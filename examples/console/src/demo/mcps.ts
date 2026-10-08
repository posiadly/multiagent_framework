import type { McpServerConfig } from '@proaxia/multiagent';

/**
 * Build the external MCP list for the football agent.
 * The library never reads these env vars — only the demo app does.
 */
export function buildFootballMcps(mcpUrl?: string): McpServerConfig[] {
  const url =
    mcpUrl ??
    process.env['INTERNET_SEARCH_MCP_URL'] ??
    'http://127.0.0.1:3921/mcp';

  const config: McpServerConfig = {
    id: 'internet-search',
    url,
  };

  const apiKey = process.env['MCP_API_KEY'];
  if (apiKey) {
    config.apiKey = apiKey;
  }

  return [config];
}
