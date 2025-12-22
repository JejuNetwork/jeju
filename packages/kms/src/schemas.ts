/**
 * KMS Schemas - Zod validation for runtime type safety
 */

import { z } from 'zod';
import type { Address, Hex } from 'viem';

// Address and Hex validation
const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/) as z.ZodType<Address>;
const hexSchema = z.string().regex(/^0x[a-fA-F0-9]*$/) as z.ZodType<Hex>;

// Condition operator enum
const conditionOperatorSchema = z.enum(['=', '!=', '>', '<', '>=', '<=', 'contains']);

// Access condition schemas - strongly typed instead of z.record(z.unknown())
const contractConditionSchema = z.object({
  type: z.literal('contract'),
  contractAddress: addressSchema,
  chain: z.string().min(1),
  method: z.string().min(1),
  parameters: z.array(z.union([z.string(), z.number(), z.boolean()])),
  returnValueTest: z.object({
    comparator: conditionOperatorSchema,
    value: z.string(),
  }),
});

const timestampConditionSchema = z.object({
  type: z.literal('timestamp'),
  chain: z.string().min(1),
  comparator: conditionOperatorSchema,
  value: z.number().int(),
});

const balanceConditionSchema = z.object({
  type: z.literal('balance'),
  chain: z.string().min(1),
  tokenAddress: addressSchema.optional(),
  comparator: conditionOperatorSchema,
  value: z.string(),
});

const stakeConditionSchema = z.object({
  type: z.literal('stake'),
  registryAddress: addressSchema,
  chain: z.string().min(1),
  minStakeUSD: z.number(),
});

const roleConditionSchema = z.object({
  type: z.literal('role'),
  registryAddress: addressSchema,
  chain: z.string().min(1),
  role: z.string().min(1),
});

const agentConditionSchema = z.object({
  type: z.literal('agent'),
  registryAddress: addressSchema,
  chain: z.string().min(1),
  agentId: z.number().int(),
});

const accessConditionSchema = z.discriminatedUnion('type', [
  contractConditionSchema,
  timestampConditionSchema,
  balanceConditionSchema,
  stakeConditionSchema,
  roleConditionSchema,
  agentConditionSchema,
]);

const accessControlPolicySchema = z.object({
  conditions: z.array(accessConditionSchema).min(1, 'Access control policy must have at least one condition'),
  operator: z.enum(['and', 'or']),
});

// Config schemas
export const encryptionConfigSchema = z.object({
  debug: z.boolean().optional(),
});

export const teeConfigSchema = z.object({
  endpoint: z.string().url().optional(),
});

export const mpcConfigSchema = z.object({
  threshold: z.number().int().min(2),
  totalParties: z.number().int().min(2),
  coordinatorEndpoint: z.string().url().optional(),
});

export const kmsConfigSchema = z.object({
  providers: z.object({
    encryption: encryptionConfigSchema.optional(),
    tee: teeConfigSchema.optional(),
    mpc: mpcConfigSchema.optional(),
  }),
  defaultProvider: z.enum(['encryption', 'tee', 'mpc']),
  defaultChain: z.string().min(1),
  registryAddress: addressSchema.optional(),
  fallbackEnabled: z.boolean().optional(),
});

// Request schemas - using strongly typed accessControlPolicySchema
export const generateKeyOptionsSchema = z.object({
  type: z.enum(['encryption', 'signing', 'session']).optional(),
  curve: z.enum(['secp256k1', 'ed25519', 'bls12-381']).optional(),
  policy: accessControlPolicySchema,
  provider: z.enum(['encryption', 'tee', 'mpc']).optional(),
});

