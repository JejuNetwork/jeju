/**
 * DWS Web Frontend Configuration
 *
 * Uses @jejunetwork/config for all configuration.
 */

import {
  getChainId,
  getContractsConfig,
  getCurrentNetwork,
  getDWSUrl,
  getOAuth3Url,
  getRpcUrl,
  type NetworkType,
} from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address } from 'viem'

// Network from config
export const NETWORK: NetworkType = getCurrentNetwork()

// Chain configuration from config
export const CHAIN_ID = getChainId(NETWORK)
export const RPC_URL = getRpcUrl(NETWORK)
export const DWS_API_URL = getDWSUrl(NETWORK)
export const OAUTH3_AGENT_URL = getOAuth3Url(NETWORK)

// Contract addresses from config
const contracts = getContractsConfig(NETWORK)

export const CONTRACTS = {
  identityRegistry: (contracts.registry.identity as Address) || ZERO_ADDRESS,
  banManager: (contracts.moderation.banManager as Address) || ZERO_ADDRESS,
  moderationMarketplace:
    (contracts.moderation.moderationMarketplace as Address) || ZERO_ADDRESS,
  reportingSystem:
    (contracts.moderation.reportingSystem as Address) || ZERO_ADDRESS,
  computeRegistry: (contracts.compute.registry as Address) || ZERO_ADDRESS,
  jnsRegistry: (contracts.jns.registry as Address) || ZERO_ADDRESS,
  jnsResolver: (contracts.jns.resolver as Address) || ZERO_ADDRESS,
  x402Facilitator:
    (contracts.payments.x402Facilitator as Address) || ZERO_ADDRESS,
} as const

export const API_ENDPOINTS = {
  health: '/health',
  storage: '/storage',
  compute: '/compute',
  containers: '/containers',
  workers: '/workers',
  cdn: '/cdn',
  git: '/git',
  pkg: '/pkg',
  ci: '/ci',
  kms: '/kms',
  vpn: '/vpn',
  rpc: '/rpc',
  api: '/api',
  oauth3: '/oauth3',
  rlaif: '/rlaif',
  scraping: '/scraping',
} as const
