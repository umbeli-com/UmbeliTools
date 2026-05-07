export interface CloudflareCredentials {
  apiToken: string;
  accountId?: string;
}

export interface DnsCreateZoneInput {
  credentials: CloudflareCredentials;
  domain: string;
}

export interface DnsGetZoneInput {
  credentials: CloudflareCredentials;
  domain: string;
}

export interface DnsDeleteZoneInput {
  credentials: CloudflareCredentials;
  zoneId: string;
}

export interface DnsAddRecordInput {
  credentials: CloudflareCredentials;
  zoneId: string;
  type: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'SRV';
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
  priority?: number;
}

export interface DnsListRecordsInput {
  credentials: CloudflareCredentials;
  zoneId: string;
}

export interface DnsUpdateRecordInput {
  credentials: CloudflareCredentials;
  zoneId: string;
  recordId: string;
  type: string;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
  priority?: number;
}

export interface DnsDeleteRecordInput {
  credentials: CloudflareCredentials;
  zoneId: string;
  recordId: string;
}
