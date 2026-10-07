import type { ChatMessage, ToolCall } from './types.js';
import type { Llm, LlmChatResult, LlmTool } from './llm.js';

export interface OpenAiCompatibleLlmOptions {
  url: string;
  apiKey: string;
  model: string;
}

export function createOpenAiCompatibleLlm(
  options: OpenAiCompatibleLlmOptions,
): Llm {
  return {
    async chat(messages, tools) {
      const response = await fetch(options.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model,
          messages: toOpenAiMessages(messages),
          ...(tools.length > 0 ? { tools: toOpenAiTools(tools) } : {}),
        }),
      });

      if (!response.ok) {
        const body = await readErrorBody(response);
        throw new Error(
          `LLM request failed (${response.status})${body ? `: ${body}` : ''}`,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`LLM response was not valid JSON: ${message}`);
      }

      return parseChatCompletion(payload);
    },
  };
}

function toOpenAiMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: message.content ?? '',
        tool_call_id: message.tool_call_id ?? '',
      };
    }
    if (message.role === 'assistant' && message.tool_calls?.length) {
      return {
        role: 'assistant',
        content: message.content,
        tool_calls: message.tool_calls,
      };
    }
    return {
      role: message.role,
      content: message.content ?? '',
    };
  });
}

function toOpenAiTools(tools: LlmTool[]): unknown[] {
  return tools.map((tool) => ({
    type: tool.type,
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    },
  }));
}

function parseChatCompletion(payload: unknown): LlmChatResult {
  if (!isRecord(payload)) {
    throw new Error('LLM response was not an object');
  }

  const choices = payload['choices'];
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('LLM response did not include any choices');
  }

  const choice = choices[0];
  if (!isRecord(choice) || !isRecord(choice['message'])) {
    throw new Error('LLM response choice is missing a message');
  }

  const message = choice['message'];
  const rawContent = message['content'];
  if (
    rawContent !== null &&
    rawContent !== undefined &&
    typeof rawContent !== 'string'
  ) {
    throw new Error('LLM response message content is not a string');
  }

  const toolCalls = readToolCalls(message['tool_calls']);
  const content = typeof rawContent === 'string' ? rawContent : undefined;
  const assistantMessage: ChatMessage = {
    role: 'assistant',
    content: rawContent ?? null,
    ...(toolCalls ? { tool_calls: toolCalls } : {}),
  };

  return {
    content,
    toolCalls,
    assistantMessage,
  };
}

function readToolCalls(value: unknown): ToolCall[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  return value.map((call, index) => {
    if (!isRecord(call) || !isRecord(call['function'])) {
      throw new Error(`LLM response has an invalid tool call at index ${index}`);
    }
    const fn = call['function'];
    const name = fn['name'];
    if (typeof name !== 'string') {
      throw new Error(
        `LLM response tool call ${index} is missing a function name`,
      );
    }
    const args = fn['arguments'];
    const id = call['id'];
    return {
      id: typeof id === 'string' ? id : `call_${index}`,
      type: 'function',
      function: {
        name,
        arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
      },
    };
  });
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    return text.slice(0, 500);
  } catch {
    return '';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
