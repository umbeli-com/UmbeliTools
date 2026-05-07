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
  duration?: number;
  nameservers?: string[];
}

export interface DomainSetNameserversInput {
  credentials: GandiCredentials;
  domain: string;
  nameservers: string[];
}
