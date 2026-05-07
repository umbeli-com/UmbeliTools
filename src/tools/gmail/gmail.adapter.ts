import type { GmailCredentials } from './types';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

async function getAccessToken(creds: GmailCredentials): Promise<string> {
  const params = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: creds.refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google OAuth refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function gmailRequest(
  creds: GmailCredentials,
  method: string,
  path: string,
  opts: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
) {
  const token = await getAccessToken(creds);
  const url = new URL(`${GMAIL_BASE}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

  const res = await fetch(url.toString(), init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new Error(`Gmail API ${method} ${path} failed (${res.status}): ${data?.error?.message || text}`);
  }
  return data;
}

export async function listMessages(
  creds: GmailCredentials,
  opts: { query?: string; labelIds?: string[]; maxResults?: number; pageToken?: string } = {},
) {
  const query: Record<string, string | number> = {};
  if (opts.query) query.q = opts.query;
  if (opts.maxResults) query.maxResults = opts.maxResults;
  if (opts.pageToken) query.pageToken = opts.pageToken;
  if (opts.labelIds?.length) {
    return gmailRequest(creds, 'GET', '/users/me/messages', {
      query: { ...query, labelIds: opts.labelIds.join(',') },
    });
  }
  return gmailRequest(creds, 'GET', '/users/me/messages', { query });
}

export async function getMessage(
  creds: GmailCredentials,
  messageId: string,
  format: 'full' | 'metadata' | 'minimal' | 'raw' = 'full',
) {
  return gmailRequest(creds, 'GET', `/users/me/messages/${messageId}`, { query: { format } });
}

export async function sendMessage(
  creds: GmailCredentials,
  opts: { to: string; subject: string; body: string; bodyType?: 'text' | 'html'; from?: string; cc?: string; bcc?: string },
) {
  const headers: string[] = [];
  if (opts.from) headers.push(`From: ${opts.from}`);
  headers.push(`To: ${opts.to}`);
  if (opts.cc) headers.push(`Cc: ${opts.cc}`);
  if (opts.bcc) headers.push(`Bcc: ${opts.bcc}`);
  headers.push(`Subject: ${opts.subject}`);
  headers.push('MIME-Version: 1.0');
  headers.push(`Content-Type: ${opts.bodyType === 'html' ? 'text/html' : 'text/plain'}; charset=utf-8`);

  const raw = Buffer.from(`${headers.join('\r\n')}\r\n\r\n${opts.body}`, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return gmailRequest(creds, 'POST', '/users/me/messages/send', { body: { raw } });
}

export async function modifyMessage(
  creds: GmailCredentials,
  messageId: string,
  opts: { addLabelIds?: string[]; removeLabelIds?: string[] },
) {
  return gmailRequest(creds, 'POST', `/users/me/messages/${messageId}/modify`, {
    body: { addLabelIds: opts.addLabelIds || [], removeLabelIds: opts.removeLabelIds || [] },
  });
}
