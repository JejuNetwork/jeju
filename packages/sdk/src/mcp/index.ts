/**
 * MCP Module - Model Context Protocol Client
 *
 * Provides TypeScript interface for:
 * - Discovering MCP servers and their capabilities
 * - Calling MCP tools and resources
 * - Managing MCP sessions
 */

import type { NetworkType } from "@jejunetwork/types";
import { getServicesConfig } from "../config";
import {
  MCPJsonRpcResponseSchema,
  MCPPromptGetResponseSchema,
  MCPPromptsListResponseSchema,
  MCPResourceContentSchema,
  MCPResourcesListResponseSchema,
  MCPResourcesReadResponseSchema,
  MCPServerSchema,
  MCPToolResultSchema,
  MCPToolsListResponseSchema,
} from "../shared/schemas";
import type { JsonRecord, JsonValue } from "../shared/types";
import type { JejuWallet } from "../wallet";

export interface MCPServer {
  name: string;
  version: string;
  protocolVersion: string;
  capabilities: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
    sampling?: boolean;
  };
  instructions?: string;
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties: Record<
      string,
      {
        type: string;
        description?: string;
        enum?: string[];
        default?: JsonValue;
      }
    >;
    required?: string[];
  };
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface MCPToolResult {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
    uri?: string;
  }>;
  isError?: boolean;
}

export interface MCPResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string; // base64 encoded
}

export interface MCPPromptMessage {
  role: "user" | "assistant";
  content: {
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
  };
}

export interface MCPSession {
  sessionId: string;
  serverInfo: MCPServer;
  tools: MCPTool[];
  resources: MCPResource[];
  prompts: MCPPrompt[];
}

export interface MCPModule {
  // Server Discovery
  discoverServer(endpoint: string): Promise<MCPServer>;
  listKnownServers(): Promise<
    Array<{ name: string; endpoint: string; info: MCPServer }>
  >;

  // Session Management
  createSession(endpoint: string): Promise<MCPSession>;
  closeSession(sessionId: string): Promise<void>;
  getSession(sessionId: string): Promise<MCPSession | null>;

  // Tools
  listTools(endpoint: string): Promise<MCPTool[]>;
  callTool(
    endpoint: string,
    toolName: string,
    arguments_: JsonRecord,
  ): Promise<MCPToolResult>;

  // Resources
  listResources(endpoint: string): Promise<MCPResource[]>;
  readResource(endpoint: string, uri: string): Promise<MCPResourceContent>;
  subscribeResource(
    endpoint: string,
    uri: string,
    onChange: (content: MCPResourceContent) => void,
  ): () => void; // Returns unsubscribe function

  // Prompts
  listPrompts(endpoint: string): Promise<MCPPrompt[]>;
  getPrompt(
    endpoint: string,
    promptName: string,
    arguments_?: Record<string, string>,
  ): Promise<{
    description?: string;
    messages: MCPPromptMessage[];
  }>;

  // Network Services (pre-configured endpoints)
  factory: {
    listTools(): Promise<MCPTool[]>;
    callTool(toolName: string, args: JsonRecord): Promise<MCPToolResult>;
    listResources(): Promise<MCPResource[]>;
    readResource(uri: string): Promise<MCPResourceContent>;
  };

  gateway: {
    listTools(): Promise<MCPTool[]>;
    callTool(toolName: string, args: JsonRecord): Promise<MCPToolResult>;
    listResources(): Promise<MCPResource[]>;
    readResource(uri: string): Promise<MCPResourceContent>;
  };
}

