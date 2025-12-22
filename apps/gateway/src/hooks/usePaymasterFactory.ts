/**
 * Paymaster Factory Hook
 * Re-exports from @jejunetwork/ui with gateway-specific config
 */

import {
  type PaymasterDeployment,
  usePaymasterDeployment as usePaymasterDeploymentBase,
  usePaymasterFactory as usePaymasterFactoryBase,
} from '@jejunetwork/ui'
import { CONTRACTS } from '../config'

export type { PaymasterDeployment }

export function usePaymasterFactory() {
  return usePaymasterFactoryBase(CONTRACTS.paymasterFactory)
}

export function usePaymasterDeployment(
  tokenAddress: `0x${string}` | undefined,
) {
  return usePaymasterDeploymentBase(CONTRACTS.paymasterFactory, tokenAddress)
}
