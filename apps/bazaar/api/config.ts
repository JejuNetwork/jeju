/**
 * Bazaar App Configuration
 * Centralized config injection for workerd compatibility
 */

import { createAppConfig, getCoreAppUrl, getEnvVar } from '@jejunetwork/config'

export interface BazaarConfig {
  // API
  bazaarApiUrl: string

  // Messaging
  farcasterHubUrl: string
  mpcSignerUrl: string

  // EQLite Database
  eqliteDatabaseId: string
  eqlitePrivateKey?: string
}

const { config, configure: setBazaarConfig } = createAppConfig<BazaarConfig>({
  bazaarApiUrl: getEnvVar('BAZAAR_API_URL') ?? getCoreAppUrl('BAZAAR_API'),
  farcasterHubUrl: getEnvVar('FARCASTER_HUB_URL') ?? 'https://hub.pinata.cloud',
  mpcSignerUrl: getEnvVar('MPC_SIGNER_URL') ?? '',
  eqliteDatabaseId: getEnvVar('EQLITE_DATABASE_ID') ?? '',
  eqlitePrivateKey: getEnvVar('EQLITE_PRIVATE_KEY'),
})

export { config }

export function configureBazaar(updates: Partial<BazaarConfig>): void {
  setBazaarConfig(updates)
}
