/**
 * Network detection - separated to avoid circular dependencies
 */
import {
  getChainId,
  getRpcUrl,
  getServicesConfig,
  type NetworkType,
} from '@jejunetwork/config'

/**
 * Detect network from browser hostname at RUNTIME
 * This is critical for deployed apps where the build might have wrong env vars
 */
function detectNetworkRuntime(): NetworkType {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname

    // Localhost or local IP → localnet
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.')
    ) {
      return 'localnet'
    }

    // Check for localnet subdomain FIRST (before mainnet check)
    if (hostname.includes('.local.jejunetwork.org')) {
      return 'localnet'
    }

    // Check for testnet subdomain
    if (
      hostname.includes('.testnet.jejunetwork.org') ||
      hostname === 'testnet.jejunetwork.org'
    ) {
      return 'testnet'
    }

    // Production jejunetwork.org domains → mainnet (only if not localnet/testnet)
    if (hostname.endsWith('.jejunetwork.org')) {
      return 'mainnet'
    }
  }

  // Fallback to localnet for SSR or unknown
  return 'localnet'
}

// Network from runtime hostname detection
export const NETWORK: NetworkType = detectNetworkRuntime()
export const NETWORK_NAME = 'Jeju'

// Chain configuration from config
export const CHAIN_ID = getChainId(NETWORK)
export const RPC_URL = getRpcUrl(NETWORK)

// Service URLs from config
const services = getServicesConfig(NETWORK)
export const INDEXER_URL = services.indexer.graphql || ''
export const EXPLORER_URL = services.explorer || ''
export const OIF_AGGREGATOR_URL = services.oif.aggregator || ''
