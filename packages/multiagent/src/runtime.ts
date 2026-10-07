import type { Llm, LlmTool } from './llm.js';
import { Agent } from './agent.js';
import { AgentThread } from './thread.js';
import { Tool } from './tool.js';
import {
  SuspendError,
  waitingResult,
  type ThreadOutcome,
  type ToolContext,
} from './types.js';

export class Runtime {
  private readonly agents = new Map<string, Agent>();
  private readonly threads = new Map<string, AgentThread>();
  private rootAgent: Agent | undefined;
  private rootThread: AgentThread | undefined;

  constructor(
    private readonly llm: Llm,
    private readonly log: (line: string) => void = (line) =>
      console.error(line),
  ) {}

  registerTree(root: Agent): void {
    this.agents.clear();
    this.indexAgent(root);
    this.rootAgent = root;
    this.rootThread = undefined;
    this.threads.clear();
  }

  getRootAgent(): Agent {
    if (!this.rootAgent) {
      throw new Error('Root agent is not registered');
    }
    return this.rootAgent;
  }

  /**
   * Send a user message to the root agent and run until it returns
   * assistant text (possibly asking for clarification after WAITING).
   */
  async chat(userMessage: string): Promise<string> {
    const root = this.getRootAgent();

    if (!this.rootThread) {
      this.rootThread = new AgentThread(root.id);
      this.threads.set(this.rootThread.threadId, this.rootThread);
      this.rootThread.append({
        role: 'system',
        content: root.systemPrompt,
      });
    }

    this.rootThread.append({ role: 'user', content: userMessage });
    this.rootThread.status = 'running';

    const outcome = await this.loop(this.rootThread);
    if (outcome.type === 'waiting') {
      return waitingResult(outcome.question);
    }
    return outcome.text;
  }

