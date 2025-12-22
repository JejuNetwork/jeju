'use client'

/**
 * Paymaster Factory Hook
 * Re-exports from @jejunetwork/ui with bazaar-specific config
 */

import {
  type PaymasterDeployment,
  usePaymasterDeployment as usePaymasterDeploymentBase,
  usePaymasterFactory as usePaymasterFactoryBase,
} from '@jejunetwork/ui'
import type { Address } from 'viem'

// TODO: Get from bazaar config when available
const PAYMASTER_FACTORY_ADDRESS =
  '0x0000000000000000000000000000000000000000' as Address

export type { PaymasterDeployment }

export function usePaymasterFactory() {
  return usePaymasterFactoryBase(PAYMASTER_FACTORY_ADDRESS)
}

export function usePaymasterDeployment(tokenAddress: Address | undefined) {
  return usePaymasterDeploymentBase(PAYMASTER_FACTORY_ADDRESS, tokenAddress)
}
