import { UmbeliToolsCore } from '../client.js';

export interface WebhookDispatchInput {
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  body: unknown;
  timeoutMs?: number;
}

export interface WebhookDispatchResult {
  success: boolean;
  statusCode: number;
  responseBody?: unknown;
  [key: string]: unknown;
}

export class WebhookTool {
  constructor(private readonly core: UmbeliToolsCore) {}

  dispatch(input: WebhookDispatchInput) {
    return this.core.request<WebhookDispatchResult>('webhook', 'dispatch', input);
  }
}
