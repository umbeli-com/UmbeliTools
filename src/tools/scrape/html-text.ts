/**
 * HTML → plain text. One implementation to replace the four hand-rolled regex
 * versions living in Noesium (gmailClient/pinterest), Webum (parser) and
 * Scrapium (normalizeText).
 *
 * Deliberately dependency-free: the service ships in a slim node:20-alpine image
 * and cheerio/jsdom would only buy a marginal accuracy gain for text extraction.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  copy: '©', reg: '®', trade: '™', deg: '°', euro: '€', pound: '£', yen: '¥', cent: '¢',
  hellip: '…', mdash: '—', ndash: '–', minus: '−', times: '×', divide: '÷', plusmn: '±',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›',
  bull: '•', middot: '·', sect: '§', para: '¶', dagger: '†', permil: '‰',
  frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³', micro: 'µ',
  ensp: ' ', emsp: ' ', thinsp: ' ', shy: '', zwj: '', zwnj: '',
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ',
  ccedil: 'ç', egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë',
  igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï', ntilde: 'ñ',
  ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø', oelig: 'œ',
  ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü', yuml: 'ÿ', szlig: 'ß',
};

/** Entities whose uppercase spelling means the same thing (&AMP; &Nbsp; …). */
const CASE_INSENSITIVE = new Set(['amp', 'lt', 'gt', 'quot', 'apos', 'nbsp', 'copy', 'reg', 'trade']);

/** Decode numeric (&#233; &#xE9;) and common named HTML entities. */
export function decodeEntities(input: string): string {
  return String(input ?? '').replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (match, body: string) => {
    if (body.charCodeAt(0) === 35 /* # */) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const codePoint = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return match;
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) return match; // lone surrogate
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }
    const exact = NAMED_ENTITIES[body];
    if (exact !== undefined) return exact;
    const lower = body.toLowerCase();
    if (CASE_INSENSITIVE.has(lower)) return NAMED_ENTITIES[lower];
    return match;
  });
}

/** Whitespace-normalised single line — Scrapium's `normalizeText`, used for length checks. */
export function normalizeText(value: string): string {
  return String(value ?? '')
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tags whose entire content is machine-only and must be dropped. */
const DROP_WITH_CONTENT = 'script|style|noscript|template|svg|math|canvas|iframe|object|embed|applet|map|audio|video';
const BLOCK_TAGS =
  'p|div|section|article|header|footer|nav|main|aside|ul|ol|li|dl|dt|dd|table|thead|tbody|tfoot|tr|h[1-6]|blockquote|pre|form|fieldset|figure|figcaption|hr|address|details|summary|title';

export interface HtmlToTextOptions {
  /** Keep paragraph structure as newlines (default true). false → one long line. */
  preserveLineBreaks?: boolean;
}

/**
 * Strip script/style/noscript & friends, turn block tags into line breaks,
 * remove the remaining markup, decode entities and collapse whitespace.
 */
export function htmlToText(html: string, opts: HtmlToTextOptions = {}): string {
  const preserveLineBreaks = opts.preserveLineBreaks !== false;
  let text = String(html ?? '');

  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1');
  text = text.replace(/<!doctype[^>]*>/gi, ' ');
  text = text.replace(/<\?[\s\S]*?\?>/g, ' ');

  // Elements dropped with their content, including an unterminated trailing one.
  text = text.replace(new RegExp(`<(${DROP_WITH_CONTENT})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi'), ' ');
  text = text.replace(new RegExp(`<(${DROP_WITH_CONTENT})\\b[^>]*>[\\s\\S]*$`, 'i'), ' ');

  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(new RegExp(`<\\/?(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi'), '\n');
  text = text.replace(/<\/?(?:td|th)\b[^>]*>/gi, '\t');
  text = text.replace(/<[^>]*>/g, ' '); // every remaining tag

  text = decodeEntities(text);

  text = text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '');

  if (!preserveLineBreaks) return normalizeText(text);

  return text
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** `<title>` content, decoded and normalised. */
export function extractTitle(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(String(html ?? ''));
  if (!match) return null;
  const title = normalizeText(decodeEntities(match[1].replace(/<[^>]*>/g, ' ')));
  return title || null;
}

function metaContent(html: string, attr: 'name' | 'property', value: string): string | null {
  const pattern = new RegExp(
    `<meta\\b[^>]*\\b${attr}\\s*=\\s*["']${value}["'][^>]*>|<meta\\b[^>]*>`,
    'gi',
  );
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(String(html ?? '')))) {
    const tag = match[0];
    const keyMatch = new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag);
    if (!keyMatch || keyMatch[1].toLowerCase() !== value.toLowerCase()) continue;
    const contentMatch = /\bcontent\s*=\s*["']([\s\S]*?)["']/i.exec(tag);
    if (!contentMatch) continue;
    const content = normalizeText(decodeEntities(contentMatch[1]));
    if (content) return content;
  }
  return null;
}

/** meta description, falling back to og:description. */
export function extractDescription(html: string): string | null {
  return metaContent(html, 'name', 'description') || metaContent(html, 'property', 'og:description');
}

/** Absolute http(s) links found in the markup, deduped and capped. */
export function extractLinks(html: string, baseUrl?: string, limit = 200): string[] {
  const out = new Set<string>();
  const pattern = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(String(html ?? ''))) && out.size < limit) {
    const raw = decodeEntities((match[1] ?? match[2] ?? match[3] ?? '').trim());
    if (!raw || raw.startsWith('#') || /^(javascript|mailto|tel|data):/i.test(raw)) continue;
    try {
      const resolved = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') out.add(resolved.toString());
    } catch {
      /* skip unparseable href */
    }
  }
  return [...out];
}
