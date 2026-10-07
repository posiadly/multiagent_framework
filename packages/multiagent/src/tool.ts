import type { LlmTool } from './llm.js';
import type { ToolContext } from './types.js';

export type ToolExecute = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<string> | string;

export class Tool {
  constructor(
    public readonly name: string,
    public readonly description: string,
    public readonly parameters: Record<string, unknown>,
    public readonly execute: ToolExecute,
  ) {}

  toLlmTool(): LlmTool {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }
}
