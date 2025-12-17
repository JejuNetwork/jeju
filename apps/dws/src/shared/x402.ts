/**
 * x402 Payment Middleware
 * Shared payment handling for Git and Pkg services
 */

import type { Context, MiddlewareHandler } from 'hono';
import type { Address } from 'viem';

export interface PaymentConfig {
  paymentRecipient: Address;
  networkId: number;
  assetAddress: Address;
  baseUrl: string;
}

export interface PaymentRequirement {
  x402Version: number;
  error: string;
  accepts: Array<{
    scheme: 'exact' | 'streaming';
    network: string;
    maxAmountRequired: string;
    asset: Address;
    payTo: Address;
    resource: string;
    description: string;
  }>;
}

export interface PaymentProof {
  txHash: string;
  amount: string;
  asset: Address;
  payer: Address;
  timestamp: number;
}

export interface PricingRule {
  resource: string; // Path pattern like '/git/repos' or '/pkg/publish'
  method?: string;
  baseCost: bigint; // In wei
  perUnitCost?: bigint; // Optional per-unit pricing (e.g., per MB)
  unitKey?: string; // Header or query param for unit count
  description: string;
  freeForTiers?: string[]; // Tiers that get this free
}

// Base costs in wei (on Base network, ~$0.001 per gwei)
const NETWORK_FEE_GWEI = 100n; // ~$0.0001 network cost
const NODE_FEE_GWEI = 50n; // ~$0.00005 node provider fee

export function calculatePrice(
  baseCost: bigint,
  units: number = 1
): { total: bigint; breakdown: { base: bigint; network: bigint; node: bigint } } {
  const base = baseCost * BigInt(units);
  const network = NETWORK_FEE_GWEI * BigInt(units);
  const node = NODE_FEE_GWEI * BigInt(units);

  return {
    total: base + network + node,
    breakdown: { base, network, node },
  };
}

export function create402Response(
  requirement: PaymentRequirement,
  headers?: Record<string, string>
): Response {
  const body = JSON.stringify(requirement);

  return new Response(body, {
    status: 402,
    headers: {
      'Content-Type': 'application/json',
      'X-Payment-Required': 'true',
      ...headers,
    },
  });
}

export function createPaymentRequirement(
  config: PaymentConfig,
  amount: bigint,
  resource: string,
  description: string
): PaymentRequirement {
  return {
    x402Version: 1,
    error: 'Payment required',
    accepts: [
      {
        scheme: 'exact',
        network: `eip155:${config.networkId}`,
        maxAmountRequired: amount.toString(),
        asset: config.assetAddress,
        payTo: config.paymentRecipient,
        resource: `${config.baseUrl}${resource}`,
        description,
      },
    ],
  };
}

/**
 * Verify a payment proof
 * In production, would verify the transaction on-chain
 */
export async function verifyPayment(
  proof: PaymentProof,
  expectedAmount: bigint,
  _expectedRecipient: Address
): Promise<{ valid: boolean; error?: string }> {
  // Basic validation
  if (!proof.txHash || proof.txHash.length !== 66) {
    return { valid: false, error: 'Invalid transaction hash' };
  }

  const proofAmount = BigInt(proof.amount);
  if (proofAmount < expectedAmount) {
    return { valid: false, error: `Insufficient payment: expected ${expectedAmount}, got ${proofAmount}` };
  }

  // In production: verify on-chain that:
  // 1. Transaction exists and is confirmed
  // 2. Amount and recipient match
  // 3. Transaction is recent (not replay)
  // 4. Asset matches expected token

  return { valid: true };
}

/**
 * Parse payment proof from request headers
 */
export function parsePaymentProof(c: Context): PaymentProof | null {
  const proofHeader = c.req.header('X-Payment-Proof');
  if (!proofHeader) return null;

  const [txHash, amount, asset, payer, timestamp] = proofHeader.split(':');
  if (!txHash || !amount) return null;

  return {
    txHash,
    amount,
    asset: (asset || '0x0') as Address,
    payer: (payer || '0x0') as Address,
    timestamp: parseInt(timestamp || '0'),
  };
}

/**
 * x402 middleware factory
 */
