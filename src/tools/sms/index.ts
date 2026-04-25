import { Router } from 'express';
import type { ToolDefinition } from '../../types/tool';
import { sendSuccess, sendError } from '../../lib/response';
import { sendSms } from './twilio.adapter';
import type { SmsSendInput } from './types';

const router = Router();

router.post('/send', async (req, res) => {
  const start = Date.now();
  const input = req.body as SmsSendInput;

  if (!input.credentials?.accountSid || !input.credentials?.authToken || !input.credentials?.from) {
    return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.accountSid, credentials.authToken, and credentials.from are required');
  }
  if (!input.to || !input.body) {
    return sendError(res, 400, 'MISSING_FIELDS', 'to and body are required');
  }

  try {
    const result = await sendSms(input.credentials, input.to, input.body, input.channel);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'twilio', channel: input.channel || 'sms' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, {
      durationMs: Date.now() - start,
      provider: 'twilio',
    });
  }
});

export const smsTool: ToolDefinition = {
  name: 'sms',
  description: 'Send SMS and WhatsApp messages via Twilio',
  actions: [
    {
      action: 'send',
      description: 'Send an SMS or WhatsApp message',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'to', 'body'],
        properties: {
          credentials: {
            type: 'object',
            required: ['accountSid', 'authToken', 'from'],
            properties: {
              accountSid: { type: 'string' },
              authToken: { type: 'string' },
              from: { type: 'string', description: 'Sender phone number (e.g. +1234567890)' },
            },
          },
          to: { type: 'string', description: 'Recipient phone number' },
          body: { type: 'string' },
          channel: { type: 'string', enum: ['sms', 'whatsapp'], default: 'sms' },
        },
      },
    },
  ],
  router,
};
