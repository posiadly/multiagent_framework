import {
  OrchestrationClient,
  type ChatCompletionTool,
  type ChatMessage as SapChatMessage,
  type OrchestrationResponse,
  type ToolChatMessage,
} from '@sap-ai-sdk/orchestration';
import type { Llm, LlmChatResult, LlmTool } from './llm.js';
import type { ChatMessage, ToolCall } from './types.js';

export interface SapServiceKey {
  clientid: string;
  clientsecret: string;
  url: string;
  serviceurls: {
    AI_API_URL: string;
  };
}

export interface SapOrchestrationLlmOptions {
  model: string;
  serviceKey: string | SapServiceKey;
}

export function createSapOrchestrationLlm(
  options: SapOrchestrationLlmOptions,
): Llm {
  const credentials = readServiceKey(options.serviceKey);
  const apiUrl = credentials.serviceurls.AI_API_URL.trim().replace(/\/+$/, '');
  const tokenServiceUrl = toTokenServiceUrl(credentials.url);
  const tokens = new ClientCredentialsToken(credentials, tokenServiceUrl);

  return {
    async chat(messages, tools): Promise<LlmChatResult> {
      const client = new OrchestrationClient(
        {
          promptTemplating: {
            model: {
              name: options.model,
            },
            ...(tools.length > 0
              ? {
                  prompt: {
                    tools: toSapTools(tools),
                  },
                }
              : {}),
          },
        },
        { resourceGroup: 'default' },
        await tokens.destination(apiUrl),
      );

      const { requestMessages, messagesHistory } = splitForRequest(messages);
      const response = await client.chatCompletion({
        messages: toSapMessages(requestMessages),
        ...(messagesHistory.length > 0
          ? { messagesHistory: toSapMessages(messagesHistory) }
          : {}),
      });

      const toolCalls = mapToolCalls(response.getToolCalls());
      const content = response.getContent() ?? undefined;
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: content ?? null,
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
      };

      return {
        content,
        toolCalls,
        assistantMessage,
      };
    },
  };
}

function toSapTools(tools: LlmTool[]): ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    },
  }));
}

function toSapMessages(messages: ChatMessage[]): SapChatMessage[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      const toolMessage: ToolChatMessage = {
        role: 'tool',
        content: message.content ?? '',
        tool_call_id: message.tool_call_id ?? '',
      };
      return toolMessage;
    }
    if (message.role === 'assistant' && message.tool_calls?.length) {
      return {
        role: 'assistant',
        content: message.content,
        tool_calls: message.tool_calls,
      };
    }
    return {
      role: message.role,
      content: message.content ?? '',
    };
  }) as SapChatMessage[];
}

function mapToolCalls(
  toolCalls: ReturnType<OrchestrationResponse['getToolCalls']>,
): ToolCall[] | undefined {
  if (!toolCalls?.length) {
    return undefined;
  }
  return toolCalls.map((call) => ({
    id: call.id,
    type: 'function' as const,
    function: {
      name: call.function.name,
      arguments: call.function.arguments,
    },
  }));
}

/**
 * When the conversation ends with tool results after an assistant tool_calls
 * message, send those as `messages` and the rest as `messagesHistory`
 * (SAP Orchestration function-calling pattern).
 */
function splitForRequest(messages: ChatMessage[]): {
  requestMessages: ChatMessage[];
  messagesHistory: ChatMessage[];
} {
  if (messages.length === 0) {
    return { requestMessages: [], messagesHistory: [] };
  }

  let index = messages.length - 1;
  while (index >= 0 && messages[index]?.role === 'tool') {
    index -= 1;
  }

  const assistantWithTools = messages[index];
  if (
    assistantWithTools?.role === 'assistant' &&
    assistantWithTools.tool_calls?.length &&
    index < messages.length - 1
  ) {
    return {
      messagesHistory: messages.slice(0, index + 1),
      requestMessages: messages.slice(index + 1),
    };
  }

  return { requestMessages: messages, messagesHistory: [] };
}