  private indexAgent(agent: Agent): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Duplicate agent id "${agent.id}"`);
    }
    this.agents.set(agent.id, agent);
    for (const child of agent.children.values()) {
      this.indexAgent(child);
    }
  }

  private requireAgent(id: string): Agent {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new Error(`Unknown agent "${id}"`);
    }
    return agent;
  }

  private buildTools(agent: Agent): Tool[] {
    const tools = [...agent.tools];

    if (agent.hasChildren) {
      tools.push(this.createDelegateTool());
    }

    if (agent.hasChildren || agent.parent) {
      tools.push(this.createMessageTool(agent));
    }

    return tools;
  }

  private createDelegateTool(): Tool {
    return new Tool(
      'delegate',
      'Delegate a task to a direct child agent. Returns the child result, or WAITING: <question> if the child needs clarification.',
      {
        type: 'object',
        properties: {
          agentId: {
            type: 'string',
            description: 'Id of the child agent to run',
          },
          task: {
            type: 'string',
            description: 'Task description for the child agent',
          },
        },
        required: ['agentId', 'task'],
      },
      async (args, ctx) => {
        const agentId = String(args['agentId'] ?? '');
        const task = String(args['task'] ?? '');
        return this.handleDelegate(ctx, agentId, task);
      },
    );
  }

  private createMessageTool(agent: Agent): Tool {
    const targets: string[] = [];
    if (agent.parent) {
      targets.push(`parent "${agent.parent.id}" (ask or escalate a question)`);
    }
    for (const childId of agent.children.keys()) {
      targets.push(`child "${childId}" (answer a WAITING clarification)`);
    }

    return new Tool(
      'message',
      `Send a message to another agent. Allowed targets: ${targets.join('; ')}. Messaging your parent suspends you until they reply. Messaging a waiting child resumes them.`,
      {
        type: 'object',
        properties: {
          agentId: {
            type: 'string',
            description: 'Target agent id (parent or direct child)',
          },
          content: {
            type: 'string',
            description: 'Question to the parent, or answer to a child',
          },
        },
        required: ['agentId', 'content'],
      },
      async (args, ctx) => {
        const agentId = String(args['agentId'] ?? '');
        const content = String(args['content'] ?? '');
        return this.handleMessage(ctx, agentId, content);
      },
    );
  }

  private async handleDelegate(
    ctx: ToolContext,
    childId: string,
    task: string,
  ): Promise<string> {
    const child = ctx.agent.getChild(childId);
    if (!child) {
      throw new Error(
        `Agent "${ctx.agent.id}" has no child "${childId}" to delegate to`,
      );
    }

    this.log(`[${ctx.agent.id}] tool:delegate → ${childId}: ${task}`);

    const childThread = new AgentThread(childId, ctx.thread.threadId);
    this.threads.set(childThread.threadId, childThread);

    const outcome = await this.runChildThread(childThread, task);
    if (outcome.type === 'waiting') {
      this.log(
        `[${ctx.agent.id}] tool_result:delegate WAITING: ${outcome.question}`,
      );
      return waitingResult(outcome.question);
    }

    this.log(
      `[${ctx.agent.id}] tool_result:delegate completed: ${outcome.text}`,
    );
    return outcome.text;
  }

  private async handleMessage(
    ctx: ToolContext,
    targetId: string,
    content: string,
  ): Promise<string> {
    if (ctx.agent.parent?.id === targetId) {
      this.log(
        `[${ctx.agent.id}] tool:message → parent ${targetId}: ${content}`,
      );
      ctx.thread.status = 'waiting';
      ctx.thread.pendingMessage = {
        toolCallId: ctx.toolCallId,
        content,
        targetAgentId: targetId,
      };
      throw new SuspendError(content, ctx.toolCallId);
    }

    const child = ctx.agent.getChild(targetId);
    if (!child) {
      throw new Error(
        `Agent "${ctx.agent.id}" cannot message unknown target "${targetId}"`,
      );
    }

    this.log(`[${ctx.agent.id}] tool:message → child ${targetId}: ${content}`);

    const childThread = this.findWaitingChildThread(
      ctx.thread.threadId,
      targetId,
    );
    if (!childThread) {
      throw new Error(
        `No waiting thread for child "${targetId}" under "${ctx.agent.id}"`,
      );
    }

    const outcome = await this.resumeThread(childThread, content);
    if (outcome.type === 'waiting') {
      this.log(
        `[${ctx.agent.id}] tool_result:message WAITING: ${outcome.question}`,
      );
      return waitingResult(outcome.question);
    }

    this.log(
      `[${ctx.agent.id}] tool_result:message completed: ${outcome.text}`,
    );
    return outcome.text;
  }

  private async runChildThread(
    thread: AgentThread,
    task: string,
  ): Promise<ThreadOutcome> {
    const agent = this.requireAgent(thread.agentId);
    thread.status = 'running';
    thread.append({ role: 'system', content: agent.systemPrompt });
    thread.append({ role: 'user', content: task });
    return this.loop(thread);
  }

  private async resumeThread(
    thread: AgentThread,
    answer: string,
  ): Promise<ThreadOutcome> {
    const pending = thread.pendingMessage;
    if (!pending) {
      throw new Error(
        `Thread "${thread.threadId}" has no pending message to resume`,
      );
    }

    thread.append({
      role: 'tool',
      content: answer,
      tool_call_id: pending.toolCallId,
    });
    thread.pendingMessage = undefined;
    thread.status = 'running';
    this.log(`[${thread.agentId}] resumed with: ${answer}`);
    return this.loop(thread);
  }

  private findWaitingChildThread(
    parentThreadId: string,
    childAgentId: string,
  ): AgentThread | undefined {
    for (const thread of this.threads.values()) {
      if (
        thread.parentThreadId === parentThreadId &&
        thread.agentId === childAgentId &&
        thread.status === 'waiting'
      ) {
        return thread;
      }
    }
    return undefined;
  }

  private async loop(thread: AgentThread): Promise<ThreadOutcome> {
    const agent = this.requireAgent(thread.agentId);
    const tools = this.buildTools(agent);
    const chatTools: LlmTool[] = tools.map((tool) => tool.toLlmTool());

    while (true) {
      const result = await this.llm.chat(thread.messages, chatTools);
      thread.append(result.assistantMessage);

      if (!result.toolCalls?.length) {
        thread.status = 'completed';
        return { type: 'completed', text: result.content ?? '' };
      }

      for (const call of result.toolCalls) {
        const tool = tools.find((item) => item.name === call.function.name);
        if (!tool) {
          thread.append({
            role: 'tool',
            content: `Error: unknown tool "${call.function.name}"`,
            tool_call_id: call.id,
          });
          continue;
        }

        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}') as Record<
            string,
            unknown
          >;
        } catch {
          thread.append({
            role: 'tool',
            content: 'Error: invalid tool arguments JSON',
            tool_call_id: call.id,
          });
          continue;
        }

        const ctx: ToolContext = {
          runtime: this,
          thread,
          agent,
          toolCallId: call.id,
        };

        try {
          const toolResult = await tool.execute(args, ctx);
          thread.append({
            role: 'tool',
            content: toolResult,
            tool_call_id: call.id,
          });
        } catch (error) {
          if (error instanceof SuspendError) {
            thread.status = 'waiting';
            return { type: 'waiting', question: error.question };
          }
          const message =
            error instanceof Error ? error.message : String(error);
          thread.append({
            role: 'tool',
            content: `Error: ${message}`,
            tool_call_id: call.id,
          });
        }
      }
    }
  }
}
