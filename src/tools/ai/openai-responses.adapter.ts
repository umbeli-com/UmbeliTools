import OpenAI from 'openai';

const DEFAULT_MODEL = 'gpt-4o-mini';

export async function openaiWebResearch(apiKey: string, prompt: string, model = DEFAULT_MODEL) {
  const client = new OpenAI({ apiKey });

  const response = await (client as any).responses.create({
    model,
    input: prompt,
    tools: [{ type: 'web_search' }],
  });

  const text =
    response.output_text ||
    response.output
      ?.map((o: any) => o.content?.map((c: any) => c.text || c.output_text || '').join(''))
      .join('\n') ||
    '';

  return {
    content: text.trim(),
    raw: response,
    provider: 'openai',
    tool: 'web_search',
  };
}
