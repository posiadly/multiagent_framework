import type { Llm } from './llm.js';
import { createOpenAiCompatibleLlm } from './openai-compatible-llm.js';

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface OpenRouterLlmOptions {
  apiKey: string;
  model: string;
}

export function createOpenRouterLlm(options: OpenRouterLlmOptions): Llm {
  return createOpenAiCompatibleLlm({
    url: OPENROUTER_CHAT_URL,
    apiKey: options.apiKey,
    model: options.model,
  });
}
