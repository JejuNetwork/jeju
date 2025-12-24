/**
 * Token Registry Hook
 * Wraps @jejunetwork/ui hooks with bazaar-specific config
 */

import {
  useTokenConfig as useTokenConfigBase,
  useTokenRegistry as useTokenRegistryBase,
} from '@jejunetwork/ui'
import type { Address } from 'viem'

// Token registry address from env: PUBLIC_TOKEN_REGISTRY_ADDRESS
const TOKEN_REGISTRY_ADDRESS = (process.env.PUBLIC_TOKEN_REGISTRY_ADDRESS ??
  '0x0000000000000000000000000000000000000000') as Address

export function useTokenRegistry() {
  return useTokenRegistryBase(TOKEN_REGISTRY_ADDRESS)
}

export function useTokenConfig(tokenAddress: Address | undefined) {
  return useTokenConfigBase(TOKEN_REGISTRY_ADDRESS, tokenAddress)
}