export function createMCPModule(
  wallet: JejuWallet,
  network: NetworkType,
): MCPModule {
  const services = getServicesConfig(network);
  const factoryMcpUrl = `${services.factory.api}/api/mcp`;
  const gatewayMcpUrl = `${services.gateway.mcp}`;

  const sessions = new Map<string, MCPSession>();
  let sessionCounter = 0;

  async function buildAuthHeaders(): Promise<Record<string, string>> {
    const timestamp = Date.now().toString();
    const message = `mcp:${timestamp}`;
    const signature = await wallet.signMessage(message);

    return {
      "Content-Type": "application/json",
      "x-jeju-address": wallet.address,
      "x-jeju-timestamp": timestamp,
      "x-jeju-signature": signature,
    };
  }

  async function mcpRequest<T>(
    endpoint: string,
    method: string,
    params?: JsonRecord,
  ): Promise<T> {
    const headers = await buildAuthHeaders();

    const body = {
      jsonrpc: "2.0",
      method,
      params: params ?? {},
      id: Date.now(),
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`MCP request failed: ${response.statusText}`);
    }

    const rawData: unknown = await response.json();
    const result = MCPJsonRpcResponseSchema.parse(rawData);

    if (result.error) {
      throw new Error(`MCP error: ${result.error.message}`);
    }

    return result.result as T;
  }

  function createServiceClient(baseUrl: string) {
    return {
      async listTools(): Promise<MCPTool[]> {
        const result = await mcpRequest<unknown>(baseUrl, "tools/list");
        const validated = MCPToolsListResponseSchema.parse(result);
        return validated.tools as MCPTool[];
      },

      async callTool(
        toolName: string,
        args: JsonRecord,
      ): Promise<MCPToolResult> {
        const result = await mcpRequest<unknown>(baseUrl, "tools/call", {
          name: toolName,
          arguments: args,
        });
        return MCPToolResultSchema.parse(result) as MCPToolResult;
      },

      async listResources(): Promise<MCPResource[]> {
        const result = await mcpRequest<unknown>(baseUrl, "resources/list");
        const validated = MCPResourcesListResponseSchema.parse(result);
        return validated.resources as MCPResource[];
      },

      async readResource(uri: string): Promise<MCPResourceContent> {
        const result = await mcpRequest<unknown>(baseUrl, "resources/read", {
          uri,
        });
        const validated = MCPResourcesReadResponseSchema.parse(result);
        return validated.contents[0] as MCPResourceContent;
      },
    };
  }

  return {
    async discoverServer(endpoint) {
      const result = await mcpRequest<unknown>(endpoint, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
        clientInfo: {
          name: "jeju-sdk",
          version: "1.0.0",
        },
      });
      return MCPServerSchema.parse(result) as MCPServer;
    },

    async listKnownServers() {
      const knownEndpoints = [
        { name: "Factory", endpoint: factoryMcpUrl },
        { name: "Gateway", endpoint: gatewayMcpUrl },
      ];

      const servers: Array<{
        name: string;
        endpoint: string;
        info: MCPServer;
      }> = [];

      // Discover servers in parallel, filter out unavailable ones
      const results = await Promise.allSettled(
        knownEndpoints.map(async ({ name, endpoint }) => {
          const info = await this.discoverServer(endpoint);
          return { name, endpoint, info };
        }),
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          servers.push(result.value);
        }
        // Skip unavailable servers - this is expected behavior for optional services
      }

      return servers;
    },

    async createSession(endpoint) {
      const serverInfo = await this.discoverServer(endpoint);
      const tools = serverInfo.capabilities.tools
        ? await this.listTools(endpoint)
        : [];
      const resources = serverInfo.capabilities.resources
        ? await this.listResources(endpoint)
        : [];
      const prompts = serverInfo.capabilities.prompts
        ? await this.listPrompts(endpoint)
        : [];

      const sessionId = `session-${++sessionCounter}`;
      const session: MCPSession = {
        sessionId,
        serverInfo,
        tools,
        resources,
        prompts,
      };

      sessions.set(sessionId, session);
      return session;
    },

    async closeSession(sessionId) {
      sessions.delete(sessionId);
    },

    async getSession(sessionId) {
      return sessions.get(sessionId) ?? null;
    },

    async listTools(endpoint) {
      const result = await mcpRequest<unknown>(endpoint, "tools/list");
      const validated = MCPToolsListResponseSchema.parse(result);
      return validated.tools as MCPTool[];
    },

    async callTool(endpoint, toolName, arguments_: JsonRecord) {
      const result = await mcpRequest<unknown>(endpoint, "tools/call", {
        name: toolName,
        arguments: arguments_,
      });
      return MCPToolResultSchema.parse(result) as MCPToolResult;
    },

    async listResources(endpoint) {
      const result = await mcpRequest<unknown>(endpoint, "resources/list");
      const validated = MCPResourcesListResponseSchema.parse(result);
      return validated.resources as MCPResource[];
    },

    async readResource(endpoint, uri) {
      const result = await mcpRequest<unknown>(endpoint, "resources/read", {
        uri,
      });
      const validated = MCPResourcesReadResponseSchema.parse(result);
      return validated.contents[0] as MCPResourceContent;
    },

    subscribeResource(endpoint, uri, onChange) {
      // SSE-based subscription
      const abortController = new AbortController();

      (async () => {
        const headers = await buildAuthHeaders();
        const response = await fetch(
          `${endpoint}/resources/subscribe?uri=${encodeURIComponent(uri)}`,
          {
            headers,
            signal: abortController.signal,
          },
        );

        if (!response.ok || !response.body) return;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data !== "[DONE]") {
                // Use safeParse since individual SSE messages may be malformed
                const result = MCPResourceContentSchema.safeParse(
                  JSON.parse(data),
                );
                if (result.success) {
                  onChange(result.data as MCPResourceContent);
                }
              }
            }
          }
        }
      })();

      return () => abortController.abort();
    },

    async listPrompts(endpoint) {
      const result = await mcpRequest<unknown>(endpoint, "prompts/list");
      const validated = MCPPromptsListResponseSchema.parse(result);
      return validated.prompts as MCPPrompt[];
    },

    async getPrompt(endpoint, promptName, arguments_) {
      const result = await mcpRequest<unknown>(endpoint, "prompts/get", {
        name: promptName,
        ...(arguments_ && { arguments: arguments_ }),
      });
      const validated = MCPPromptGetResponseSchema.parse(result);
      return {
        description: validated.description,
        messages: validated.messages as MCPPromptMessage[],
      };
    },

    factory: createServiceClient(factoryMcpUrl),
    gateway: createServiceClient(gatewayMcpUrl),
  };
}
