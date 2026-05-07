import { Router } from 'express';
import type { ToolDefinition } from '../../types/tool';
import { sendSuccess, sendError } from '../../lib/response';
import { metaSendDM, metaReplyComment, metaGetAccounts, metaPublish, metaListConversations, metaListConversationMessages } from './meta.adapter';
import type { MetaSendDMInput, MetaReplyCommentInput, MetaGetAccountsInput, MetaPublishInput, MetaListConversationsInput, MetaListMessagesInput } from './types';

const router = Router();

router.post('/meta/send-dm', async (req, res) => {
  const start = Date.now();
  const input = req.body as MetaSendDMInput;

  if (!input.credentials?.accessToken) return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.accessToken is required');
  if (!input.igUserId || !input.recipientId || !input.message) return sendError(res, 400, 'MISSING_FIELDS', 'igUserId, recipientId, and message are required');

  try {
    const result = await metaSendDM(input.credentials.accessToken, input.igUserId, input.recipientId, input.message);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'meta' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'meta' });
  }
});

router.post('/meta/reply-comment', async (req, res) => {
  const start = Date.now();
  const input = req.body as MetaReplyCommentInput;

  if (!input.credentials?.accessToken) return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.accessToken is required');
  if (!input.commentId || !input.message) return sendError(res, 400, 'MISSING_FIELDS', 'commentId and message are required');

  try {
    const result = await metaReplyComment(input.credentials.accessToken, input.commentId, input.message);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'meta' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'meta' });
  }
});

router.post('/meta/get-accounts', async (req, res) => {
  const start = Date.now();
  const input = req.body as MetaGetAccountsInput;

  if (!input.credentials?.accessToken) return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.accessToken is required');

  try {
    const result = await metaGetAccounts(input.credentials.accessToken);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'meta' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'meta' });
  }
});

router.post('/meta/publish', async (req, res) => {
  const start = Date.now();
  const input = req.body as MetaPublishInput;

  if (!input.credentials?.accessToken) return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.accessToken is required');
  if (!input.igUserId || !input.params) return sendError(res, 400, 'MISSING_FIELDS', 'igUserId and params are required');

  try {
    const result = await metaPublish(input.credentials.accessToken, input.igUserId, input.params);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'meta' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'meta' });
  }
});

router.post('/meta/list-conversations', async (req, res) => {
  const start = Date.now();
  const input = req.body as MetaListConversationsInput;

  if (!input.credentials?.accessToken) return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.accessToken is required');
  if (!input.igUserId) return sendError(res, 400, 'MISSING_FIELDS', 'igUserId is required');

  try {
    const result = await metaListConversations(input.credentials.accessToken, input.igUserId, {
      platform: input.platform,
      limit: input.limit,
    });
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'meta' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'meta' });
  }
});

router.post('/meta/list-messages', async (req, res) => {
  const start = Date.now();
  const input = req.body as MetaListMessagesInput;

  if (!input.credentials?.accessToken) return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.accessToken is required');
  if (!input.conversationId) return sendError(res, 400, 'MISSING_FIELDS', 'conversationId is required');

  try {
    const result = await metaListConversationMessages(input.credentials.accessToken, input.conversationId, input.limit);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'meta' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'meta' });
  }
});

export const socialTool: ToolDefinition = {
  name: 'social',
  description: 'Social media integrations (Meta/Instagram Graph API)',
  actions: [
    {
      action: 'meta/send-dm',
      description: 'Send a DM on Instagram via the Graph API',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'igUserId', 'recipientId', 'message'],
        properties: {
          credentials: { type: 'object', required: ['accessToken'], properties: { accessToken: { type: 'string' } } },
          igUserId: { type: 'string', description: 'The Instagram business account ID sending the message' },
          recipientId: { type: 'string', description: 'Comment ID or user IGSID to send the DM to' },
          message: { type: 'string' },
        },
      },
    },
    {
      action: 'meta/reply-comment',
      description: 'Reply to an Instagram comment',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'commentId', 'message'],
        properties: {
          credentials: { type: 'object', required: ['accessToken'], properties: { accessToken: { type: 'string' } } },
          commentId: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
    {
      action: 'meta/get-accounts',
      description: 'List connected Facebook pages and Instagram business accounts',
      inputSchema: {
        type: 'object',
        required: ['credentials'],
        properties: {
          credentials: { type: 'object', required: ['accessToken'], properties: { accessToken: { type: 'string' } } },
        },
      },
    },
    {
      action: 'meta/publish',
      description: 'Create and publish a media post on Instagram',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'igUserId', 'params'],
        properties: {
          credentials: { type: 'object', required: ['accessToken'], properties: { accessToken: { type: 'string' } } },
          igUserId: { type: 'string' },
          params: { type: 'object', description: 'Media container params (image_url, caption, etc.)' },
        },
      },
    },
    {
      action: 'meta/list-conversations',
      description: 'List Instagram or Messenger conversations for an account',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'igUserId'],
        properties: {
          credentials: { type: 'object', required: ['accessToken'], properties: { accessToken: { type: 'string' } } },
          igUserId: { type: 'string' },
          platform: { type: 'string', enum: ['instagram', 'messenger'], default: 'instagram' },
          limit: { type: 'number', default: 25 },
        },
      },
    },
    {
      action: 'meta/list-messages',
      description: 'List messages in a conversation',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'conversationId'],
        properties: {
          credentials: { type: 'object', required: ['accessToken'], properties: { accessToken: { type: 'string' } } },
          conversationId: { type: 'string' },
          limit: { type: 'number', default: 25 },
        },
      },
    },
  ],
  router,
};
