import { Router } from 'express';
import type { ToolDefinition } from '../../types/tool';
import { sendSuccess, sendError } from '../../lib/response';
import type { InboxLogInquiryInput, InboxGetStatsInput } from './types';

const router = Router();

router.post('/log-inquiry', async (req, res) => {
  const start = Date.now();
  const input = req.body as InboxLogInquiryInput;

  if (!input.credentials?.baseUrl || !input.credentials?.apiToken) {
    return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.baseUrl and credentials.apiToken are required');
  }
  if (!['instagram', 'email'].includes(input.canal)) {
    return sendError(res, 400, 'INVALID_FIELD', 'canal must be instagram or email');
  }
  if (!input.expediteur || !input.texte) {
    return sendError(res, 400, 'MISSING_FIELDS', 'expediteur and texte are required');
  }

  try {
    const url = input.credentials.baseUrl.replace(/\/$/, '') + '/api/inquiries';
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.credentials.apiToken}`,
      },
      body: JSON.stringify({
        canal: input.canal,
        source: input.source,
        expediteur: input.expediteur,
        sujet: input.sujet,
        texte: input.texte,
        reponse_proposee: input.reponse_proposee,
        horodatage: input.horodatage || new Date().toISOString(),
        external_id: input.external_id,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const body = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      return sendError(res, 502, 'INBOX_FAILED', `Inbox returned ${upstream.status}`, body, {
        durationMs: Date.now() - start,
      });
    }

    sendSuccess(res, body, { durationMs: Date.now() - start });
  } catch (err: any) {
    sendError(res, 500, 'INTERNAL_ERROR', err.message, undefined, { durationMs: Date.now() - start });
  }
});

router.post('/get-stats', async (req, res) => {
  const start = Date.now();
  const input = req.body as InboxGetStatsInput;

  if (!input.credentials?.baseUrl || !input.credentials?.apiToken) {
    return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.baseUrl and credentials.apiToken are required');
  }

  try {
    const url = new URL(input.credentials.baseUrl.replace(/\/$/, '') + '/api/stats');
    if (input.range) url.searchParams.set('range', input.range);

    const upstream = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${input.credentials.apiToken}` },
      signal: AbortSignal.timeout(10_000),
    });

    const body = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      return sendError(res, 502, 'INBOX_FAILED', `Inbox returned ${upstream.status}`, body, {
        durationMs: Date.now() - start,
      });
    }

    sendSuccess(res, body, { durationMs: Date.now() - start });
  } catch (err: any) {
    sendError(res, 500, 'INTERNAL_ERROR', err.message, undefined, { durationMs: Date.now() - start });
  }
});

const credsSchema = {
  type: 'object',
  required: ['baseUrl', 'apiToken'],
  properties: {
    baseUrl: { type: 'string', description: 'BusinessInbox base URL (e.g. https://samtr.umbeli.com)' },
    apiToken: { type: 'string', description: 'API_TOKEN bearer secret' },
  },
};

export const inboxTool: ToolDefinition = {
  name: 'inbox',
  description: 'Log commercial inquiries to a BusinessInbox/Ciao instance',
  actions: [
    {
      action: 'log-inquiry',
      description: 'POST a new inquiry (Instagram DM or email) to a BusinessInbox endpoint',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'canal', 'expediteur', 'texte'],
        properties: {
          credentials: credsSchema,
          canal: { type: 'string', enum: ['instagram', 'email'] },
          source: { type: 'string', description: 'gmail | outlook | instagram | other' },
          expediteur: { type: 'string', description: 'Sender ID or email address' },
          sujet: { type: 'string', description: 'Email subject (optional)' },
          texte: { type: 'string', description: 'Message body' },
          reponse_proposee: { type: 'string', description: 'AI-generated proposed reply' },
          horodatage: { type: 'string', description: 'ISO timestamp (defaults to now)' },
          external_id: { type: 'string', description: 'Optional unique ID for dedup' },
        },
      },
    },
    {
      action: 'get-stats',
      description: 'Fetch inquiry stats from a BusinessInbox endpoint',
      inputSchema: {
        type: 'object',
        required: ['credentials'],
        properties: {
          credentials: credsSchema,
          range: { type: 'string', enum: ['today', 'week', 'all'], default: 'today' },
        },
      },
    },
  ],
  router,
};
