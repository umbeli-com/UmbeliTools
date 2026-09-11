import { randomBytes } from 'crypto';
import { extensionOf } from './mime';

export const MAX_KEY_LENGTH = 512;
export const MAX_KEY_SEGMENTS = 12;
export const MAX_SEGMENT_LENGTH = 200;

/**
 * The one and only shape of key this tool will ever create or act on.
 * First char must be alphanumeric, which kills `.`, `..`, `.hidden` and empty
 * segments in a single rule. No spaces, no `%`, no unicode, no backslash.
 */
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Bucket names in Supabase: lowercase alnum plus `-`/`_`/`.`. */
const BUCKET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,99}$/;

export function isSafeBucket(bucket: unknown): bucket is string {
  return typeof bucket === 'string' && BUCKET_RE.test(bucket);
}

/**
 * Strict key guard. Everything the `delete` and `sign-url` endpoints touch has to
 * pass this, so an attacker cannot walk out of the intended folder, smuggle a
 * second path through percent-encoding, or aim at a control-character name.
 */
export function isSafeKey(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) return false;
  // Reject anything non-ASCII-printable outright (control chars, NUL, unicode
  // look-alikes, RTL overrides).
  if (!/^[\x21-\x7e]+$/.test(key)) return false;
  // No leftover encoding, no windows separators, no globbing, no query/fragment
  // smuggling, no absolute or trailing slash.
  if (/[%\\*?"'<>|:;,&#\s]/.test(key)) return false;
  if (key.startsWith('/') || key.endsWith('/') || key.includes('//')) return false;

  const segments = key.split('/');
  if (segments.length > MAX_KEY_SEGMENTS) return false;
  return segments.every(
    (s) => s.length > 0 && s.length <= MAX_SEGMENT_LENGTH && SEGMENT_RE.test(s),
  );
}

/** A prefix is just a key that may also be a single folder segment. */
export function isSafePrefix(prefix: unknown): prefix is string {
  return typeof prefix === 'string' && prefix.length > 0 && isSafeKey(prefix);
}

/** True when `key` is `prefix` itself or sits under it, on a segment boundary. */
export function isUnderPrefix(key: string, prefix: string): boolean {
  const clean = prefix.replace(/\/+$/, '');
  return key === clean || key.startsWith(`${clean}/`);
}

/**
 * Turn an arbitrary user file name into one safe key segment.
 * Accents are stripped rather than encoded so the result always satisfies
 * SEGMENT_RE — which is what makes `deleteByUrl` able to be this strict.
 */
export function sanitizeFilename(filename: string): string {
  const raw = String(filename || '').split(/[\\/]/).pop() || '';
  const ext = extensionOf(raw);
  const base = ext ? raw.slice(0, raw.length - ext.length) : raw;

  const cleanBase = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/[^A-Za-z0-9]+$/, '')
    .slice(0, 80);

  const cleanExt = /^\.[A-Za-z0-9]{1,12}$/.test(ext) ? ext.toLowerCase() : '';
  return `${cleanBase || 'file'}${cleanExt}`;
}

/** `<prefix>/<epoch>-<rand>-<safe name>` — unique, sortable, and always safe. */
export function buildKey(filename: string, prefix?: string): string {
  const safeName = sanitizeFilename(filename);
  const unique = `${Date.now()}-${randomBytes(4).toString('hex')}-${safeName}`;
  const key = prefix ? `${prefix.replace(/\/+$/, '')}/${unique}` : unique;
  return key.slice(0, MAX_KEY_LENGTH);
}

/** Percent-encode a key for use in a request path (segment by segment). */
export function encodeKeyPath(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

export interface KeyFromUrlResult {
  key?: string;
  reason?: string;
}

/**
 * Reverse a URL we previously handed out back into an object key.
 *
 * Deliberately paranoid — this is the input an attacker controls when trying to
 * delete somebody else's object with our service_role key:
 *   1. must parse as an absolute http(s) URL
 *   2. origin must equal the caller's own Supabase project origin
 *   3. path must be one of the known Supabase Storage object shapes
 *   4. the bucket segment must equal the caller's own bucket, exactly
 *   5. each remaining segment is decoded ONCE; a decoded `/` or `%` is fatal
 *   6. the reassembled key must pass `isSafeKey`
 * Anything else returns `{ reason }` and the caller turns that into a 400.
 */
export function keyFromUrl(rawUrl: string, projectUrl: string, bucket: string): KeyFromUrlResult {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return { reason: 'url is empty' };

  let target: URL;
  let project: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return { reason: 'url is not an absolute URL' };
  }
  try {
    project = new URL(projectUrl);
  } catch {
    return { reason: 'credentials.url is not a valid URL' };
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return { reason: `unsupported protocol "${target.protocol}"` };
  }
  if (target.origin.toLowerCase() !== project.origin.toLowerCase()) {
    return { reason: `url origin ${target.origin} does not belong to the Supabase project ${project.origin}` };
  }
  if (target.username || target.password) return { reason: 'url must not contain credentials' };

  // Raw path segments — never touch target.pathname as a whole string, and never
  // decode twice.
  const rawSegments = target.pathname.split('/').filter((s) => s.length > 0);
  if (rawSegments[0] !== 'storage' || rawSegments[1] !== 'v1') {
    return { reason: 'url is not a Supabase Storage object URL' };
  }

  let rest = rawSegments.slice(2);
  if (rest[0] === 'render' && rest[1] === 'image') {
    // /storage/v1/render/image/public/<bucket>/<key> — image transform URLs have
    // no `object` segment.
    rest = rest.slice(2);
  } else {
    // /storage/v1/object/... — every other object URL shape.
    if (rest[0] !== 'object') return { reason: 'url is not a Supabase Storage object URL' };
    rest = rest.slice(1);
  }
  // {public|sign|authenticated}/<bucket>/<key>, or plain <bucket>/<key>
  if (rest[0] === 'public' || rest[0] === 'sign' || rest[0] === 'authenticated') rest = rest.slice(1);

  if (rest.length < 2) return { reason: 'url does not contain a bucket and an object key' };

  const urlBucket = safeDecode(rest[0]);
  if (urlBucket === null) return { reason: 'bucket segment is not decodable' };
  if (urlBucket !== bucket) {
    return { reason: `url points at bucket "${urlBucket}", not "${bucket}"` };
  }

  const keySegments: string[] = [];
  for (const seg of rest.slice(1)) {
    const decoded = safeDecode(seg);
    if (decoded === null) return { reason: 'object key is not decodable' };
    // A decoded separator or a surviving `%` means someone double-encoded.
    if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('%')) {
      return { reason: 'object key contains an encoded path separator' };
    }
    keySegments.push(decoded);
  }

  const key = keySegments.join('/');
  if (!isSafeKey(key)) {
    return { reason: 'resolved key does not match the allowed key pattern' };
  }
  return { key };
}

function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}
