import { Router } from 'express';
import type { ToolDefinition } from '../../types/tool';
import { sendSuccess, sendError } from '../../lib/response';
import { createZone, getZone, deleteZone, listRecords, addRecord, updateRecord, deleteRecord } from './cloudflare.adapter';
import type {
  DnsCreateZoneInput,
  DnsGetZoneInput,
  DnsDeleteZoneInput,
  DnsAddRecordInput,
  DnsListRecordsInput,
  DnsUpdateRecordInput,
  DnsDeleteRecordInput,
} from './types';

const router = Router();

function checkApiToken(c: any) {
  return c?.apiToken;
}

router.post('/create-zone', async (req, res) => {
  const start = Date.now();
  const input = req.body as DnsCreateZoneInput;
  if (!checkApiToken(input.credentials)) return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.apiToken is required');
  if (!input.credentials.accountId) return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.accountId is required for zone creation');
  if (!input.domain) return sendError(res, 400, 'MISSING_FIELDS', 'domain is required');
  try {
    const result = await createZone(input.credentials, input.domain);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'cloudflare' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'cloudflare' });
  }
});

router.post('/get-zone', async (req, res) => {
  const start = Date.now();
  const input = req.body as DnsGetZoneInput;
  if (!checkApiToken(input.credentials)) return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.apiToken is required');
  if (!input.domain) return sendError(res, 400, 'MISSING_FIELDS', 'domain is required');
  try {
    const result = await getZone(input.credentials, input.domain);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'cloudflare' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'cloudflare' });
  }
});

router.post('/delete-zone', async (req, res) => {
  const start = Date.now();
  const input = req.body as DnsDeleteZoneInput;
  if (!checkApiToken(input.credentials)) return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.apiToken is required');
  if (!input.zoneId) return sendError(res, 400, 'MISSING_FIELDS', 'zoneId is required');
  try {
    const result = await deleteZone(input.credentials, input.zoneId);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'cloudflare' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'cloudflare' });
  }
});

router.post('/list-records', async (req, res) => {
  const start = Date.now();
  const input = req.body as DnsListRecordsInput;
  if (!checkApiToken(input.credentials)) return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.apiToken is required');
  if (!input.zoneId) return sendError(res, 400, 'MISSING_FIELDS', 'zoneId is required');
  try {
    const result = await listRecords(input.credentials, input.zoneId);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'cloudflare' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'cloudflare' });
  }
});

router.post('/add-record', async (req, res) => {
  const start = Date.now();
  const input = req.body as DnsAddRecordInput;
  if (!checkApiToken(input.credentials)) return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.apiToken is required');
  if (!input.zoneId || !input.type || !input.name || !input.content) {
    return sendError(res, 400, 'MISSING_FIELDS', 'zoneId, type, name, and content are required');
  }
  try {
    const result = await addRecord(input.credentials, input.zoneId, input);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'cloudflare' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'cloudflare' });
  }
});

router.post('/update-record', async (req, res) => {
  const start = Date.now();
  const input = req.body as DnsUpdateRecordInput;
  if (!checkApiToken(input.credentials)) return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.apiToken is required');
  if (!input.zoneId || !input.recordId) return sendError(res, 400, 'MISSING_FIELDS', 'zoneId and recordId are required');
  try {
    const result = await updateRecord(input.credentials, input.zoneId, input.recordId, input);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'cloudflare' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'cloudflare' });
  }
});

router.post('/delete-record', async (req, res) => {
  const start = Date.now();
  const input = req.body as DnsDeleteRecordInput;
  if (!checkApiToken(input.credentials)) return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.apiToken is required');
  if (!input.zoneId || !input.recordId) return sendError(res, 400, 'MISSING_FIELDS', 'zoneId and recordId are required');
  try {
    const result = await deleteRecord(input.credentials, input.zoneId, input.recordId);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'cloudflare' });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, { durationMs: Date.now() - start, provider: 'cloudflare' });
  }
});

const credsSchema = {
  type: 'object',
  required: ['apiToken'],
  properties: {
    apiToken: { type: 'string', description: 'Cloudflare API token' },
    accountId: { type: 'string', description: 'Required for zone creation' },
  },
};

export const dnsTool: ToolDefinition = {
  name: 'dns',
  description: 'Manage Cloudflare DNS zones and records',
  actions: [
    { action: 'create-zone', description: 'Create a Cloudflare DNS zone', inputSchema: { type: 'object', required: ['credentials', 'domain'], properties: { credentials: credsSchema, domain: { type: 'string' } } } },
    { action: 'get-zone', description: 'Get a Cloudflare zone by domain', inputSchema: { type: 'object', required: ['credentials', 'domain'], properties: { credentials: credsSchema, domain: { type: 'string' } } } },
    { action: 'delete-zone', description: 'Delete a Cloudflare zone', inputSchema: { type: 'object', required: ['credentials', 'zoneId'], properties: { credentials: credsSchema, zoneId: { type: 'string' } } } },
    { action: 'list-records', description: 'List DNS records in a zone', inputSchema: { type: 'object', required: ['credentials', 'zoneId'], properties: { credentials: credsSchema, zoneId: { type: 'string' } } } },
    {
      action: 'add-record',
      description: 'Add a DNS record',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'zoneId', 'type', 'name', 'content'],
        properties: {
          credentials: credsSchema,
          zoneId: { type: 'string' },
          type: { type: 'string', enum: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV'] },
          name: { type: 'string' },
          content: { type: 'string' },
          ttl: { type: 'number', default: 1 },
          proxied: { type: 'boolean', default: false },
          priority: { type: 'number', description: 'Required for MX records' },
        },
      },
    },
    {
      action: 'update-record',
      description: 'Update an existing DNS record',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'zoneId', 'recordId', 'type', 'name', 'content'],
        properties: {
          credentials: credsSchema,
          zoneId: { type: 'string' },
          recordId: { type: 'string' },
          type: { type: 'string' },
          name: { type: 'string' },
          content: { type: 'string' },
          ttl: { type: 'number' },
          proxied: { type: 'boolean' },
          priority: { type: 'number' },
        },
      },
    },
    {
      action: 'delete-record',
      description: 'Delete a DNS record',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'zoneId', 'recordId'],
        properties: { credentials: credsSchema, zoneId: { type: 'string' }, recordId: { type: 'string' } },
      },
    },
  ],
  router,
};
