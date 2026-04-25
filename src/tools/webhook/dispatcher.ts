export async function dispatchWebhook(
  url: string,
  body: unknown,
  opts: { method?: string; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ success: boolean; statusCode: number; responseBody?: unknown }> {
  const res = await fetch(url, {
    method: opts.method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...opts.headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs || 10_000),
  });

  let responseBody: unknown;
  try {
    responseBody = await res.json();
  } catch {
    responseBody = await res.text().catch(() => null);
  }

  return { success: res.ok, statusCode: res.status, responseBody };
}
