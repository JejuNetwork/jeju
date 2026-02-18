import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address } from 'viem'

/**
 * Intentionally keep these payment protocol types local to documentation.
 * Importing them from `@jejunetwork/shared` pulled a second `elysia`
 * type graph into docs typechecking, triggering `AnyElysia` private-type
 * incompatibility.
 *
 * Keep these definitions intentionally in sync with
 * `packages/shared/src/x402.ts` when protocol shapes change.
 */
export type X402Network =
  | 'sepolia'
  | 'ethereum'
  | 'jeju'
  | 'jeju-testnet'
  | 'base'
  | 'base-sepolia'

export interface PaymentScheme {
  scheme: 'exact' | 'upto'
  network: X402Network
  maxAmountRequired: string
  resource: string
  description: string
  payTo: Address
  asset: Address
  maxTimeoutSeconds: number
  mimeType: string
  outputSchema: string | null
  extra?: Record<string, unknown>
}

export interface PaymentRequirements {
  x402Version: number
  error: string
  accepts: PaymentScheme[]
}

export const parseEther = (value: string): bigint => {
  const [whole, decimal = ''] = value.split('.')
  const paddedDecimal = decimal.padEnd(18, '0').slice(0, 18)
  return BigInt(whole + paddedDecimal)
}

export const PAYMENT_TIERS = {
  PREMIUM_DOCS: parseEther('0.01'),
  API_DOCS: parseEther('0.005'),
  TUTORIALS: parseEther('0.02'),
  EXAMPLES: parseEther('0.01'),
} as const

export function createPaymentRequirement(
  resource: string,
  amount: bigint,
  description: string,
  recipientAddress: Address,
  tokenAddress: Address = ZERO_ADDRESS,
  network: X402Network = 'jeju',
): PaymentRequirements {
  return {
    x402Version: 1,
    error: 'Payment required to access this resource',
    accepts: [
      {
        scheme: 'exact',
        network,
        maxAmountRequired: amount.toString(),
        resource,
        description,
        payTo: recipientAddress,
        asset: tokenAddress,
        maxTimeoutSeconds: 300,
        mimeType: 'application/json',
        outputSchema: null,
        extra: {
          serviceName: 'Documentation',
        },
      },
    ],
  }
}
