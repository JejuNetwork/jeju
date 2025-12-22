/**
 * Zod schemas for VPN server validation
 * 
 * All inputs and outputs are validated with fail-fast patterns
 */

import { z } from 'zod';
import { getAddress, type Address, type Hex } from 'viem';

// ============================================================================
// Address Validation
// ============================================================================

const AddressSchema = z.string().transform((val): Address => {
  return getAddress(val) as Address;
});

const HexSchema = z.string().refine(
  (val): val is Hex => {
    return /^0x[a-fA-F0-9]+$/.test(val) && val.length >= 2;
  },
  { error: 'Invalid hex string' }
).transform((val) => val as Hex);

// ============================================================================
// VPN Node Schemas
// ============================================================================

export const VPNNodeStatusSchema = z.enum(['online', 'busy', 'offline']);

export const VPNNodeStateSchema = z.object({
  nodeId: z.string().min(1, 'Node ID required'),
  operator: AddressSchema,
  countryCode: z.string().length(2, 'Country code must be 2 characters').toUpperCase(),
  region: z.string().min(1, 'Region required'),
  endpoint: z.string().min(1, 'Endpoint required'),
  wireguardPubKey: z.string().min(1, 'WireGuard public key required'),
  status: VPNNodeStatusSchema,
  activeConnections: z.number().int().nonnegative('Active connections cannot be negative'),
  maxConnections: z.number().int().positive('Max connections must be positive'),
  latencyMs: z.number().int().nonnegative('Latency cannot be negative'),
}).strict();

// ============================================================================
// Session Schemas
// ============================================================================

export const VPNProtocolSchema = z.enum(['wireguard', 'socks5', 'http']);

// VPNSessionState schema - BigInt fields accept bigint or numeric strings
export const VPNSessionStateSchema = z.object({
  sessionId: z.string().min(1, 'Session ID required'),
  clientAddress: AddressSchema,
  nodeId: z.string().min(1, 'Node ID required'),
  protocol: VPNProtocolSchema,
  startTime: z.number().int().positive('Start time must be positive'),
  bytesUp: z.union([
    z.bigint(),
    z.string().regex(/^\d+$/).transform(s => BigInt(s)),
    z.number().int().nonnegative().transform(n => BigInt(n)),
  ]),
  bytesDown: z.union([
    z.bigint(),
    z.string().regex(/^\d+$/).transform(s => BigInt(s)),
    z.number().int().nonnegative().transform(n => BigInt(n)),
  ]),
  isPaid: z.boolean(),
  paymentAmount: z.union([
    z.bigint(),
    z.string().regex(/^\d+$/).transform(s => BigInt(s)),
    z.number().int().nonnegative().transform(n => BigInt(n)),
  ]),
}).strict();

// ============================================================================
// Contribution Schemas
// ============================================================================

// ContributionState schema - BigInt fields accept bigint or numeric strings
export const ContributionStateSchema = z.object({
  address: AddressSchema,
  bytesUsed: z.union([
    z.bigint(),
    z.string().regex(/^\d+$/).transform(s => BigInt(s)),
    z.number().int().nonnegative().transform(n => BigInt(n)),
  ]),
  bytesContributed: z.union([
    z.bigint(),
    z.string().regex(/^\d+$/).transform(s => BigInt(s)),
    z.number().int().nonnegative().transform(n => BigInt(n)),
  ]),
  cap: z.union([
    z.bigint(),
    z.string().regex(/^\d+$/).transform(s => BigInt(s)),
    z.number().int().nonnegative().transform(n => BigInt(n)),
  ]),
  periodStart: z.number().int().positive('Period start must be positive'),
  periodEnd: z.number().int().positive('Period end must be positive'),
}).strict().refine(
  (data) => data.periodEnd > data.periodStart,
  { error: 'Period end must be after period start', path: ['period_end'] }
);

// ============================================================================
// Pricing Schemas
// ============================================================================

export const VPNPricingSchema = z.object({
  pricePerGB: z.string().regex(/^\d+$/, 'Price per GB must be numeric string'),
  pricePerHour: z.string().regex(/^\d+$/, 'Price per hour must be numeric string'),
  pricePerRequest: z.string().regex(/^\d+$/, 'Price per request must be numeric string'),
  supportedTokens: z.array(AddressSchema).min(1, 'At least one supported token required'),
}).strict();

// ============================================================================
// Server Config Schema
// ============================================================================

export const VPNServerConfigSchema = z.object({
  publicUrl: z.string().url('Invalid public URL'),
  port: z.number().int().min(1).max(65535, 'Port must be between 1 and 65535'),
  chainId: z.number().int().positive('Chain ID must be positive'),
  rpcUrl: z.string().url('Invalid RPC URL'),
  coordinatorUrl: z.string().url('Invalid coordinator URL'),
  contracts: z.object({
    vpnRegistry: AddressSchema,
    vpnBilling: AddressSchema,
    x402Facilitator: AddressSchema,
  }).strict(),
  paymentRecipient: AddressSchema,
  pricing: VPNPricingSchema,
}).strict();

export type VPNServerConfig = z.infer<typeof VPNServerConfigSchema>;
export type VPNPricing = z.infer<typeof VPNPricingSchema>;
export type VPNNodeState = z.infer<typeof VPNNodeStateSchema>;

// Types with BigInt - need manual type definitions since Zod transforms don't preserve BigInt in type inference
export interface VPNSessionState {
  sessionId: string;
  clientAddress: Address;
  nodeId: string;
  protocol: 'wireguard' | 'socks5' | 'http';
  startTime: number;
  bytesUp: bigint;
  bytesDown: bigint;
  isPaid: boolean;
  paymentAmount: bigint;
}

