import { UmbeliToolsCore } from '../client.js';

/** Supabase Storage credentials — passed on every call, never read from env server-side. */
export interface StorageCredentials {
  /** Project URL, e.g. `https://xxxx.supabase.co`. */
  url: string;
  /** service_role key. Bypasses RLS — always pair destructive calls with `requirePrefix`. */
  serviceRoleKey: string;
  /** Bucket name, e.g. `posts`. */
  bucket: string;
}

export type StorageKind = 'image' | 'video' | 'document' | 'other';

export interface StorageUploadInput {
  credentials: StorageCredentials;
  /** Raw base64 or a `data:` URL. Use `toBase64()` if you hold bytes. */
  fileBase64: string;
  /** Original file name. Drives the extension allowlist and the MIME correction map. */
  filename?: string;
  /** What the browser claimed. Fallback only — the extension map wins. */
  contentType?: string;
  /** Folder prefix (tenant/user id). Segments of `[A-Za-z0-9._-]`. */
  prefix?: string;
  /**
   * Explicit object key instead of `prefix` + generated name. Must end in an
   * allowed extension: with a key present it, not `filename`, is what the
   * server's extension allowlist checks.
   */
  key?: string;
  /**
   * Refuse the upload unless the key written sits under this prefix.
   * Pass the tenant/user id whenever `key` or `prefix` comes from an end user —
   * with `upsert: true` a free-form key can otherwise overwrite any object in
   * the bucket.
   */
  requirePrefix?: string;
  upsert?: boolean;
  /** Default 25 MB, hard-capped server-side at 500 MB. */
  maxSizeBytes?: number;
  cacheControlSeconds?: number;
  /** Also return a signed URL valid this many seconds (private buckets). */
  signUrlExpiresIn?: number;
}

export interface StorageUploadResult {
  /** Public URL. Only resolvable when the bucket is public — otherwise use `signedUrl`. */
  url: string;
  key: string;
  size: number;
  contentType: string;
  bucket: string;
  kind: StorageKind;
  /** Present only when `signUrlExpiresIn` was supplied. */
  signedUrl?: string;
}

export interface StorageListInput {
  credentials: StorageCredentials;
  prefix?: string;
  /** Default 100, clamped to 1000. */
  limit?: number;
  offset?: number;
  search?: string;
  sortBy?: { column?: 'name' | 'updated_at' | 'created_at' | 'last_accessed_at'; order?: 'asc' | 'desc' };
}

export interface StorageEntry {
  key: string;
  name: string;
  size: number | null;
  contentType: string | null;
  kind: StorageKind;
  isFolder: boolean;
  updatedAt: string | null;
  createdAt: string | null;
  url: string;
}

export interface StorageListResult {
  entries: StorageEntry[];
  count: number;
  prefix: string;
  bucket: string;
  limit: number;
  offset: number;
  /** True when the page came back full — ask for the next `offset`. */
  hasMore: boolean;
}

export interface StorageDeleteInput {
  credentials: StorageCredentials;
  /** A URL this tool handed out. Exactly one of `url` or `key`. */
  url?: string;
  key?: string;
  /**
   * Refuse the delete unless the resolved key sits under this prefix.
   * Pass the tenant/user id here — it is the only scoping the service can enforce.
   */
  requirePrefix?: string;
}

export interface StorageDeleteResult {
  key: string;
  bucket: string;
  /** False when the key resolved fine but no such object existed. */
  deleted: boolean;
  removed: string[];
}

export interface StorageSignUrlInput {
  credentials: StorageCredentials;
  key?: string;
  url?: string;
  /** Default 3600s, clamped to 7 days. */
  expiresIn?: number;
  requirePrefix?: string;
  /** `true` to force a download, or a string to force a download under that name. */
  download?: boolean | string;
}

export interface StorageSignUrlResult {
  signedUrl: string;
  key: string;
  bucket: string;
  expiresIn: number;
  expiresAt: string;
}

/** Bytes -> base64, in Node and in the browser. */
export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const nodeBuffer = (globalThis as { Buffer?: { from(v: Uint8Array): { toString(enc: string): string } } }).Buffer;
  if (nodeBuffer) return nodeBuffer.from(view).toString('base64');
  let binary = '';
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export class StorageTool {
  constructor(private readonly core: UmbeliToolsCore) {}

  /**
   * Upload a file to Supabase Storage.
   *
   * The stored content type comes from the extension allowlist, not from what the
   * browser claimed (browsers send `application/octet-stream` for .heic,
   * `image/jpg` for .jpg, `application/vnd.ms-excel` for .csv…).
   *
   * NOTE: this SDK method sends JSON, which the service caps at 2 MB. Above that,
   * POST `multipart/form-data` to `/api/tools/storage/upload` directly, with the
   * credentials as a JSON `credentials` form field.
   */
  upload(input: StorageUploadInput) {
    return this.core.request<StorageUploadResult>('storage', 'upload', input);
  }

  /** List objects under a prefix, each classified image | video | document | other. */
  list(input: StorageListInput) {
    return this.core.request<StorageListResult>('storage', 'list', input);
  }

  /**
   * Delete one object by key, or by a URL previously handed out.
   * A URL is only accepted when it is on the caller's own Supabase origin, names
   * the caller's own bucket, and decodes to a strict `[A-Za-z0-9._-]` key.
   * Always pass `requirePrefix` when the bucket is shared between tenants.
   */
  delete(input: StorageDeleteInput) {
    return this.core.request<StorageDeleteResult>('storage', 'delete', input);
  }

  /** Time-limited signed URL for an object in a private bucket. */
  signUrl(input: StorageSignUrlInput) {
    return this.core.request<StorageSignUrlResult>('storage', 'sign-url', input);
  }
}
