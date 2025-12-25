/**
 * Moderation contract addresses for browser
 *
 * Uses @jejunetwork/config for all configuration.
 */

import { getContractsConfig, getCurrentNetwork } from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address } from 'viem'

interface ModerationContractAddresses {
  moderationMarketplace: Address
  banManager: Address
  identityRegistry: Address
}

function getContractsForNetwork(
  network: 'mainnet' | 'testnet' | 'localnet',
): ModerationContractAddresses {
  const contracts = getContractsConfig(network)

  return {
    moderationMarketplace:
      (contracts.moderation?.moderationMarketplace as Address) || ZERO_ADDRESS,
    banManager:
      (contracts.moderation?.banManager as Address) || ZERO_ADDRESS,
    identityRegistry:
      (contracts.registry?.identity as Address) || ZERO_ADDRESS,
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

export function getContracts(): ModerationContractAddresses {
  return MODERATION_CONTRACTS[getCurrentNetwork()]
}
