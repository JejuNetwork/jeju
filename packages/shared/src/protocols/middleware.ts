/**
 * Protocol Middleware - ERC-8004 Identity & x402 Payment Verification
 * 
 * Provides standardized middleware for:
 * - ERC-8004 agent identity verification
 * - Ban status checking via BanManager
 * - x402 payment verification and settlement
 * - Rate limiting with stake tiers
 */

import type { Context, Next } from 'hono';
import type { Address } from 'viem';
import { createPublicClient, http, verifyMessage, getAddress } from 'viem';
import { getChain } from '../chains';

// ============================================================================
// Types
// ============================================================================

export interface ERC8004Config {
  rpcUrl: string;
  identityRegistryAddress: Address;
  banManagerAddress?: Address;
  requireRegistration?: boolean;
  requireActive?: boolean;
}

export interface X402Config {
  network: string;
  facilitatorAddress?: Address;
  paymentRecipient: Address;
  maxPaymentAge?: number;
  supportedAssets?: Address[];
}

export interface PaymentRequirement {
  x402Version: number;
  scheme: 'exact' | 'upto';
  network: string;
  maxAmountRequired: string;
  asset: Address;
  payTo: Address;
  resource: string;
  description: string;
}

export interface SkillResult {
  message: string;
  data: Record<string, unknown>;
  requiresPayment?: PaymentRequirement;
}

export interface AgentInfo {
  agentId: bigint;
  owner: Address;
  name: string;
  active: boolean;
  a2aEndpoint: string;
  mcpEndpoint: string;
  tags: string[];
  banned: boolean;
  banReason?: string;
}

// ============================================================================
// ABI Fragments
// ============================================================================

const IDENTITY_REGISTRY_ABI = [
  {
    name: 'getAgentByAddress',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'agentId', type: 'uint256' },
        { name: 'owner', type: 'address' },
        { name: 'name', type: 'string' },
        { name: 'active', type: 'bool' },
        { name: 'a2aEndpoint', type: 'string' },
        { name: 'mcpEndpoint', type: 'string' },
      ],
    }],
  },
  {
    name: 'getAgentTags',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: 'tags', type: 'bytes32[]' }],
  },
] as const;

const BAN_MANAGER_ABI = [
  {
    name: 'isNetworkBanned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getNetworkBan',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'isBanned', type: 'bool' },
        { name: 'bannedAt', type: 'uint256' },
        { name: 'reason', type: 'string' },
        { name: 'proposalId', type: 'bytes32' },
      ],
    }],
  },
] as const;

// ============================================================================
// ERC-8004 Identity Verification
// ============================================================================

let erc8004Client: ReturnType<typeof createPublicClient> | null = null;
let erc8004Config: ERC8004Config | null = null;

export function configureERC8004(config: ERC8004Config): void {
  erc8004Config = config;
  erc8004Client = createPublicClient({
    chain: getChain(config.rpcUrl.includes('localhost') ? 'localnet' : 'testnet'),
    transport: http(config.rpcUrl),
  });
}

export async function getAgentInfo(address: Address): Promise<AgentInfo | null> {
  if (!erc8004Client || !erc8004Config) {
    throw new Error('ERC-8004 middleware not configured. Call configureERC8004() first.');
  }

  const agent = await erc8004Client.readContract({
    address: erc8004Config.identityRegistryAddress,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getAgentByAddress',
    args: [address],
  });

  if (!agent || agent.agentId === 0n) {
    return null;
  }

  // Get tags
  const tagsRaw = await erc8004Client.readContract({
    address: erc8004Config.identityRegistryAddress,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getAgentTags',
    args: [agent.agentId],
  });
  const tags = tagsRaw.map((t: `0x${string}`) => {
    const str = Buffer.from(t.slice(2), 'hex').toString('utf8');
    return str.replace(/\0/g, '');
  });

  // Check ban status if BanManager is configured
  let banned = false;
  let banReason: string | undefined;

  if (erc8004Config.banManagerAddress) {
    const banInfo = await erc8004Client.readContract({
      address: erc8004Config.banManagerAddress,
      abi: BAN_MANAGER_ABI,
      functionName: 'getNetworkBan',
      args: [agent.agentId],
    });
    banned = banInfo.isBanned;
    banReason = banInfo.reason;
  }

  return {
    agentId: agent.agentId,
    owner: agent.owner,
    name: agent.name,
    active: agent.active,
    a2aEndpoint: agent.a2aEndpoint,
    mcpEndpoint: agent.mcpEndpoint,
    tags,
    banned,
    banReason,
  };
}

export function erc8004Middleware(options: { requireRegistration?: boolean; requireActive?: boolean } = {}) {
  return async (c: Context, next: Next) => {
    const address = c.req.header('x-jeju-address') as Address | undefined;

    if (!address) {
      if (options.requireRegistration) {
        return c.json({ error: 'x-jeju-address header required' }, 401);
      }
      c.set('agentInfo', null);
      return next();
    }

    const agentInfo = await getAgentInfo(address);

    if (options.requireRegistration && !agentInfo) {
      return c.json({ error: 'Address not registered as ERC-8004 agent' }, 403);
    }

    if (agentInfo?.banned) {
      return c.json({ 
        error: 'Agent is banned from the network',
        reason: agentInfo.banReason,
      }, 403);
    }

    if (options.requireActive && agentInfo && !agentInfo.active) {
      return c.json({ error: 'Agent registration is not active' }, 403);
    }

    c.set('agentInfo', agentInfo);
    c.set('userAddress', address);
    return next();
  };
}

