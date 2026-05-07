import { BaseAdapter } from '../../lib/baseAdapter';

const GRAPH_API_VERSION = 'v23.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

function createAdapter(accessToken: string) {
  return new (class extends BaseAdapter {
    async graphRequest(method: string, path: string, opts: { query?: Record<string, any>; form?: Record<string, any> } = {}) {
      const { query = {}, form, ...rest } = opts;
      const requestOpts: any = {
        query: { ...query, access_token: accessToken },
        ...rest,
      };

      if (form) {
        const body = new URLSearchParams();
        for (const [k, v] of Object.entries(form)) {
          if (v !== undefined && v !== null) body.append(k, String(v));
        }
        requestOpts.body = body;
        requestOpts.json = false;
      }

      const { data } = await this.request(method, path, requestOpts);
      if (data?.error) {
        throw new Error(`Graph API error: ${data.error.message || 'Unknown error'}`);
      }
      return data;
    }
  })({ baseUrl: GRAPH_BASE_URL });
}

export async function metaSendDM(accessToken: string, igUserId: string, recipientId: string, message: string) {
  const adapter = createAdapter(accessToken);
  return adapter.graphRequest('POST', `/${igUserId}/messages`, {
    form: {
      recipient: JSON.stringify({ comment_id: recipientId }),
      message: JSON.stringify({ text: message }),
    },
  });
}

export async function metaReplyComment(accessToken: string, commentId: string, message: string) {
  const adapter = createAdapter(accessToken);
  return adapter.graphRequest('POST', `/${commentId}/replies`, {
    form: { message },
  });
}

export async function metaGetAccounts(accessToken: string) {
  const adapter = createAdapter(accessToken);
  const pages = await adapter.graphRequest('GET', '/me/accounts', {
    query: { fields: 'id,name,access_token,instagram_business_account{id,username}' },
  });
  return pages;
}

export async function metaPublish(accessToken: string, igUserId: string, params: Record<string, string>) {
  const adapter = createAdapter(accessToken);
  const container = await adapter.graphRequest('POST', `/${igUserId}/media`, { form: params });
  const result = await adapter.graphRequest('POST', `/${igUserId}/media_publish`, {
    form: { creation_id: container.id },
  });
  return result;
}

export async function metaListConversations(accessToken: string, igUserId: string, opts: { platform?: 'instagram' | 'messenger'; limit?: number } = {}) {
  const adapter = createAdapter(accessToken);
  return adapter.graphRequest('GET', `/${igUserId}/conversations`, {
    query: {
      platform: opts.platform || 'instagram',
      limit: opts.limit || 25,
      fields: 'id,updated_time,participants',
    },
  });
}

export async function metaListConversationMessages(accessToken: string, conversationId: string, limit = 25) {
  const adapter = createAdapter(accessToken);
  return adapter.graphRequest('GET', `/${conversationId}`, {
    query: {
      fields: `messages.limit(${limit}){id,created_time,from,to,message}`,
    },
  });
}
