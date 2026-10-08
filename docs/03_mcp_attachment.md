---
name: MCP attachment
overview: Let each agent attach multiple externally configured Streamable HTTP MCP servers (optional Bearer API key), mapping their tools into the agent loop. Demo uses one internet-search MCP on the football agent.
todos:
  - id: mcp-bridge
    content: Add McpServerConfig + Streamable HTTP client bridge mapping MCP tools to framework Tool[]
    status: completed
  - id: agent-runtime
    content: Add Agent.mcps 4th arg; make Runtime.registerTree async and merge connected MCP tools in buildTools
    status: completed
  - id: demo-mcp-server
    content: Add internet-search MCP with web_search (duck-duck-scrape) and read_url (Jina Reader)
    status: completed
  - id: demo-football
    content: Attach internet-search MCP config from outside the library to the football agent
    status: completed
  - id: docs-env
    content: Update .env.example, README, and this design note
    status: completed
isProject: false
---

# MCP attachment for agents

## Goal

Agents can use tools from one or more MCP servers. The list of servers is supplied by the application when constructing each `Agent`. The library connects over Streamable HTTP, optionally with a Bearer API key, lists tools, and exposes them in the existing agent loop next to domain tools and `delegate` / `message`.

## Library API

```ts
type McpServerConfig = {
  id: string; // tool name prefix: `${id}__${toolName}`
  url: string; // Streamable HTTP endpoint
  apiKey?: string; // Authorization: Bearer <apiKey>
};

new Agent(id, systemPrompt, tools?, mcps?);
await runtime.registerTree(root); // connects every agent's mcps
```

`@proaxia/multiagent` does not read `process.env`. Callers pass URLs and keys.

On `registerTree`, the runtime walks the tree, connects each `McpServerConfig`, caches `Tool[]` per agent id, and merges them in `buildTools` after domain tools and before communication tools. Re-register closes previous MCP clients.

## Demo: `internet-search`

Package [`examples/internet-search-mcp`](../examples/internet-search-mcp) is a local Streamable HTTP MCP server named `internet-search` with:

| Tool | Backend |
| --- | --- |
| `web_search` | `duck-duck-scrape` |
| `read_url` | Jina Reader (`https://r.jina.ai/<url>`) with `JINA_API_KEY` |

The console example starts that server, builds `McpServerConfig[]` in [`examples/console/src/demo/mcps.ts`](../examples/console/src/demo/mcps.ts), and passes it only to the `football` agent. Prefixed tool names seen by the LLM: `internet-search__web_search`, `internet-search__read_url`.

Optional `MCP_API_KEY` protects the local MCP HTTP port; the same value is sent by the framework client as Bearer.
