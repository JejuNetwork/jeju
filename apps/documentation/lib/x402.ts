import type { PaymentRequirements, X402Network } from '@jejunetwork/shared'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address } from 'viem'

export type { PaymentRequirements }

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
