/**
 * x402 Payment Protocol for Bazaar
 * Re-exports shared implementation with Bazaar-specific payment tiers
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
} from '../../../scripts/shared/x402';

// Import for re-export with extension
import { createPaymentRequirement as sharedCreatePaymentRequirement } from '../../../scripts/shared/x402';
import type { Address } from 'viem';

// ============ Bazaar-Specific Payment Tiers ============

export const PAYMENT_TIERS = {
  // NFT Marketplace
  NFT_LISTING: parseEther('0.001'),
  NFT_PURCHASE_FEE: 250, // 2.5% basis points
  
  // DeFi Operations
  SWAP_FEE: 30, // 0.3% basis points
  POOL_CREATION: parseEther('0.01'),
  LIQUIDITY_ADD: parseEther('0.0001'),
  
  // Token Launch
  TOKEN_DEPLOYMENT: parseEther('0.005'),
  
  // Prediction Markets
  MARKET_CREATION: parseEther('0.01'),
  TRADING_FEE: 50, // 0.5% basis points
  
  // API Access
  PREMIUM_API_DAILY: parseEther('0.1'),
  PREMIUM_API_MONTHLY: parseEther('2.0'),
  
  // Historical Data
  HISTORICAL_DATA: parseEther('0.05'),
} as const;

// ============ Bazaar-Specific Wrapper ============

/**
 * Create payment requirement with Bazaar defaults
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
    serviceName: 'Bazaar',
  }, tokenAddress);
}
