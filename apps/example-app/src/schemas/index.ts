/**
 * Zod Schemas for Runtime Validation
 * 
 * All types have corresponding zod schemas for runtime validation.
 * Use these schemas to validate all inputs, outputs, and data transformations.
 */

import { z } from 'zod';
import { AddressSchema, HexSchema, TimestampSchema, BigIntSchema } from '@jejunetwork/types/validation';
import { type Address, type Hex } from 'viem';

// Re-export base schemas from shared types
export { AddressSchema, HexSchema, TimestampSchema, BigIntSchema };

// Alias for backwards compatibility
export const addressSchema = AddressSchema;
const hexSchema = HexSchema;

// Todo ID schema - reusable validation for todo IDs
export const todoIdSchema = z.string().min(1, 'Todo ID is required').trim();

// Todo Priority
export const todoPrioritySchema = z.enum(['low', 'medium', 'high']);

// Todo schemas
export const createTodoInputSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500, 'Title too long'),
  description: z.string().max(5000, 'Description too long').optional(),
  priority: todoPrioritySchema.optional(),
  dueDate: TimestampSchema.optional(),
  encrypt: z.boolean().optional(),
  attachment: z.instanceof(Uint8Array).optional(),
});

export const updateTodoInputSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500, 'Title too long').optional(),
  description: z.string().max(5000, 'Description too long').optional(),
  completed: z.boolean().optional(),
  priority: todoPrioritySchema.optional(),
  dueDate: TimestampSchema.nullable().optional(),
});

export const todoSchema = z.object({
  id: z.string().min(1, 'ID is required'),
  title: z.string().min(1, 'Title is required'),
  description: z.string(),
  completed: z.boolean(),
  priority: todoPrioritySchema,
  dueDate: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  owner: addressSchema,
  encryptedData: z.string().nullable(),
  attachmentCid: z.string().nullable(),
});

// Query parameter schemas
export const listTodosQuerySchema = z.object({
  completed: z.string().transform((val) => val === 'true' ? true : val === 'false' ? false : undefined).optional(),
  priority: todoPrioritySchema.optional(),
  search: z.string().max(200, 'Search query too long').optional(),
});

// Bulk operation schemas
export const bulkCompleteSchema = z.object({
  ids: z.array(z.string().min(1, 'ID is required')).min(1, 'At least one ID is required').max(100, 'Too many IDs'),
});

export const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1, 'ID is required')).min(1, 'At least one ID is required').max(100, 'Too many IDs'),
});

// Authentication schemas
export const walletAuthHeadersSchema = z.object({
  'x-jeju-address': addressSchema,
  'x-jeju-timestamp': z.string().regex(/^\d+$/, 'Timestamp must be numeric').transform(Number).pipe(TimestampSchema),
  'x-jeju-signature': hexSchema,
});

export const oauth3AuthHeadersSchema = z.object({
  'x-oauth3-session': z.string().min(1, 'Session ID is required'),
});

// A2A Protocol schemas
export const a2AAgentCardSchema = z.object({
  protocolVersion: z.string(),
  name: z.string(),
  description: z.string(),
  url: z.string().url(),
  preferredTransport: z.string(),
  provider: z.object({
    organization: z.string(),
    url: z.string().url(),
  }),
  version: z.string(),
  capabilities: z.object({
    streaming: z.boolean(),
    pushNotifications: z.boolean(),
    stateTransitionHistory: z.boolean(),
  }),
  defaultInputModes: z.array(z.string()),
  defaultOutputModes: z.array(z.string()),
  skills: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    tags: z.array(z.string()),
    examples: z.array(z.string()).optional(),
    x402Price: z.object({
      amount: BigIntSchema,
      token: z.string(),
      description: z.string().optional(),
    }).optional(),
  })),
  x402: z.object({
    enabled: z.boolean(),
    acceptedTokens: z.array(z.object({
      symbol: z.string(),
      address: addressSchema,
      decimals: z.number().int().positive(),
      minAmount: BigIntSchema,
    })),
    paymentAddress: addressSchema,
    pricePerRequest: BigIntSchema.optional(),
    network: z.enum(['base', 'base-sepolia', 'jeju', 'jeju-testnet']),
  }).optional(),
});

export const a2AMessageSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.object({
    message: z.object({
      messageId: z.string(),
      parts: z.array(z.union([
        z.object({
          kind: z.literal('text'),
          text: z.string(),
        }),
        z.object({
          kind: z.literal('data'),
          data: z.record(z.string(), z.unknown()),
        }),
      ])),
    }).optional(),
  }).optional(),
  id: z.union([z.string(), z.number()]),
});

export const a2ASkillParamsSchema = z.object({
  skillId: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  priority: todoPrioritySchema.optional(),
  dueDate: TimestampSchema.optional(),
  id: z.string().optional(),
  todoId: z.string().optional(),
  reminderTime: TimestampSchema.optional(),
  completed: z.boolean().optional(),
});

// MCP Protocol schemas
export const mcpServerInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  capabilities: z.object({
    resources: z.boolean(),
    tools: z.boolean(),
    prompts: z.boolean(),
  }),
});

export const mcpResourceSchema = z.object({
  uri: z.string(),
  name: z.string(),
  description: z.string(),
  mimeType: z.string(),
});

export const mcpToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.object({
    type: z.literal('object'),
    properties: z.record(z.string(), z.object({
      type: z.string(),
      description: z.string().optional(),
      enum: z.array(z.string()).optional(),
    })),
    required: z.array(z.string()).optional(),
  }),
  x402Price: z.object({
    amount: BigIntSchema,
    token: z.string(),
    description: z.string().optional(),
  }).optional(),
});

