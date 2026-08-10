import { UmbeliToolsCore } from '../client.js';

export interface MetaCredentials {
  accessToken: string;
}

export interface MetaSendDmInput {
  credentials: MetaCredentials;
  igUserId: string;
  recipientId: string;
  message: string;
}

export interface MetaReplyCommentInput {
  credentials: MetaCredentials;
  commentId: string;
  message: string;
}

export interface MetaGetAccountsInput {
  credentials: MetaCredentials;
}

export interface MetaPublishInput {
  credentials: MetaCredentials;
  igUserId: string;
  params: Record<string, string>;
}

export interface MetaListConversationsInput {
  credentials: MetaCredentials;
  igUserId: string;
  platform?: 'instagram' | 'messenger';
  limit?: number;
}

export interface MetaListMessagesInput {
  credentials: MetaCredentials;
  conversationId: string;
  limit?: number;
}

export class SocialMetaTool {
  constructor(private readonly core: UmbeliToolsCore) {}

  sendDm(input: MetaSendDmInput) {
    return this.core.request<Record<string, unknown>>('social', 'meta/send-dm', input);
  }

  replyComment(input: MetaReplyCommentInput) {
    return this.core.request<Record<string, unknown>>('social', 'meta/reply-comment', input);
  }

  getAccounts(input: MetaGetAccountsInput) {
    return this.core.request<Record<string, unknown>>('social', 'meta/get-accounts', input);
  }

  publish(input: MetaPublishInput) {
    return this.core.request<Record<string, unknown>>('social', 'meta/publish', input);
  }

  listConversations(input: MetaListConversationsInput) {
    return this.core.request<Record<string, unknown>>('social', 'meta/list-conversations', input);
  }

  listMessages(input: MetaListMessagesInput) {
    return this.core.request<Record<string, unknown>>('social', 'meta/list-messages', input);
  }
}

export class SocialTool {
  readonly meta: SocialMetaTool;
  constructor(core: UmbeliToolsCore) {
    this.meta = new SocialMetaTool(core);
  }
}
