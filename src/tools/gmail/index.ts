import { Router } from 'express';
import type { ToolDefinition } from '../../types/tool';
import { sendSuccess, sendError } from '../../lib/response';
import { listMessages, getMessage, sendMessage, modifyMessage } from './gmail.adapter';
import type { GmailListInput, GmailGetInput, GmailSendInput, GmailModifyInput } from './types';

const router = Router();

function validateCreds(c: any) {
  return c?.clientId && c?.clientSecret && c?.refreshToken;
}

router.post('/list-messages', async (req, res) => {
  const start = Date.now();
  const input = req.body as GmailListInput;
  if (!validateCreds(input.credentials)) {
    return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.clientId, clientSecret, and refreshToken are required');
  }
  try {
    const result = await listMessages(input.credentials, {
      query: input.query,
      labelIds: input.labelIds,
      maxResults: input.maxResults,
      pageToken: input.pageToken,
    });
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'gmail' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'gmail' });
  }
});

router.post('/get-message', async (req, res) => {
  const start = Date.now();
  const input = req.body as GmailGetInput;
  if (!validateCreds(input.credentials)) {
    return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.clientId, clientSecret, and refreshToken are required');
  }
  if (!input.messageId) return sendError(res, 400, 'MISSING_FIELDS', 'messageId is required');
  try {
    const result = await getMessage(input.credentials, input.messageId, input.format);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'gmail' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'gmail' });
  }
});

router.post('/send-message', async (req, res) => {
  const start = Date.now();
  const input = req.body as GmailSendInput;
  if (!validateCreds(input.credentials)) {
    return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.clientId, clientSecret, and refreshToken are required');
  }
  if (!input.to || !input.subject || !input.body) {
    return sendError(res, 400, 'MISSING_FIELDS', 'to, subject, and body are required');
  }
  try {
    const result = await sendMessage(input.credentials, input);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'gmail' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'gmail' });
  }
});

router.post('/modify-message', async (req, res) => {
  const start = Date.now();
  const input = req.body as GmailModifyInput;
  if (!validateCreds(input.credentials)) {
    return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.clientId, clientSecret, and refreshToken are required');
  }
  if (!input.messageId) return sendError(res, 400, 'MISSING_FIELDS', 'messageId is required');
  try {
    const result = await modifyMessage(input.credentials, input.messageId, {
      addLabelIds: input.addLabelIds,
      removeLabelIds: input.removeLabelIds,
    });
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'gmail' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'gmail' });
  }
});

const credsSchema = {
  type: 'object',
  required: ['clientId', 'clientSecret', 'refreshToken'],
  properties: {
    clientId: { type: 'string' },
    clientSecret: { type: 'string' },
    refreshToken: { type: 'string' },
  },
};

export const gmailTool: ToolDefinition = {
  name: 'gmail',
  description: 'Read and send Gmail messages via the Google Gmail API (OAuth2 refresh token)',
  actions: [
    {
      action: 'list-messages',
      description: 'List Gmail messages matching a query (e.g. "is:unread", "from:user@example.com")',
      inputSchema: {
        type: 'object',
        required: ['credentials'],
        properties: {
          credentials: credsSchema,
          query: { type: 'string', description: 'Gmail search query string' },
          labelIds: { type: 'array', items: { type: 'string' } },
          maxResults: { type: 'number', default: 100 },
          pageToken: { type: 'string' },
        },
      },
    },
    {
      action: 'get-message',
      description: 'Get the full contents of a Gmail message',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'messageId'],
        properties: {
          credentials: credsSchema,
          messageId: { type: 'string' },
          format: { type: 'string', enum: ['full', 'metadata', 'minimal', 'raw'], default: 'full' },
        },
      },
    },
    {
      action: 'send-message',
      description: 'Send an email via Gmail',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'to', 'subject', 'body'],
        properties: {
          credentials: credsSchema,
          to: { type: 'string' },
          subject: { type: 'string' },
          body: { type: 'string' },
          bodyType: { type: 'string', enum: ['text', 'html'], default: 'text' },
          from: { type: 'string' },
          cc: { type: 'string' },
          bcc: { type: 'string' },
        },
      },
    },
    {
      action: 'modify-message',
      description: 'Add or remove labels on a Gmail message (e.g. mark as read by removing UNREAD)',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'messageId'],
        properties: {
          credentials: credsSchema,
          messageId: { type: 'string' },
          addLabelIds: { type: 'array', items: { type: 'string' } },
          removeLabelIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  ],
  router,
};
