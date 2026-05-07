import type { OutlookCredentials } from './types';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

function tokenUrl(tenantId?: string) {
  return `https://login.microsoftonline.com/${tenantId || 'common'}/oauth2/v2.0/token`;
}

async function getAccessToken(creds: OutlookCredentials): Promise<string> {
  const params = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: creds.refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(tokenUrl(creds.tenantId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Microsoft OAuth refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function graphRequest(
  creds: OutlookCredentials,
  method: string,
  path: string,
  opts: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
) {
  const token = await getAccessToken(creds);
  const url = new URL(`${GRAPH_BASE}${path}`);
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
    throw new Error(`Microsoft Graph ${method} ${path} failed (${res.status}): ${data?.error?.message || text}`);
  }
  return data;
}

export async function listMessages(
  creds: OutlookCredentials,
  opts: { filter?: string; search?: string; top?: number; skip?: number; orderby?: string } = {},
) {
  const query: Record<string, string | number | undefined> = {
    $top: opts.top || 25,
  };
  if (opts.filter) query.$filter = opts.filter;
  if (opts.search) query.$search = `"${opts.search}"`;
  if (opts.skip) query.$skip = opts.skip;
  if (opts.orderby) query.$orderby = opts.orderby;
  return graphRequest(creds, 'GET', '/me/messages', { query });
}

export async function getMessage(creds: OutlookCredentials, messageId: string) {
  return graphRequest(creds, 'GET', `/me/messages/${messageId}`);
}

export async function sendMessage(
  creds: OutlookCredentials,
  opts: { to: string[]; subject: string; body: string; bodyType?: 'text' | 'html'; cc?: string[]; bcc?: string[] },
) {
  const toRecipients = opts.to.map((email) => ({ emailAddress: { address: email } }));
  const ccRecipients = opts.cc?.map((email) => ({ emailAddress: { address: email } })) || [];
  const bccRecipients = opts.bcc?.map((email) => ({ emailAddress: { address: email } })) || [];

  return graphRequest(creds, 'POST', '/me/sendMail', {
    body: {
      message: {
        subject: opts.subject,
        body: { contentType: opts.bodyType === 'html' ? 'HTML' : 'Text', content: opts.body },
        toRecipients,
        ccRecipients,
        bccRecipients,
      },
    },
  });
}

export async function markRead(creds: OutlookCredentials, messageId: string, isRead: boolean) {
  return graphRequest(creds, 'PATCH', `/me/messages/${messageId}`, { body: { isRead } });
}
