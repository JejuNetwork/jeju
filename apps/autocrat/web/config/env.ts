/**
 * Autocrat Environment Configuration
 *
 * For development: uses hardcoded defaults (localnet)
 * For production: build with Bun.build define option to replace values
 *
 * Note: Import from here instead of accessing env vars directly.
 */
import { ZERO_ADDRESS } from '@jejunetwork/types'

// Network defaults - localnet for development
// Production builds should use Bun.build with define option to replace these
export const NETWORK: 'localnet' | 'testnet' | 'mainnet' = 'localnet'
export const CHAIN_ID = 1337
export const RPC_URL = 'http://localhost:6546'

// External services - empty string means use relative URLs (same origin)
export const AUTOCRAT_API_URL = ''
export const OAUTH3_AGENT_URL = 'http://localhost:4200'

// Contract addresses
export const AUTOCRAT_ADDRESS = ZERO_ADDRESS

// WalletConnect - disabled by default in development
export const WALLETCONNECT_PROJECT_ID = ''
