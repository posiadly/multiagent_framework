import { Runtime } from '@proaxia/multiagent';
import { ConsoleApp } from './cli/console-app.js';
import { createLlm } from './create-llm.js';
import { buildDemoTree } from './demo/agents.js';

async function main(): Promise<void> {
  const llm = createLlm();
  const runtime = new Runtime(llm, (line) =>
    console.error(`[runtime] ${line}`),
  );
  runtime.registerTree(buildDemoTree());

  const app = new ConsoleApp(runtime);
  await app.start();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Fatal: ${message}`);
  process.exitCode = 1;
});
