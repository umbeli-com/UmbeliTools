import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

export async function anthropicComplete(
  apiKey: string,
  messages: { role: string; content: string }[],
  opts: { model?: string; maxTokens?: number; systemPrompt?: string } = {},
) {
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: opts.model || DEFAULT_MODEL,
    max_tokens: opts.maxTokens || 2048,
    ...(opts.systemPrompt && { system: opts.systemPrompt }),
    messages: messages as Anthropic.MessageParam[],
  });

  const block = message.content[0];
  return {
    content: block?.type === 'text' ? block.text : '',
    usage: message.usage,
    stopReason: message.stop_reason,
    provider: 'anthropic',
  };
}
