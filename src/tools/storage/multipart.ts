/**
 * Minimal `multipart/form-data` reader — deliberately dependency-free.
 *
 * Why not multer: multer is an Express-middleware framework around busboy and
 * would be a new runtime dependency for one endpoint. We buffer the body with
 * `express.raw()` (which we already have) and walk it once. Scope on purpose:
 *   - the whole body is already in memory (same as multer.memoryStorage())
 *   - text fields are decoded as UTF-8
 *   - only the FIRST file part is kept; extra file parts are ignored
 *   - no `multipart/mixed`, no chunked transfer-encoding inside parts
 * Anything malformed throws, and the route turns that into a 400.
 */

export interface MultipartFile {
  field: string;
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface ParsedMultipart {
  fields: Record<string, string>;
  file: MultipartFile | null;
}

const CRLF = Buffer.from('\r\n');
const DOUBLE_CRLF = Buffer.from('\r\n\r\n');

export function boundaryFromContentType(contentType: string | undefined): string | null {
  if (!contentType) return null;
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = (match?.[1] ?? match?.[2] ?? '').trim();
  return boundary || null;
}

export function parseMultipart(body: Buffer, boundary: string): ParsedMultipart {
  if (!Buffer.isBuffer(body) || body.length === 0) throw new Error('empty multipart body');
  if (boundary.length > 200) throw new Error('multipart boundary is too long');

  const delimiter = Buffer.from(`--${boundary}`);
  const fields: Record<string, string> = {};
  let file: MultipartFile | null = null;

  let cursor = body.indexOf(delimiter);
  if (cursor < 0) throw new Error('multipart boundary not found in body');

  while (cursor >= 0) {
    let partStart = cursor + delimiter.length;

    // Closing delimiter: `--boundary--`
    if (body.slice(partStart, partStart + 2).toString('latin1') === '--') break;
    // Skip the CRLF that follows the delimiter (tolerate a bare LF).
    if (body.slice(partStart, partStart + 2).equals(CRLF)) partStart += 2;
    else if (body[partStart] === 0x0a) partStart += 1;

    const nextDelimiter = body.indexOf(delimiter, partStart);
    if (nextDelimiter < 0) throw new Error('unterminated multipart part');

    // The CRLF immediately before the next delimiter belongs to the delimiter.
    let partEnd = nextDelimiter;
    if (partEnd >= 2 && body.slice(partEnd - 2, partEnd).equals(CRLF)) partEnd -= 2;

    const headerEnd = body.indexOf(DOUBLE_CRLF, partStart);
    if (headerEnd < 0 || headerEnd > partEnd) throw new Error('multipart part has no header block');

    const headerText = body.slice(partStart, headerEnd).toString('utf8');
    const content = body.slice(headerEnd + DOUBLE_CRLF.length, partEnd);
    const headers = parseHeaders(headerText);

    const disposition = headers['content-disposition'] || '';
    const field = readDispositionParam(disposition, 'name');
    const filename = readDispositionParam(disposition, 'filename');

    if (field !== null) {
      if (filename !== null) {
        if (!file) {
          file = {
            field,
            filename,
            contentType: (headers['content-type'] || '').split(';')[0].trim(),
            data: content,
          };
        }
      } else {
        fields[field] = content.toString('utf8');
      }
    }

    cursor = nextDelimiter;
  }

  return { fields, file };
}

function parseHeaders(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    out[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return out;
}

function readDispositionParam(disposition: string, param: string): string | null {
  const quoted = new RegExp(`${param}\\s*=\\s*"([^"]*)"`, 'i').exec(disposition);
  if (quoted) return quoted[1];
  const bare = new RegExp(`${param}\\s*=\\s*([^;]+)`, 'i').exec(disposition);
  return bare ? bare[1].trim() : null;
}
