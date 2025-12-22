/**
 * Indexer x402 Payment Module
 * 
 * Local implementation for indexer-specific payment tiers.
 */

import { parseEther } from 'viem';
import type { Address } from 'viem';
import { z } from 'zod';
import { addressSchema, validateOrThrow } from './validation';

// ============ Types ============

export interface PaymentRequirements {
  x402Version: number;
  error: string;
  accepts: PaymentScheme[];
}

export interface PaymentScheme {
  scheme: 'exact' | 'upto';
  network: X402Network;
  maxAmountRequired: string;
  asset: Address;
  payTo: Address;
  resource: string;
  description: string;
  mimeType: string;
  outputSchema: string | null;
  maxTimeoutSeconds: number;
  extra?: Record<string, string>;
}

export interface PaymentPayload {
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  amount: string;
  resource: string;
  nonce: string;
  timestamp: number;
  signature?: string;
}

export type X402Network = 'sepolia' | 'ethereum' | 'jeju' | 'jeju-testnet' | 'base' | 'base-sepolia';

// ============ Network Configuration ============

export const CHAIN_IDS: Record<X402Network, number> = {
  sepolia: 11155111,
  'base-sepolia': 84532,
  ethereum: 1,
  base: 8453,
  jeju: 420691,
  'jeju-testnet': 420690,
};

export const RPC_URLS: Record<X402Network, string> = {
  sepolia: 'https://ethereum-sepolia-rpc.publicnode.com',
  'base-sepolia': 'https://sepolia.base.org',
  ethereum: 'https://eth.llamarpc.com',
  base: 'https://mainnet.base.org',
  jeju: process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545',
  'jeju-testnet': process.env.JEJU_TESTNET_RPC_URL || 'https://testnet-rpc.jejunetwork.org',
};

export const USDC_ADDRESSES: Record<X402Network, Address> = {
  sepolia: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  jeju: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
  'jeju-testnet': '0x0000000000000000000000000000000000000000',
};

// ============ Indexer-Specific Payment Tiers ============

export const INDEXER_PAYMENT_TIERS = {
  QUERY_BASIC: parseEther('0.001'),
  QUERY_COMPLEX: parseEther('0.005'),
  HISTORICAL_DATA: parseEther('0.01'),
  BULK_EXPORT: parseEther('0.05'),
  SUBSCRIPTION_DAILY: parseEther('0.1'),
  SUBSCRIPTION_MONTHLY: parseEther('2.0'),
} as const;

// ============ Stub Functions ============

const paymentPayloadSchema = z.object({
  scheme: z.string().min(1),
  network: z.string().min(1),
  asset: addressSchema,
  payTo: addressSchema,
  amount: z.string().regex(/^\d+$/, 'Amount must be a string representation of a positive integer'),
  resource: z.string().min(1),
  nonce: z.string().min(1),
  timestamp: z.number().int().positive(),
  signature: z.string().optional(),
});

export function verifyPayment(payload: PaymentPayload): boolean {
  if (!payload) {
    throw new Error('Payment payload is required');
  }
  const result = paymentPayloadSchema.safeParse(payload);
  return result.success;
}

export function parsePaymentHeader(header: string): PaymentPayload | null {
  if (!header || typeof header !== 'string' || header.trim().length === 0) {
    return null;
  }
  try {
    const decoded = Buffer.from(header, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    const validated = paymentPayloadSchema.parse(parsed);
    return validated;
  } catch {
    return null;
  }
}

export function checkPayment(payload: PaymentPayload): { valid: boolean; error?: string } {
  if (!payload) {
    return { valid: false, error: 'Payment payload is required' };
  }
  try {
    paymentPayloadSchema.parse(payload);
    return { valid: true };
  } catch (error) {
    if (error instanceof Error) {
      return { valid: false, error: error.message };
    }
    return { valid: false, error: 'Invalid payment payload' };
  }
}

export function createBasePaymentRequirement(
  recipientAddress: Address,
  resource: string,
  description: string,
  amount: bigint,
  network: X402Network = 'jeju'
): PaymentRequirements {
  if (!recipientAddress || typeof recipientAddress !== 'string') {
    throw new Error('recipientAddress is required and must be a string');
  }
  validateOrThrow(addressSchema, recipientAddress, 'createBasePaymentRequirement recipientAddress');
  
  if (!resource || typeof resource !== 'string' || resource.trim().length === 0) {
    throw new Error('resource is required and must be a non-empty string');
  }
  
  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    throw new Error('description is required and must be a non-empty string');
  }
  
  if (typeof amount !== 'bigint' || amount <= 0n) {
    throw new Error(`Invalid amount: ${amount}. Must be a positive bigint.`);
  }
  
  if (!Object.keys(CHAIN_IDS).includes(network)) {
    throw new Error(`Invalid network: ${network}. Must be one of: ${Object.keys(CHAIN_IDS).join(', ')}`);
  }
  
  return {
    x402Version: 1,
    error: 'Payment Required',
    accepts: [{
      scheme: 'exact',
      network,
      maxAmountRequired: amount.toString(),
      asset: USDC_ADDRESSES[network],
      payTo: recipientAddress,
      resource,
      description,
      mimeType: 'application/json',
      outputSchema: null,
      maxTimeoutSeconds: 300,
    }],
  };
}

export function signPaymentPayload(payload: PaymentPayload, privateKey: string): string {
  if (!payload) {
    throw new Error('payload is required');
  }
  if (!privateKey || typeof privateKey !== 'string' || privateKey.trim().length === 0) {
    throw new Error('privateKey is required and must be a non-empty string');
  }
  paymentPayloadSchema.parse(payload);
  return ''; // Stub
}

export function generate402Headers(requirements: PaymentRequirements): Record<string, string> {
  return {
    'WWW-Authenticate': `X402 ${Buffer.from(JSON.stringify(requirements)).toString('base64')}`,
  };
}

/**
 * Create indexer-specific payment requirement
 */
export function createIndexerPaymentRequirement(
  resource: string,
  tier: keyof typeof INDEXER_PAYMENT_TIERS,
  recipientAddress: Address,
  description?: string
): PaymentRequirements {
  return createBasePaymentRequirement(
    recipientAddress,
    resource,
    description || `Indexer ${tier} access`,
    INDEXER_PAYMENT_TIERS[tier],
    'jeju'
  );
}
