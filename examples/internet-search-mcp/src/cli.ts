import { startInternetSearchMcp } from './server.js';

async function main(): Promise<void> {
  const port = Number(process.env['INTERNET_SEARCH_MCP_PORT'] ?? '3921');
  const host = process.env['INTERNET_SEARCH_MCP_HOST'] ?? '127.0.0.1';

  const options: Parameters<typeof startInternetSearchMcp>[0] = { host, port };
  if (process.env['MCP_API_KEY']) {
    options.mcpApiKey = process.env['MCP_API_KEY'];
  }
  if (process.env['JINA_API_KEY']) {
    options.jinaApiKey = process.env['JINA_API_KEY'];
  }

  const handle = await startInternetSearchMcp(options);

  const shutdown = async () => {
    await handle.close();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Fatal: ${message}`);
  process.exitCode = 1;
});
