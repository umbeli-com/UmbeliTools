/** Supabase Storage credentials — always supplied per request, never from process.env. */
export interface StorageCredentials {
  /** Supabase project URL, e.g. `https://xxxx.supabase.co` (no trailing slash needed). */
  url: string;
  /** service_role key. Bypasses RLS — see the security notes on `delete`. */
  serviceRoleKey: string;
  /** Bucket name, e.g. `posts`. */
  bucket: string;
}

export interface StorageUploadInput {
  credentials: StorageCredentials;
  /** Base64 payload (raw base64 or a `data:` URL). Ignored when the request is multipart. */
  fileBase64?: string;
  /** Original file name — drives the extension allowlist and the MIME correction map. */
  filename?: string;
  /** Client-declared MIME type. Only a fallback: the extension map wins when it knows the type. */
  contentType?: string;
  /** Folder prefix inside the bucket, e.g. a tenant/user id. Sanitised, then prepended to the key. */
  prefix?: string;
  /**
   * Explicit full object key. Must pass the strict key pattern AND end in an
   * allowed extension — when it is present it, not `filename`, is what the
   * extension allowlist and the stored content type are taken from.
   * Overrides `prefix`/`filename` naming.
   */
  key?: string;
  /**
   * Refuse the upload unless the key written sits under this prefix.
   * The write-side twin of the same guard on `delete`: with `upsert: true` a
   * free-form `key` can otherwise overwrite any object in the bucket.
   */
  requirePrefix?: string;
  /** Overwrite an existing object at the same key (Supabase `x-upsert`). Default false. */
  upsert?: boolean;
  /** Per-request size cap in bytes. Default 25 MB, hard-capped at 500 MB. */
  maxSizeBytes?: number;
  /** `cache-control: max-age=` seconds sent to Supabase. Default 3600. */
  cacheControlSeconds?: number;
  /** When set, also return a signed URL valid for this many seconds (for private buckets). */
  signUrlExpiresIn?: number;
}

export interface StorageListInput {
  credentials: StorageCredentials;
  /** Folder prefix to list, e.g. `tenant-42/avatars`. Empty string = bucket root. */
  prefix?: string;
  limit?: number;
  offset?: number;
  /** Substring filter applied by Supabase on the object name. */
  search?: string;
  sortBy?: { column?: 'name' | 'updated_at' | 'created_at' | 'last_accessed_at'; order?: 'asc' | 'desc' };
}

export interface StorageDeleteInput {
  credentials: StorageCredentials;
  /** A URL previously handed out by `upload`/`list`/`sign-url`. Reversed back to a key. */
  url?: string;
  /** Object key. Exactly one of `url` or `key` is required. */
  key?: string;
  /**
   * Refuse the delete unless the resolved key sits under this prefix.
   * STRONGLY recommended: the service_role key can delete anything in the bucket,
   * so this is the only tenant scoping the tool can enforce.
   */
  requirePrefix?: string;
}

export interface StorageSignUrlInput {
  credentials: StorageCredentials;
  /** Object key, or pass `url` to have it reversed back to a key first. */
  key?: string;
  url?: string;
  /** Lifetime in seconds. Default 3600, max 7 days. */
  expiresIn?: number;
  /** Same tenant guard as `delete`. */
  requirePrefix?: string;
  /** Ask the browser to download rather than render. `true` or a suggested filename. */
  download?: boolean | string;
}

export type StorageKind = 'image' | 'video' | 'document' | 'other';

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
