/**
 * x402 Payment Protocol for Documentation
 * Re-exports shared implementation with Documentation-specific payment tiers
 */

import { parseEther } from 'viem';

// Re-export core x402 functionality
export {
  type PaymentRequirements,
  type PaymentScheme,
  type PaymentPayload,
  parsePaymentHeader,
  checkPayment,
} from '../../../scripts/shared/x402';

import { createPaymentRequirement as sharedCreatePaymentRequirement } from '../../../scripts/shared/x402';
import type { Address } from 'viem';

// ============ Documentation-Specific Payment Tiers ============

export const PAYMENT_TIERS = {
  PREMIUM_DOCS: parseEther('0.01'),
  API_DOCS: parseEther('0.005'),
  TUTORIALS: parseEther('0.02'),
  EXAMPLES: parseEther('0.01'),
} as const;

// ============ Documentation-Specific Wrapper ============

export function createPaymentRequirement(
  resource: string,
  amount: bigint,
  description: string,
  recipientAddress: Address,
  tokenAddress: Address = '0x0000000000000000000000000000000000000000',
  network: 'base-sepolia' | 'base' | 'jeju' | 'jeju-testnet' = 'jeju'
) {
  return sharedCreatePaymentRequirement(resource, amount, description, {
    recipientAddress,
    network,
    serviceName: 'Documentation',
  }, tokenAddress);
}
