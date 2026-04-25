export interface WebhookDispatchInput {
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  body: unknown;
  timeoutMs?: number;
}
