import { Router } from 'express';
import type { ToolDefinition } from '../../types/tool';
import { sendMailjet } from './mailjet.adapter';
import { sendSmtp } from './smtp.adapter';
import { sendSuccess, sendError } from '../../lib/response';
import type { EmailSendInput, EmailSmtpSendInput } from './types';

const router = Router();

router.post('/send', async (req, res) => {
  const start = Date.now();
  const input = req.body as EmailSendInput;

  if (!input.credentials?.apiKey || !input.credentials?.secretKey) {
    return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.apiKey and credentials.secretKey are required');
  }
  if (!input.from?.email || !input.to?.length || !input.subject || !input.htmlBody) {
    return sendError(res, 400, 'MISSING_FIELDS', 'from.email, to, subject, and htmlBody are required');
  }

  try {
    const result = await sendMailjet(input.credentials, [
      {
        From: { Email: input.from.email, Name: input.from.name },
        To: input.to.map((t) => ({ Email: t.email, Name: t.name })),
        Subject: input.subject,
        HTMLPart: input.htmlBody,
      },
    ]);

    if (!result.success) {
      return sendError(res, 502, 'PROVIDER_ERROR', result.error || 'Mailjet send failed', undefined, {
        durationMs: Date.now() - start,
        provider: 'mailjet',
      });
    }

    sendSuccess(res, result.response, { durationMs: Date.now() - start, provider: 'mailjet' });
  } catch (err: any) {
    sendError(res, 500, 'INTERNAL_ERROR', err.message, undefined, {
      durationMs: Date.now() - start,
      provider: 'mailjet',
    });
  }
});

router.post('/smtp-send', async (req, res) => {
  const start = Date.now();
  const input = req.body as EmailSmtpSendInput;

  if (!input.credentials?.host || !input.credentials?.user || !input.credentials?.password) {
    return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.host, credentials.user, and credentials.password are required');
  }
  if (!input.from?.email || !input.to || !input.subject || (!input.text && !input.html)) {
    return sendError(res, 400, 'MISSING_FIELDS', 'from.email, to, subject, and text or html are required');
  }

  try {
    const result = await sendSmtp(input.credentials, input);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'smtp', host: input.credentials.host });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, {
      durationMs: Date.now() - start,
      provider: 'smtp',
    });
  }
});

export const emailTool: ToolDefinition = {
  name: 'email',
  description: 'Send transactional emails via Mailjet',
  actions: [
    {
      action: 'send',
      description: 'Send one or more emails via Mailjet',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'from', 'to', 'subject', 'htmlBody'],
        properties: {
          credentials: {
            type: 'object',
            required: ['apiKey', 'secretKey'],
            properties: {
              apiKey: { type: 'string' },
              secretKey: { type: 'string' },
            },
          },
          from: {
            type: 'object',
            required: ['email'],
            properties: { email: { type: 'string' }, name: { type: 'string' } },
          },
          to: {
            type: 'array',
            items: {
              type: 'object',
              required: ['email'],
              properties: { email: { type: 'string' }, name: { type: 'string' } },
            },
          },
          subject: { type: 'string' },
          htmlBody: { type: 'string' },
        },
      },
    },
    {
      action: 'smtp-send',
      description: 'Send an email via any SMTP server (Outlook SMTP, Gmail SMTP, infomaniak, Mailgun, custom, etc.)',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'from', 'to', 'subject'],
        properties: {
          credentials: {
            type: 'object',
            required: ['host', 'user', 'password'],
            properties: {
              host: { type: 'string', description: 'SMTP host (e.g. smtp.office365.com)' },
              port: { type: 'number', default: 587 },
              secure: { type: 'boolean', description: 'true for port 465, false for STARTTLS on 587' },
              user: { type: 'string' },
              password: { type: 'string' },
            },
          },
          from: {
            type: 'object',
            required: ['email'],
            properties: { email: { type: 'string' }, name: { type: 'string' } },
          },
          to: { type: 'string' },
          subject: { type: 'string' },
          text: { type: 'string', description: 'Plain-text body' },
          html: { type: 'string', description: 'HTML body' },
          cc: { type: 'string' },
          bcc: { type: 'string' },
          replyTo: { type: 'string' },
        },
      },
    },
  ],
  router,
};
