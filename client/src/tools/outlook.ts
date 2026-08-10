import { UmbeliToolsCore } from '../client.js';

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

export class OutlookTool {
  constructor(private readonly core: UmbeliToolsCore) {}

  listMessages(input: OutlookListInput) {
    return this.core.request<Record<string, unknown>>('outlook', 'list-messages', input);
  }

  getMessage(input: OutlookGetInput) {
    return this.core.request<Record<string, unknown>>('outlook', 'get-message', input);
  }

  sendMessage(input: OutlookSendInput) {
    return this.core.request<Record<string, unknown>>('outlook', 'send-message', input);
  }

  /** Server-to-server send via Microsoft Graph client_credentials (Mail.Send app perm). */
  sendAsApp(input: OutlookSendAsAppInput) {
    return this.core.request<Record<string, unknown>>('outlook', 'send-as-app', input);
  }

  markRead(input: OutlookMarkReadInput) {
    return this.core.request<Record<string, unknown>>('outlook', 'mark-read', input);
  }
}
