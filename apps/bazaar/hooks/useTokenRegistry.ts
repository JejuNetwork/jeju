'use client'

/**
 * Token Registry Hook
 * Re-exports from @jejunetwork/ui with bazaar-specific config
 */

import {
  type TokenConfig,
  type TokenInfo,
  useTokenConfig as useTokenConfigBase,
  useTokenRegistry as useTokenRegistryBase,
} from '@jejunetwork/ui'
import type { Address } from 'viem'

// TODO: Get from bazaar config when available
const TOKEN_REGISTRY_ADDRESS =
  '0x0000000000000000000000000000000000000000' as Address

export type { TokenInfo, TokenConfig }

export function useTokenRegistry() {
  return useTokenRegistryBase(TOKEN_REGISTRY_ADDRESS)
}

export function useTokenConfig(tokenAddress: Address | undefined) {
  return useTokenConfigBase(TOKEN_REGISTRY_ADDRESS, tokenAddress)
}
