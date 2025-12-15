/**
 * Type definitions for the Experimental Decentralized Todo App
 */

import type { Address, Hex } from 'viem';

// Todo Item
export interface Todo {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
  dueDate: number | null;
  createdAt: number;
  updatedAt: number;
  owner: Address;
  encryptedData: string | null;
  attachmentCid: string | null;
}

export interface CreateTodoInput {
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  dueDate?: number;
  encrypt?: boolean;
  attachment?: Uint8Array;
}

export interface UpdateTodoInput {
  title?: string;
  description?: string;
  completed?: boolean;
  priority?: 'low' | 'medium' | 'high';
  dueDate?: number | null;
}

// A2A Protocol Types
export interface A2AAgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  preferredTransport: string;
  provider: { organization: string; url: string };
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2ASkill[];
}

export interface A2ASkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
}

export interface A2AMessage {
  jsonrpc: string;
  method: string;
  params?: {
    message?: {
      messageId: string;
      parts: Array<{
        kind: 'text' | 'data';
        text?: string;
        data?: Record<string, unknown>;
      }>;
    };
  };
  id: unknown;
}

export interface A2AResponse {
  jsonrpc: string;
  id: unknown;
  result?: {
    role: string;
    parts: Array<{ kind: string; text?: string; data?: Record<string, unknown> }>;
    messageId: string;
    kind: string;
  };
  error?: { code: number; message: string };
}

// MCP Protocol Types
export interface MCPServerInfo {
  name: string;
  version: string;
  description: string;
  capabilities: {
    resources: boolean;
    tools: boolean;
    prompts: boolean;
  };
}

export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

export interface MCPPrompt {
  name: string;
  description: string;
  arguments: Array<{ name: string; description: string; required?: boolean }>;
}

// Cache Types
export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

// Cron Job Types
export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  endpoint: string;
  enabled: boolean;
  lastRun: number | null;
  nextRun: number;
}

// Service Status
export interface ServiceStatus {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency?: number;
  details?: string;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  services: ServiceStatus[];
  timestamp: number;
}

// Deploy Types
export interface DeployResult {
  jnsName: string;
  frontendCid: string;
  backendEndpoint: string;
  a2aEndpoint: string;
  mcpEndpoint: string;
  databaseId: string;
  triggerId: Hex;
}
