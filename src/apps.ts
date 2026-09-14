import 'dotenv/config';
import { ConsoleApp } from './cli/console-app.js';
import { buildDemoTree } from './demo/agents.js';
import { Runtime } from './framework/runtime.js';
import { LlmClient } from './llm/llm-client.js';

async function main(): Promise<void> {
  const llm = new LlmClient();
  const runtime = new Runtime(llm, (line) => console.error(`[runtime] ${line}`));
  runtime.registerTree(buildDemoTree());

  const app = new ConsoleApp(runtime);
  await app.start();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Fatal: ${message}`);
  process.exitCode = 1;
});
