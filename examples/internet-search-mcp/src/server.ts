import type { Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { NextFunction, Request, Response } from 'express';
import * as z from 'zod/v4';
import { searchWeb } from './ddg-search.js';

export type InternetSearchMcpOptions = {
  host?: string;
  port?: number;
  /** Bearer token required on MCP HTTP requests. Omit to allow unauthenticated access. */
  mcpApiKey?: string;
  /** Jina API key used when calling r.jina.ai. */
  jinaApiKey?: string;
};

export type InternetSearchMcpHandle = {
  url: string;
  close: () => Promise<void>;
};

const ANSI_BLUE = '\u001b[34m';
const ANSI_RESET = '\u001b[0m';

function logBlue(message: string): void {
  console.log(`${ANSI_BLUE}${message}${ANSI_RESET}`);
}

function createInternetSearchMcpServer(jinaApiKey: string | undefined): McpServer {
  const server = new McpServer({
    name: 'internet-search',
    version: '1.0.0',
  });

  server.registerTool(
    'web_search',
    {
      description:
        'Search the public web with DuckDuckGo. Returns titles, URLs, and snippets.',
      inputSchema: {
        query: z.string().min(1).max(400).describe('Search query'),
        count: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe('Max results to return (1-20, default 8)'),
      },
    },
    async ({ query, count }) => {
      try {
        const limit = count ?? 8;
        logBlue(`[internet-search] web_search: ${query}`);
        const hits = await searchWeb(query, limit);

        if (hits.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No results for: ${query}`,
              },
            ],
          };
        }

        const lines = hits.map((item, index) => {
          const snippet = item.snippet ? `\n   ${item.snippet}` : '';
          return `${index + 1}. ${item.title}\n   URL: ${item.url}${snippet}`;
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: lines.join('\n\n'),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `web_search failed: ${message}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    'read_url',
    {
      description:
        'Fetch a URL and return LLM-friendly page content via Jina Reader.',
      inputSchema: {
        url: z.string().url().describe('Absolute http(s) URL to read'),
      },
    },
    async ({ url }) => {
      try {
        logBlue(`[internet-search] read_url: ${url}`);
        const readerUrl = `https://r.jina.ai/${url}`;
        const headers: Record<string, string> = {
          Accept: 'application/json',
          'X-Return-Format': 'markdown',
        };
        if (jinaApiKey) {
          headers['Authorization'] = `Bearer ${jinaApiKey}`;
        }

        const response = await fetch(readerUrl, { headers });
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(
            `Jina Reader failed (${response.status}): ${body || response.statusText}`,
          );
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          const json = (await response.json()) as {
            data?: { content?: string; title?: string; url?: string };
            content?: string;
          };
          const markdown =
            json.data?.content ??
            json.content ??
            JSON.stringify(json, null, 2);
          const title = json.data?.title;
          const text = title ? `# ${title}\n\n${markdown}` : markdown;
          return {
            content: [{ type: 'text' as const, text }],
          };
        }

        const text = await response.text();
        return {
          content: [{ type: 'text' as const, text }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `read_url failed: ${message}`,
            },
          ],
        };
      }
    },
  );

  return server;
}

function requireBearer(
  app: ReturnType<typeof createMcpExpressApp>,
  mcpApiKey: string | undefined,
): void {
  if (!mcpApiKey) {
    return;
  }

  app.use('/mcp', (req: Request, res: Response, next: NextFunction) => {
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const token = match?.[1]?.trim();
    if (token !== mcpApiKey) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Unauthorized: valid Bearer API key required',
        },
        id: null,
      });
      return;
    }
    next();
  });
}

/**
 * Start the internet-search Streamable HTTP MCP server.
 * Returns the MCP endpoint URL and a close function.
 */
export async function startInternetSearchMcp(
  options: InternetSearchMcpOptions = {},
): Promise<InternetSearchMcpHandle> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 3921;
  const app = createMcpExpressApp();
  requireBearer(app, options.mcpApiKey);

  app.post('/mcp', async (req: Request, res: Response) => {
    const server = createInternetSearchMcpServer(options.jinaApiKey);
    try {
      // Stateless mode requires an explicit undefined sessionIdGenerator.
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      } as unknown as ConstructorParameters<
        typeof StreamableHTTPServerTransport
      >[0]);
      await server.connect(transport as Transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      console.error('[internet-search-mcp] request error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  });

  app.delete('/mcp', (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  });

  const httpServer: Server = await new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      resolve(server);
    });
    server.once('error', reject);
  });

  const url = `http://${host}:${port}/mcp`;
  console.error(`[internet-search-mcp] listening on ${url}`);

  return {
    url,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
