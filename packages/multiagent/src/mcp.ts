import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { Tool } from './tool.js';

export type McpServerConfig = {
  /** Unique id per agent; used as a tool-name prefix. */
  id: string;
  /** Streamable HTTP MCP endpoint URL. */
  url: string;
  /** Optional Bearer token sent as `Authorization: Bearer <apiKey>`. */
  apiKey?: string;
};

export type McpConnection = {
  config: McpServerConfig;
  client: Client;
  tools: Tool[];
  close: () => Promise<void>;
};

function toolNamePrefix(serverId: string): string {
  return `${serverId}__`;
}

function serializeMcpContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return JSON.stringify(content);
  }

  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') {
      parts.push(String(item));
      continue;
    }
    const record = item as Record<string, unknown>;
    if (record['type'] === 'text' && typeof record['text'] === 'string') {
      parts.push(record['text']);
      continue;
    }
    parts.push(JSON.stringify(item));
  }
  return parts.join('\n');
}

function toJsonSchemaParameters(
  inputSchema: unknown,
): Record<string, unknown> {
  if (
    inputSchema &&
    typeof inputSchema === 'object' &&
    !Array.isArray(inputSchema)
  ) {
    return inputSchema as Record<string, unknown>;
  }
  return {
    type: 'object',
    properties: {},
  };
}

/**
 * Connect to a Streamable HTTP MCP server and map its tools to framework Tools.
 */
export async function connectMcpServer(
  config: McpServerConfig,
): Promise<McpConnection> {
  const client = new Client({
    name: 'proaxia-multiagent',
    version: '1.0.0',
  });

  const headers: Record<string, string> = {};
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: {
      headers,
    },
  });

  try {
    // SDK Transport.sessionId is optional at runtime; exactOptionalPropertyTypes
    // disagrees with StreamableHTTPClientTransport's declaration.
    await client.connect(transport as Transport);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to connect MCP server "${config.id}" at ${config.url}: ${message}`,
    );
  }

  let listed;
  try {
    listed = await client.listTools();
  } catch (error) {
    await client.close().catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to list tools from MCP server "${config.id}": ${message}`,
    );
  }

  const prefix = toolNamePrefix(config.id);
  const tools = listed.tools.map((mcpTool) => {
    const name = `${prefix}${mcpTool.name}`;
    const description = mcpTool.description ?? `MCP tool ${mcpTool.name}`;
    const parameters = toJsonSchemaParameters(mcpTool.inputSchema);

    return new Tool(name, description, parameters, async (args) => {
      const result = await client.callTool({
        name: mcpTool.name,
        arguments: args,
      });
      const text = serializeMcpContent(result.content);
      if (result.isError) {
        throw new Error(text || `MCP tool "${mcpTool.name}" failed`);
      }
      return text || '(empty MCP tool result)';
    });
  });

  return {
    config,
    client,
    tools,
    close: async () => {
      await client.close();
    },
  };
}

/**
 * Connect multiple MCP servers and return a flat Tool list plus closers.
 */
export async function connectMcpServers(
  configs: McpServerConfig[],
): Promise<{ tools: Tool[]; connections: McpConnection[] }> {
  const connections: McpConnection[] = [];
  const tools: Tool[] = [];

  try {
    for (const config of configs) {
      const connection = await connectMcpServer(config);
      connections.push(connection);
      tools.push(...connection.tools);
    }
  } catch (error) {
    await Promise.all(connections.map((c) => c.close().catch(() => undefined)));
    throw error;
  }

  return { tools, connections };
}
