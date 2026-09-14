# Multi-agent Framework

Class-based TypeScript framework for multi-level agent hierarchies with a custom agent loop (no LangGraph). Agents talk through LLM **function calling** tools:

- `delegate` — start a child agent on a task
- `message` — ask/escalate to a **parent** (suspend + `WAITING`) or answer/resume a **child**

LLM calls go through SAP AI Core via `@sap-ai-sdk/orchestration`.

## Hierarchy (demo)

```
User → root (ogólne tematy)
         └── football (piłka nożna ogólnie)
               ├── psg
               └── arsenal
```

1. Root rozmawia o wszystkim poza piłką; tematy piłkarskie `delegate` → `football`.
2. `football` mówi o piłce ogólnie; PSG → `delegate` do `psg`, Arsenal → `delegate` do `arsenal`.
3. Specjaliści mogą `message` do `football` (WAITING); `football` odpowiada lokalnie albo eskaluje do `root`.
4. Root może odpowiedzieć sam albo dopytać użytkownika, potem `message` w dół.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy env template and set AI Core credentials:

```bash
cp .env.example .env
```

Set `AICORE_SERVICE_KEY` to your AI Core service key JSON (as expected by the SAP AI SDK). Optionally set `AICORE_MODEL` (default `gpt-4o`).

3. Build and run the console UI:

```bash
npm run build
npm start
```

Talk to the **root** agent. Use `/exit` or `/quit` to leave.

Runtime tool traces (`delegate` / `message`) are printed on stderr.

## Project layout

```
src/
  framework/   # Agent, Tool, AgentThread, Runtime
  llm/         # LlmClient (OrchestrationClient + function calling)
  demo/        # Root / Mid / Leaf prompts and tree wiring
  cli/         # ConsoleApp (readline)
  apps.ts      # Entry point
```

## Defining agents

```ts
import { Agent, Runtime } from './framework/index.js';
import { LlmClient } from './llm/llm-client.js';

const arsenal = new Agent('arsenal', 'Jesteś specjalistą od Arsenalu…');
const football = new Agent('football', 'Jesteś ekspertem od piłki…');
const root = new Agent('root', 'Rozmawiasz na ogólne tematy…');

football.addChild(arsenal);
root.addChild(football);

const runtime = new Runtime(new LlmClient());
runtime.registerTree(root);
const reply = await runtime.chat('Co sądzisz o ostatnim meczu Arsenalu?');
```

Communication tools (`delegate`, `message`) are injected by the Runtime from the tree shape. Pass optional domain `Tool` instances into the `Agent` constructor.
