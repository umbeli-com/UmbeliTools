import type { StorageKind } from './types';

/**
 * Extension -> canonical MIME type.
 *
 * This is the *correction* map, lifted and extended from Socialum's
 * `media.routes.js`. Browsers lie about MIME types constantly:
 *   - iOS Safari sends `application/octet-stream` for .heic/.heif
 *   - several browsers send the non-existent `image/jpg` for .jpg
 *   - Windows/Excel sends `application/vnd.ms-excel` for a plain .csv
 *   - .mkv/.avi/.m4v/.3gp/.mts usually arrive as `application/octet-stream`
 *   - Office files sometimes arrive as `application/zip`
 * So: when we know the extension, the extension wins. The client-declared
 * `contentType` is only a fallback for extensions not in this map.
 */
export const MIME_BY_EXTENSION: Record<string, string> = {
  // images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  // video
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.webm': 'video/webm',
  '.m4v': 'video/x-m4v',
  '.3gp': 'video/3gpp',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.mts': 'video/mp2t',
  '.ts': 'video/mp2t',
  '.ogv': 'video/ogg',
  // audio
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.flac': 'audio/flac',
  '.weba': 'audio/webm',
  // documents
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.rtf': 'application/rtf',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.ics': 'text/calendar',
  '.vcf': 'text/vcard',
  // archives
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
};

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.heic', '.heif',
  '.bmp', '.tif', '.tiff', '.ico', '.svg',
]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm',
  '.m4v', '.3gp', '.mpeg', '.mpg', '.mts', '.ts', '.ogv',
]);

const DOCUMENT_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.odt', '.ods', '.rtf', '.csv', '.txt', '.md', '.json', '.xml', '.ics', '.vcf',
]);

const OTHER_EXTENSIONS = new Set([
  '.mp3', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.opus', '.flac', '.weba',
  '.zip', '.gz',
]);

/** Everything the upload endpoint accepts. Anything else is rejected outright. */
export const ALLOWED_EXTENSIONS: string[] = [
  ...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, ...DOCUMENT_EXTENSIONS, ...OTHER_EXTENSIONS,
].sort();

const ALLOWED_SET = new Set(ALLOWED_EXTENSIONS);

/**
 * A syntactically valid `type/subtype` — RFC 9110 tokens, nothing else.
 * The resolved value is interpolated into the `Content-Type` REQUEST header sent
 * to Supabase, so a declared type carrying a CR/LF or a stray control byte must
 * never survive the fallback path.
 */
const MIME_TOKEN_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+\/[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/** MIME prefixes/values accepted as a *fallback* when the extension is unknown to us. */
const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/', 'text/'];
const ALLOWED_MIME_EXACT = new Set(Object.values(MIME_BY_EXTENSION));

/** Lowercased extension including the leading dot, or '' when there is none. */
export function extensionOf(filename: string): string {
  const base = String(filename || '').split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot).toLowerCase();
}

export function isAllowedExtension(ext: string): boolean {
  return ALLOWED_SET.has(ext);
}

/**
 * Resolve the content type we will actually store.
 * Extension map wins; the client-declared type is only used when we don't know the
 * extension, and even then it must look like a real media/text type.
 */
export function resolveContentType(filename: string, declared?: string): string {
  const ext = extensionOf(filename);
  const mapped = MIME_BY_EXTENSION[ext];
  if (mapped) return mapped;

  const clean = String(declared || '').split(';')[0].trim().toLowerCase();
  if (!clean || !MIME_TOKEN_RE.test(clean)) return 'application/octet-stream';
  if (ALLOWED_MIME_EXACT.has(clean)) return clean;
  if (ALLOWED_MIME_PREFIXES.some((p) => clean.startsWith(p))) return clean;
  return 'application/octet-stream';
}

/** Classify a stored object for the `list` action. */
export function classify(nameOrKey: string, contentType?: string | null): StorageKind {
  const ext = extensionOf(nameOrKey);
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
  if (OTHER_EXTENSIONS.has(ext)) return 'other';

  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (
    mime === 'application/pdf' ||
    mime.startsWith('text/') ||
    mime.startsWith('application/vnd.openxmlformats-') ||
    mime.startsWith('application/vnd.oasis.opendocument') ||
    mime === 'application/msword' ||
    mime === 'application/vnd.ms-excel' ||
    mime === 'application/vnd.ms-powerpoint' ||
    mime === 'application/rtf' ||
    mime === 'application/json' ||
    mime === 'application/xml'
  ) return 'document';
  return 'other';
}
