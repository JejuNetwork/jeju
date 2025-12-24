/**
 * API Marketplace
 *
 * Decentralized API key marketplace with TEE-backed secure key vault
 */

// Access Control
export {
  type AccessCheckResult,
  AccessControlBuilder,
  accessControl,
  checkAccess,
  checkRateLimit,
  getRateLimitUsage,
  incrementRateLimit,
  isDomainAllowed,
  isEndpointAllowed,
  isMethodAllowed,
} from './access-control'
// Container Deployment
export {
  type APIDeployment,
  addKMSKey,
  addSecretRef,
  type ContainerSpec,
  createDeployment,
  DEPLOYMENT_TEMPLATES,
  type DeploymentType,
  deleteDeployment,
  deploy,
  getDeployment,
  getLogs as getDeploymentLogs,
  getMarketplaceDeploymentStats,
  getTemplates,
  listDeployments,
  listToMarketplace,
  recordRequest as recordDeploymentRequest,
  stopDeployment,
  unlistFromMarketplace,
  updateDeployment,
  type WorkerSpec,
} from './container-deployment'
// Key Vault
export {
  decryptKeyForRequest,
  deleteKey,
  getAccessLog,
  getAccessLogByRequester,
  getKeyMetadata,
  getKeysByOwner,
  getVaultStats,
  hasSystemKey,
  loadSystemKeys,
  rotateKey,
  storeKey,
  type VaultStats,
  verifyAttestation,
} from './key-vault'
// Payments
export {
  calculateAffordableRequests,
  calculateRevenueShare,
  configurePayments,
  create402Response,
  estimateCost,
  getAccountInfo,
  getBalance,
  getMinimumDeposit,
  getPlatformFeeBps,
  meetsMinimumDeposit,
  type PaymentConfig,
  parsePaymentProof,
  processDeposit,
  processWithdraw,
  verifyPaymentProof,
} from './payments'
// Providers
export {
  ALL_PROVIDERS,
  getConfiguredProviders,
  getProvider,
  getProvidersByCategory,
  isProviderConfigured,
  PROVIDERS_BY_CATEGORY,
  PROVIDERS_BY_ID,
} from './providers'
// Proxy Router
export {
  checkProviderHealth,
  type ProxyOptions,
  proxyRequest,
  proxyStreamingRequest,
} from './proxy-router'
// Registry
export {
  type CreateListingParams,
  canAfford,
  chargeUser,
  createListing,
  deposit,
  findCheapestListing,
  getAccount,
  getActiveListings,
  getAllListings,
  getAllProviderHealth,
  getAllProviders,
  getListing,
  getListingsByProvider,
  getListingsBySeller,
  getMarketplaceStats,
  getOrCreateAccount,
  getProviderById,
  getProviderHealth,
  initializeSystemListings,
  recordRequest,
  updateListing,
  updateProviderHealth,
  withdraw,
} from './registry'
// Sanitizer
export {
  checkForLeaks,
  createSanitizationConfig,
  DEFAULT_KEY_PATTERNS,
  extractPotentialKeys,
  mightContainKey,
  REDACT_PATHS,
  STRIP_HEADERS,
  sanitizeHeaders,
  sanitizeObject,
  sanitizeResponse,
  sanitizeString,
} from './sanitizer'
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
