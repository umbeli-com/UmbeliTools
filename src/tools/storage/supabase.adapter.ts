import { BaseAdapter } from '../../lib/baseAdapter';
import { AdapterError } from '../../lib/errors';
import type { StorageCredentials } from './types';
import { encodeKeyPath } from './keys';

export interface SupabaseObjectRow {
  name: string;
  id: string | null;
  updated_at: string | null;
  created_at: string | null;
  last_accessed_at: string | null;
  metadata: { size?: number; mimetype?: string; [key: string]: unknown } | null;
}

export interface UploadedObject {
  Key?: string;
  Id?: string;
  path?: string;
}

/**
 * Supabase Storage over its REST API.
 *
 * No `@supabase/supabase-js` dependency: the storage endpoints are plain HTTP and
 * going through BaseAdapter gets us the shared backoff/timeout/AdapterError
 * behaviour that supabase-js would hide behind its own fetch.
 */
export class SupabaseStorageAdapter extends BaseAdapter {
  readonly projectUrl: string;
  readonly bucket: string;

  constructor(creds: StorageCredentials, opts: { timeout?: number } = {}) {
    const projectUrl = String(creds.url).trim().replace(/\/+$/, '');
    super({
      baseUrl: `${projectUrl}/storage/v1`,
      defaultHeaders: {
        apikey: creds.serviceRoleKey,
        Authorization: `Bearer ${creds.serviceRoleKey}`,
      },
      timeout: opts.timeout ?? 60_000,
    });
    this.projectUrl = projectUrl;
    this.bucket = creds.bucket;
  }

  private get bucketPath(): string {
    return encodeURIComponent(this.bucket);
  }

  /** Public URL for an object (only resolvable when the bucket is public). */
  publicUrl(key: string): string {
    return `${this.projectUrl}/storage/v1/object/public/${this.bucketPath}/${encodeKeyPath(key)}`;
  }

  async upload(
    key: string,
    body: Buffer,
    opts: { contentType: string; upsert?: boolean; cacheControlSeconds?: number },
  ): Promise<UploadedObject> {
    const res = await this.request('POST', `/object/${this.bucketPath}/${encodeKeyPath(key)}`, {
      body,
      json: false,
      headers: {
        'Content-Type': opts.contentType,
        'cache-control': `max-age=${opts.cacheControlSeconds ?? 3600}`,
        'x-upsert': opts.upsert ? 'true' : 'false',
      },
      // A retried POST without upsert would come back 409 "already exists" and
      // mask a successful first attempt, so only retry when upsert is on.
      retries: opts.upsert ? 2 : 0,
    });
    return (res.data ?? {}) as UploadedObject;
  }

  async list(opts: {
    prefix?: string;
    limit?: number;
    offset?: number;
    search?: string;
    sortBy?: { column?: string; order?: string };
  }): Promise<SupabaseObjectRow[]> {
    const res = await this.request('POST', `/object/list/${this.bucketPath}`, {
      body: {
        prefix: opts.prefix ?? '',
        limit: opts.limit ?? 100,
        offset: opts.offset ?? 0,
        search: opts.search ?? '',
        sortBy: { column: opts.sortBy?.column ?? 'name', order: opts.sortBy?.order ?? 'asc' },
      },
    });
    return Array.isArray(res.data) ? (res.data as SupabaseObjectRow[]) : [];
  }

  /** Returns the rows Supabase actually removed — empty when the key did not exist. */
  async remove(keys: string[]): Promise<SupabaseObjectRow[]> {
    const res = await this.request('DELETE', `/object/${this.bucketPath}`, {
      body: { prefixes: keys },
    });
    return Array.isArray(res.data) ? (res.data as SupabaseObjectRow[]) : [];
  }

  async signUrl(key: string, expiresIn: number, download?: boolean | string): Promise<string> {
    const body: Record<string, unknown> = { expiresIn };
    const res = await this.request('POST', `/object/sign/${this.bucketPath}/${encodeKeyPath(key)}`, { body });

    const signedPath = (res.data as { signedURL?: string; signedUrl?: string } | null)?.signedURL
      ?? (res.data as { signedUrl?: string } | null)?.signedUrl;
    if (!signedPath) throw new AdapterError('Supabase Storage returned no signedURL', { body: res.data });

    const url = new URL(`${this.projectUrl}/storage/v1${signedPath.startsWith('/') ? '' : '/'}${signedPath}`);
    if (download === true) url.searchParams.set('download', '');
    else if (typeof download === 'string' && download) url.searchParams.set('download', download);
    return url.toString();
  }
}

/** Flatten an AdapterError from Supabase into one readable line. */
export function describeStorageError(err: unknown): string {
  if (err instanceof AdapterError) {
    const body = err.body as { message?: string; error?: string; statusCode?: string } | string | null;
    const detail =
      typeof body === 'string'
        ? body.slice(0, 300)
        : body?.message || body?.error || '';
    const status = err.status ? `Supabase Storage ${err.status}` : 'Supabase Storage';
    return detail ? `${status}: ${detail}` : `${status}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
