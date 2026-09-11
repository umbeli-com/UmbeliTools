import express, { Router } from 'express';
import type { ToolDefinition } from '../../types/tool';
import { sendSuccess, sendError } from '../../lib/response';
import { SupabaseStorageAdapter, describeStorageError } from './supabase.adapter';
import { boundaryFromContentType, parseMultipart } from './multipart';
import {
  buildKey,
  isSafeBucket,
  isSafeKey,
  isSafePrefix,
  isUnderPrefix,
  keyFromUrl,
} from './keys';
import { ALLOWED_EXTENSIONS, classify, extensionOf, isAllowedExtension, resolveContentType } from './mime';
import type {
  StorageCredentials,
  StorageDeleteInput,
  StorageEntry,
  StorageListInput,
  StorageSignUrlInput,
  StorageUploadInput,
} from './types';

const PROVIDER = 'supabase-storage';

/** The only `sortBy` values Supabase Storage accepts — and the ones our schema advertises. */
const SORT_COLUMNS = new Set(['name', 'updated_at', 'created_at', 'last_accessed_at']);
const SORT_ORDERS = new Set(['asc', 'desc']);

export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
export const HARD_MAX_BYTES = 500 * 1024 * 1024; // 500 MB — Socialum's video ceiling
const MAX_SIGN_EXPIRES_IN = 7 * 24 * 60 * 60; // 7 days
const DEFAULT_SIGN_EXPIRES_IN = 3600;

const router = Router();

/**
 * Multipart bodies arrive here untouched: the app-level `express.json()` only
 * claims `application/json`, so it never sees (or size-caps) them. We buffer the
 * raw bytes and parse them ourselves — see multipart.ts for why not multer.
 */
const rawMultipart = express.raw({ type: 'multipart/form-data', limit: HARD_MAX_BYTES });

/** Validate the credentials block every action needs. Returns null when it is fine. */
function credentialsProblem(creds: StorageCredentials | undefined): string | null {
  if (!creds || typeof creds !== 'object') return 'credentials { url, serviceRoleKey, bucket } is required';
  if (!creds.url) return 'credentials.url is required';
  if (!creds.serviceRoleKey) return 'credentials.serviceRoleKey is required';
  if (!creds.bucket) return 'credentials.bucket is required';
  // Every one of the three ends up in a URL or in a request header. A non-string
  // (a JSON number, object or array) used to sail through here and only fail as a
  // 502 from the provider — or, for `serviceRoleKey`, as an "[object Object]"
  // Authorization header. That is the caller's mistake and must read as a 400.
  if (typeof creds.url !== 'string') return 'credentials.url must be a string';
  if (typeof creds.serviceRoleKey !== 'string') return 'credentials.serviceRoleKey must be a string';
  if (typeof creds.bucket !== 'string') return 'credentials.bucket must be a string';
  if (!isSafeBucket(creds.bucket)) return 'credentials.bucket contains invalid characters';
  try {
    const parsed = new URL(String(creds.url));
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'credentials.url must be http(s)';
  } catch {
    return 'credentials.url must be an absolute URL';
  }
  return null;
}

/** Resolve `key` | `url` into a key, applying the optional tenant guard. */
function resolveTargetKey(
  input: { key?: string; url?: string; requirePrefix?: string },
  creds: StorageCredentials,
): { key: string } | { status: number; code: string; message: string } {
  const hasKey = typeof input.key === 'string' && input.key.length > 0;
  const hasUrl = typeof input.url === 'string' && input.url.length > 0;

  if (!hasKey && !hasUrl) {
    return { status: 400, code: 'MISSING_FIELDS', message: 'one of key or url is required' };
  }
  if (hasKey && hasUrl) {
    return { status: 400, code: 'INVALID_FIELD', message: 'pass either key or url, not both' };
  }

  let key: string;
  if (hasKey) {
    if (!isSafeKey(input.key)) {
      return {
        status: 400,
        code: 'INVALID_FIELD',
        message: 'key does not match the allowed key pattern (segments of [A-Za-z0-9._-], no leading dot, no traversal)',
      };
    }
    key = input.key as string;
  } else {
    const resolved = keyFromUrl(input.url as string, creds.url, creds.bucket);
    if (!resolved.key) {
      return { status: 400, code: 'INVALID_FIELD', message: `url rejected: ${resolved.reason}` };
    }
    key = resolved.key;
  }

  if (input.requirePrefix !== undefined) {
    if (!isSafePrefix(input.requirePrefix)) {
      return { status: 400, code: 'INVALID_FIELD', message: 'requirePrefix is not a valid prefix' };
    }
    if (!isUnderPrefix(key, input.requirePrefix)) {
      return {
        status: 403,
        code: 'FORBIDDEN_KEY',
        message: `resolved key "${key}" is not under requirePrefix "${input.requirePrefix}"`,
      };
    }
  }

  return { key };
}

