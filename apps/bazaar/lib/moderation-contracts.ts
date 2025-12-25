/**
 * Moderation contract addresses for browser
 *
 * Uses @jejunetwork/config for defaults with PUBLIC_ env overrides.
 */

import { getContractsConfig, getCurrentNetwork } from '@jejunetwork/config'
import { isHexString } from '@jejunetwork/types'
import type { Address } from 'viem'

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

/** Get env var from import.meta.env (browser) */
function getEnv(key: string): string | undefined {
  if (typeof import.meta?.env === 'object') {
    return import.meta.env[key] as string | undefined
  }
  return undefined
}

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

function getContractsForNetwork(network: 'mainnet' | 'testnet' | 'localnet'): ModerationContractAddresses {
  const contracts = getContractsConfig(network)

  return {
    moderationMarketplace:
      parseEnvAddress(getEnv('PUBLIC_MODERATION_MARKETPLACE_ADDRESS')) ||
      (contracts.moderation?.ModerationMarketplace as Address) ||
      ZERO_ADDRESS,
    banManager:
      parseEnvAddress(getEnv('PUBLIC_BAN_MANAGER_ADDRESS')) ||
      (contracts.moderation?.BanManager as Address) ||
      ZERO_ADDRESS,
    identityRegistry:
      parseEnvAddress(getEnv('PUBLIC_IDENTITY_REGISTRY_ADDRESS')) ||
      (contracts.registry?.IdentityRegistry as Address) ||
      ZERO_ADDRESS,
  }
}

export const MODERATION_CONTRACTS: {
  mainnet: ModerationContractAddresses
  testnet: ModerationContractAddresses
  localnet: ModerationContractAddresses
} = {
  mainnet: getContractsForNetwork('mainnet'),
  testnet: getContractsForNetwork('testnet'),
  localnet: getContractsForNetwork('localnet'),
}

function getCurrentNetworkType(): 'mainnet' | 'testnet' | 'localnet' {
  const envNetwork = getEnv('PUBLIC_NETWORK')
  if (envNetwork === 'mainnet' || envNetwork === 'testnet' || envNetwork === 'localnet') {
    return envNetwork
  }
  return getCurrentNetwork()
}

export function getContracts(): ModerationContractAddresses {
  return MODERATION_CONTRACTS[getCurrentNetworkType()]
}
