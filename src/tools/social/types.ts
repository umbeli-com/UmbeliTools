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
