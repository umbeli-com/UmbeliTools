import type { GandiCredentials, GandiContactInfo } from './types';

const GANDI_API_BASE = 'https://api.gandi.net/v5';

async function gandiRequest<T>(creds: GandiCredentials, method: string, endpoint: string, body?: unknown): Promise<T> {
  const res = await fetch(`${GANDI_API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`Gandi ${method} ${endpoint} → ${res.status}: ${JSON.stringify(data)}`);
  }

  return data as T;
}

export async function checkAvailability(creds: GandiCredentials, domain: string) {
  const data = await gandiRequest<{ products?: { status: string; type?: string; taxes?: { price_after_taxes: number; currency: string }[] }[] }>(
    creds,
    'GET',
    `/domain/check?name=${encodeURIComponent(domain)}`,
  );

  const product = data.products?.[0];
  if (!product) {
    return {
      domain,
      available: false,
      premium: false,
      error: `TLD not recognized by Gandi (.${domain.split('.').pop()})`,
    };
  }

  return {
    domain,
    available: product.status === 'available',
    premium: product.type === 'premium',
    price: product.taxes?.[0]?.price_after_taxes,
    currency: product.taxes?.[0]?.currency,
  };
}

export async function suggestDomains(creds: GandiCredentials, query: string, country?: string) {
  const params = new URLSearchParams({ name: query });
  if (country) params.set('country', country);
  const data = await gandiRequest<{ name?: string }[] | { suggestions?: { name: string }[] }>(
    creds,
    'GET',
    `/domain/suggest?${params.toString()}`,
  );
  const names = Array.isArray(data)
    ? data.map((d) => d.name).filter((n): n is string => !!n)
    : (data?.suggestions || []).map((s) => s.name);
  return { suggestions: names };
}

export async function purchaseDomain(
  creds: GandiCredentials,
  domain: string,
  contact: GandiContactInfo,
  opts: { duration?: number; nameservers?: string[] } = {},
) {
  return gandiRequest(creds, 'POST', '/domain/domains', {
    fqdn: domain,
    duration: opts.duration ?? 1,
    owner: contact,
    admin: contact,
    tech: contact,
    billing: contact,
    nameserver: {
      current: 'other',
      hosts: opts.nameservers || ['elsa.ns.cloudflare.com', 'stan.ns.cloudflare.com'],
    },
  });
}

export async function setNameservers(creds: GandiCredentials, domain: string, nameservers: string[]) {
  return gandiRequest(creds, 'PUT', `/domain/domains/${encodeURIComponent(domain)}/nameservers`, {
    nameservers,
  });
}