// ============================================================================
// x402 Payment Verification
// ============================================================================

let x402Config: X402Config | null = null;
const usedNonces = new Set<string>();

export function configureX402(config: X402Config): void {
  x402Config = config;
}

export function createPaymentRequirement(
  resource: string,
  amount: string,
  description: string,
  asset: Address = '0x0000000000000000000000000000000000000000' as Address,
): PaymentRequirement {
  if (!x402Config) {
    throw new Error('x402 middleware not configured. Call configureX402() first.');
  }

  return {
    x402Version: 1,
    scheme: 'exact',
    network: x402Config.network,
    maxAmountRequired: amount,
    asset,
    payTo: x402Config.paymentRecipient,
    resource,
    description,
  };
}

export interface X402PaymentPayload {
  scheme: string;
  network: string;
  amount: string;
  asset: Address;
  payTo: Address;
  resource: string;
  nonce: string;
  timestamp: number;
  signature: `0x${string}`;
}

export function parseX402Header(header: string): X402PaymentPayload | null {
  if (!header.startsWith('x402:')) return null;

  const parts = header.split(':');
  if (parts.length < 3) return null;

  const payloadB64 = parts[2];
  const payloadJson = Buffer.from(payloadB64, 'base64').toString('utf8');
  const payload = JSON.parse(payloadJson) as X402PaymentPayload;

  return payload;
}

export async function verifyX402Payment(
  paymentHeader: string,
  expectedAmount: bigint,
  expectedResource: string,
): Promise<{ valid: boolean; signer?: Address; error?: string }> {
  if (!x402Config) {
    throw new Error('x402 middleware not configured. Call configureX402() first.');
  }

  const payload = parseX402Header(paymentHeader);
  if (!payload) return { valid: false, error: 'Invalid payment header format' };

  // Validate timestamp
  const maxAge = x402Config.maxPaymentAge ?? 300;
  if (Math.abs(Date.now() / 1000 - payload.timestamp) > maxAge) {
    return { valid: false, error: 'Payment expired' };
  }

  // Validate amount
  if (BigInt(payload.amount) < expectedAmount) {
    return { valid: false, error: 'Insufficient payment amount' };
  }

  // Validate resource
  if (payload.resource !== expectedResource) {
    return { valid: false, error: 'Resource mismatch' };
  }

  // Validate recipient
  if (payload.payTo.toLowerCase() !== x402Config.paymentRecipient.toLowerCase()) {
    return { valid: false, error: 'Wrong payment recipient' };
  }

  // Validate nonce hasn't been used
  const nonceKey = `${payload.nonce}`;
  if (usedNonces.has(nonceKey)) {
    return { valid: false, error: 'Nonce already used' };
  }

  // Verify signature
  const message = `x402:${payload.scheme}:${payload.network}:${payload.payTo}:${payload.amount}:${payload.asset}:${payload.resource}:${payload.nonce}:${payload.timestamp}`;
  
  let signer: Address;
  try {
    const valid = await verifyMessage({
      address: getAddress(payload.payTo),
      message,
      signature: payload.signature,
    });
    if (!valid) {
      return { valid: false, error: 'Invalid signature' };
    }
    signer = payload.payTo;
  } catch {
    return { valid: false, error: 'Signature verification failed' };
  }

  // Mark nonce as used
  usedNonces.add(nonceKey);

  return { valid: true, signer };
}

export function x402Middleware(requiredAmount?: bigint) {
  return async (c: Context, next: Next) => {
    const paymentHeader = c.req.header('x-payment');
    
    if (!paymentHeader) {
      if (requiredAmount && requiredAmount > 0n) {
        const requirement = createPaymentRequirement(
          c.req.path,
          requiredAmount.toString(),
          'Payment required for this endpoint',
        );
        return c.json({
          error: 'Payment Required',
          x402: requirement,
        }, 402);
      }
      return next();
    }

    const result = await verifyX402Payment(
      paymentHeader,
      requiredAmount ?? 0n,
      c.req.path,
    );

    if (!result.valid) {
      return c.json({
        error: 'Payment verification failed',
        details: result.error,
      }, 402);
    }

    c.set('paymentSigner', result.signer);
    c.set('paymentVerified', true);
    return next();
  };
}

// ============================================================================
// Combined Middleware Helper
// ============================================================================

export interface ProtocolMiddlewareConfig {
  erc8004?: ERC8004Config & { requireRegistration?: boolean; requireActive?: boolean };
  x402?: X402Config;
}

export function configureProtocolMiddleware(config: ProtocolMiddlewareConfig): void {
  if (config.erc8004) {
    configureERC8004(config.erc8004);
  }
  if (config.x402) {
    configureX402(config.x402);
  }
}

// ============================================================================
// Skill Result Helpers
// ============================================================================

export function skillSuccess(message: string, data: Record<string, unknown>): SkillResult {
  return { message, data };
}

export function skillError(error: string, details?: Record<string, unknown>): SkillResult {
  return { message: error, data: { error, ...details } };
}

export function skillRequiresPayment(
  resource: string,
  amount: string,
  description: string,
  asset?: Address,
): SkillResult {
  return {
    message: 'Payment required',
    data: {},
    requiresPayment: createPaymentRequirement(resource, amount, description, asset),
  };
}

