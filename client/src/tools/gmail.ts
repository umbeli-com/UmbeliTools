import { UmbeliToolsCore } from '../client.js';

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

export class GmailTool {
  constructor(private readonly core: UmbeliToolsCore) {}

  listMessages(input: GmailListInput) {
    return this.core.request<Record<string, unknown>>('gmail', 'list-messages', input);
  }

  getMessage(input: GmailGetInput) {
    return this.core.request<Record<string, unknown>>('gmail', 'get-message', input);
  }

  sendMessage(input: GmailSendInput) {
    return this.core.request<Record<string, unknown>>('gmail', 'send-message', input);
  }

  modifyMessage(input: GmailModifyInput) {
    return this.core.request<Record<string, unknown>>('gmail', 'modify-message', input);
  }
}
