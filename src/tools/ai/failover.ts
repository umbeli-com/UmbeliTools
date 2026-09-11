import { AdapterError } from '../../lib/errors';
import type { AICredentials, AIProvider, AIProviderCredential } from './types';

export interface FailoverAttempt {
  provider: AIProvider;
  /** Upstream HTTP status when we could recover one. */
  status?: number;
  message: string;
  /** true when the chain moved on to the next provider after this failure. */
  failedOver: boolean;
}

/** Statuses that mean "this provider is unhealthy right now", not "your prompt is bad". */
const FAILOVER_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 522, 524, 529]);
const AUTH_STATUSES = new Set([401, 403]);

const TRANSPORT_ERROR_NAMES = new Set([
  'APIConnectionError',
  'APIConnectionTimeoutError',
  'APIUserAbortError',
  'AbortError',
  'TimeoutError',
  'FetchError',
]);

const TRANSPORT_MESSAGE_RE =
  /(fetch failed|network error|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|timed? ?out|aborted)/i;

export class ProviderChainError extends Error {
  attempts: FailoverAttempt[];
  status?: number;
  lastProvider?: AIProvider;
  /** The error thrown by the provider that ended the chain. */
  lastError?: unknown;

  constructor(attempts: FailoverAttempt[], lastError?: unknown) {
    const last = attempts[attempts.length - 1];
    super(
      attempts.length > 1
        ? `All ${attempts.length} AI providers failed: ${attempts.map((a) => `${a.provider}(${a.status ?? 'transport'}): ${a.message}`).join(' | ')}`
        : (last?.message ?? 'AI provider call failed'),
    );
    this.name = 'ProviderChainError';
    this.attempts = attempts;
    this.status = last?.status;
    this.lastProvider = last?.provider;
    this.lastError = lastError;
  }
}

/** Best-effort HTTP status extraction across AdapterError, the OpenAI/Anthropic SDKs and the Gemini SDK. */
export function providerStatus(err: unknown): number | undefined {
  if (err instanceof AdapterError) return err.status;
  const candidate = err as { status?: unknown; statusCode?: unknown; response?: { status?: unknown }; message?: unknown };
  for (const value of [candidate?.status, candidate?.statusCode, candidate?.response?.status]) {
    if (typeof value === 'number' && value >= 100 && value < 600) return value;
  }
  const message = typeof candidate?.message === 'string' ? candidate.message : '';
  // Gemini surfaces "[GoogleGenerativeAI Error]: ... [429 Too Many Requests]" style messages.
  const bracket = /\[(\d{3})\s/.exec(message) ?? /\bstatus(?:\s+code)?:?\s*(\d{3})\b/i.exec(message);
  if (bracket) {
    const parsed = Number(bracket[1]);
    if (parsed >= 100 && parsed < 600) return parsed;
  }
  return undefined;
}

export function isTransportError(err: unknown): boolean {
  if (err instanceof AdapterError) return err.status === undefined;
  const candidate = err as { name?: unknown; code?: unknown; message?: unknown };
  if (typeof candidate?.name === 'string' && TRANSPORT_ERROR_NAMES.has(candidate.name)) return true;
  if (typeof candidate?.code === 'string' && /^E[A-Z]+$/.test(candidate.code)) return true;
  if (typeof candidate?.message === 'string' && TRANSPORT_MESSAGE_RE.test(candidate.message)) return true;
  return false;
}

/**
 * A 400 is the caller's problem — burning the rest of the chain on it just costs
 * three bad requests instead of one. Only transport/408/429/5xx (and, opt-in,
 * 401/403) move to the next provider.
 */
export function shouldFailover(err: unknown, status: number | undefined, failoverOnAuthErrors: boolean): boolean {
  if (status !== undefined) {
    if (FAILOVER_STATUSES.has(status)) return true;
    if (failoverOnAuthErrors && AUTH_STATUSES.has(status)) return true;
    return false;
  }
  return isTransportError(err);
}

export function errorMessage(err: unknown): string {
  const base = err instanceof Error ? err.message : String(err);
  if (err instanceof AdapterError && err.body !== undefined && err.body !== null) {
    const body = typeof err.body === 'string' ? err.body : JSON.stringify(err.body);
    if (body && !base.includes(body)) return `${base} — ${body.slice(0, 500)}`;
  }
  return base;
}

/**
 * Builds the ordered chain. The legacy `{ provider, apiKey }` pair comes first,
 * then `providers[]`. Entries without a key are dropped, duplicates collapse.
 */
export function resolveProviderChain(credentials: AICredentials | undefined): AIProviderCredential[] {
  const chain: AIProviderCredential[] = [];
  const seen = new Set<string>();

  const push = (candidate: Partial<AIProviderCredential> | undefined) => {
    const provider = candidate?.provider;
    const apiKey = typeof candidate?.apiKey === 'string' ? candidate.apiKey.trim() : '';
    if (!provider || !apiKey) return;
    const dedupeKey = `${provider}:${apiKey}:${candidate?.model ?? ''}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    chain.push({ provider, apiKey, ...(candidate?.model ? { model: candidate.model } : {}) });
  };

  push({ provider: credentials?.provider, apiKey: credentials?.apiKey });
  if (Array.isArray(credentials?.providers)) {
    for (const entry of credentials!.providers!) push(entry);
  }

  return chain;
}

export const SUPPORTED_PROVIDERS: AIProvider[] = ['anthropic', 'openai', 'gemini'];

export function unsupportedProviders(chain: AIProviderCredential[]): AIProvider[] {
  return chain.map((c) => c.provider).filter((p) => !SUPPORTED_PROVIDERS.includes(p));
}

export interface FailoverOutcome<T> {
  result: T;
  provider: AIProvider;
  model?: string;
  attempts: FailoverAttempt[];
}

/** Runs `fn` down the chain, stopping at the first success or the first non-retryable failure. */
export async function runWithFailover<T>(
  chain: AIProviderCredential[],
  fn: (credential: AIProviderCredential, index: number) => Promise<T>,
  opts: { failoverOnAuthErrors?: boolean } = {},
): Promise<FailoverOutcome<T>> {
  const attempts: FailoverAttempt[] = [];

  for (let i = 0; i < chain.length; i += 1) {
    const credential = chain[i];
    try {
      const result = await fn(credential, i);
      return { result, provider: credential.provider, model: credential.model, attempts };
    } catch (err) {
      const status = providerStatus(err);
      const canFailover = shouldFailover(err, status, opts.failoverOnAuthErrors === true);
      const isLast = i === chain.length - 1;
      attempts.push({
        provider: credential.provider,
        ...(status !== undefined ? { status } : {}),
        message: errorMessage(err),
        failedOver: canFailover && !isLast,
      });
      if (!canFailover || isLast) throw new ProviderChainError(attempts, err);
    }
  }

  throw new ProviderChainError(attempts);
}
