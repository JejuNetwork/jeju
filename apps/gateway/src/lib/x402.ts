import { parseEther } from 'viem'
import { ZERO_ADDRESS } from './contracts'

// Re-export all core x402 functionality from shared
export {
  CHAIN_IDS,
  calculatePercentageFee,
  checkPayment,
  createPaymentPayload,
  generate402Headers,
  getEIP712Domain,
  getEIP712Types,
  type PaymentPayload,
  type PaymentRequirements,
  type PaymentScheme,
  parsePaymentHeader,
  RPC_URLS,
  type SettlementResponse,
  signPaymentPayload,
  USDC_ADDRESSES,
  verifyPayment,
  type X402Config,
  type X402Network,
} from '@jejunetwork/deployment/scripts/shared/x402'

// Import for re-export with extension
import { createPaymentRequirement as sharedCreatePaymentRequirement } from '@jejunetwork/deployment/scripts/shared/x402'
import type { Address } from 'viem'

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
} as const

export function createPaymentRequirement(
  resource: string,
  amount: bigint,
  description: string,
  recipientAddress: Address,
  tokenAddress: Address = ZERO_ADDRESS,
  network: 'base-sepolia' | 'base' | 'jeju' | 'jeju-testnet' = 'jeju',
) {
  return sharedCreatePaymentRequirement(
    resource,
    amount,
    description,
    {
      recipientAddress,
      network,
      serviceName: 'Gateway',
    },
    tokenAddress,
  )
}
