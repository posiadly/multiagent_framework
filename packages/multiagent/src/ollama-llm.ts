import type { Llm } from './llm.js';
import { createOpenAiCompatibleLlm } from './openai-compatible-llm.js';

export interface OllamaLlmOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function createOllamaLlm(options: OllamaLlmOptions): Llm {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
  return createOpenAiCompatibleLlm({
    url: `${baseUrl}/v1/chat/completions`,
    apiKey: options.apiKey,
    model: options.model,
  });
}
