/**
 * Token Registry Hook
 * Re-exports from @jejunetwork/ui with gateway-specific config
 */

import {
  type TokenConfig,
  type TokenInfo,
  useTokenConfig as useTokenConfigBase,
  useTokenRegistry as useTokenRegistryBase,
} from '@jejunetwork/ui'
import { CONTRACTS } from '../config'

export type { TokenInfo, TokenConfig }

export function useTokenRegistry() {
  return useTokenRegistryBase(CONTRACTS.tokenRegistry)
}

export function useTokenConfig(tokenAddress: `0x${string}` | undefined) {
  return useTokenConfigBase(CONTRACTS.tokenRegistry, tokenAddress)
}
