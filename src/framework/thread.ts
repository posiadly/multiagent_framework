import type { ChatMessage, PendingMessage, ThreadStatus } from './types.js';

let threadCounter = 0;

export class AgentThread {
  readonly threadId: string;
  readonly messages: ChatMessage[] = [];
  status: ThreadStatus = 'running';
  pendingMessage: PendingMessage | undefined;

  constructor(
    public readonly agentId: string,
    public readonly parentThreadId?: string,
  ) {
    threadCounter += 1;
    this.threadId = `thread_${threadCounter}_${agentId}`;
  }

  append(message: ChatMessage): void {
    this.messages.push(message);
  }
}
