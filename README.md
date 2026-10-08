# Multi-agent Framework

Class-based TypeScript framework for multi-level agent hierarchies with a custom agent loop (no LangGraph). Agents talk through LLM **function calling** tools:

- `delegate` — start a child agent on a task
- `message` — ask/escalate to a **parent** (suspend + `WAITING`) or answer/resume a **child**

The reusable library is `@proaxia/multiagent`. It does not read environment variables. The application constructs an LLM proxy and passes credentials, the model name, and any host into it.

## Workspace

One git repo, three npm packages:

```
packages/multiagent/              # @proaxia/multiagent
examples/internet-search-mcp/     # local MCP: web_search + read_url
examples/console/                 # football console demo (multiagent-console)
```

`npm run build` compiles the library, the internet-search MCP, then the console. `npm start` and `npm run dev` run the console example (which starts the MCP in-process).

## LLM proxies

| Proxy | Factory | Import |
| --- | --- | --- |
| SAP Orchestration | `createSapOrchestrationLlm({ model, serviceKey })` | `@proaxia/multiagent/sap` |
| OpenRouter | `createOpenRouterLlm({ apiKey, model })` | `@proaxia/multiagent` |
| Ollama | `createOllamaLlm({ baseUrl, apiKey, model })` | `@proaxia/multiagent` |

OpenRouter and Ollama share one OpenAI-compatible chat client. SAP Orchestration stays separate because it splits the latest tool results into `messages` and the rest into `messagesHistory`.

`@sap-ai-sdk/orchestration` is an optional peer dependency of the library, so apps that use OpenRouter or Ollama do not load it. The console example depends on it directly.

```ts
import { Agent, Runtime, createOllamaLlm } from "@proaxia/multiagent";
import { createSapOrchestrationLlm } from "@proaxia/multiagent/sap";

const runtime = new Runtime(
  createSapOrchestrationLlm({
    model: "gpt-4o",
    serviceKey: serviceKeyJson,
  }),
);

const ollamaRuntime = new Runtime(
  createOllamaLlm({
    baseUrl: "http://localhost:11434",
    apiKey,
    model: "llama3.1",
  }),
);
```

## Hierarchy (demo)

```
User → root (general topics)
         └── football (football in general)
               ├── psg
               └── arsenal
```

1. Root talks about everything except football; football topics `delegate` → `football`.
2. `football` covers football in general; PSG → `delegate` to `psg`, Arsenal → `delegate` to `arsenal`.
3. Specialists can `message` `football` (`WAITING`); `football` answers locally or escalates to `root`.
4. Root can answer itself or ask the user, then `message` downward.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the env template and fill in the provider you want. The file stays at the repo root; the example loads it with `--env-file=../../.env`.

```bash
cp .env.example .env
```

Set `LLM_PROVIDER` to one of:

- `sap` — `AICORE_SERVICE_KEY` (AI Core service-key JSON) and optional `AICORE_MODEL` (default `gpt-4o`)
- `openrouter` — `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`
- `ollama` — `OLLAMA_BASE_URL`, `OLLAMA_API_KEY`, and `OLLAMA_MODEL`

Optional for the football agent’s internet tools:

- `JINA_API_KEY` — Jina Reader (scrape) used by the local `internet-search` MCP
- `MCP_API_KEY` — optional Bearer on the local MCP HTTP port (client sends the same key)
- `INTERNET_SEARCH_MCP_HOST` / `INTERNET_SEARCH_MCP_PORT` — listen address (defaults `127.0.0.1:3921`)

3. Build and run the console UI:

```bash
npm run build
npm start
```

Talk to the **root** agent. Use `/exit` or `/quit` to leave.

Runtime tool traces (`delegate` / `message`) are printed on stderr.

## Defining agents

```ts
import { Agent, Runtime, createOllamaLlm } from "@proaxia/multiagent";

const arsenal = new Agent("arsenal", "You are an Arsenal specialist…");
const football = new Agent("football", "You are a football expert…");
const root = new Agent("root", "You chat about general topics…");

football.addChild(arsenal);
root.addChild(football);

const runtime = new Runtime(
  createOllamaLlm({
    baseUrl: "http://localhost:11434",
    apiKey,
    model: "llama3.1",
  }),
);
await runtime.registerTree(root);
const reply = await runtime.chat("What do you think of Arsenal's last match?");
```

Communication tools (`delegate`, `message`) are injected by the Runtime from the tree shape. Pass optional domain `Tool` instances and/or `McpServerConfig[]` into the `Agent` constructor.

## MCP tools

Each agent may attach multiple Streamable HTTP MCP servers. Config is supplied by the app (the library does not hardcode servers or read env):

```ts
import { Agent, Runtime, type McpServerConfig } from "@proaxia/multiagent";

const mcps: McpServerConfig[] = [
  {
    id: "internet-search",
    url: "http://127.0.0.1:3921/mcp",
    apiKey: process.env.MCP_API_KEY, // optional Bearer
  },
];

const football = new Agent("football", "…", [], mcps);
await runtime.registerTree(root);
```

Tool names are prefixed as `${id}__${mcpToolName}` so several servers can coexist with `delegate` / `message`.

### Demo: `internet-search`

The console starts [`examples/internet-search-mcp`](examples/internet-search-mcp) and attaches it to **football** only:

| Tool | Role |
| --- | --- |
| `internet-search__web_search` | DuckDuckGo via `duck-duck-scrape` |
| `internet-search__read_url` | Page content via Jina Reader (`r.jina.ai`) |

Set `JINA_API_KEY` for authenticated Reader access (higher limits). See [docs/03_mcp_attachment.md](docs/03_mcp_attachment.md).
