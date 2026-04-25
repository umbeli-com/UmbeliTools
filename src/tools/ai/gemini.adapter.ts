import { GoogleGenerativeAI } from '@google/generative-ai';

const DEFAULT_MODEL = 'gemini-2.0-flash';

export async function geminiComplete(
  apiKey: string,
  messages: { role: string; content: string }[],
  opts: { model?: string; systemPrompt?: string } = {},
) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelConfig: any = { model: opts.model || DEFAULT_MODEL };
  if (opts.systemPrompt) {
    modelConfig.systemInstruction = opts.systemPrompt;
  }
  const model = genAI.getGenerativeModel(modelConfig);

  const chat = model.startChat({
    history: messages
      .slice(0, -1)
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : m.role,
        parts: [{ text: m.content }],
      })),
  });

  const lastMessage = messages[messages.length - 1];
  const result = await chat.sendMessage(lastMessage.content);
  const response = await result.response;

  return {
    content: response.text(),
    candidates: response.candidates,
    provider: 'gemini',
  };
}
