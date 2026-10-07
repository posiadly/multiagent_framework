import type { Agent } from './agent.js';
import type { AgentThread } from './thread.js';
import type { Runtime } from './runtime.js';

export type ThreadStatus = 'running' | 'waiting' | 'completed';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCallFunction {
  name: string;
  arguments: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: ToolCallFunction;
}

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface PendingMessage {
  toolCallId: string;
  content: string;
  targetAgentId: string;
}

export interface ToolContext {
  runtime: Runtime;
  thread: AgentThread;
  agent: Agent;
  toolCallId: string;
}

export type ThreadOutcome =
  | { type: 'completed'; text: string }
  | { type: 'waiting'; question: string };

export function waitingResult(question: string): string {
  return `WAITING: ${question}`;
}

export function parseWaitingResult(
  result: string,
): { waiting: true; question: string } | { waiting: false; text: string } {
  if (result.startsWith('WAITING: ')) {
    return { waiting: true, question: result.slice('WAITING: '.length) };
  }
  return { waiting: false, text: result };
}

/** Thrown by upward `message` to stop the agent loop without a tool result. */
export class SuspendError extends Error {
  readonly question: string;
  readonly toolCallId: string;

  constructor(question: string, toolCallId: string) {
    super(`Agent suspended waiting for reply: ${question}`);
    this.name = 'SuspendError';
    this.question = question;
    this.toolCallId = toolCallId;
  }
}
