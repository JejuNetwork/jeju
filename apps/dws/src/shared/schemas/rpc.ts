/**
 * RPC service schemas
 */

import { z } from 'zod';
import type { Address } from 'viem';
import { addressSchema, nonEmptyStringSchema, positiveIntSchema, urlSchema } from '../validation';

/**
 * RPC provider registration request schema
 */
export const rpcProviderRegistrationSchema = z.object({
  chainId: positiveIntSchema,
  endpoint: urlSchema,
  wsEndpoint: urlSchema.optional(),
  region: nonEmptyStringSchema,
  tier: z.enum(['free', 'standard', 'premium']),
  maxRps: positiveIntSchema,
});

/**
 * RPC provider heartbeat request schema
 */
export const rpcProviderHeartbeatSchema = z.object({
  latency: z.number().int().nonnegative().optional(),
  currentRps: z.number().int().nonnegative().optional(),
  status: z.enum(['active', 'degraded', 'offline']).optional(),
});

/**
 * RPC provider params schema
 */
export const rpcProviderParamsSchema = z.object({
  id: z.string().uuid(),
});

/**
 * RPC chains query schema
 */
export const rpcChainsQuerySchema = z.object({
  testnet: z.coerce.boolean().optional(),
});

/**
 * Chain params schema
 */
export const chainParamsSchema = z.object({
  chainId: z.coerce.number().int().positive(),
});

/**
 * JSON-RPC request schema
 */
export const rpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string().min(1),
  params: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(),
  id: z.union([z.string(), z.number()]).optional(),
});

/**
 * JSON-RPC batch request schema
 */
export const rpcBatchRequestSchema = z.array(rpcRequestSchema).min(1);
