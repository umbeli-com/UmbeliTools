/**
 * Headless-Chromium fallback for client-rendered pages (SPA shells from Bolt /
 * Lovable / v0 / Next / Vite bundles), ported from Webum's csr-render.service.
 *
 * Playwright is NOT a dependency of this service — the prod image is
 * node:20-alpine and a Chromium install would add ~400 MB. The module is loaded
 * lazily at request time; when it is missing the route answers CONFIG_ERROR
 * instead of the process failing at boot.
 */
import { htmlToText, normalizeText, extractTitle } from './html-text';
import { assertSafeUrl, isSafeUrl } from './ssrf.guard';

/**
 * `document` only exists inside the page callback below, which Playwright
 * serialises and runs in Chromium — never in this Node process.
 */
declare const document: any;

export class BrowserUnavailableError extends Error {
  readonly code = 'CONFIG_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'BrowserUnavailableError';
  }
}

/** Total inline <script> character count — a proxy for "ships a JS bundle". */
export function inlineScriptChars(html: string): number {
  let total = 0;
  const re = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) total += m[1].length;
  return total;
}

function externalScriptCount(html: string): number {
  const matches = html.match(/<script\b[^>]*\bsrc\s*=/gi);
  return matches ? matches.length : 0;
}

/** Common SPA mount points / builder loader shells (Webum's list). */
const SPA_SHELL_RE =
  /id=["'](?:__bundler_loading|__bundler_thumbnail|root|app|__next|___gatsby|svelte|q-app|q-modal)["']/i;

export interface CsrDetection {
  likelyClientRendered: boolean;
  reason: string;
  /** Length of the normalised visible text found by the static parse. */
  staticTextLength: number;
  inlineScriptChars: number;
  externalScripts: number;
  spaShell: boolean;
}

/**
 * True when the static parse found ~no content AND the document looks like a
 * client-rendered app. Gated on the static text length so normal static sites
 * never trigger a (costly) render.
 */
export function detectClientRendered(html: string, opts: { minTextLength?: number } = {}): CsrDetection {
  const minTextLength = opts.minTextLength ?? 500;
  const source = String(html ?? '');
  const staticTextLength = normalizeText(htmlToText(source, { preserveLineBreaks: false })).length;
  const inline = inlineScriptChars(source);
  const external = externalScriptCount(source);
  const spaShell = SPA_SHELL_RE.test(source);

  const base: Omit<CsrDetection, 'likelyClientRendered' | 'reason'> = {
    staticTextLength,
    inlineScriptChars: inline,
    externalScripts: external,
    spaShell,
  };

  if (staticTextLength > minTextLength) {
    return { ...base, likelyClientRendered: false, reason: 'static-content-sufficient' };
  }
  if (inline > 20_000) return { ...base, likelyClientRendered: true, reason: 'large-inline-bundle' };
  if (spaShell) return { ...base, likelyClientRendered: true, reason: 'spa-shell-detected' };
  if (staticTextLength < 200 && external > 0) {
    return { ...base, likelyClientRendered: true, reason: 'empty-shell-with-external-scripts' };
  }
  return { ...base, likelyClientRendered: false, reason: 'no-csr-signal' };
}

async function launchBrowser(timeoutMs: number): Promise<{ browser: any; module: string }> {
  let mod: any;
  let name = '';
  for (const candidate of ['playwright', 'playwright-core']) {
    try {
      // Non-literal specifier so tsc does not require the (absent) types, and so
      // a slim image without Chromium simply fails here instead of at boot.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require(candidate);
      name = candidate;
      break;
    } catch {
      /* try the next one */
    }
  }
  if (!mod?.chromium) {
    throw new BrowserUnavailableError(
      'Headless rendering is unavailable: playwright is not installed in this image. ' +
        'Install it (npm i playwright && npx playwright install --with-deps chromium) or run the ' +
        'mcr.microsoft.com/playwright base image, then retry render-html.',
    );
  }

  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
  try {
    const browser = await mod.chromium.launch({
      headless: true,
      timeout: timeoutMs,
      executablePath,
      // --no-sandbox is required to launch Chromium as root inside Docker.
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    return { browser, module: name };
  } catch (err: any) {
    throw new BrowserUnavailableError(
      `Chromium could not be launched (${err?.message || String(err)}). The container is missing the browser ` +
        'binary or its shared libraries — see `npx playwright install --with-deps chromium`.',
    );
  }
}

export interface RenderInput {
  /** Navigate to this URL (already SSRF-guarded by the caller). */
  url?: string;
  /** …or render this markup directly (single-file bundles). */
  html?: string;
  timeoutMs?: number;
  /** Extra settle time after load, for bundles that hydrate late. */
  waitMs?: number;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  userAgent?: string;
  /** Remove <script>/loader shells from the snapshot (default true). */
  stripScripts?: boolean;
  viewport?: { width: number; height: number };
}

export interface RenderOutput {
  html: string;
  finalUrl: string | null;
  title: string | null;
  renderedWith: string;
  blockedRequests: number;
}

const LOADER_SELECTORS = '#__bundler_loading, #__bundler_thumbnail';

/**
 * Render in Chromium and return a CLEAN static snapshot the normal parser can
 * read. Throws BrowserUnavailableError when the browser is missing; other
 * failures surface as plain Errors.
 */
export async function renderToStaticHtml(input: RenderInput): Promise<RenderOutput> {
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 30_000, 5_000), 120_000);
  const waitMs = Math.min(Math.max(input.waitMs ?? 2_500, 0), 15_000);
  const waitUntil = input.waitUntil ?? 'networkidle';
  const stripScripts = input.stripScripts !== false;

  const { browser, module } = await launchBrowser(timeoutMs);
  let blockedRequests = 0;

  try {
    const context = await browser.newContext({
      userAgent: input.userAgent,
      viewport: input.viewport ?? { width: 1366, height: 900 },
      javaScriptEnabled: true,
    });

    // The SSRF guard must also cover what the PAGE fetches: a rendered bundle can
    // request http://169.254.169.254/ on its own.
    await context.route('**/*', async (route: any) => {
      const requestUrl: string = route.request().url();
      if (/^(data|blob|about):/i.test(requestUrl)) return route.continue();
      if (!/^https?:/i.test(requestUrl) || !(await isSafeUrl(requestUrl))) {
        blockedRequests++;
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });

    const page = await context.newPage();

    if (input.url) {
      await page.goto(input.url, { waitUntil, timeout: timeoutMs }).catch(() => {
        /* networkidle times out on chatty bundles — keep whatever rendered */
      });
    } else {
      await page.setContent(String(input.html ?? ''), { waitUntil, timeout: timeoutMs }).catch(() => {});
    }
    if (waitMs) await page.waitForTimeout(waitMs);

    const snapshot: string = await page.evaluate(
      ({ strip, loaders }: { strip: boolean; loaders: string }) => {
        if (strip) {
          document.querySelectorAll(`script, template, ${loaders}`).forEach((el: any) => el.remove());
        }
        return '<!doctype html>\n' + document.documentElement.outerHTML;
      },
      { strip: stripScripts, loaders: LOADER_SELECTORS },
    );

    const finalUrl: string | null = input.url ? await page.url() : null;
    return {
      html: snapshot,
      finalUrl,
      title: extractTitle(snapshot),
      renderedWith: `${module}/chromium`,
      blockedRequests,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Guard helper re-exported so routes keep one import surface. */
export { assertSafeUrl };
