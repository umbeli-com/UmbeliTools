import { UmbeliToolsCore } from '../client.js';

export interface CloudflareCredentials {
  apiToken: string;
  accountId?: string;
}

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'SRV';

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

export interface DnsListRecordsInput {
  credentials: CloudflareCredentials;
  zoneId: string;
}

export interface DnsAddRecordInput {
  credentials: CloudflareCredentials;
  zoneId: string;
  type: DnsRecordType;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
  priority?: number;
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

export interface DnsZone {
  id: string;
  name: string;
  name_servers?: string[];
  status?: string;
  [key: string]: unknown;
}

export interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
  [key: string]: unknown;
}

export class DnsTool {
  constructor(private readonly core: UmbeliToolsCore) {}

  createZone(input: DnsCreateZoneInput) {
    return this.core.request<DnsZone>('dns', 'create-zone', input);
  }

  getZone(input: DnsGetZoneInput) {
    return this.core.request<DnsZone>('dns', 'get-zone', input);
  }

  deleteZone(input: DnsDeleteZoneInput) {
    return this.core.request<{ id: string }>('dns', 'delete-zone', input);
  }

  listRecords(input: DnsListRecordsInput) {
    return this.core.request<DnsRecord[]>('dns', 'list-records', input);
  }

  addRecord(input: DnsAddRecordInput) {
    return this.core.request<DnsRecord>('dns', 'add-record', input);
  }

  updateRecord(input: DnsUpdateRecordInput) {
    return this.core.request<DnsRecord>('dns', 'update-record', input);
  }

  deleteRecord(input: DnsDeleteRecordInput) {
    return this.core.request<{ id: string }>('dns', 'delete-record', input);
  }
}
