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

async function getAppToken(creds: { tenantId: string; clientId: string; clientSecret: string }): Promise<string> {
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });

  const res = await fetch(`https://login.microsoftonline.com/${creds.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Microsoft client_credentials token failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export async function sendAsApp(
  creds: { tenantId: string; clientId: string; clientSecret: string; userEmail: string },
  opts: { to: string[]; subject: string; body: string; bodyType?: 'text' | 'html'; cc?: string[]; bcc?: string[]; saveToSentItems?: boolean },
) {
  const token = await getAppToken(creds);
  const message: any = {
    subject: opts.subject,
    body: { contentType: opts.bodyType === 'html' ? 'HTML' : 'Text', content: opts.body },
    toRecipients: opts.to.map((email) => ({ emailAddress: { address: email } })),
    ccRecipients: opts.cc?.map((email) => ({ emailAddress: { address: email } })) || [],
    bccRecipients: opts.bcc?.map((email) => ({ emailAddress: { address: email } })) || [],
  };

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(creds.userEmail)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, saveToSentItems: opts.saveToSentItems ?? true }),
    },
  );

  if (res.status === 202) {
    return { sent: true, requestId: res.headers.get('request-id') };
  }
  const errBody = await res.text();
  throw new Error(`Graph sendMail (app-flow) failed ${res.status}: ${errBody.slice(0, 500)}`);
}
