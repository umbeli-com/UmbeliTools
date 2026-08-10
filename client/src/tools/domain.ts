import { UmbeliToolsCore } from '../client.js';

export interface GandiCredentials {
  apiKey: string;
}

export interface GandiContactInfo {
  email: string;
  given: string;
  family: string;
  streetaddr: string;
  city: string;
  country: string;
  phone: string;
  zip?: string;
  orgname?: string;
  type: 'person' | 'company' | 'association' | 'publicbody';
}

export interface DomainCheckInput {
  credentials: GandiCredentials;
  domain: string;
}

export interface DomainSuggestInput {
  credentials: GandiCredentials;
  query: string;
  country?: string;
}

export interface DomainPurchaseInput {
  credentials: GandiCredentials;
  domain: string;
  contact: GandiContactInfo;
  /** Registration duration in years (default 1). */
  duration?: number;
  nameservers?: string[];
}

export interface DomainSetNameserversInput {
  credentials: GandiCredentials;
  domain: string;
  nameservers: string[];
}

export interface DomainCheckResult {
  domain: string;
  available: boolean;
  price?: { value: number; currency: string };
  [key: string]: unknown;
}

export class DomainTool {
  constructor(private readonly core: UmbeliToolsCore) {}

  checkAvailability(input: DomainCheckInput) {
    return this.core.request<DomainCheckResult>('domain', 'check-availability', input);
  }

  suggest(input: DomainSuggestInput) {
    return this.core.request<Array<{ domain: string; [key: string]: unknown }>>('domain', 'suggest', input);
  }

  purchase(input: DomainPurchaseInput) {
    return this.core.request<Record<string, unknown>>('domain', 'purchase', input);
  }

  setNameservers(input: DomainSetNameserversInput) {
    return this.core.request<Record<string, unknown>>('domain', 'set-nameservers', input);
  }
}
