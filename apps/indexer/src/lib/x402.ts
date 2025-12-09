/**
 * x402 Payment Protocol for Indexer
 * Provides types and utilities for payment-gated API access
 */

import { parseEther } from 'viem';
import type { Address } from 'viem';

// ============ Types ============

export interface PaymentRequirements {
  version: string;
  resource: string;
  amount: string;
  asset: string;
  network: string;
  recipient: string;
  description: string;
  service: string;
  chainId: number;
}

export interface PaymentScheme {
  type: 'signature' | 'transfer' | 'permit';
  data: string;
}

export interface PaymentPayload {
  scheme: PaymentScheme;
  signature: string;
  nonce: string;
  timestamp: number;
}

// ============ Chain IDs ============

export const CHAIN_IDS = {
  'sepolia': 11155111,
  'ethereum': 1,
  'jeju': 420691,
  'jeju-testnet': 420690,
} as const;

// ============ Indexer-Specific Payment Tiers ============

export const PAYMENT_TIERS = {
  QUERY_BASIC: parseEther('0.001'),
  QUERY_COMPLEX: parseEther('0.005'),
  HISTORICAL_DATA: parseEther('0.01'),
  BULK_EXPORT: parseEther('0.05'),
  SUBSCRIPTION_DAILY: parseEther('0.1'),
  SUBSCRIPTION_MONTHLY: parseEther('2.0'),
} as const;

// ============ Utilities ============

/**
 * Parse x402 payment header from request
 */
export function parsePaymentHeader(header: string): PaymentPayload | null {
  if (!header || !header.startsWith('x402 ')) {
    return null;
  }
  const data = header.slice(5);
  return JSON.parse(Buffer.from(data, 'base64').toString('utf-8')) as PaymentPayload;
}

/**
 * Verify a payment payload
 */
export async function verifyPayment(payload: PaymentPayload, requirements: PaymentRequirements): Promise<boolean> {
  // Stub implementation - actual verification would check signatures, etc.
  return !!payload && !!requirements;
}

/**
 * Check if payment is required and verify if provided
 */
export async function checkPayment(
  header: string | undefined,
  requirements: PaymentRequirements
): Promise<{ valid: boolean; error?: string }> {
  if (!header) {
    return { valid: false, error: 'Payment required' };
  }

  const payload = parsePaymentHeader(header);
  if (!payload) {
    return { valid: false, error: 'Invalid payment header' };
  }

  const isValid = await verifyPayment(payload, requirements);
  if (!isValid) {
    return { valid: false, error: 'Payment verification failed' };
  }

  return { valid: true };
}

/**
 * Create a payment requirement for a resource
 */
export function createPaymentRequirement(
  resource: string,
  amount: bigint,
  description: string,
  recipientAddress: Address,
  tokenAddress: Address = '0x0000000000000000000000000000000000000000',
  network: 'base-sepolia' | 'base' | 'jeju' | 'jeju-testnet' = 'jeju'
): PaymentRequirements {
  return {
    version: '1.0',
    resource,
    amount: amount.toString(),
    asset: tokenAddress,
    network,
    recipient: recipientAddress,
    description,
    service: 'Indexer',
    chainId: CHAIN_IDS[network],
  };
}
