/**
 * Paymaster Factory Hook
 * Wraps @jejunetwork/ui hooks with bazaar-specific config
 */

import {
  usePaymasterDeployment as usePaymasterDeploymentBase,
  usePaymasterFactory as usePaymasterFactoryBase,
} from '@jejunetwork/ui'
import type { Address } from 'viem'

// Paymaster factory address from env: PUBLIC_PAYMASTER_FACTORY_ADDRESS
const PAYMASTER_FACTORY_ADDRESS = (process.env
  .PUBLIC_PAYMASTER_FACTORY_ADDRESS ??
  '0x0000000000000000000000000000000000000000') as Address

export function usePaymasterFactory() {
  return usePaymasterFactoryBase(PAYMASTER_FACTORY_ADDRESS)
}

export function usePaymasterDeployment(tokenAddress: Address | undefined) {
  return usePaymasterDeploymentBase(PAYMASTER_FACTORY_ADDRESS, tokenAddress)
}
