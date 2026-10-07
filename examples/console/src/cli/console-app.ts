import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { Runtime } from '@proaxia/multiagent';

export class ConsoleApp {
  constructor(private readonly runtime: Runtime) {}

  async start(): Promise<void> {
    const rl = readline.createInterface({ input, output });
    const root = this.runtime.getRootAgent();

    console.log('Multi-agent demo');
    console.log(`Root agent: ${root.id}`);
    console.log('General topics → root; football → football; PSG / Arsenal → specialists.');
    console.log('Type a message for the root agent. Commands: /exit, /quit');
    console.log('');

    try {
      while (true) {
        const line = (await rl.question('You> ')).trim();
        if (!line) {
          continue;
        }
        if (line === '/exit' || line === '/quit') {
          break;
        }

        try {
          const reply = await this.runtime.chat(line);
          console.log(`Root> ${reply}`);
          console.log('');
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(`Error: ${message}`);
          console.log('');
        }
      }
    } finally {
      rl.close();
    }
  }
}
