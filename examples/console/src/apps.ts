import { Runtime } from '@proaxia/multiagent';
import { startInternetSearchMcp } from 'internet-search-mcp';
import { ConsoleApp } from './cli/console-app.js';
import { createLlm } from './create-llm.js';
import { buildDemoTree } from './demo/agents.js';
import { buildFootballMcps } from './demo/mcps.js';

async function main(): Promise<void> {
  const port = Number(process.env['INTERNET_SEARCH_MCP_PORT'] ?? '3921');
  const host = process.env['INTERNET_SEARCH_MCP_HOST'] ?? '127.0.0.1';

  const mcpOptions: Parameters<typeof startInternetSearchMcp>[0] = {
    host,
    port,
  };
  if (process.env['MCP_API_KEY']) {
    mcpOptions.mcpApiKey = process.env['MCP_API_KEY'];
  }
  if (process.env['JINA_API_KEY']) {
    mcpOptions.jinaApiKey = process.env['JINA_API_KEY'];
  }

  const mcp = await startInternetSearchMcp(mcpOptions);

  const llm = createLlm();
  const runtime = new Runtime(llm, (line) =>
    console.error(`[runtime] ${line}`),
  );
  await runtime.registerTree(buildDemoTree(buildFootballMcps(mcp.url)));

  const app = new ConsoleApp(runtime);
  try {
    await app.start();
  } finally {
    await mcp.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Fatal: ${message}`);
  process.exitCode = 1;
});
