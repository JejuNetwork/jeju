/**
 * Edge coordination service schemas
 */

import { z } from 'zod';
import type { Address } from 'viem';
import { addressSchema, nonEmptyStringSchema, cidSchema, positiveIntSchema } from '../validation';

/**
 * Edge node registration request schema
 */
export const edgeNodeRegistrationSchema = z.object({
  nodeType: z.enum(['wallet-edge', 'full-node', 'cdn-node']),
  platform: nonEmptyStringSchema,
  operator: addressSchema.optional(),
  capabilities: z.object({
    proxy: z.boolean(),
    torrent: z.boolean(),
    cdn: z.boolean(),
    rpc: z.boolean(),
    storage: z.boolean(),
    maxCacheBytes: z.number().int().nonnegative(),
    maxBandwidthMbps: z.number().int().nonnegative(),
  }),
  region: z.string().optional(),
});

/**
 * Edge cache request schema
 */
export const edgeCacheRequestSchema = z.object({
  cid: cidSchema,
  priority: z.enum(['high', 'normal', 'low']).default('normal'),
  regions: z.array(z.string()).optional(),
  minReplicas: z.number().int().positive().optional(),
});

/**
 * Edge node params schema
 */
export const edgeNodeParamsSchema = z.object({
  nodeId: z.string().uuid(),
});

/**
 * Edge nodes query schema
 */
export const edgeNodesQuerySchema = z.object({
  region: z.string().optional(),
  type: z.enum(['wallet-edge', 'full-node', 'cdn-node']).optional(),
  status: z.enum(['online', 'offline', 'busy']).default('online'),
});

/**
 * Edge route params schema
 */
export const edgeRouteParamsSchema = z.object({
  cid: cidSchema,
});
