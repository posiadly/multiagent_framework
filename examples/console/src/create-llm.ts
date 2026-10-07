import { createOllamaLlm, createOpenRouterLlm } from '@proaxia/multiagent';
import type { Llm } from '@proaxia/multiagent';
import { createSapOrchestrationLlm } from '@proaxia/multiagent/sap';

export function createLlm(): Llm {
  const provider = process.env['LLM_PROVIDER']?.trim().toLowerCase();
  if (!provider) {
    throw new Error(
      'LLM_PROVIDER is required. Expected sap, openrouter, or ollama.',
    );
  }

  if (provider === 'sap') {
    const model = process.env['AICORE_MODEL']?.trim() || 'gpt-4o';
    const serviceKey = process.env['AICORE_SERVICE_KEY']?.trim();
    if (!serviceKey) {
      throw new Error('AICORE_SERVICE_KEY is required when LLM_PROVIDER=sap');
    }
    return createSapOrchestrationLlm({ model, serviceKey });
  }

  if (provider === 'openrouter') {
    return createOpenRouterLlm({
      apiKey: requireEnv('OPENROUTER_API_KEY', provider),
      model: requireEnv('OPENROUTER_MODEL', provider),
    });
  }

  if (provider === 'ollama') {
    return createOllamaLlm({
      baseUrl: requireEnv('OLLAMA_BASE_URL', provider),
      apiKey: requireEnv('OLLAMA_API_KEY', provider),
      model: requireEnv('OLLAMA_MODEL', provider),
    });
  }

  throw new Error(
    `Unknown LLM_PROVIDER "${provider}". Expected sap, openrouter, or ollama.`,
  );
}

function requireEnv(name: string, provider: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required when LLM_PROVIDER=${provider}`);
  }
  return value;
}
