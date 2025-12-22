/**
 * MCP Module - Model Context Protocol Client
 *
 * Provides TypeScript interface for:
 * - Discovering MCP servers and their capabilities
 * - Calling MCP tools and resources
 * - Managing MCP sessions
 */

import type { NetworkType } from "@jejunetwork/types";
import type { JejuWallet } from "../wallet";
import type { JsonRecord, JsonValue } from "../shared/types";
import { getServicesConfig } from "../config";

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Module Interface
// ============================================================================

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
    callTool(
      toolName: string,
      args: JsonRecord,
    ): Promise<MCPToolResult>;
    listResources(): Promise<MCPResource[]>;
    readResource(uri: string): Promise<MCPResourceContent>;
  };

  gateway: {
    listTools(): Promise<MCPTool[]>;
    callTool(
      toolName: string,
      args: JsonRecord,
    ): Promise<MCPToolResult>;
    listResources(): Promise<MCPResource[]>;
    readResource(uri: string): Promise<MCPResourceContent>;
  };
}

// ============================================================================
// Implementation
// ============================================================================

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

    const result = (await response.json()) as {
      jsonrpc: string;
      id: number;
      result?: T;
      error?: { code: number; message: string; data?: JsonValue };
    };

    if (result.error) {
      throw new Error(`MCP error: ${result.error.message}`);
    }

    return result.result as T;
  }

  function createServiceClient(baseUrl: string) {
    return {
      async listTools(): Promise<MCPTool[]> {
        return mcpRequest<{ tools: MCPTool[] }>(baseUrl, "tools/list").then(
          (r) => r.tools,
        );
      },

      async callTool(
        toolName: string,
        args: JsonRecord,
      ): Promise<MCPToolResult> {
        return mcpRequest<MCPToolResult>(baseUrl, "tools/call", {
          name: toolName,
          arguments: args,
        });
      },

      async listResources(): Promise<MCPResource[]> {
        return mcpRequest<{ resources: MCPResource[] }>(
          baseUrl,
          "resources/list",
        ).then((r) => r.resources);
      },

      async readResource(uri: string): Promise<MCPResourceContent> {
        return mcpRequest<{ contents: MCPResourceContent[] }>(
          baseUrl,
          "resources/read",
          {
            uri,
          },
        ).then((r) => r.contents[0]);
      },
    };
  }

  return {
    async discoverServer(endpoint) {
      return mcpRequest<MCPServer>(endpoint, "initialize", {
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
      const result = await mcpRequest<{ tools: MCPTool[] }>(
        endpoint,
        "tools/list",
      );
      return result.tools;
    },

    async callTool(endpoint, toolName, arguments_: JsonRecord) {
      return mcpRequest<MCPToolResult>(endpoint, "tools/call", {
        name: toolName,
        arguments: arguments_,
      });
    },

    async listResources(endpoint) {
      const result = await mcpRequest<{ resources: MCPResource[] }>(
        endpoint,
        "resources/list",
      );
      return result.resources;
    },

    async readResource(endpoint, uri) {
      const result = await mcpRequest<{ contents: MCPResourceContent[] }>(
        endpoint,
        "resources/read",
        { uri },
      );
      return result.contents[0];
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
                onChange(JSON.parse(data) as MCPResourceContent);
              }
            }
          }
        }
      })();

      return () => abortController.abort();
    },

    async listPrompts(endpoint) {
      const result = await mcpRequest<{ prompts: MCPPrompt[] }>(
        endpoint,
        "prompts/list",
      );
      return result.prompts;
    },

    async getPrompt(endpoint, promptName, arguments_) {
      return mcpRequest<{
        description?: string;
        messages: MCPPromptMessage[];
      }>(endpoint, "prompts/get", {
        name: promptName,
        arguments: arguments_,
      });
    },

    factory: createServiceClient(factoryMcpUrl),
    gateway: createServiceClient(gatewayMcpUrl),
  };
}
