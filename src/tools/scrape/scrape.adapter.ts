const JINA_PREFIX = 'https://r.jina.ai/http://';
const MARKDOWN_MARKER = 'Markdown Content:';
const DEFAULT_TIMEOUT = 20_000;
const DEFAULT_USER_AGENT = 'UmbeliToolsBot/1.0';

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function toJinaUrl(url: string): string {
  const target = normalizeUrl(url).replace(/^https?:\/\//i, '');
  return `${JINA_PREFIX}${target}`;
}

function stripJinaEnvelope(payload: string): string {
  const markerIndex = payload.indexOf(MARKDOWN_MARKER);
  if (markerIndex === -1) return payload;
  return payload.slice(markerIndex + MARKDOWN_MARKER.length).trim();
}

export async function scrapeMarkdown(url: string, timeoutMs = DEFAULT_TIMEOUT) {
  const target = toJinaUrl(url);
  const res = await fetch(target, {
    headers: {
      'user-agent': DEFAULT_USER_AGENT,
      'cache-control': 'no-cache',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    throw new Error(`jina.ai HTTP ${res.status} for ${url}`);
  }

  const text = await res.text();
  return {
    url,
    via: 'jina.ai',
    markdown: stripJinaEnvelope(text),
  };
}

export async function scrapeHtml(url: string, opts: { userAgent?: string; timeoutMs?: number } = {}) {
  const res = await fetch(normalizeUrl(url), {
    headers: {
      'user-agent': opts.userAgent || DEFAULT_USER_AGENT,
      'cache-control': 'no-cache',
    },
    signal: AbortSignal.timeout(opts.timeoutMs || DEFAULT_TIMEOUT),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }

  const html = await res.text();
  return {
    url,
    status: res.status,
    contentType: res.headers.get('content-type') || null,
    html,
  };
}
