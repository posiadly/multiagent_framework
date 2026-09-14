import {
  OrchestrationClient,
  type ChatCompletionTool,
  type ChatMessage as SapChatMessage,
  type ToolChatMessage,
} from '@sap-ai-sdk/orchestration';
import type { ChatMessage, ToolCall } from '../framework/types.js';

export interface LlmChatResult {
  content: string | undefined;
  toolCalls: ToolCall[] | undefined;
  assistantMessage: ChatMessage;
}

function toSapMessages(messages: ChatMessage[]): SapChatMessage[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      const toolMessage: ToolChatMessage = {
        role: 'tool',
        content: message.content ?? '',
        tool_call_id: message.tool_call_id ?? '',
      };
      return toolMessage;
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
  }) as SapChatMessage[];
}

function mapToolCalls(
  toolCalls: ReturnType<
    import('@sap-ai-sdk/orchestration').OrchestrationResponse['getToolCalls']
  >,
): ToolCall[] | undefined {
  if (!toolCalls?.length) {
    return undefined;
  }
  return toolCalls.map((call) => ({
    id: call.id,
    type: 'function' as const,
    function: {
      name: call.function.name,
      arguments: call.function.arguments,
    },
  }));
}

export class LlmClient {
  constructor(
    private readonly modelName: string = process.env['AICORE_MODEL'] ?? 'gpt-4o',
  ) {}

  async chat(
    messages: ChatMessage[],
    tools: ChatCompletionTool[] = [],
  ): Promise<LlmChatResult> {
    const client = new OrchestrationClient({
      promptTemplating: {
        model: {
          name: this.modelName,
        },
        ...(tools.length > 0
          ? {
              prompt: {
                tools,
              },
            }
          : {}),
      },
    });

    const { requestMessages, messagesHistory } = splitForRequest(messages);
    const response = await client.chatCompletion({
      messages: toSapMessages(requestMessages),
      ...(messagesHistory.length > 0
        ? { messagesHistory: toSapMessages(messagesHistory) }
        : {}),
    });

    const toolCalls = mapToolCalls(response.getToolCalls());
    const content = response.getContent() ?? undefined;
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
}

/**
 * When the conversation ends with tool results after an assistant tool_calls
 * message, send those as `messages` and the rest as `messagesHistory`
 * (SAP Orchestration function-calling pattern).
 */
function splitForRequest(messages: ChatMessage[]): {
  requestMessages: ChatMessage[];
  messagesHistory: ChatMessage[];
} {
  if (messages.length === 0) {
    return { requestMessages: [], messagesHistory: [] };
  }

  let index = messages.length - 1;
  while (index >= 0 && messages[index]?.role === 'tool') {
    index -= 1;
  }

  const assistantWithTools = messages[index];
  if (
    assistantWithTools?.role === 'assistant' &&
    assistantWithTools.tool_calls?.length &&
    index < messages.length - 1
  ) {
    return {
      messagesHistory: messages.slice(0, index + 1),
      requestMessages: messages.slice(index + 1),
    };
  }

  return { requestMessages: messages, messagesHistory: [] };
}
