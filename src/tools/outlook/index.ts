import { Router } from 'express';
import type { ToolDefinition } from '../../types/tool';
import { sendSuccess, sendError } from '../../lib/response';
import { listMessages, getMessage, sendMessage, markRead } from './outlook.adapter';
import type { OutlookListInput, OutlookGetInput, OutlookSendInput, OutlookMarkReadInput } from './types';

const router = Router();

function validateCreds(c: any) {
  return c?.clientId && c?.clientSecret && c?.refreshToken;
}

router.post('/list-messages', async (req, res) => {
  const start = Date.now();
  const input = req.body as OutlookListInput;
  if (!validateCreds(input.credentials)) {
    return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.clientId, clientSecret, and refreshToken are required');
  }
  try {
    const result = await listMessages(input.credentials, input);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'outlook' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'outlook' });
  }
});

router.post('/get-message', async (req, res) => {
  const start = Date.now();
  const input = req.body as OutlookGetInput;
  if (!validateCreds(input.credentials)) {
    return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.clientId, clientSecret, and refreshToken are required');
  }
  if (!input.messageId) return sendError(res, 400, 'MISSING_FIELDS', 'messageId is required');
  try {
    const result = await getMessage(input.credentials, input.messageId);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'outlook' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'outlook' });
  }
});

router.post('/send-message', async (req, res) => {
  const start = Date.now();
  const input = req.body as OutlookSendInput;
  if (!validateCreds(input.credentials)) {
    return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.clientId, clientSecret, and refreshToken are required');
  }
  if (!input.to?.length || !input.subject || !input.body) {
    return sendError(res, 400, 'MISSING_FIELDS', 'to, subject, and body are required');
  }
  try {
    const result = await sendMessage(input.credentials, input);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'outlook' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'outlook' });
  }
});

router.post('/mark-read', async (req, res) => {
  const start = Date.now();
  const input = req.body as OutlookMarkReadInput;
  if (!validateCreds(input.credentials)) {
    return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.clientId, clientSecret, and refreshToken are required');
  }
  if (!input.messageId) return sendError(res, 400, 'MISSING_FIELDS', 'messageId is required');
  try {
    const result = await markRead(input.credentials, input.messageId, input.isRead ?? true);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'outlook' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'outlook' });
  }
});

const credsSchema = {
  type: 'object',
  required: ['clientId', 'clientSecret', 'refreshToken'],
  properties: {
    clientId: { type: 'string' },
    clientSecret: { type: 'string' },
    refreshToken: { type: 'string' },
    tenantId: { type: 'string', description: 'Azure tenant (defaults to "common")' },
  },
};

export const outlookTool: ToolDefinition = {
  name: 'outlook',
  description: 'Read and send Outlook/Microsoft 365 emails via Microsoft Graph API',
  actions: [
    {
      action: 'list-messages',
      description: 'List Outlook messages with optional OData $filter or $search',
      inputSchema: {
        type: 'object',
        required: ['credentials'],
        properties: {
          credentials: credsSchema,
          filter: { type: 'string', description: 'OData $filter (e.g. "isRead eq false")' },
          search: { type: 'string', description: 'Free-text search' },
          top: { type: 'number', default: 25 },
          skip: { type: 'number' },
          orderby: { type: 'string', description: 'e.g. "receivedDateTime desc"' },
        },
      },
    },
    {
      action: 'get-message',
      description: 'Get the full contents of an Outlook message',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'messageId'],
        properties: { credentials: credsSchema, messageId: { type: 'string' } },
      },
    },
    {
      action: 'send-message',
      description: 'Send an email via Outlook',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'to', 'subject', 'body'],
        properties: {
          credentials: credsSchema,
          to: { type: 'array', items: { type: 'string' } },
          subject: { type: 'string' },
          body: { type: 'string' },
          bodyType: { type: 'string', enum: ['text', 'html'], default: 'text' },
          cc: { type: 'array', items: { type: 'string' } },
          bcc: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    {
      action: 'mark-read',
      description: 'Mark an Outlook message as read or unread',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'messageId'],
        properties: {
          credentials: credsSchema,
          messageId: { type: 'string' },
          isRead: { type: 'boolean', default: true },
        },
      },
    },
  ],
  router,
};