/** Multipart form fields -> the same input shape the JSON path uses. */
function inputFromFields(fields: Record<string, string>): StorageUploadInput {
  let credentials: StorageCredentials | undefined;
  if (fields.credentials) {
    try {
      credentials = JSON.parse(fields.credentials) as StorageCredentials;
    } catch {
      credentials = undefined;
    }
  }
  if (!credentials) {
    credentials = {
      url: fields.url || '',
      serviceRoleKey: fields.serviceRoleKey || '',
      bucket: fields.bucket || '',
    };
  }
  const num = (v: string | undefined) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);
  return {
    credentials,
    filename: fields.filename || undefined,
    contentType: fields.contentType || undefined,
    prefix: fields.prefix || undefined,
    key: fields.key || undefined,
    upsert: fields.upsert === 'true' || fields.upsert === '1',
    maxSizeBytes: num(fields.maxSizeBytes),
    cacheControlSeconds: num(fields.cacheControlSeconds),
    signUrlExpiresIn: num(fields.signUrlExpiresIn),
  };
}

/**
 * A caller-supplied number, forced to an integer in `[1, max]`.
 * Supabase's own schemas reject floats, and several of these values end up in a
 * request header or a JSON body upstream, so nothing but an integer may pass.
 */
function positiveInt(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return Math.min(fallback, max);
  return Math.min(Math.floor(n), max);
}

