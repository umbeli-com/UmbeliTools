/**
 * SSRF guard for every outbound fetch made on behalf of a caller.
 *
 * Rules enforced:
 *  - only http: / https: schemes
 *  - no embedded credentials (user:pass@host)
 *  - blocked hostnames (localhost, *.local, *.internal, cloud metadata names)
 *  - the RESOLVED address is checked, not just the literal: every A/AAAA record
 *    returned for the hostname must sit outside loopback / private / link-local /
 *    CGNAT / multicast / reserved space
 *  - IPv6 is expanded before matching, so ::1, ::ffff:127.0.0.1 and fc00::/7 are
 *    caught (a naive string prefix check is not enough)
 *
 * Callers must re-run `assertSafeUrl` on EVERY redirect hop — see
 * safe-fetch.adapter.ts. A guard that only validates the first URL is theatre.
 */
import { promises as dnsPromises } from 'dns';
import { isIP } from 'net';
import { setTimeout as wait } from 'timers/promises';

export class BlockedUrlError extends Error {
  readonly code = 'BLOCKED_URL';
  constructor(message: string) {
    super(message);
    this.name = 'BlockedUrlError';
  }
}

/** Hostnames refused outright, before any DNS work. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
]);

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan'];

const DNS_TIMEOUT_MS = 5_000;
const DNS_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  expiresAt: number;
  addresses?: string[];
  error?: string;
}

const DNS_CACHE_MAX_ENTRIES = 500;
const dnsCache = new Map<string, CacheEntry>();

/** Bounded so a caller cannot grow the cache with random hostnames. */
function cacheVerdict(hostname: string, entry: CacheEntry): void {
  if (dnsCache.size >= DNS_CACHE_MAX_ENTRIES) dnsCache.clear();
  dnsCache.set(hostname, entry);
}

/** Add the scheme when the caller passed a bare host ("example.com"). */
export function normalizeUrl(value: string): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

function isBlockedIpv4(ip: string): boolean {
  const octets = parseIpv4(ip);
  if (!octets) return true; // unparseable → refuse
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // 127/8 loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 169 && b === 254) return true; // 169.254/16 link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a >= 224) return true; // multicast, reserved, 255.255.255.255
  return false;
}

/** Expand any IPv6 form (::, embedded IPv4, zone id) to 8 numeric hextets. */
function expandIpv6(input: string): number[] | null {
  let addr = String(input).split('%')[0].toLowerCase();
  if (addr.startsWith('[') && addr.endsWith(']')) addr = addr.slice(1, -1);
  if (!addr) return null;

  const lastColon = addr.lastIndexOf(':');
  if (lastColon === -1) return null;
  const tail = addr.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    addr = `${addr.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tailParts = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tailParts.length;
  if (halves.length === 1) {
    if (head.length !== 8) return null;
  } else if (fill < 0) {
    return null;
  }
  const parts = halves.length === 2 ? [...head, ...new Array(fill).fill('0'), ...tailParts] : head;
  if (parts.length !== 8) return null;

  const hextets: number[] = [];
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    hextets.push(parseInt(part, 16));
  }
  return hextets;
}

function isBlockedIpv6(ip: string): boolean {
  const h = expandIpv6(ip);
  if (!h) return true;

  const leadingZero = h.slice(0, 5).every((x) => x === 0);
  if (h.slice(0, 7).every((x) => x === 0) && (h[7] === 0 || h[7] === 1)) return true; // :: and ::1

  // ::ffff:a.b.c.d (v4-mapped), ::a.b.c.d (v4-compatible), 64:ff9b::/96 (NAT64)
  const embeddedV4 =
    (leadingZero && (h[5] === 0xffff || h[5] === 0)) ||
    (h[0] === 0x0064 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0));
  if (embeddedV4) {
    const v4 = `${h[6] >> 8}.${h[6] & 0xff}.${h[7] >> 8}.${h[7] & 0xff}`;
    return isBlockedIpv4(v4);
  }

  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** True when this literal IP must never be contacted. Unknown input → blocked. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true;
}

async function resolveHost(hostname: string): Promise<string[]> {
  const cached = dnsCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.error) throw new BlockedUrlError(cached.error);
    return cached.addresses ?? [];
  }

  let records: Array<{ address: string }> = [];
  try {
    records = (await Promise.race([
      dnsPromises.lookup(hostname, { all: true, verbatim: true }),
      wait(DNS_TIMEOUT_MS).then(() => {
        throw new Error(`DNS lookup timed out after ${DNS_TIMEOUT_MS}ms`);
      }),
    ])) as Array<{ address: string }>;
  } catch (err: any) {
    const message = `Cannot resolve ${hostname}: ${err?.message || String(err)}`;
    cacheVerdict(hostname, { expiresAt: Date.now() + DNS_CACHE_TTL_MS, error: message });
    throw new BlockedUrlError(message);
  }

  if (!records.length) {
    const message = `Cannot resolve ${hostname}: no A/AAAA record`;
    cacheVerdict(hostname, { expiresAt: Date.now() + DNS_CACHE_TTL_MS, error: message });
    throw new BlockedUrlError(message);
  }

  const addresses = records.map((r) => r.address);
  cacheVerdict(hostname, { expiresAt: Date.now() + DNS_CACHE_TTL_MS, addresses });
  return addresses;
}

export interface SafeUrl {
  /** The parsed, scheme-normalised URL that is safe to fetch. */
  url: URL;
  hostname: string;
  /** Every address the hostname resolved to (the literal itself for an IP URL). */
  addresses: string[];
}

/**
 * Throws BlockedUrlError unless `raw` is an http(s) URL whose host resolves
 * entirely to public addresses. MUST be called again for each redirect hop.
 */
export async function assertSafeUrl(raw: string): Promise<SafeUrl> {
  const candidate = normalizeUrl(raw);
  if (!candidate) throw new BlockedUrlError('Empty URL');

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new BlockedUrlError(`Invalid URL: ${raw}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError(`Scheme "${url.protocol}" is not allowed (http/https only)`);
  }
  if (url.username || url.password) {
    throw new BlockedUrlError('URLs with embedded credentials are not allowed');
  }

  const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '').toLowerCase();
  if (!hostname) throw new BlockedUrlError('URL has no host');

  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new BlockedUrlError(`Address ${hostname} is in a blocked (loopback/private/link-local) range`);
    }
    return { url, hostname, addresses: [hostname] };
  }

  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOST_SUFFIXES.some((s) => hostname.endsWith(s))) {
    throw new BlockedUrlError(`Hostname "${hostname}" is blocked`);
  }

  const addresses = await resolveHost(hostname);
  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      throw new BlockedUrlError(
        `Hostname "${hostname}" resolves to ${address}, which is in a blocked (loopback/private/link-local) range`,
      );
    }
  }

  return { url, hostname, addresses };
}

/** Boolean helper for hot paths (browser subresource interception). */
export async function isSafeUrl(raw: string): Promise<boolean> {
  try {
    await assertSafeUrl(raw);
    return true;
  } catch {
    return false;
  }
}
