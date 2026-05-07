export interface OutlookCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  tenantId?: string;
}

export interface OutlookListInput {
  credentials: OutlookCredentials;
  filter?: string;
  search?: string;
  top?: number;
  skip?: number;
  orderby?: string;
}

export interface OutlookGetInput {
  credentials: OutlookCredentials;
  messageId: string;
}

export interface OutlookSendInput {
  credentials: OutlookCredentials;
  to: string[];
  subject: string;
  body: string;
  bodyType?: 'text' | 'html';
  cc?: string[];
  bcc?: string[];
}

export interface OutlookMarkReadInput {
  credentials: OutlookCredentials;
  messageId: string;
  isRead: boolean;
}

export interface OutlookSendAsAppInput {
  credentials: {
    tenantId: string;
    clientId: string;
    clientSecret: string;
    userEmail: string;
  };
  to: string[];
  subject: string;
  body: string;
  bodyType?: 'text' | 'html';
  cc?: string[];
  bcc?: string[];
  saveToSentItems?: boolean;
}