export const mcpToolCallSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});

export const mcpResourceReadSchema = z.object({
  uri: z.string(),
});

export const mcpPromptGetSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.string()),
});

// x402 Payment schemas
export const x402ConfigSchema = z.object({
  enabled: z.boolean(),
  acceptedTokens: z.array(z.object({
    symbol: z.string(),
    address: addressSchema,
    decimals: z.number().int().positive(),
    minAmount: BigIntSchema,
  })),
  paymentAddress: addressSchema,
  pricePerRequest: BigIntSchema.optional(),
  network: z.enum(['base', 'base-sepolia', 'jeju', 'jeju-testnet']),
});

export const x402PaymentHeaderSchema = z.object({
  token: addressSchema,
  amount: z.string(),
  payer: addressSchema,
  payee: addressSchema,
  nonce: z.string(),
  deadline: TimestampSchema,
  signature: hexSchema,
});

export const x402VerifySchema = z.object({
  header: z.string().min(1, 'Payment header is required'),
});

// Auth routes schemas
export const authProviderSchema = z.enum(['wallet', 'farcaster', 'github', 'google', 'twitter', 'discord']);

export const authLoginProviderSchema = z.object({
  provider: authProviderSchema,
});

export const authCallbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

// Stats schema
export const todoStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
  byPriority: z.object({
    low: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
  }),
});

// Decrypted todo data schema (for JSON.parse validation)
export const decryptedTodoDataSchema = z.object({
  title: z.string(),
  description: z.string(),
});

export type DecryptedTodoData = z.infer<typeof decryptedTodoDataSchema>;

// Health check schemas
export const serviceStatusSchema = z.object({
  name: z.string(),
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  latency: z.number().int().nonnegative().optional(),
  details: z.string().optional(),
});

export const healthResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  version: z.string(),
  services: z.array(serviceStatusSchema),
  timestamp: TimestampSchema,
});

// JNS Service schemas
export const jnsAvailableResponseSchema = z.object({
  available: z.boolean(),
});

export const jnsRegisterResponseSchema = z.object({
  txHash: hexSchema,
});

export const jnsRecordsSchema = z.object({
  address: addressSchema.optional(),
  contentHash: z.string().optional(),
  a2aEndpoint: z.string().url().optional(),
  mcpEndpoint: z.string().url().optional(),
  restEndpoint: z.string().url().optional(),
  avatar: z.string().url().optional(),
  url: z.string().url().optional(),
  description: z.string().optional(),
});

export const jnsResolveResponseSchema = z.object({
  address: addressSchema,
});

export const jnsPriceResponseSchema = z.object({
  price: z.string().regex(/^\d+$/, 'Price must be a numeric string'),
});

// Type exports for TypeScript inference
export type CreateTodoInput = z.infer<typeof createTodoInputSchema>;
export type UpdateTodoInput = z.infer<typeof updateTodoInputSchema>;
export type Todo = {
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
};
export type ListTodosQuery = z.infer<typeof listTodosQuerySchema>;
export type BulkCompleteInput = z.infer<typeof bulkCompleteSchema>;
export type BulkDeleteInput = z.infer<typeof bulkDeleteSchema>;
export type WalletAuthHeaders = {
  'x-jeju-address': Address;
  'x-jeju-timestamp': number;
  'x-jeju-signature': Hex;
};
export type OAuth3AuthHeaders = z.infer<typeof oauth3AuthHeadersSchema>;
export type A2AAgentCard = z.infer<typeof a2AAgentCardSchema>;
export type A2AMessage = z.infer<typeof a2AMessageSchema>;
export type A2ASkillParams = z.infer<typeof a2ASkillParamsSchema>;
export type MCPServerInfo = z.infer<typeof mcpServerInfoSchema>;
export type MCPResource = z.infer<typeof mcpResourceSchema>;
export type MCPTool = z.infer<typeof mcpToolSchema>;
export type MCPToolCall = z.infer<typeof mcpToolCallSchema>;
export type MCPResourceRead = z.infer<typeof mcpResourceReadSchema>;
export type MCPPromptGet = z.infer<typeof mcpPromptGetSchema>;
export type X402Config = z.infer<typeof x402ConfigSchema>;
export type X402PaymentHeader = {
  token: Address;
  amount: string;
  payer: Address;
  payee: Address;
  nonce: string;
  deadline: number;
  signature: Hex;
};
export type X402VerifyInput = z.infer<typeof x402VerifySchema>;
export type AuthProvider = z.infer<typeof authProviderSchema>;
export type AuthLoginProvider = z.infer<typeof authLoginProviderSchema>;
export type AuthCallbackQuery = z.infer<typeof authCallbackQuerySchema>;
export type TodoStats = z.infer<typeof todoStatsSchema>;
export type ServiceStatus = z.infer<typeof serviceStatusSchema>;
export type JNSRecords = {
  address?: Address;
  contentHash?: string;
  a2aEndpoint?: string;
  mcpEndpoint?: string;
  restEndpoint?: string;
  avatar?: string;
  url?: string;
  description?: string;
};
export type JNSAvailableResponse = z.infer<typeof jnsAvailableResponseSchema>;
export type JNSRegisterResponse = {
  txHash: Hex;
};
export type JNSResolveResponse = {
  address: Address;
};
export type JNSPriceResponse = z.infer<typeof jnsPriceResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
