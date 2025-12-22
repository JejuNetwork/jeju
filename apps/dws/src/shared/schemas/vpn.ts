/**
 * VPN/Proxy service schemas
 */

import { z } from 'zod';
import type { Address } from 'viem';
import { addressSchema, nonEmptyStringSchema, positiveIntSchema, urlSchema } from '../validation';

/**
 * VPN proxy node registration request schema
 */
export const vpnNodeRegistrationSchema = z.object({
  endpoint: urlSchema,
  region: nonEmptyStringSchema,
  country: nonEmptyStringSchema,
  city: z.string().optional(),
  type: z.enum(['residential', 'datacenter', 'mobile']),
  protocol: z.enum(['http', 'https', 'socks5']),
  port: z.number().int().positive().max(65535),
  bandwidth: positiveIntSchema,
  metadata: z.record(z.string(), z.string()).optional(),
});

/**
 * VPN node heartbeat request schema
 */
export const vpnNodeHeartbeatSchema = z.object({
  latency: z.number().int().nonnegative().optional(),
  bandwidth: positiveIntSchema.optional(),
});

/**
 * VPN proxy session creation request schema
 */
export const vpnSessionRequestSchema = z.object({
  region: z.string().optional(),
  country: z.string().optional(),
  type: z.enum(['residential', 'datacenter', 'mobile']).optional(),
  duration: z.number().int().positive().optional(),
});

/**
 * VPN node params schema
 */
export const vpnNodeParamsSchema = z.object({
  id: z.string().uuid(),
});

/**
 * VPN session params schema
 */
export const vpnSessionParamsSchema = z.object({
  sessionId: z.string().uuid(),
});

/**
 * VPN nodes query schema
 */
export const vpnNodesQuerySchema = z.object({
  region: z.string().optional(),
  country: z.string().optional(),
  type: z.enum(['residential', 'datacenter', 'mobile']).optional(),
  status: z.enum(['active', 'inactive', 'maintenance']).default('active'),
});