/** Strict base64 decode. Rejects data URLs with a non-base64 payload. */
function decodeBase64(raw: string): Buffer | null {
  let payload = raw.trim();
  const dataUrl = /^data:([^;,]*)(;[^,]*)?,/i.exec(payload);
  if (dataUrl) {
    if (!/;base64/i.test(dataUrl[2] || '')) return null;
    payload = payload.slice(dataUrl[0].length);
  }
  payload = payload.replace(/\s+/g, '');
  if (!payload || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return null;
  const buf = Buffer.from(payload, 'base64');
  return buf.length > 0 ? buf : null;
}

/** MIME declared inside a data: URL, used only as a fallback. */
function contentTypeFromDataUrl(raw: string): string | undefined {
  const m = /^data:([^;,]+)[;,]/i.exec(raw.trim());
  return m ? m[1] : undefined;
}

// ─────────────────────────────── upload ───────────────────────────────
router.post('/upload', rawMultipart, async (req, res) => {
  const start = Date.now();
  const contentTypeHeader = String(req.headers['content-type'] || '');
  const isMultipart = contentTypeHeader.toLowerCase().includes('multipart/form-data');

  let input: StorageUploadInput;
  let buffer: Buffer;
  let filename: string;
  let declaredType: string | undefined;

  if (isMultipart) {
    const boundary = boundaryFromContentType(contentTypeHeader);
    if (!boundary) return sendError(res, 400, 'INVALID_FIELD', 'multipart request has no boundary');
    if (!Buffer.isBuffer(req.body)) {
      return sendError(res, 400, 'INVALID_FIELD', 'multipart body could not be buffered');
    }
    let parsed;
    try {
      parsed = parseMultipart(req.body, boundary);
    } catch (err: any) {
      return sendError(res, 400, 'INVALID_FIELD', `multipart parse failed: ${err.message}`);
    }
    if (!parsed.file) return sendError(res, 400, 'MISSING_FIELDS', 'no file part found in the multipart body');

    input = inputFromFields(parsed.fields);
    buffer = parsed.file.data;
    filename = input.filename || parsed.file.filename || '';
    declaredType = input.contentType || parsed.file.contentType || undefined;
  } else {
    input = (req.body || {}) as StorageUploadInput;
    if (!input.fileBase64) {
      return sendError(res, 400, 'MISSING_FIELDS', 'fileBase64 is required (or send the request as multipart/form-data)');
    }
    const decoded = decodeBase64(String(input.fileBase64));
    if (!decoded) return sendError(res, 400, 'INVALID_FIELD', 'fileBase64 is not valid base64 / a base64 data URL');
    buffer = decoded;
    filename = input.filename || '';
    declaredType = input.contentType || contentTypeFromDataUrl(String(input.fileBase64));
  }

  const credsProblem = credentialsProblem(input.credentials);
  if (credsProblem) return sendError(res, 400, 'MISSING_CREDENTIALS', credsProblem);
  const creds = input.credentials;

  if (!filename && !input.key) {
    return sendError(res, 400, 'MISSING_FIELDS', 'filename is required (or pass an explicit key)');
  }

  // Size cap, enforced on the decoded bytes.
  const cap = Math.min(
    Math.max(1, Number(input.maxSizeBytes) || DEFAULT_MAX_BYTES),
    HARD_MAX_BYTES,
  );
  if (buffer.length > cap) {
    return sendError(
      res,
      413,
      'FILE_TOO_LARGE',
      `file is ${buffer.length} bytes, limit is ${cap} bytes`,
    );
  }

  // Extension allowlist. When an explicit key is supplied it is the name the
  // object will REALLY carry, so it is the one that has to pass: checking only
  // `filename` let `{ filename: "a.png", key: "u1/evil.html" }` write an
  // arbitrary extension into the bucket, which is exactly what the allowlist
  // exists to prevent. The stored content type comes from the same name.
  const explicitKey = typeof input.key === 'string' && input.key.length > 0 ? input.key : undefined;
  const nameForType = explicitKey ?? filename;
  const ext = extensionOf(nameForType);
  if (!ext || !isAllowedExtension(ext)) {
    return sendError(
      res,
      400,
      'INVALID_FIELD',
      `unsupported file extension "${ext || '(none)'}"${explicitKey ? ' on key' : ''}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
    );
  }
  const contentType = resolveContentType(nameForType, declaredType);

  // Key: explicit (strictly validated) or generated from prefix + safe filename.
  let key: string;
  if (explicitKey) {
    if (!isSafeKey(explicitKey)) {
      return sendError(res, 400, 'INVALID_FIELD', 'key does not match the allowed key pattern');
    }
    key = explicitKey;
  } else {
    // `prefix: ""` means the bucket root, the same as omitting it — `list`
    // already reads it that way, and only `upload` used to 400 on it.
    const prefix = input.prefix === '' ? undefined : input.prefix;
    if (prefix !== undefined && !isSafePrefix(prefix)) {
      return sendError(res, 400, 'INVALID_FIELD', 'prefix does not match the allowed key pattern');
    }
    key = buildKey(filename, prefix);
  }

  // Same tenant guard as `delete`/`sign-url`. Without it an app that forwards a
  // user-supplied `key` (or `prefix`) lets one of its users overwrite another
  // tenant's object with `upsert: true` — a destructive write the service_role
  // key is happy to perform.
  if (input.requirePrefix !== undefined) {
    if (!isSafePrefix(input.requirePrefix)) {
      return sendError(res, 400, 'INVALID_FIELD', 'requirePrefix is not a valid prefix');
    }
    if (!isUnderPrefix(key, input.requirePrefix)) {
      return sendError(
        res,
        403,
        'FORBIDDEN_KEY',
        `key "${key}" is not under requirePrefix "${input.requirePrefix}"`,
      );
    }
  }

  const adapter = new SupabaseStorageAdapter(creds);
  try {
    await adapter.upload(key, buffer, {
      contentType,
      upsert: Boolean(input.upsert),
      // Coerced, not forwarded: this value is interpolated into a `cache-control`
      // REQUEST header, so a caller-supplied string must never reach it raw.
      cacheControlSeconds: positiveInt(input.cacheControlSeconds, 3600, 31_536_000),
    });

    let signedUrl: string | undefined;
    if (input.signUrlExpiresIn) {
      const expiresIn = positiveInt(input.signUrlExpiresIn, DEFAULT_SIGN_EXPIRES_IN, MAX_SIGN_EXPIRES_IN);
      signedUrl = await adapter.signUrl(key, expiresIn);
    }

    sendSuccess(
      res,
      {
        url: adapter.publicUrl(key),
        key,
        size: buffer.length,
        contentType,
        bucket: creds.bucket,
        kind: classify(key, contentType),
        signedUrl,
      },
      { durationMs: Date.now() - start, provider: PROVIDER },
    );
  } catch (err) {
    sendError(res, 502, 'PROVIDER_ERROR', describeStorageError(err), undefined, {
      durationMs: Date.now() - start,
      provider: PROVIDER,
    });
  }
});

// ──────────────────────────────── list ────────────────────────────────
router.post('/list', async (req, res) => {
  const start = Date.now();
  const input = (req.body || {}) as StorageListInput;

  const credsProblem = credentialsProblem(input.credentials);
  if (credsProblem) return sendError(res, 400, 'MISSING_CREDENTIALS', credsProblem);
  const creds = input.credentials;

  if (input.prefix !== undefined && input.prefix !== '' && !isSafePrefix(input.prefix)) {
    return sendError(res, 400, 'INVALID_FIELD', 'prefix does not match the allowed key pattern');
  }

  if (input.search !== undefined && typeof input.search !== 'string') {
    return sendError(res, 400, 'INVALID_FIELD', 'search must be a string');
  }
  // The action's inputSchema advertises an enum for both of these; until now the
  // handler forwarded whatever arrived straight into Supabase's list body, which
  // made the schema a lie and pushed a caller error out as a 502.
  let sortBy: { column: string; order: string } | undefined;
  if (input.sortBy !== undefined) {
    if (typeof input.sortBy !== 'object' || input.sortBy === null || Array.isArray(input.sortBy)) {
      return sendError(res, 400, 'INVALID_FIELD', 'sortBy must be an object { column, order }');
    }
    const column = input.sortBy.column ?? 'name';
    const order = input.sortBy.order ?? 'asc';
    if (!SORT_COLUMNS.has(column)) {
      return sendError(res, 400, 'INVALID_FIELD', `sortBy.column must be one of ${[...SORT_COLUMNS].join(', ')}`);
    }
    if (!SORT_ORDERS.has(order)) {
      return sendError(res, 400, 'INVALID_FIELD', 'sortBy.order must be "asc" or "desc"');
    }
    sortBy = { column, order };
  }

  const prefix = (input.prefix || '').replace(/\/+$/, '');
  const limit = positiveInt(input.limit, 100, 1000);
  const offset = Math.max(0, Math.floor(Number(input.offset)) || 0);

  const adapter = new SupabaseStorageAdapter(creds);
  try {
    const rows = await adapter.list({
      prefix,
      limit,
      offset,
      search: input.search,
      sortBy,
    });

    const entries: StorageEntry[] = rows.map((row) => {
      const key = prefix ? `${prefix}/${row.name}` : row.name;
      // Supabase returns pseudo-folders with a null id and null metadata.
      const isFolder = row.id === null && !row.metadata;
      const contentType = (row.metadata?.mimetype as string | undefined) ?? null;
      return {
        key,
        name: row.name,
        size: typeof row.metadata?.size === 'number' ? row.metadata.size : null,
        contentType,
        kind: isFolder ? 'other' : classify(row.name, contentType),
        isFolder,
        updatedAt: row.updated_at ?? null,
        createdAt: row.created_at ?? null,
        url: adapter.publicUrl(key),
      };
    });

    sendSuccess(
      res,
      {
        entries,
        count: entries.length,
        prefix,
        bucket: creds.bucket,
        limit,
        offset,
        hasMore: entries.length === limit,
      },
      { durationMs: Date.now() - start, provider: PROVIDER },
    );
  } catch (err) {
    sendError(res, 502, 'PROVIDER_ERROR', describeStorageError(err), undefined, {
      durationMs: Date.now() - start,
      provider: PROVIDER,
    });
  }
});

// ─────────────────────────────── delete ───────────────────────────────
router.post('/delete', async (req, res) => {
  const start = Date.now();
  const input = (req.body || {}) as StorageDeleteInput;

  const credsProblem = credentialsProblem(input.credentials);
  if (credsProblem) return sendError(res, 400, 'MISSING_CREDENTIALS', credsProblem);
  const creds = input.credentials;

  const resolved = resolveTargetKey(input, creds);
  if ('status' in resolved) return sendError(res, resolved.status, resolved.code, resolved.message);

  const adapter = new SupabaseStorageAdapter(creds);
  try {
    const removed = await adapter.remove([resolved.key]);
    sendSuccess(
      res,
      {
        key: resolved.key,
        bucket: creds.bucket,
        deleted: removed.length > 0,
        removed: removed.map((r) => r.name),
      },
      { durationMs: Date.now() - start, provider: PROVIDER },
    );
  } catch (err) {
    sendError(res, 502, 'PROVIDER_ERROR', describeStorageError(err), undefined, {
      durationMs: Date.now() - start,
      provider: PROVIDER,
    });
  }
});

// ────────────────────────────── sign-url ──────────────────────────────
router.post('/sign-url', async (req, res) => {
  const start = Date.now();
  const input = (req.body || {}) as StorageSignUrlInput;

  const credsProblem = credentialsProblem(input.credentials);
  if (credsProblem) return sendError(res, 400, 'MISSING_CREDENTIALS', credsProblem);
  const creds = input.credentials;

  const resolved = resolveTargetKey(input, creds);
  if ('status' in resolved) return sendError(res, resolved.status, resolved.code, resolved.message);

  const expiresIn = positiveInt(input.expiresIn, DEFAULT_SIGN_EXPIRES_IN, MAX_SIGN_EXPIRES_IN);

  const adapter = new SupabaseStorageAdapter(creds);
  try {
    const signedUrl = await adapter.signUrl(resolved.key, expiresIn, input.download);
    sendSuccess(
      res,
      {
        signedUrl,
        key: resolved.key,
        bucket: creds.bucket,
        expiresIn,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      },
      { durationMs: Date.now() - start, provider: PROVIDER },
    );
  } catch (err) {
    sendError(res, 502, 'PROVIDER_ERROR', describeStorageError(err), undefined, {
      durationMs: Date.now() - start,
      provider: PROVIDER,
    });
  }
});

// An oversized MULTIPART body is the one failure this tool can describe better
// than the service-wide handler can: it is a file that broke the tool's own
// ceiling, so it gets the tool's own FILE_TOO_LARGE code.
//
// EVERYTHING ELSE is handed on to `errorHandler()` in src/index.ts on purpose.
// This used to answer `500 INTERNAL_ERROR` with the raw `err.message`, which
// defeated that handler's `exposeInternals: false` policy — the one rule that
// keeps an unexpected throw from returning a connection string or a provider
// token to the caller. (Malformed and oversized JSON already come back as
// 400 INVALID_JSON / 413 PAYLOAD_TOO_LARGE from there: `express.json()` is
// mounted above this router, so its failures never reach this handler anyway.)
router.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!err) return next();
  if (err.type === 'entity.too.large' || err.status === 413) {
    return sendError(res, 413, 'FILE_TOO_LARGE', `request body exceeds the ${HARD_MAX_BYTES} byte limit`);
  }
  return next(err);
});

const credentialsSchema = {
  type: 'object',
  required: ['url', 'serviceRoleKey', 'bucket'],
  description: 'Supabase project credentials, passed per request (never read from env)',
  properties: {
    url: { type: 'string', description: 'Project URL, e.g. https://xxxx.supabase.co' },
    serviceRoleKey: { type: 'string', description: 'service_role key (bypasses RLS)' },
    bucket: { type: 'string', description: 'Bucket name, e.g. "posts"' },
  },
};

export const storageTool: ToolDefinition = {
  name: 'storage',
  description:
    'File storage on Supabase Storage: upload (base64 or multipart, with the browser-MIME correction map), prefix listing with image/video/document/other classification, paranoid delete-by-URL, and signed URLs for private buckets.',
  actions: [
    {
      action: 'upload',
      description:
        `Upload a file. Send JSON with "fileBase64" (raw base64 or a data: URL), or POST the same fields as multipart/form-data with the file in any file part. The stored content type comes from the extension allowlist, not from what the browser claimed (browsers send application/octet-stream for .heic, image/jpg for .jpg, application/vnd.ms-excel for .csv…). Size cap: maxSizeBytes, default ${DEFAULT_MAX_BYTES} bytes, hard max ${HARD_MAX_BYTES}. Pass requirePrefix (the tenant id) whenever key or prefix comes from an end user — with upsert on, a free-form key overwrites any object in the bucket. Errors: 400 INVALID_FIELD (bad base64 / extension / key), 403 FORBIDDEN_KEY, 413 FILE_TOO_LARGE, 502 PROVIDER_ERROR. NOTE: the JSON path is capped by the app-level 2mb express.json limit; use multipart above that.`,
      inputSchema: {
        type: 'object',
        required: ['credentials'],
        properties: {
          credentials: credentialsSchema,
          fileBase64: { type: 'string', description: 'Raw base64 or a data: URL. Required unless the request is multipart.' },
          filename: { type: 'string', description: 'Original file name — drives the extension allowlist and MIME correction' },
          contentType: { type: 'string', description: 'Client-declared MIME. Fallback only; the extension map wins.' },
          prefix: { type: 'string', description: 'Folder prefix (tenant/user id). Segments of [A-Za-z0-9._-].' },
          key: { type: 'string', description: 'Explicit object key. Must match the strict key pattern AND end in an allowed extension — with a key present it, not filename, is what the allowlist checks.' },
          requirePrefix: { type: 'string', description: 'Refuse unless the key written sits under this prefix. Strongly recommended whenever key/prefix comes from an end user.' },
          upsert: { type: 'boolean', default: false, description: 'Overwrite an object at the same key' },
          maxSizeBytes: { type: 'number', default: DEFAULT_MAX_BYTES, description: `Per-request cap, clamped to ${HARD_MAX_BYTES}` },
          cacheControlSeconds: { type: 'number', default: 3600 },
          signUrlExpiresIn: { type: 'number', description: 'Also return a signed URL valid this many seconds (private buckets)' },
        },
      },
    },
    {
      action: 'list',
      description:
        'List objects under a prefix. Each entry is classified image | video | document | other, and pseudo-folders are flagged with isFolder. Returns entries[], count, hasMore.',
      inputSchema: {
        type: 'object',
        required: ['credentials'],
        properties: {
          credentials: credentialsSchema,
          prefix: { type: 'string', description: 'Folder to list; omit or "" for the bucket root' },
          limit: { type: 'number', default: 100, description: 'Clamped to 1000' },
          offset: { type: 'number', default: 0 },
          search: { type: 'string', description: 'Substring filter on the object name' },
          sortBy: {
            type: 'object',
            properties: {
              column: { type: 'string', enum: ['name', 'updated_at', 'created_at', 'last_accessed_at'], default: 'name' },
              order: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
            },
          },
        },
      },
    },
    {
      action: 'delete',
      description:
        'Delete one object, addressed by key or by a URL previously handed out. The URL is reversed back to a key only if it is on the caller\'s own Supabase origin, matches a known /storage/v1/object/... shape, names the caller\'s own bucket, and decodes to a key made of [A-Za-z0-9._-] segments — anything else is a 400. Pass requirePrefix (e.g. the tenant id) to refuse keys outside that folder: the service_role key can otherwise reach every object in the bucket. Returns { key, deleted, removed[] }; deleted is false when the object did not exist.',
      inputSchema: {
        type: 'object',
        required: ['credentials'],
        properties: {
          credentials: credentialsSchema,
          key: { type: 'string', description: 'Object key. Exactly one of key or url.' },
          url: { type: 'string', description: 'A URL this tool handed out (public, signed, authenticated or render/image).' },
          requirePrefix: { type: 'string', description: 'Refuse unless the resolved key sits under this prefix. Strongly recommended.' },
        },
      },
    },
    {
      action: 'sign-url',
      description:
        'Create a time-limited signed URL for an object in a private bucket. Accepts key or url (reversed with the same strict guard as delete). expiresIn defaults to 3600s and is clamped to 7 days. Returns { signedUrl, key, expiresIn, expiresAt }.',
      inputSchema: {
        type: 'object',
        required: ['credentials'],
        properties: {
          credentials: credentialsSchema,
          key: { type: 'string', description: 'Object key. Exactly one of key or url.' },
          url: { type: 'string', description: 'A URL this tool handed out, reversed back to a key.' },
          expiresIn: { type: 'number', default: DEFAULT_SIGN_EXPIRES_IN, description: `Seconds; clamped to ${MAX_SIGN_EXPIRES_IN}` },
          requirePrefix: { type: 'string', description: 'Refuse unless the resolved key sits under this prefix' },
          download: {
            type: ['boolean', 'string'],
            description: 'true to force a download, or a string to force a download under that filename',
          },
        },
      },
    },
  ],
  router,
};
