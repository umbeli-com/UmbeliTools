import { Router } from 'express';
import type { ToolDefinition } from '../../types/tool';
import { sendSuccess, sendError } from '../../lib/response';
import { checkAvailability, suggestDomains, purchaseDomain, setNameservers } from './gandi.adapter';
import type { DomainCheckInput, DomainSuggestInput, DomainPurchaseInput, DomainSetNameserversInput } from './types';

const router = Router();

function checkCreds(c: any) {
  return c?.apiKey;
}

router.post('/check-availability', async (req, res) => {
  const start = Date.now();
  const input = req.body as DomainCheckInput;
  if (!checkCreds(input.credentials)) return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.apiKey is required');
  if (!input.domain) return sendError(res, 400, 'MISSING_FIELDS', 'domain is required');
  try {
    const result = await checkAvailability(input.credentials, input.domain);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'gandi' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'gandi' });
  }
});

router.post('/suggest', async (req, res) => {
  const start = Date.now();
  const input = req.body as DomainSuggestInput;
  if (!checkCreds(input.credentials)) return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.apiKey is required');
  if (!input.query) return sendError(res, 400, 'MISSING_FIELDS', 'query is required');
  try {
    const result = await suggestDomains(input.credentials, input.query, input.country);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'gandi' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'gandi' });
  }
});

router.post('/purchase', async (req, res) => {
  const start = Date.now();
  const input = req.body as DomainPurchaseInput;
  if (!checkCreds(input.credentials)) return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.apiKey is required');
  if (!input.domain || !input.contact) return sendError(res, 400, 'MISSING_FIELDS', 'domain and contact are required');
  try {
    const result = await purchaseDomain(input.credentials, input.domain, input.contact, {
      duration: input.duration,
      nameservers: input.nameservers,
    });
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'gandi' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'gandi' });
  }
});

router.post('/set-nameservers', async (req, res) => {
  const start = Date.now();
  const input = req.body as DomainSetNameserversInput;
  if (!checkCreds(input.credentials)) return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.apiKey is required');
  if (!input.domain || !input.nameservers?.length) return sendError(res, 400, 'MISSING_FIELDS', 'domain and nameservers are required');
  try {
    const result = await setNameservers(input.credentials, input.domain, input.nameservers);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'gandi' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'gandi' });
  }
});

const credsSchema = {
  type: 'object',
  required: ['apiKey'],
  properties: { apiKey: { type: 'string', description: 'Gandi API key' } },
};

const contactSchema = {
  type: 'object',
  required: ['email', 'given', 'family', 'streetaddr', 'city', 'country', 'phone', 'type'],
  properties: {
    email: { type: 'string' },
    given: { type: 'string' },
    family: { type: 'string' },
    streetaddr: { type: 'string' },
    city: { type: 'string' },
    country: { type: 'string', description: 'Two-letter country code (e.g. CA, FR)' },
    phone: { type: 'string' },
    zip: { type: 'string' },
    orgname: { type: 'string' },
    type: { type: 'string', enum: ['person', 'company', 'association', 'publicbody'] },
  },
};

export const domainTool: ToolDefinition = {
  name: 'domain',
  description: 'Domain availability, suggestions, registration, and nameserver management via Gandi',
  actions: [
    {
      action: 'check-availability',
      description: 'Check whether a domain is available for registration',
      inputSchema: { type: 'object', required: ['credentials', 'domain'], properties: { credentials: credsSchema, domain: { type: 'string' } } },
    },
    {
      action: 'suggest',
      description: 'Get domain name suggestions for a query string',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'query'],
        properties: { credentials: credsSchema, query: { type: 'string' }, country: { type: 'string' } },
      },
    },
    {
      action: 'purchase',
      description: 'Register/purchase a domain via Gandi',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'domain', 'contact'],
        properties: {
          credentials: credsSchema,
          domain: { type: 'string' },
          contact: contactSchema,
          duration: { type: 'number', default: 1, description: 'Years' },
          nameservers: { type: 'array', items: { type: 'string' }, description: 'Defaults to Cloudflare nameservers' },
        },
      },
    },
    {
      action: 'set-nameservers',
      description: 'Update nameservers for an owned domain',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'domain', 'nameservers'],
        properties: {
          credentials: credsSchema,
          domain: { type: 'string' },
          nameservers: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  ],
  router,
};
