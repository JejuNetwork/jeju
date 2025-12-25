import { createX402PaymentRequirement } from '@jejunetwork/shared'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address } from 'viem'
import { parseEther } from 'viem'

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
  return createX402PaymentRequirement(
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
