import type { McpServerConfig } from './mcp.js';
import type { Tool } from './tool.js';

export class Agent {
  readonly children = new Map<string, Agent>();
  parent: Agent | undefined;

  constructor(
    public readonly id: string,
    public readonly systemPrompt: string,
    public readonly tools: Tool[] = [],
    public readonly mcps: McpServerConfig[] = [],
  ) {}

  get isRoot(): boolean {
    return this.parent === undefined;
  }

  get hasChildren(): boolean {
    return this.children.size > 0;
  }

  addChild(agent: Agent): this {
    if (agent.parent !== undefined) {
      throw new Error(
        `Agent "${agent.id}" already has parent "${agent.parent.id}"`,
      );
    }
    if (this.children.has(agent.id)) {
      throw new Error(`Agent "${this.id}" already has child "${agent.id}"`);
    }
    agent.parent = this;
    this.children.set(agent.id, agent);
    return this;
  }

  getChild(id: string): Agent | undefined {
    return this.children.get(id);
  }

  findDescendant(id: string): Agent | undefined {
    const direct = this.children.get(id);
    if (direct) {
      return direct;
    }
    for (const child of this.children.values()) {
      const found = child.findDescendant(id);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
}
