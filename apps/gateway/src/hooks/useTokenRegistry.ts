/**
 * Token Registry Hook
 * Re-exports from @jejunetwork/ui with gateway-specific config
 */

import {
  useTokenRegistry as useTokenRegistryBase,
  useTokenConfig as useTokenConfigBase,
  type TokenInfo,
  type TokenConfig,
} from '@jejunetwork/ui';
import { CONTRACTS } from '../config';

export type { TokenInfo, TokenConfig };

export function useTokenRegistry() {
  return useTokenRegistryBase(CONTRACTS.tokenRegistry);
}

export function useTokenConfig(tokenAddress: `0x${string}` | undefined) {
  return useTokenConfigBase(CONTRACTS.tokenRegistry, tokenAddress);
}

