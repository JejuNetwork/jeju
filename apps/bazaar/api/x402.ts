import { createX402PaymentRequirement } from '@jejunetwork/shared'
import type { Address } from 'viem'
import { parseEther } from 'viem'

export {
  calculatePercentageFee,
  checkPayment,
  createPaymentPayload,
  generate402Headers,
  getEIP712Domain,
  getEIP712Types,
  isValidPaymentPayload,
  type PaymentPayload,
  type PaymentRequirements,
  type PaymentScheme,
  parsePaymentHeader,
  type SettlementResponse,
  signPaymentPayload,
  type UntrustedPaymentPayload,
  USDC_ADDRESSES,
  verifyPayment,
  X402_CHAIN_IDS as CHAIN_IDS,
  X402_RPC_URLS as RPC_URLS,
  type X402Network,
  type X402PaymentConfig as X402Config,
} from '@jejunetwork/shared'

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
} as const

export function createPaymentRequirement(
  resource: string,
  amount: bigint,
  description: string,
  recipientAddress: Address,
  tokenAddress: Address = '0x0000000000000000000000000000000000000000',
  network: 'base-sepolia' | 'base' | 'jeju' | 'jeju-testnet' = 'jeju',
) {
  return createX402PaymentRequirement(
    resource,
    amount,
    description,
    {
      recipientAddress,
      network,
      serviceName: 'Bazaar',
    },
    tokenAddress,
  )
}