export interface ContributionState {
  address: Address;
  bytesUsed: bigint;
  bytesContributed: bigint;
  cap: bigint;
  periodStart: number;
  periodEnd: number;
}

// ============================================================================
// Query Parameter Schemas
// ============================================================================

export const NodesQuerySchema = z.object({
  country: z.string().length(2).toUpperCase().optional(),
  capability: z.string().optional(),
}).strict();

export const SessionQuerySchema = z.object({
  sessionId: z.string().min(1, 'Session ID required'),
}).strict();

// ============================================================================
// Request/Response Schemas
// ============================================================================

export const ConnectRequestSchema = z.object({
  nodeId: z.string().min(1).optional(),
  countryCode: z.string().length(2).toUpperCase().optional(),
  protocol: VPNProtocolSchema.optional(),
}).strict();

export const DisconnectRequestSchema = z.object({
  sessionId: z.string().min(1, 'Session ID required'),
}).strict();

export const ProxyRequestSchema = z.object({
  url: z.string().url('Invalid URL'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']).default('GET'),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  countryCode: z.string().length(2).toUpperCase().optional(),
}).strict();

export const ContributionSettingsRequestSchema = z.object({
  enabled: z.boolean().optional(),
  maxBandwidthPercent: z.number().min(0).max(100, 'Max bandwidth percent must be between 0 and 100').optional(),
  shareCDN: z.boolean().optional(),
  shareVPNRelay: z.boolean().optional(),
  earningMode: z.boolean().optional(),
}).strict();

// ============================================================================
// A2A Schemas
// ============================================================================

export const A2AMessagePartSchema = z.object({
  kind: z.enum(['text', 'data']),
  text: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
}).strict().refine(
  (part) => {
    if (part.kind === 'text') return typeof part.text === 'string';
    if (part.kind === 'data') return typeof part.data === 'object' && part.data !== null;
    return false;
  },
  { error: 'Part must have appropriate content for its kind' }
);

export const A2AMessageSchema = z.object({
  role: z.enum(['user', 'agent']),
  parts: z.array(A2AMessagePartSchema).min(1, 'Message must have at least one part'),
  messageId: z.string().min(1, 'Message ID required'),
}).strict();

export const A2ARequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string().min(1, 'Method required'),
  params: z.object({
    message: A2AMessageSchema,
  }).strict(),
  id: z.number().int(),
}).strict();

// ============================================================================
// MCP Schemas
// ============================================================================

export const MCPResourceReadSchema = z.object({
  uri: z.string().min(1, 'URI required'),
}).strict();

// Tool argument schemas for type safety
export const VPNConnectArgsSchema = z.object({
  countryCode: z.string().length(2).toUpperCase().optional(),
  protocol: z.enum(['wireguard', 'socks5', 'http']).optional(),
}).strict();

export const VPNDisconnectArgsSchema = z.object({
  connectionId: z.string().min(1, 'Connection ID required'),
}).strict();

export const GetNodesArgsSchema = z.object({
  countryCode: z.string().length(2).toUpperCase().optional(),
}).strict();

export const GetContributionArgsSchema = z.object({}).strict();

// Union of all tool argument types
export const MCPToolArgsSchema = z.union([
  VPNConnectArgsSchema,
  VPNDisconnectArgsSchema,
  GetNodesArgsSchema,
  ProxyRequestSchema,
  GetContributionArgsSchema,
]);

export const MCPToolCallSchema = z.object({
  name: z.string().min(1, 'Tool name required'),
  arguments: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.record(z.string(), z.string())])),
}).strict();

export const MCPPromptGetSchema = z.object({
  name: z.string().min(1, 'Prompt name required'),
  arguments: z.record(z.string(), z.string()).optional(),
}).strict();

// ============================================================================
// x402 Payment Schemas
// ============================================================================

export const X402PaymentPayloadSchema = z.object({
  scheme: z.enum(['exact', 'upto']),
  network: z.string().min(1, 'Network required'),
  payTo: AddressSchema,
  amount: z.string().regex(/^\d+$/, 'Amount must be numeric string'),
  asset: AddressSchema,
  resource: z.string().min(1, 'Resource required'),
  nonce: z.string().min(1, 'Nonce required'),
  timestamp: z.number().int().positive('Timestamp must be positive'),
  signature: HexSchema,
}).strict();

export const X402VerifyRequestSchema = z.object({
  paymentHeader: z.string().min(1, 'Payment header required'),
  resource: z.string().min(1, 'Resource required'),
  amount: z.string().regex(/^\d+$/, 'Amount must be numeric string'),
}).strict();

export const X402CreateHeaderRequestSchema = z.object({
  resource: z.string().min(1, 'Resource required'),
  amount: z.string().regex(/^\d+$/, 'Amount must be numeric string'),
  signature: HexSchema,
  payer: AddressSchema,
}).strict();

// ============================================================================
// Auth Schemas
// ============================================================================

export const AuthHeadersSchema = z.object({
  'x-jeju-address': AddressSchema,
  'x-jeju-timestamp': z.string().regex(/^\d+$/, 'Timestamp must be numeric string'),
  'x-jeju-signature': HexSchema,
}).strict();

// ============================================================================
// Helper Functions - Re-export from shared
// ============================================================================

export { expectValid, expectExists, expect, getExists } from '../shared/validation';
