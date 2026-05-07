const SERPER_ENDPOINT = 'https://google.serper.dev/search';

export async function googleSearch(
  apiKey: string,
  query: string,
  opts: { country?: string; language?: string; numResults?: number; page?: number } = {},
) {
  const body: Record<string, unknown> = { q: query };
  if (opts.country) body.gl = opts.country;
  if (opts.language) body.hl = opts.language;
  if (opts.numResults) body.num = opts.numResults;
  if (opts.page) body.page = opts.page;

  const res = await fetch(SERPER_ENDPOINT, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Serper API ${res.status}: ${text}`);
  }

  return res.json();
}
