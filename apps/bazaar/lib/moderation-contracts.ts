/**
 * Moderation contract addresses for browser
 */

import { isHexString } from '@jejunetwork/types'
import type { Address } from 'viem'

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

/** Parse env var as Address or return zero address */
function parseEnvAddress(value: string | undefined): Address {
  if (!value || !isHexString(value)) {
    return ZERO_ADDRESS
  }
  return value
}

interface ModerationContractAddresses {
  moderationMarketplace: Address
  banManager: Address
  identityRegistry: Address
}

export const MODERATION_CONTRACTS: {
  mainnet: ModerationContractAddresses
  testnet: ModerationContractAddresses
} = {
  mainnet: {
    moderationMarketplace: parseEnvAddress(
      import.meta.env?.VITE_MODERATION_MARKETPLACE_ADDRESS,
    ),
    banManager: parseEnvAddress(import.meta.env?.VITE_BAN_MANAGER_ADDRESS),
    identityRegistry: parseEnvAddress(
      import.meta.env?.VITE_IDENTITY_REGISTRY_ADDRESS,
    ),
  },
  testnet: {
    moderationMarketplace: parseEnvAddress(
      import.meta.env?.VITE_MODERATION_MARKETPLACE_ADDRESS,
    ),
    banManager: parseEnvAddress(import.meta.env?.VITE_BAN_MANAGER_ADDRESS),
    identityRegistry: parseEnvAddress(
      import.meta.env?.VITE_IDENTITY_REGISTRY_ADDRESS,
    ),
  },
}

function getCurrentNetwork(): 'mainnet' | 'testnet' {
  const network = import.meta.env?.VITE_NETWORK || 'testnet'
  return network === 'mainnet' ? 'mainnet' : 'testnet'
}

export function getContracts(): ModerationContractAddresses {
  return MODERATION_CONTRACTS[getCurrentNetwork()]
}
