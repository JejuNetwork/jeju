/**
 * x402 Payment Protocol for Documentation
 * Standalone implementation for documentation-specific payment tiers
 */

type Address = `0x${string}`

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

export interface PaymentScheme {
  scheme: string
  network: string
  maxAmountRequired: string
  resource: string
  description: string
  payTo: Address
  asset: Address
  maxTimeoutSeconds: number
  mimeType: string
  extra?: Record<string, string>
}

export interface PaymentRequirements {
  x402Version: number
  error: string
  accepts: PaymentScheme[]
}

type Network = 'base-sepolia' | 'base' | 'jeju' | 'jeju-testnet'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

export function createPaymentRequirement(
  resource: string,
  amount: bigint,
  description: string,
  recipientAddress: Address,
  tokenAddress: Address = ZERO_ADDRESS,
  network: Network = 'jeju',
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
        extra: {
          serviceName: 'Documentation',
        },
      },
    ],
  }
}
