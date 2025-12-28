/**
 * Network Shared Package
 * Common hooks, components, APIs, services, protocols and utilities used across all network apps
 */

// Viem Utilities (EIP-7702 compatible)
export {
  // EIP-7702 authorization helpers
  type Authorization,
  BATCH_EXECUTOR_ABI,
  type BatchCall,
  // Core contract helpers
  createTypedPublicClient,
  createTypedWalletClient,
  type EIP7702TransactionParams,
  getContract,
  hashAuthorizationMessage,
  type PublicClientConfig,
  prepareAuthorization,
  readContract,
  recoverAuthorizer,
  requiresAuthorization,
  type SignAuthorizationConfig,
  type SignedAuthorization,
  signAuthorization,
  verifyAuthorizationSignature,
  type WalletClientConfig,
  writeContract,
} from '@jejunetwork/contracts'
// Moderation API
export {
  type AgentLabels,
  BAN_TYPES,
  type BanStatus as ModerationBanStatus,
  CASE_STATUS,
  createModerationAPI,
  LABELS,
  ModerationAPI,
  type ModerationCase,
  type ModerationConfig,
  type ModerationStats,
  type ModeratorProfile,
  REPORT_TYPES,
  REPUTATION_TIERS,
  type Report,
  SEVERITY_LEVELS,
  type TransactionRequest,
} from './api/moderation'
// Auth Types
export type { SIWEMessage, SIWFMessage } from './auth/types'
// Branding
export {
  applyBrandingToDocument,
  getBrandingCssVars,
} from './branding'
// Cache Client
export {
  type CacheClient,
  type CacheClientConfig,
  type CacheInstance,
  type CacheStats,
  getCacheClient,
  getCacheRentalClient,
  resetCacheClients,
  resetCacheRentalClient,
} from './cache'
// Chains
export {
  createAgentCard,
  getChain,
  getLocalnetChain,
  getMainnetChain,
  getNetworkChains,
  getProviderInfo,
  getServiceName,
  getTestnetChain,
  inferChainFromRpcUrl,
} from './chains'
// Components
export {
  BanBanner,
  BanIndicator,
  BanOverlay,
} from './components/BanBanner'
// Content Safety Utilities
export {
  type ContentCategory,
  type ContentCheckResult,
  checkAgentOutput,
  checkUserInput,
  hasContentIssue,
  sanitizeContent,
} from './content-safety'
// Crypto (HSM)
export {
  type EncryptionResult,
  getHSMClient,
  HSMClient,
  type HSMConfig,
  type HSMCredentials,
  type HSMKey,
  type HSMProvider,
  type KeyAttributes,
  resetHSMClient,
  type SignatureRequest,
  type SignatureResult,
} from './crypto'
// Crypto (Universal - browser/worker compatible)
export {
  bytesToHex,
  constantTimeEqual,
  createHash,
  createHmac,
  decryptAesCbc,
  decryptAesGcm,
  decryptWithPassword,
  deriveECDHSharedSecret,
  deriveKeyScrypt,
  encryptAesCbc,
  encryptAesGcm,
  encryptWithPassword,
  fromHex,
  generateECDHKeyPair,
  generateECKeyPair,
  generateRSAKeyPair,
  generateUUID,
  type HashAlgorithm,
  type HashInstance,
  type HmacInstance,
  hash160,
  hash256,
  hash384,
  hash512,
  hexToBytes,
  hmacSha256,
  hmacSha512,
  randomBytes,
  randomHex,
  randomUUID,
  sha1,
  sha256,
  sha384,
  sha512,
  signEC,
  signRSA,
  signRSAPSS,
  timingSafeEqual,
  toHex,
  verifyEC,
  verifyRSA,
  verifyRSAPSS,
} from './crypto/universal'
// Duplicate Detection
export {
  checkDuplicate,
  cleanupDuplicates,
  clearAllDuplicates,
  clearDuplicates,
  DUPLICATE_DETECTION_CONFIGS,
  type DuplicateCheckResult,
  type DuplicateConfig,
  type DuplicateConfigType,
  getDuplicateStats,
} from './dedup'
// Dev Server (for frontend development)
export {
  type AppTheme,
  AUTOCRAT_THEME,
  BAZAAR_THEME,
  CRUCIBLE_THEME,
  createDevServer,
  DEFAULT_BROWSER_EXTERNALS,
  DEFAULT_PROXY_PATHS,
  DEFAULT_WATCH_DIRS,
  type DevServerConfig,
  DWS_THEME,
  GATEWAY_THEME,
  generateDevHtml,
  THEMES,
  type ThemeName,
  VPN_THEME,
} from './dev-server'
// EIL (Economic Interoperability Layer)
export {
  APP_TOKEN_PREFERENCE_ABI,
  type AppPreference,
  buildAppAwarePaymentData,
  buildLiquidityDepositTransaction,
  buildSwapTransaction,
  buildTokenPaymentData,
  buildXLPStakeTransaction,
  type ChainInfo,
  CROSS_CHAIN_PAYMASTER_ABI,
  type CrossChainSwapParams,
  calculateSwapFee,
  canPayGasWithToken,
  DEFAULT_EIL_CONFIG,
  type EILConfig,
  type EILStats,
  estimateSwapTime,
  formatGasPaymentOption,
  formatSwapRoute,
  formatXLPPosition,
  type GasPaymentOption,
  getBestGasTokenForApp,
  getChainById,
  isCrossChainSwap,
  L1_STAKE_MANAGER_ABI,
  SUPPORTED_CHAINS,
  type SwapStatus,
  selectBestGasToken,
  validateSwapParams,
  type XLPPosition,
} from './eil'
// Environment Utilities (browser-safe)
export {
  getEnv,
  getEnvBoolean,
  getEnvNumber,
  getEnvOrDefault,
  initEnv,
  isBrowser,
  isServer,
  isWorker,
  requireEnv,
  setEnv,
} from './env'
// Errors
export {
  AuthenticationError,
  AuthorizationError,
  BadRequestError,
  BusinessLogicError,
  ConflictError,
  DatabaseError,
  ExternalServiceError,
  InternalServerError,
  JejuError,
  NotFoundError,
  RateLimitError,
  ServiceUnavailableError,
  ValidationError,
} from './errors'
// Events (Universal EventEmitter - browser/worker compatible)
export { createEventEmitter, EventEmitter } from './events'
// Federation
export {
  type CrossNetworkAttestation,
  createFederationClient,
  createFederationDiscovery,
  type DiscoveryConfig,
  FEDERATED_IDENTITY_ABI,
  FEDERATED_LIQUIDITY_ABI,
  FEDERATED_SOLVER_ABI,
  type FederatedAgent,
  type FederatedSolver,
  FederationClient,
  type FederationConfig,
  FederationDiscovery,
  type IdentityVerification,
  type LiquidityRequest,
  NETWORK_REGISTRY_ABI,
  type NetworkContracts,
  type NetworkInfo,
  type NetworkLiquidity,
  type RouteInfo,
  type TrustRelation,
  type XLP,
} from './federation'
// Formatting Utilities
export {
  chunk,
  // CSS
  classNames,
  cn,
  // Utilities
  delay,
  // Addresses
  formatAddress,
  // Bytes
  formatBytes,
  formatBytesBinary,
  formatDuration,
  formatDurationVerbose,
  // ETH
  formatEth,
  formatGas,
  formatGasPrice,
  // Duration
  formatMs,
  // Numbers
  formatNumber,
  formatPercent,
  // Time ago
  formatTimeAgo,
  formatTimestamp,
  formatUsd,
  // IDs
  generateId,
  generatePrefixedId,
  shortenAddress,
  // Safe conversions
  toSafeNumber,
  toSafeString,
} from './format'
// Health Check Middleware
export {
  healthChecks,
  healthMiddleware,
} from './health-middleware'
// Hooks
export {
  type BanCheckConfig as HookBanCheckConfig,
  type BanStatus,
  BanType,
  getBanTypeColor,
  getBanTypeLabel,
  useBanStatus,
} from './hooks/useBanStatus'
// IPFS Client
export {
  cidToBytes32,
  createIPFSClient,
  fileExistsOnIPFS,
  getIPFSUrl,
  type IPFSClient,
  type IPFSConfig,
  type IPFSUploadResult,
  retrieveFromIPFS,
  retrieveJSONFromIPFS,
  uploadJSONToIPFS,
  uploadToIPFS,
} from './ipfs-client'
// JSON Parsing Utilities
export {
  type ParseResult,
  parseJsonResponse,
  parseJsonString,
  parseJsonWithFallback,
  tryParseJson,
  tryStringifyJson,
} from './json'
// Logger
export {
  clearLoggerCache,
  createLogger,
  createLoggerAsync,
  getDefaultLogger,
  getLogger,
  type Logger,
  type LoggerConfig,
  type LogLevel,
  logger,
} from './logger'
// Ban Check Middleware
export {
  type BanCheckConfig,
  BanChecker,
  type BanCheckResult,
  type BanStatus as BanCheckStatus,
  createElysiaBanPlugin,
  getBanStatus,
  getDefaultChecker,
  initBanChecker,
  isBanned,
} from './middleware/banCheck'
// API Cache Middleware
export {
  APICache,
  type CacheConfig as APICacheConfig,
  type CacheMiddlewareResult,
  type CacheResult,
  type CacheStats as APICacheStats,
  createCacheMiddleware,
  createComputeCache,
  createListCache,
  createSearchCache,
  createStatsCache,
  generateCacheKey,
} from './middleware/cache'
// Performance Monitoring
export {
  type Bottleneck,
  type BottleneckSeverity,
  type BottleneckType,
  type CacheMetrics,
  type DatabaseMetrics,
  PerformanceMonitor,
  type PerformanceSnapshot,
  performanceMonitor,
  type StorageMetrics,
  type SystemMetrics,
} from './monitoring'
// Moderation Notifications
export {
  createBanNotification,
  createModerationNotifications,
  type EventData,
  type EventType,
  type ModerationEvent,
  ModerationNotificationService,
  type NotificationConfig,
  type Subscriber,
} from './notifications/moderation-events'
// Nullable Utilities (undefined/null conversion)
export {
  first,
  isNotNullish,
  isNullish,
  last,
  mapGet,
  toDate,
  toDateOrNull,
  toNull,
  toUndefined,
} from './nullable'
// Oracle (shared oracle node utilities)
export {
  CHAINLINK_AGGREGATOR_ABI,
  COMMITTEE_MANAGER_ABI,
  ConfigurationError,
  FEED_REGISTRY_ABI,
  NETWORK_CONNECTOR_ABI,
  type OracleConfigFileData,
  type OracleNetworkConfig,
  type PrometheusMetric,
  REPORT_VERIFIER_ABI,
  resolveEnvVar,
  UNISWAP_V3_POOL_ABI,
  validateAddress,
  validatePrivateKey,
} from './oracle'
// Paymaster
export {
  checkPaymasterApproval,
  estimateTokenCost,
  generatePaymasterData,
  getApprovalTxData,
  getAvailablePaymasters,
  getPaymasterForToken,
  getPaymasterOptions,
  getTokenBalance,
  PAYMASTER_ABI,
  PAYMASTER_FACTORY_ABI,
  type PaymasterConfig,
  type PaymasterInfo,
  type PaymasterOption,
  preparePaymasterData,
} from './paymaster'
// Protocol Servers
export {
  type A2AConfig,
  type A2AResult,
  type A2ASkill,
  type AgentCard,
  type AgentInfo,
  // Middleware
  configureERC8004,
  configureProtocolMiddleware,
  configureX402,
  createA2AServer,
  createMCPServer,
  createPaymentRequirement,
  // Protocol Server
  createServer,
  createServerlessHandler,
  type ERC8004Config,
  erc8004Middleware,
  getAgentInfo,
  type MCPConfig,
  type MCPPrompt,
  type MCPPromptResult,
  type MCPResource,
  type MCPTool,
  type PaymentRequirement,
  type ProtocolMiddlewareConfig,
  parseX402Header,
  type ServerConfig,
  type ServerInstance,
  type SkillContext,
  type SkillResult,
  skillError,
  skillRequiresPayment,
  skillSuccess,
  startServer,
  verifyX402Payment,
  type X402Config,
  type X402PaymentPayload,
  x402Middleware,
} from './protocols'
// Retry Utilities
export {
  isRetryableError,
  type RetryOptions,
  retryIfRetryable,
  retryWithCondition,
  sleep,
} from './retry'
// Schema Types
export { type IPFSUploadResponse, IPFSUploadResponseSchema } from './schemas'
// Key Security Validation (TEE/KMS enforcement)
export {
  enforceKeySecurityAtStartup,
  getKMSConfig,
  type KeySecurityValidationResult,
  shouldUseKMS,
  validateKeySecurityConfig,
} from './security/key-validation'
// Security Middleware
export {
  type RateLimitConfig,
  rateLimitMiddleware,
  type SecurityConfig,
  securityMiddleware,
} from './security-middleware'
// Service Worker
export {
  cacheUrls,
  checkForUpdates,
  clearCache,
  registerServiceWorker,
  type SWRegistrationOptions,
  sendMessageToSW,
  skipWaiting,
  unregisterServiceWorker,
} from './service-worker'
// Decentralized Services
export {
  type AppManifest,
  type AuthHeaders,
  type CacheConfig,
  type CacheService,
  type CacheServiceConfig,
  type ContentResolution,
  type ContentVersioningConfig,
  // Content Versioning
  ContentVersioningService,
  type CronConfig,
  type CronJob,
  type CronJobConfig,
  type CronService,
  cacheKeys,
  // Cache
  createCacheService,
  createContentVersioningService,
  // Cron
  createCronService,
  // Database
  createDatabaseService,
  // IPNS
  createIPNSClient,
  // JNS
  createJNSService,
  // KMS
  createKMSService,
  createPreviewManager,
  // Storage
  createStorageService,
  type DatabaseConfig,
  type DatabaseService,
  type DatabaseServiceConfig,
  type DeploymentMode,
  decodeIPNSContenthash,
  type EncryptionPolicy,
  type ExecResult,
  encodeIPNSContenthash,
  getCurrentDeploymentMode,
  getIPNSKeyName,
  IPNSClient,
  type IPNSKey,
  type IPNSPublishResult,
  type IPNSResolution,
  isDevModeActive,
  type JNSConfig,
  type JNSRecords,
  type JNSService,
  type KMSConfig,
  type KMSServiceClient,
  type PinOptions,
  PreviewDeploymentManager,
  type QueryParam,
  type QueryResult,
  resetCacheService,
  resetCronService,
  resetDatabaseService,
  resetJNSService,
  resetKMSService,
  resetStorageService,
  type SecretsServiceConfig,
  // Types
  type ServiceHealth,
  type StorageConfig,
  type StorageService,
  type StorageServiceConfig,
  type StorageTier,
  setupDAppJNS,
  type TransactionClient,
  type TriggersServiceConfig,
  type UploadOptions,
  type UploadResult,
} from './services'
// Singleton Utilities
export {
  createGlobalSingleton,
  createPortSingleton,
  createSingleton,
  type PortSingletonAccessor,
  type SingletonAccessor,
} from './singleton'
// Snowflake ID Generator
export {
  generateSnowflakeId,
  isValidSnowflakeId,
  parseSnowflakeId,
  SnowflakeGenerator,
  type SnowflakeParsed,
} from './snowflake'
// Jeju Storage (IPFS/Arweave)
export {
  getJejuStorageClient,
  initializeJejuStorage,
  isJejuStorageAvailable,
  JejuStorageClient,
  type JejuStorageConfig,
  type JejuUploadOptions,
  type JejuUploadResult,
  type ModelStorageOptions,
  resetJejuStorageClient,
  type StoredModel,
} from './storage'
// Token Utilities
export {
  calculateUsdValue,
  formatTokenAmount,
  formatTokenUsd,
  formatTokenWithSymbol,
  isSignificantAmount,
  parseTokenAmount,
} from './token-utils'
// Token Counter Utilities
export {
  budgetTokens,
  countTokens,
  countTokensSync,
  getModelTokenLimit,
  getSafeContextLimit,
  MODEL_TOKEN_LIMITS,
  truncateToTokenLimit,
  truncateToTokenLimitSync,
} from './tokens'
// Type Guards
export {
  assertDefined,
  assertNotNull,
  fetchJsonAs,
  getErrorMessage,
  hasArrayProperty,
  hasBooleanProperty,
  hasNumberProperty,
  hasProperty,
  hasStringProperty,
  isArray,
  isArrayOf,
  isBoolean,
  isDate,
  isFiniteNumber,
  isJsonRecord,
  isJsonValue,
  isNonEmptyString,
  isNumber,
  isNumberArray,
  isObject,
  isPlainObject,
  isPositiveInteger,
  isString,
  isStringArray,
  isStringRecord,
  isUint8Array,
  type JsonValue,
  parseJson,
  parseJsonAs,
  responseJson,
  toError,
  toJsonRecord,
  toJsonValueOrNull,
  toStringArray,
} from './type-guards'
// Shared Types
export type {
  JsonRpcError,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  ProtocolData,
  ProtocolValue,
  RpcParam,
  SqlDefaultValue,
  SqlParam,
  SqlRow,
  WebhookBody,
} from './types'
// Wagmi Utilities (see gateway's useTypedWriteContract hook for full solution)
export {
  type WagmiWriteParams,
  type WriteParamsInput,
  writeParams,
  writeParamsAsync,
} from './wagmi'
// x402 Payment Protocol
export {
  CHAIN_IDS as X402_CHAIN_IDS,
  calculatePercentageFee,
  checkPayment,
  createPaymentPayload,
  createX402PaymentRequirement,
  generate402Headers,
  getEIP712Domain,
  getEIP712Types,
  isValidPaymentPayload,
  PAYMENT_TIERS as X402_PAYMENT_TIERS,
  type PaymentPayload,
  type PaymentRequirements,
  type PaymentScheme,
  parsePaymentHeader,
  RPC_URLS as X402_RPC_URLS,
  type SettlementResponse,
  signPaymentPayload,
  signPaymentPayloadWithKMS,
  type UntrustedPaymentPayload,
  USDC_ADDRESSES,
  verifyPayment,
  type X402Network,
  type X402PaymentConfig,
  type X402PaymentHeader,
  type X402PaymentOption,
  type X402PaymentRequirement,
} from './x402'
