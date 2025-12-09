/**
 * x402 Payment Protocol for Gateway
 * Re-exports shared implementation with Gateway-specific payment tiers
 */

import { parseEther } from 'viem';

// Re-export all core x402 functionality from shared
export {
  type PaymentRequirements,
  type PaymentScheme,
  type PaymentPayload,
  type SettlementResponse,
  type X402Network,
  type X402Config,
  CHAIN_IDS,
  RPC_URLS,
  USDC_ADDRESSES,
  getEIP712Domain,
  getEIP712Types,
  createPaymentPayload,
  parsePaymentHeader,
  verifyPayment,
  signPaymentPayload,
  checkPayment,
  calculatePercentageFee,
  generate402Headers,
} from '../../../../scripts/shared/x402';

// Import for re-export with extension
import { createPaymentRequirement as sharedCreatePaymentRequirement } from '../../../../scripts/shared/x402';
import type { Address } from 'viem';

// ============ Gateway-Specific Payment Tiers ============

export const PAYMENT_TIERS = {
  // Node Operations
  NODE_REGISTRATION: parseEther('0.05'),
  PAYMASTER_DEPLOYMENT: parseEther('0.1'),
  
  // API Access
  API_BASIC: parseEther('0.0001'),
  API_PREMIUM: parseEther('0.001'),
  PREMIUM_API_DAILY: parseEther('0.2'),
  PREMIUM_API_MONTHLY: parseEther('5.0'),
  
  // Liquidity Operations
  LIQUIDITY_ADD: parseEther('0.001'),
  LIQUIDITY_REMOVE: parseEther('0.0005'),
} as const;

// ============ Gateway-Specific Wrapper ============

/**
 * Create payment requirement with Gateway defaults
 */
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
    serviceName: 'Gateway',
  }, tokenAddress);
}
