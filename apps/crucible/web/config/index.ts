import {
  CORE_PORTS,
  getCurrentNetwork,
  getLocalhostHost,
  getServicesConfig,
  type NetworkType,
} from '@jejunetwork/config'

export const NETWORK_NAME = 'Jeju Network'

// IMPORTANT: Do NOT call getCurrentNetwork() at module level!
// In bundled apps, env vars may not be set when the module is first evaluated.
// Use lazy getter function instead.
function getNetwork(): NetworkType {
  return getCurrentNetwork()
}

// Crucible API runs on the executor port (4021)
export const CRUCIBLE_PORT = CORE_PORTS.CRUCIBLE_API.DEFAULT
export const CRUCIBLE_API_PORT = CORE_PORTS.CRUCIBLE_EXECUTOR.DEFAULT

/**
 * Get the API base URL based on current environment
 * In production, uses the centralized services config (crucible.api URL)
 * In development, uses localhost
 */
function getApiBaseUrl(): string {
  const localhost = getLocalhostHost()

  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname

    // Local development - use localhost with proper port
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.local.jejunetwork.org')
    ) {
      return `http://${localhost}:${CRUCIBLE_API_PORT}`
    }

    // Production/testnet - use the centralized services config
    // The frontend is served from IPFS/CDN, but API is on a separate server
    if (hostname.endsWith('.jejunetwork.org')) {
      const services = getServicesConfig()
      // Use the executor URL since that's where the main API runs
      return services.crucible.executor
    }
  }

  // Fallback for SSR/node - use local URLs
  return `http://${localhost}:${CRUCIBLE_API_PORT}`
}

export const API_URL = getApiBaseUrl()

/**
 * Get the redirect URI for OAuth callbacks
 */
function getRedirectUri(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/auth/callback`
  }
  // Fallback for SSR
  return 'http://localhost:4020/auth/callback'
}

// Chain IDs for Jeju networks
const CHAIN_IDS = {
  localnet: 31337, // Anvil/Foundry default
  testnet: 420690,
  mainnet: 420691,
} as const

/**
 * Get the OAuth3 TEE agent URL based on environment
 * In browser on localnet, use the proxy domain to avoid CORS issues
 */
function getOAuth3TeeUrl(): string {
  const services = getServicesConfig()
  const network = getNetwork()

  // In browser on localnet, use the proxy domain to avoid CORS
  if (
    typeof window !== 'undefined' &&
    network === 'localnet' &&
    window.location.hostname.endsWith('.local.jejunetwork.org')
  ) {
    // Use same port as the current page (proxy handles routing)
    const port = window.location.port ? `:${window.location.port}` : ''
    return `http://oauth3.local.jejunetwork.org${port}`
  }

  return services.oauth3.tee
}

/**
 * OAuth3 configuration for wallet authentication
 * Called at runtime to ensure network is detected correctly
 */
export function getOAuth3Config() {
  const services = getServicesConfig()
  const network = getNetwork()

  return {
    appId: 'crucible',
    appName: 'Crucible',
    // Redirect URI for OAuth callbacks
    redirectUri: getRedirectUri(),
    // OAuth3 TEE agent URL - use proxy URL in browser to avoid CORS
    teeAgentUrl: getOAuth3TeeUrl(),
    // RPC URL for on-chain interactions - use network-appropriate URL
    rpcUrl: services.rpc.l2,
    // Chain ID for the current network - prevents defaulting to localnet
    chainId: CHAIN_IDS[network],
    // Enable decentralized discovery via JNS
    decentralized: network !== 'localnet',
    // Network for chain interactions
    network,
  }
}

// Export getter function for network (lazy evaluation)
export { getNetwork }
