/**
 * API Marketplace
 *
 * Decentralized API key marketplace with TEE-backed secure key vault
 */

// Types
export * from './types';

// Providers
export {
  ALL_PROVIDERS,
  PROVIDERS_BY_ID,
  PROVIDERS_BY_CATEGORY,
  getProvider,
  getProvidersByCategory,
  getConfiguredProviders,
  isProviderConfigured,
} from './providers';

// Registry
export {
  createListing,
  getListing,
  getAllListings,
  getListingsByProvider,
  getListingsBySeller,
  getActiveListings,
  updateListing,
  recordRequest,
  getOrCreateAccount,
  getAccount,
  deposit,
  withdraw,
  chargeUser,
  canAfford,
  updateProviderHealth,
  getProviderHealth,
  getAllProviderHealth,
  getMarketplaceStats,
  getAllProviders,
  getProviderById,
  findCheapestListing,
  initializeSystemListings,
  type CreateListingParams,
} from './registry';

// Key Vault
export {
  storeKey,
  getKeyMetadata,
  deleteKey,
  getKeysByOwner,
  decryptKeyForRequest,
  loadSystemKeys,
  hasSystemKey,
  getAccessLog,
  getAccessLogByRequester,
  verifyAttestation,
  rotateKey,
  getVaultStats,
  type VaultStats,
} from './key-vault';

// Sanitizer
export {
  DEFAULT_KEY_PATTERNS,
  STRIP_HEADERS,
  REDACT_PATHS,
  createSanitizationConfig,
  sanitizeString,
  sanitizeObject,
  sanitizeHeaders,
  sanitizeResponse,
  mightContainKey,
  extractPotentialKeys,
  checkForLeaks,
} from './sanitizer';

// Access Control
export {
  isDomainAllowed,
  isEndpointAllowed,
  isMethodAllowed,
  checkRateLimit,
  incrementRateLimit,
  getRateLimitUsage,
  checkAccess,
  accessControl,
  AccessControlBuilder,
  type AccessCheckResult,
} from './access-control';

// Proxy Router
export {
  proxyRequest,
  checkProviderHealth,
  proxyStreamingRequest,
  type ProxyOptions,
} from './proxy-router';

// Payments
export {
  configurePayments,
  create402Response,
  parsePaymentProof,
  verifyPaymentProof,
  processDeposit,
  processWithdraw,
  getBalance,
  getAccountInfo,
  meetsMinimumDeposit,
  getMinimumDeposit,
  estimateCost,
  calculateAffordableRequests,
  calculateRevenueShare,
  getPlatformFeeBps,
  type PaymentConfig,
} from './payments';

// Container Deployment
export {
  createDeployment,
  getDeployment,
  listDeployments,
  updateDeployment,
  deploy,
  stopDeployment,
  deleteDeployment,
  listToMarketplace,
  unlistFromMarketplace,
  addKMSKey,
  addSecretRef,
  recordRequest as recordDeploymentRequest,
  getLogs as getDeploymentLogs,
  getMarketplaceDeploymentStats,
  getTemplates,
  DEPLOYMENT_TEMPLATES,
  type APIDeployment,
  type ContainerSpec,
  type WorkerSpec,
  type DeploymentType,
  type DeploymentStatus,
} from './container-deployment';

// ============================================================================
// Initialize
// ============================================================================

/**
 * Initialize the API marketplace
 * Must be called before using any marketplace functions
 */
export async function initializeMarketplace(): Promise<void> {
  // Initialize state first (ensures CQL is ready)
  const { initializeDWSState } = await import('../state.js');
  await initializeDWSState();
  
  // Load system keys from environment
  const { loadSystemKeys } = require('./key-vault');
  loadSystemKeys();

  // Create system listings for configured providers
  const { initializeSystemListings } = require('./registry');
  await initializeSystemListings();

  console.log('[API Marketplace] Initialized');
}
