/**
 * Bazaar App Configuration
 * Dynamic config injection for DWS/workerd compatibility
 *
 * SECURITY: Secrets are retrieved through the secrets module.
 * Never expose secrets through environment variables in client code.
 *
 * All config is resolved from:
 * 1. Secrets module (for sensitive data)
 * 2. Environment variables (for non-sensitive config)
 * 3. Network-based config from @jejunetwork/config
 * 4. On-chain registry (future: JNS-based discovery)
 */

import {
  createAppConfig,
  getCoreAppUrl,
  getCurrentNetwork,
  getEnvVar,
} from '@jejunetwork/config'
import { getSqlitPrivateKey } from '../lib/secrets'

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
  // SQLit private key retrieved through secrets module (not raw env var)
  sqlitPrivateKey: getSqlitPrivateKey(),
})

export { config }

export function configureBazaar(updates: Partial<BazaarConfig>): void {
  setBazaarConfig(updates)
}
