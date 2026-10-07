import type { ChatMessage, ToolCall } from './types.js';

export interface LlmTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmChatResult {
  content: string | undefined;
  toolCalls: ToolCall[] | undefined;
  assistantMessage: ChatMessage;
}

export interface Llm {
  chat(messages: ChatMessage[], tools: LlmTool[]): Promise<LlmChatResult>;
}
