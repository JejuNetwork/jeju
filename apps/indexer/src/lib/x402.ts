/**
 * Indexer x402 Payment Module
 * 
 * Re-exports shared x402 implementation with indexer-specific payment tiers.
 * Uses EIP-712 signatures for proper payment verification.
 */

import { parseEther } from 'viem';
import type { Address } from 'viem';

// Re-export from shared implementation
export {
  verifyPayment,
  parsePaymentHeader,
  checkPayment,
  createPaymentRequirement as createBasePaymentRequirement,
  signPaymentPayload,
  generate402Headers,
  CHAIN_IDS,
  RPC_URLS,
  USDC_ADDRESSES,
  type PaymentRequirements,
  type PaymentPayload,
  type PaymentScheme,
  type X402Network,
} from '../../../../scripts/shared/x402';

// ============ Indexer-Specific Payment Tiers ============

export const INDEXER_PAYMENT_TIERS = {
  QUERY_BASIC: parseEther('0.001'),
  QUERY_COMPLEX: parseEther('0.005'),
  HISTORICAL_DATA: parseEther('0.01'),
  BULK_EXPORT: parseEther('0.05'),
  SUBSCRIPTION_DAILY: parseEther('0.1'),
  SUBSCRIPTION_MONTHLY: parseEther('2.0'),
} as const;

/**
 * Create indexer-specific payment requirement
 */
export function createIndexerPaymentRequirement(
  resource: string,
  tier: keyof typeof INDEXER_PAYMENT_TIERS,
  recipientAddress: Address,
  description?: string
) {
  const { createPaymentRequirement: create } = require('../../../../scripts/shared/x402');
  return create(
    recipientAddress,
    resource,
    description || `Indexer ${tier} access`,
    INDEXER_PAYMENT_TIERS[tier],
    'jeju'
  );
}
