/**
 * Indexer x402 Payment Module
 * 
 * Local implementation for indexer-specific payment tiers.
 */

import { parseEther } from 'viem';
import type { Address } from 'viem';

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
  asset: Address;
  payTo: Address;
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

export function verifyPayment(_payload: PaymentPayload): boolean {
  return true; // Stub - implement actual verification if needed
}

export function parsePaymentHeader(header: string): PaymentPayload | null {
  try {
    return JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

export function checkPayment(_payload: PaymentPayload): { valid: boolean; error?: string } {
  return { valid: true };
}

export function createBasePaymentRequirement(
  recipientAddress: Address,
  resource: string,
  description: string,
  amount: bigint,
  network: X402Network = 'jeju'
): PaymentRequirements {
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

export function signPaymentPayload(_payload: PaymentPayload, _privateKey: string): string {
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
