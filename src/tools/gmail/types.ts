export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface GmailListInput {
  credentials: GmailCredentials;
  query?: string;
  labelIds?: string[];
  maxResults?: number;
  pageToken?: string;
}

export interface GmailGetInput {
  credentials: GmailCredentials;
  messageId: string;
  format?: 'full' | 'metadata' | 'minimal' | 'raw';
}

export interface GmailSendInput {
  credentials: GmailCredentials;
  to: string;
  subject: string;
  body: string;
  bodyType?: 'text' | 'html';
  from?: string;
  cc?: string;
  bcc?: string;
}

export interface GmailModifyInput {
  credentials: GmailCredentials;
  messageId: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
}