export const encryptRequestSchema = z.object({
  data: z.union([z.string(), z.instanceof(Uint8Array)]),
  policy: accessControlPolicySchema,
  keyId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const signRequestSchema = z.object({
  message: z.union([z.string(), z.instanceof(Uint8Array)]),
  keyId: z.string().min(1),
  hashAlgorithm: z.enum(['keccak256', 'sha256', 'none']).optional(),
});

export const thresholdSignRequestSchema = z.object({
  message: z.union([z.string(), z.instanceof(Uint8Array)]),
  keyId: z.string().min(1),
  threshold: z.number().int().min(2),
  totalParties: z.number().int().min(2),
  hashAlgorithm: z.enum(['keccak256', 'sha256']).optional(),
});

// Token schemas
export const tokenHeaderSchema = z.object({
  alg: z.string().min(1),
  typ: z.literal('JWT'),
});

export const tokenClaimsSchema = z.object({
  sub: z.string().min(1),
  iss: z.string().min(1),
  aud: z.string().min(1),
  iat: z.number().int().optional(),
  exp: z.number().int().optional(),
  jti: z.string().optional(),
  wallet: addressSchema.optional(),
  chainId: z.string().optional(),
  provider: z.string().optional(),
  scopes: z.array(z.string()).optional(),
}).catchall(z.union([z.string(), z.number(), z.array(z.string()), z.undefined()]));

export const tokenOptionsSchema = z.object({
  keyId: z.string().min(1).optional(),
  expiresInSeconds: z.number().int().positive().optional(),
});

export const verifyTokenOptionsSchema = z.object({
  issuer: z.string().min(1).optional(),
  audience: z.string().min(1).optional(),
  expectedSigner: addressSchema.optional(),
  allowExpired: z.boolean().optional(),
});

// Vault schemas
export const secretPolicySchema = z.object({
  allowedAddresses: z.array(addressSchema).optional(),
  allowedRoles: z.array(z.string()).optional(),
  minStake: z.bigint().optional(),
  expiresAt: z.number().int().optional(),
  maxAccessCount: z.number().int().positive().optional(),
  rotationInterval: z.number().int().positive().optional(),
});

export const vaultConfigSchema = z.object({
  encryptionKeyId: z.string().min(1).optional(),
  daEndpoint: z.string().url().optional(),
  auditLogging: z.boolean().default(true),
  autoRotateInterval: z.number().int().positive().optional(),
});

// MPC schemas
export const mpcPartySchema = z.object({
  id: z.string().min(1),
  index: z.number().int().min(1),
  endpoint: z.string().url(),
  publicKey: hexSchema,
  address: addressSchema,
  enclaveId: hexSchema.optional(),
  attestation: z.object({
    quote: hexSchema,
    measurement: hexSchema,
    timestamp: z.number().int(),
    verified: z.boolean(),
  }).optional(),
  stake: z.bigint(),
  registeredAt: z.number().int(),
});

export const mpcKeyGenParamsSchema = z.object({
  keyId: z.string().min(1),
  threshold: z.number().int().min(2),
  totalParties: z.number().int().min(2),
  partyIds: z.array(z.string().min(1)),
  curve: z.literal('secp256k1'),
  accessPolicy: z.object({
    type: z.enum(['open', 'allowlist', 'stake', 'role', 'contract']),
    allowlist: z.array(addressSchema).optional(),
    minStake: z.bigint().optional(),
    roles: z.array(z.string()).optional(),
    contractAddress: addressSchema.optional(),
    contractMethod: z.string().optional(),
  }).optional(),
}).refine(data => data.threshold <= data.totalParties, {
  message: 'Threshold cannot exceed total parties',
}).refine(data => data.partyIds.length === data.totalParties, {
  message: 'Party count must match totalParties',
});

export const mpcSignRequestSchema = z.object({
  keyId: z.string().min(1),
  message: hexSchema,
  messageHash: hexSchema,
  requester: addressSchema,
  accessProof: z.object({
    type: z.enum(['signature', 'merkle', 'stake', 'role']),
    proof: hexSchema,
    timestamp: z.number().int(),
  }).optional(),
});

export const mpcCoordinatorConfigSchema = z.object({
  threshold: z.number().int().min(2),
  totalParties: z.number().int().min(2),
  sessionTimeout: z.number().int().positive(),
  maxConcurrentSessions: z.number().int().positive(),
  requireAttestation: z.boolean(),
  minPartyStake: z.bigint(),
  network: z.enum(['localnet', 'testnet', 'mainnet']),
});

// TEE API response schemas for external endpoint validation
export const teeConnectResponseSchema = z.object({
  attestation: z.object({
    quote: hexSchema,
    measurement: hexSchema,
    timestamp: z.number().int(),
    verified: z.boolean(),
  }).optional(),
  enclaveKey: z.string().optional(),
});

export const teeKeyGenResponseSchema = z.object({
  publicKey: z.string().min(1),
  address: z.string().min(1),
});

export const teeSignResponseSchema = z.object({
  signature: z.string().min(1),
});

// DA API response schemas
export const daSecretsListResponseSchema = z.object({
  secrets: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    encryptedValue: z.string().min(1),
    keyId: z.string().min(1),
    version: z.number().int(),
    owner: addressSchema,
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
    expiresAt: z.number().int().optional(),
    tags: z.array(z.string()),
    metadata: z.record(z.string(), z.string()),
  })),
});

// Helper for parsing encrypted ciphertext - accepts hex with or without 0x prefix
// Empty strings are valid for encrypting empty data (ciphertext will be just "0x")
export const ciphertextPayloadSchema = z.object({
  ciphertext: z.string().regex(/^(0x)?[a-fA-F0-9]*$/),
  iv: z.string().regex(/^(0x)?[a-fA-F0-9]+$/),
  tag: z.string().regex(/^(0x)?[a-fA-F0-9]+$/),
  version: z.number().int().positive().optional(),
  mpc: z.boolean().optional(),
});

// Validation helpers
export function validateOrThrow<T>(schema: z.ZodSchema<T>, data: unknown, errorPrefix: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`${errorPrefix}: ${issues}`);
  }
  return result.data;
}

export function parseEnvInt(value: string | undefined, defaultValue?: number): number {
  if (value === undefined) {
    if (defaultValue === undefined) throw new Error('Environment variable required but not set');
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) throw new Error(`Invalid integer: ${value}`);
  return parsed;
}
