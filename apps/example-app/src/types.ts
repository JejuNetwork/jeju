/**
 * Type definitions for the Decentralized App Template
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
  x402?: X402Config;
}

export interface A2ASkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
  x402Price?: X402Price;
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
  id: string | number;
}

export interface A2AResponse {
  jsonrpc: string;
  id: string | number;
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
  x402Price?: X402Price;
}

export interface MCPPrompt {
  name: string;
  description: string;
  arguments: Array<{ name: string; description: string; required?: boolean }>;
}

// x402 Payment Protocol Types
export interface X402Config {
  enabled: boolean;
  acceptedTokens: X402Token[];
  paymentAddress: Address;
  pricePerRequest?: bigint;
  network: 'base' | 'base-sepolia' | 'jeju' | 'jeju-testnet';
}

export interface X402Token {
  symbol: string;
  address: Address;
  decimals: number;
  minAmount: bigint;
}

export interface X402Price {
  amount: bigint;
  token: string;
  description?: string;
}

export interface X402PaymentHeader {
  token: Address;
  amount: string;
  payer: Address;
  payee: Address;
  nonce: string;
  deadline: number;
  signature: Hex;
}

export interface X402PaymentResult {
  valid: boolean;
  txHash?: Hex;
  error?: string;
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

// REST API Response Types
export interface ApiResponse<T> {
  data: T;
  meta?: {
    timestamp: number;
    requestId: string;
  };
}

export interface ApiError {
  error: string;
  code: string;
  details?: string;
}

// Template Configuration
export interface TemplateConfig {
  appName: string;
  jnsName: string;
  databaseId: string;
  description: string;
  owner: Address;
  ports: {
    main: number;
    frontend: number;
  };
  x402: X402Config;
}

// Priority type
export type TodoPriority = 'low' | 'medium' | 'high' | 'urgent';

// Constants
export const TODO_PRIORITIES: readonly TodoPriority[] = ['low', 'medium', 'high', 'urgent'] as const;

export const A2A_SKILLS = [
  'list-todos',
  'create-todo',
  'complete-todo',
  'delete-todo',
  'get-summary',
  'set-reminder',
  'prioritize',
] as const;

export const MCP_TOOLS = [
  'create_todo',
  'list_todos',
  'update_todo',
  'delete_todo',
  'get_stats',
  'schedule_reminder',
  'bulk_complete',
] as const;

// Default x402 configuration
export const X402_CONFIG = {
  enabled: true,
  paymentAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address, // Default dev address
  acceptedTokens: [
    {
      symbol: 'JEJU',
      address: '0x5FbDB2315678afecb367f032d93F642f64180aa3' as Address,
      decimals: 18,
      minAmount: 1000000000000000n, // 0.001 JEJU
    },
    {
      symbol: 'USDC',
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
      decimals: 6,
      minAmount: 1000n, // 0.001 USDC
    },
  ],
  prices: {
    rest: '10000000000000000', // 0.01 JEJU per REST call
    a2a: '50000000000000000', // 0.05 JEJU per A2A call
    mcp: '50000000000000000', // 0.05 JEJU per MCP call
  },
  network: 'base-sepolia' as const,
} as const;