function readServiceKey(serviceKey: string | SapServiceKey): SapServiceKey {
  if (typeof serviceKey !== 'string') {
    return assertServiceKey(serviceKey);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serviceKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`SAP service key is not valid JSON: ${message}`);
  }
  return assertServiceKey(parsed);
}

function assertServiceKey(value: unknown): SapServiceKey {
  if (!isServiceKey(value)) {
    throw new Error(
      'SAP service key must include clientid, clientsecret, url, and serviceurls.AI_API_URL',
    );
  }
  return value;
}

function isServiceKey(value: unknown): value is SapServiceKey {
  if (!isRecord(value)) {
    return false;
  }
  const urls = value['serviceurls'];
  if (!isRecord(urls)) {
    return false;
  }
  return (
    typeof value['clientid'] === 'string' &&
    value['clientid'].length > 0 &&
    typeof value['clientsecret'] === 'string' &&
    value['clientsecret'].length > 0 &&
    typeof value['url'] === 'string' &&
    value['url'].length > 0 &&
    typeof urls['AI_API_URL'] === 'string' &&
    urls['AI_API_URL'].length > 0
  );
}

function toTokenServiceUrl(authUrl: string): string {
  const trimmed = authUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/oauth/token')) {
    return trimmed;
  }
  return `${trimmed}/oauth/token`;
}

/**
 * OrchestrationClient expects an OAuth2 client-credentials destination whose
 * bearer token is already in `authTokens`. The Cloud SDK does not exchange
 * `clientid` / `clientsecret` itself.
 */
class ClientCredentialsToken {
  private cached:
    | {
        accessToken: string;
        expiresAt: number;
      }
    | undefined;

  constructor(
    private readonly credentials: SapServiceKey,
    private readonly tokenServiceUrl: string,
  ) {}

  async destination(apiUrl: string): Promise<{
    url: string;
    authentication: 'OAuth2ClientCredentials';
    clientId: string;
    clientSecret: string;
    tokenServiceUrl: string;
    authTokens: [
      {
        type: 'bearer';
        value: string;
        expiresIn: string;
        error: null;
        http_header: { key: 'Authorization'; value: string };
      },
    ];
  }> {
    const token = await this.accessToken();
    return {
      url: apiUrl,
      authentication: 'OAuth2ClientCredentials',
      clientId: this.credentials.clientid,
      clientSecret: this.credentials.clientsecret,
      tokenServiceUrl: this.tokenServiceUrl,
      authTokens: [
        {
          type: 'bearer',
          value: token.accessToken,
          expiresIn: String(token.expiresInSeconds),
          error: null,
          http_header: {
            key: 'Authorization',
            value: `Bearer ${token.accessToken}`,
          },
        },
      ],
    };
  }

  private async accessToken(): Promise<{
    accessToken: string;
    expiresInSeconds: number;
  }> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt - now > 60_000) {
      const expiresInSeconds = Math.floor((this.cached.expiresAt - now) / 1000);
      return {
        accessToken: this.cached.accessToken,
        expiresInSeconds,
      };
    }

    const response = await fetch(this.tokenServiceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.credentials.clientid,
        client_secret: this.credentials.clientsecret,
      }),
    });

    if (!response.ok) {
      const body = (await response.text()).trim().slice(0, 300);
      throw new Error(
        `SAP token request failed (${response.status})${body ? `: ${body}` : ''}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`SAP token response was not valid JSON: ${message}`);
    }

    if (!isRecord(payload) || typeof payload['access_token'] !== 'string') {
      throw new Error('SAP token response did not include an access_token');
    }

    const expiresInRaw = payload['expires_in'];
    const expiresInSeconds =
      typeof expiresInRaw === 'number' && expiresInRaw > 0 ? expiresInRaw : 3600;
    this.cached = {
      accessToken: payload['access_token'],
      expiresAt: now + expiresInSeconds * 1000,
    };
    return {
      accessToken: payload['access_token'],
      expiresInSeconds,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
