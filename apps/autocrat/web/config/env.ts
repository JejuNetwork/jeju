/**
 * Autocrat Environment Configuration
 *
 * Uses @jejunetwork/config for centralized configuration.
 * For production: build with Bun.build define option to override values.
 *
 * Note: Import from here instead of accessing env vars directly.
 */
import {
  getChainId,
  getContract,
  getCurrentNetwork,
  getOAuth3Url,
  getRpcUrl,
  getServiceUrl,
} from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'

// Network defaults - from centralized config
export const NETWORK = getCurrentNetwork()
export const CHAIN_ID = getChainId(NETWORK)
export const RPC_URL = getRpcUrl(NETWORK)

// External services - from config, empty means use relative URLs (same origin)
export const AUTOCRAT_API_URL =
  getServiceUrl('compute', 'nodeApi', NETWORK) || ''
export const OAUTH3_AGENT_URL = getOAuth3Url(NETWORK)

// Contract addresses
export const AUTOCRAT_ADDRESS =
  (getContract('governance', 'autocrat', NETWORK) as `0x${string}`) ||
  ZERO_ADDRESS

// WalletConnect - disabled by default in development
export const WALLETCONNECT_PROJECT_ID =
  NETWORK === 'localnet'
    ? ''
    : (process.env.PUBLIC_WALLETCONNECT_PROJECT_ID ?? '')
