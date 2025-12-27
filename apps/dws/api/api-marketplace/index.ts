/**
 * API Marketplace
 *
 * Decentralized API key marketplace with TEE-backed secure key vault
 */

// Access Control
export {
  accessControl,
  checkAccess,
  checkRateLimit,
  getRateLimitUsage,
  incrementRateLimit,
  isDomainAllowed,
  isEndpointAllowed,
  isMethodAllowed,
} from './access-control'

// Key Vault
export {
  decryptKeyForRequest,
  deleteKey,
  getKeyMetadata,
  getKeysByOwner,
  getVaultStats,
  storeKey,
} from './key-vault'

// Payments
export {
  calculateAffordableRequests,
  calculateRevenueShare,
  create402Response,
  getAccountInfo,
  getBalance,
  getMinimumDeposit,
  meetsMinimumDeposit,
  parsePaymentProof,
  processDeposit,
  processWithdraw,
} from './payments'

// Providers
export {
  getAllProviders,
  getConfiguredProviders,
  getProviderById,
  getProvidersByCategory,
} from './providers'

// Proxy Router
export { checkProviderHealth, proxyRequest } from './proxy-router'

// Registry
export {
  canAfford,
  chargeUser,
  createListing,
  deposit,
  findCheapestListing,
  getAllListings,
  getAllProviderHealth,
  getListing,
  getListingsByProvider,
  getListingsBySeller,
  getMarketplaceStats,
  getOrCreateAccount,
  initializeSystemListings,
  updateListing,
  withdraw,
} from './registry'
// Sanitizer
export {
  checkForLeaks,
  createSanitizationConfig,
  extractPotentialKeys,
  mightContainKey,
  sanitizeObject,
  sanitizeResponse,
  sanitizeString,
} from './sanitizer'

// Types
export type { APIProvider, ProxyRequest, ProxyResponse } from './types'
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
  // Initialize state first (ensures EQLite is ready)
  await initializeDWSState()

  // Load system keys from environment
  keyVault.loadSystemKeys()

  // Create system listings for configured providers
  await registry.initializeSystemListings()

  console.log('[API Marketplace] Initialized')
}
