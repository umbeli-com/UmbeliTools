import OpenAI from 'openai';

const DEFAULT_MODEL = 'gpt-4o-mini';

export async function openaiComplete(
  apiKey: string,
  messages: { role: string; content: string }[],
  opts: { model?: string; maxTokens?: number; temperature?: number; systemPrompt?: string; jsonMode?: boolean } = {},
) {
  const client = new OpenAI({ apiKey });

  const allMessages: OpenAI.ChatCompletionMessageParam[] = [];
  if (opts.systemPrompt) {
    allMessages.push({ role: 'system', content: opts.systemPrompt });
  }
  allMessages.push(...(messages as OpenAI.ChatCompletionMessageParam[]));

  const completion = await client.chat.completions.create({
    model: opts.model || DEFAULT_MODEL,
    messages: allMessages,
    temperature: opts.temperature ?? 0.7,
    ...(opts.maxTokens && { max_tokens: opts.maxTokens }),
    ...(opts.jsonMode && { response_format: { type: 'json_object' } }),
  });

  return {
    content: completion.choices[0]?.message?.content || '',
    usage: completion.usage,
    finishReason: completion.choices[0]?.finish_reason,
    provider: 'openai',
  };
}
