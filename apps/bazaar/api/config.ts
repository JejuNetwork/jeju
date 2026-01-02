/**
 * Bazaar App Configuration
 * Dynamic config injection for DWS/workerd compatibility
 *
 * All config is resolved from:
 * 1. Environment variables
 * 2. Network-based config from @jejunetwork/config
 * 3. On-chain registry (future: JNS-based discovery)
 */

import {
  createAppConfig,
  getCoreAppUrl,
  getCurrentNetwork,
  getEnvVar,
} from '@jejunetwork/config'

export interface BazaarConfig {
  // API
  bazaarApiUrl: string

  // Messaging (resolved from env vars - decentralized services don't need hardcoded URLs)
  farcasterHubUrl: string
  mpcSignerUrl: string

  // SQLit Database
  sqlitDatabaseId: string
  sqlitPrivateKey?: string
}

// Get network-aware config
const network = getCurrentNetwork()

const { config, configure: setBazaarConfig } = createAppConfig<BazaarConfig>({
  bazaarApiUrl: getEnvVar('BAZAAR_API_URL') ?? getCoreAppUrl('BAZAAR_API'),
  // Messaging URLs are resolved from env vars - no hardcoded fallbacks for decentralization
  farcasterHubUrl: getEnvVar('FARCASTER_HUB_URL') ?? '',
  mpcSignerUrl: getEnvVar('MPC_SIGNER_URL') ?? '',
  // Database ID uses network-aware naming for isolation
  sqlitDatabaseId: getEnvVar('SQLIT_DATABASE_ID') ?? `bazaar-${network}`,
  sqlitPrivateKey: getEnvVar('SQLIT_PRIVATE_KEY'),
})

export { config }

export function configureBazaar(updates: Partial<BazaarConfig>): void {
  setBazaarConfig(updates)
}