export function x402Middleware(
  config: PaymentConfig,
  rules: PricingRule[],
  getUserTier?: (address: Address) => Promise<string>
): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path;
    const method = c.req.method;

    // Find matching rule
    const rule = rules.find(r => {
      const pathMatch = path.startsWith(r.resource) || path.match(new RegExp(r.resource.replace('*', '.*')));
      const methodMatch = !r.method || r.method === method;
      return pathMatch && methodMatch;
    });

    // No pricing rule = free
    if (!rule) {
      await next();
      return;
    }

    // Check if user's tier gets this free
    const userAddress = c.req.header('X-Jeju-Address') as Address | undefined;
    if (userAddress && rule.freeForTiers && getUserTier) {
      const tier = await getUserTier(userAddress);
      if (rule.freeForTiers.includes(tier)) {
        await next();
        return;
      }
    }

    // Calculate cost
    let units = 1;
    if (rule.unitKey) {
      const unitValue = c.req.header(rule.unitKey) || c.req.query(rule.unitKey);
      if (unitValue) {
        units = parseInt(unitValue) || 1;
      }
    }

    const { total } = calculatePrice(rule.baseCost, units);

    // Check for payment proof
    const proof = parsePaymentProof(c);
    if (proof) {
      const verification = await verifyPayment(proof, total, config.paymentRecipient);
      if (verification.valid) {
        // Payment verified, proceed
        c.set('paymentVerified', true);
        c.set('paymentAmount', proof.amount);
        await next();
        return;
      }
    }

    // No valid payment, return 402
    const requirement = createPaymentRequirement(config, total, path, rule.description);
    return create402Response(requirement);
  };
}

// ============ Predefined Pricing Rules ============

export const GIT_PRICING_RULES: PricingRule[] = [
  {
    resource: '/git/repos',
    method: 'POST',
    baseCost: 1000000000000000n, // 0.001 ETH for private repo
    description: 'Create private repository',
    freeForTiers: ['basic', 'pro', 'unlimited'],
  },
  {
    resource: '/git/*/push',
    method: 'POST',
    baseCost: 100000000000n, // 0.0000001 ETH per MB
    perUnitCost: 100000000000n,
    unitKey: 'Content-Length',
    description: 'Push to repository (per MB)',
    freeForTiers: ['pro', 'unlimited'],
  },
  {
    resource: '/git/*/issues',
    method: 'POST',
    baseCost: 10000000000000n, // 0.00001 ETH to create issue
    description: 'Create issue',
    freeForTiers: ['basic', 'pro', 'unlimited'],
  },
  {
    resource: '/git/*/pulls',
    method: 'POST',
    baseCost: 50000000000000n, // 0.00005 ETH to create PR
    description: 'Create pull request',
    freeForTiers: ['basic', 'pro', 'unlimited'],
  },
];

export const PKG_PRICING_RULES: PricingRule[] = [
  {
    resource: '/pkg/-/v1/login',
    method: 'PUT',
    baseCost: 0n, // Free
    description: 'Package registry login',
  },
  {
    resource: '/pkg/@*/[^/]+$', // Scoped package publish
    method: 'PUT',
    baseCost: 500000000000000n, // 0.0005 ETH to publish
    description: 'Publish scoped package',
    freeForTiers: ['basic', 'pro', 'unlimited'],
  },
  {
    resource: '/pkg/[^@/]+$', // Unscoped package publish
    method: 'PUT',
    baseCost: 1000000000000000n, // 0.001 ETH for unscoped
    description: 'Publish unscoped package',
    freeForTiers: ['pro', 'unlimited'],
  },
];

// ============ Tier Definitions ============

export interface TierDefinition {
  name: string;
  monthlyPrice: bigint;
  features: {
    privateRepos: number;
    privatePackages: number;
    storageGB: number;
    bandwidthGB: number;
    collaborators: number;
  };
}

export const TIERS: Record<string, TierDefinition> = {
  free: {
    name: 'Free',
    monthlyPrice: 0n,
    features: {
      privateRepos: 0,
      privatePackages: 0,
      storageGB: 1,
      bandwidthGB: 10,
      collaborators: 3,
    },
  },
  basic: {
    name: 'Basic',
    monthlyPrice: 5000000000000000000n, // 5 ETH/month (~$15)
    features: {
      privateRepos: 10,
      privatePackages: 10,
      storageGB: 10,
      bandwidthGB: 100,
      collaborators: 10,
    },
  },
  pro: {
    name: 'Pro',
    monthlyPrice: 15000000000000000000n, // 15 ETH/month (~$45)
    features: {
      privateRepos: 100,
      privatePackages: 100,
      storageGB: 100,
      bandwidthGB: 1000,
      collaborators: 50,
    },
  },
  unlimited: {
    name: 'Unlimited',
    monthlyPrice: 50000000000000000000n, // 50 ETH/month (~$150)
    features: {
      privateRepos: -1, // Unlimited
      privatePackages: -1,
      storageGB: 1000,
      bandwidthGB: -1,
      collaborators: -1,
    },
  },
};

/**
 * Calculate tier subscription cost
 */
export function getTierPrice(tier: string, months: number = 1): bigint {
  const tierDef = TIERS[tier];
  if (!tierDef) return 0n;
  return tierDef.monthlyPrice * BigInt(months);
}

/**
 * Check if tier allows a feature
 */
export function tierAllows(tier: string, feature: keyof TierDefinition['features'], count: number): boolean {
  const tierDef = TIERS[tier];
  if (!tierDef) return false;

  const limit = tierDef.features[feature];
  return limit === -1 || count <= limit;
}

