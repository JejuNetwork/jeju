/**
 * API Marketplace
 *
 * Decentralized API key marketplace with TEE-backed secure key vault
 */

// Access Control
export { getRateLimitUsage } from './access-control'

// Key Vault
export {
  deleteKey,
  getKeysByOwner,
  getVaultStats,
  storeKey,
} from './key-vault'

// Payments
export {
  calculateAffordableRequests,
  getAccountInfo,
  getBalance,
  getMinimumDeposit,
  parsePaymentProof,
  processDeposit,
  processWithdraw,
} from './payments'

// Providers
export {
  getAllProviders,
  getConfiguredProviders,
  getProviderById,
} from './providers'

// Proxy Router
export { checkProviderHealth, proxyRequest } from './proxy-router'
// Registry
export {
  createListing,
  findCheapestListing,
  getAllListings,
  getAllProviderHealth,
  getListing,
  getListingsByProvider,
  getListingsBySeller,
  getMarketplaceStats,
  updateListing,
} from './registry'
// Types
export type { APIProvider, ProxyRequest, ProxyResponse } from './types'

// Types
export * from './types'

// Initialize

import { initializeDWSState } from '../state.js'
import * as keyVault from './key-vault.js'
import * as registry from './registry.js'

/**
 * Initialize the API marketplace
 * Must be called before using any marketplace functions
 */
export async function initializeMarketplace(): Promise<void> {
  // Initialize state first (ensures CQL is ready)
  await initializeDWSState()

  // Load system keys from environment
  keyVault.loadSystemKeys()

  // Create system listings for configured providers
  await registry.initializeSystemListings()

  console.log('[API Marketplace] Initialized')
}
