import { Router } from 'express';
import type { ToolDefinition } from '../../types/tool';
import { sendSuccess, sendError } from '../../lib/response';
import { dispatchWebhook } from './dispatcher';
import type { WebhookDispatchInput } from './types';

const router = Router();

router.post('/dispatch', async (req, res) => {
  const start = Date.now();
  const input = req.body as WebhookDispatchInput;

  if (!input.url) {
    return sendError(res, 400, 'MISSING_FIELDS', 'url is required');
  }
  if (input.body === undefined) {
    return sendError(res, 400, 'MISSING_FIELDS', 'body is required');
  }

  try {
    const result = await dispatchWebhook(input.url, input.body, {
      method: input.method,
      headers: input.headers,
      timeoutMs: input.timeoutMs,
    });

    if (!result.success) {
      return sendError(res, 502, 'WEBHOOK_FAILED', `Webhook returned ${result.statusCode}`, result.responseBody, {
        durationMs: Date.now() - start,
      });
    }

    sendSuccess(res, result, { durationMs: Date.now() - start });
  } catch (err: any) {
    sendError(res, 500, 'INTERNAL_ERROR', err.message, undefined, { durationMs: Date.now() - start });
  }
});

export const webhookTool: ToolDefinition = {
  name: 'webhook',
  description: 'Dispatch HTTP webhooks to external URLs',
  actions: [
    {
      action: 'dispatch',
      description: 'Send an HTTP request to a webhook URL',
      inputSchema: {
        type: 'object',
        required: ['url', 'body'],
        properties: {
          url: { type: 'string' },
          method: { type: 'string', enum: ['POST', 'PUT', 'PATCH'], default: 'POST' },
          headers: { type: 'object', description: 'Additional HTTP headers' },
          body: { description: 'The JSON payload to send' },
          timeoutMs: { type: 'number', default: 10000 },
        },
      },
    },
  ],
  router,
};
