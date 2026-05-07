export interface MetaSendDMInput {
  credentials: { accessToken: string };
  igUserId: string;
  recipientId: string;
  message: string;
}

export interface MetaReplyCommentInput {
  credentials: { accessToken: string };
  commentId: string;
  message: string;
}

export interface MetaGetAccountsInput {
  credentials: { accessToken: string };
}

export interface MetaPublishInput {
  credentials: { accessToken: string };
  igUserId: string;
  params: Record<string, string>;
}

export interface MetaListConversationsInput {
  credentials: { accessToken: string };
  igUserId: string;
  platform?: 'instagram' | 'messenger';
  limit?: number;
}

export interface MetaListMessagesInput {
  credentials: { accessToken: string };
  conversationId: string;
  limit?: number;
}
