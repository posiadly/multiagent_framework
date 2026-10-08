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
      let response: Response;
      try {
        response = await fetch(options.url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: options.model,
            messages: toOpenAiMessages(messages),
            ...(tools.length > 0
              ? { tools: toOpenAiTools(tools), tool_choice: 'auto' }
              : {}),
          }),
        });
      } catch (error) {
        throw new Error(formatFetchFailure(options.url, error));
      }

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

      const knownToolNames = new Set(tools.map((tool) => tool.function.name));
      return parseChatCompletion(payload, knownToolNames);
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

function parseChatCompletion(
  payload: unknown,
  knownToolNames: Set<string>,
): LlmChatResult {
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

  let toolCalls = readToolCalls(message['tool_calls']);
  let content = typeof rawContent === 'string' ? rawContent : undefined;

  // Some local models (e.g. Qwen via Ollama) emit tool calls as text.
  if (!toolCalls?.length && content && knownToolNames.size > 0) {
    const recovered = recoverToolCallsFromContent(content, knownToolNames);
    if (recovered) {
      toolCalls = recovered.toolCalls;
      content = recovered.remainingContent;
    }
  }

  const assistantMessage: ChatMessage = {
    role: 'assistant',
    content: content ?? null,
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

function recoverToolCallsFromContent(
  content: string,
  knownToolNames: Set<string>,
): { toolCalls: ToolCall[]; remainingContent: string | undefined } | undefined {
  const fromXml = parseXmlStyleToolCalls(content, knownToolNames);
  if (fromXml) {
    return fromXml;
  }
  return parseJsonStyleToolCalls(content, knownToolNames);
}

/**
 * Qwen / Ollama style:
 * <function=tool_name>
 * <parameter=arg>
 * value
 * </parameter>
 * </function>
 */
function parseXmlStyleToolCalls(
  content: string,
  knownToolNames: Set<string>,
): { toolCalls: ToolCall[]; remainingContent: string | undefined } | undefined {
  const functionRe =
    /<function=([A-Za-z0-9_.-]+)>\s*([\s\S]*?)\s*<\/function>/g;
  const toolCalls: ToolCall[] = [];
  let cleaned = content;
  let match: RegExpExecArray | null;

  while ((match = functionRe.exec(content)) !== null) {
    const name = match[1] ?? '';
    if (!knownToolNames.has(name)) {
      continue;
    }
    const body = match[2] ?? '';
    const args: Record<string, unknown> = {};
    const paramRe =
      /<parameter=([A-Za-z0-9_.-]+)>\s*([\s\S]*?)\s*<\/parameter>/g;
    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramRe.exec(body)) !== null) {
      const key = paramMatch[1] ?? '';
      const value = (paramMatch[2] ?? '').trim();
      args[key] = coerceParamValue(value);
    }

    toolCalls.push({
      id: `call_xml_${toolCalls.length}`,
      type: 'function',
      function: {
        name,
        arguments: JSON.stringify(args),
      },
    });
    cleaned = cleaned.replace(match[0], '');
  }

  if (toolCalls.length === 0) {
    return undefined;
  }

  cleaned = cleaned
    .replace(/<\/?tool_call>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    toolCalls,
    remainingContent: cleaned.length > 0 ? cleaned : undefined,
  };
}

function parseJsonStyleToolCalls(
  content: string,
  knownToolNames: Set<string>,
): { toolCalls: ToolCall[]; remainingContent: string | undefined } | undefined {
  const candidates = extractJsonObjects(content);
  const toolCalls: ToolCall[] = [];
  let cleaned = content;

  for (const candidate of candidates) {
    const name =
      typeof candidate['name'] === 'string'
        ? candidate['name']
        : typeof candidate['tool'] === 'string'
          ? candidate['tool']
          : undefined;
    if (!name || !knownToolNames.has(name)) {
      continue;
    }

    const args = candidate['arguments'] ?? candidate['parameters'] ?? {};
    toolCalls.push({
      id: `call_json_${toolCalls.length}`,
      type: 'function',
      function: {
        name,
        arguments:
          typeof args === 'string' ? args : JSON.stringify(args ?? {}),
      },
    });

    const serialized = JSON.stringify(candidate);
    cleaned = cleaned.replace(serialized, '');
    // Also try pretty-printed / original substring if present.
    const loose = content.match(
      new RegExp(
        `\\{[^{}]*"name"\\s*:\\s*"${escapeRegExp(name)}"[\\s\\S]*?\\}`,
      ),
    );
    if (loose?.[0]) {
      cleaned = cleaned.replace(loose[0], '');
    }
  }

  if (toolCalls.length === 0) {
    return undefined;
  }

  cleaned = cleaned.replace(/```(?:json)?/g, '').trim();
  return {
    toolCalls,
    remainingContent: cleaned.length > 0 ? cleaned : undefined,
  };
}

function extractJsonObjects(content: string): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  const trimmed = content.trim();

  // fenced ```json ... ```
  const fence = /```(?:json)?\s*([\s\S]*?)```/g;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fence.exec(content)) !== null) {
    pushParsedObject(fenceMatch[1] ?? '', objects);
  }

  pushParsedObject(trimmed, objects);

  // Scan for balanced {...} blocks
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== '{') {
      continue;
    }
    let depth = 0;
    for (let j = i; j < content.length; j++) {
      const ch = content[j];
      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          pushParsedObject(content.slice(i, j + 1), objects);
          i = j;
          break;
        }
      }
    }
  }

  return objects;
}

function pushParsedObject(
  text: string,
  objects: Record<string, unknown>[],
): void {
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed)) {
      objects.push(parsed);
    }
  } catch {
    // ignore
  }
}

function coerceParamValue(value: string): unknown {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    return text.slice(0, 500);
  } catch {
    return '';
  }
}

function formatFetchFailure(url: string, error: unknown): string {
  const parts = [`LLM request to ${url} failed`];
  if (error instanceof Error) {
    parts.push(error.message);
    const cause = error.cause;
    if (cause instanceof Error) {
      parts.push(cause.message);
    } else if (typeof cause === 'string' && cause) {
      parts.push(cause);
    }
  } else {
    parts.push(String(error));
  }
  return parts.join(': ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
