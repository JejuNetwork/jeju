/**
 * x402 Payment Protocol for Documentation
 * Re-exports shared implementation with Documentation-specific payment tiers
 */

import { parseEther, type Address } from 'viem';
import { createPaymentRequirement as sharedCreatePaymentRequirement } from '../../../scripts/shared/x402';

export {
  type PaymentRequirements,
  type PaymentScheme,
  type PaymentPayload,
  parsePaymentHeader,
  checkPayment,
} from '../../../scripts/shared/x402';

export const PAYMENT_TIERS = {
  PREMIUM_DOCS: parseEther('0.01'),
  API_DOCS: parseEther('0.005'),
  TUTORIALS: parseEther('0.02'),
  EXAMPLES: parseEther('0.01'),
} as const;

type Network = 'base-sepolia' | 'base' | 'jeju' | 'jeju-testnet';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export function createPaymentRequirement(
  resource: string,
  amount: bigint,
  description: string,
  recipientAddress: Address,
  tokenAddress: Address = ZERO_ADDRESS,
  network: Network = 'jeju'
) {
  return sharedCreatePaymentRequirement(
    resource,
    amount,
    description,
    { recipientAddress, network, serviceName: 'Documentation' },
    tokenAddress
  );
}
