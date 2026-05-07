import type { CloudflareCredentials } from './types';

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

interface CloudflareResponse<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T;
}

async function cfRequest<T>(
  creds: CloudflareCredentials,
  method: string,
  endpoint: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${CF_API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${creds.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = (await res.json().catch(() => ({ success: false, errors: [], result: null }))) as CloudflareResponse<T>;

  if (!data.success) {
    throw new Error(`Cloudflare ${method} ${endpoint}: ${JSON.stringify(data.errors)}`);
  }

  return data.result;
}

export async function createZone(creds: CloudflareCredentials, domain: string) {
  if (!creds.accountId) throw new Error('credentials.accountId is required to create a zone');
  return cfRequest<{ id: string; name: string; name_servers: string[] }>(creds, 'POST', '/zones', {
    name: domain,
    account: { id: creds.accountId },
    jump_start: false,
  });
}

export async function getZone(creds: CloudflareCredentials, domain: string) {
  const zones = await cfRequest<{ id: string; name: string; name_servers: string[] }[]>(
    creds,
    'GET',
    `/zones?name=${encodeURIComponent(domain)}`,
  );
  if (!zones?.length) throw new Error(`No zone found for ${domain}`);
  return zones[0];
}

export async function deleteZone(creds: CloudflareCredentials, zoneId: string) {
  return cfRequest<{ id: string }>(creds, 'DELETE', `/zones/${zoneId}`);
}

export async function listRecords(creds: CloudflareCredentials, zoneId: string) {
  return cfRequest<unknown[]>(creds, 'GET', `/zones/${zoneId}/dns_records?per_page=100`);
}

export async function addRecord(
  creds: CloudflareCredentials,
  zoneId: string,
  opts: { type: string; name: string; content: string; ttl?: number; proxied?: boolean; priority?: number },
) {
  const payload: Record<string, unknown> = {
    type: opts.type,
    name: opts.name,
    content: opts.content,
    proxied: opts.proxied ?? false,
    ttl: opts.ttl ?? 1,
  };
  if (opts.type === 'MX') payload.priority = opts.priority ?? 10;
  return cfRequest<{ id: string; type: string; name: string; content: string }>(creds, 'POST', `/zones/${zoneId}/dns_records`, payload);
}

export async function updateRecord(
  creds: CloudflareCredentials,
  zoneId: string,
  recordId: string,
  opts: { type: string; name: string; content: string; ttl?: number; proxied?: boolean; priority?: number },
) {
  return cfRequest<{ id: string }>(creds, 'PUT', `/zones/${zoneId}/dns_records/${recordId}`, {
    ...opts,
    ttl: opts.ttl ?? 1,
  });
}

export async function deleteRecord(creds: CloudflareCredentials, zoneId: string, recordId: string) {
  return cfRequest<{ id: string }>(creds, 'DELETE', `/zones/${zoneId}/dns_records/${recordId}`);
}
