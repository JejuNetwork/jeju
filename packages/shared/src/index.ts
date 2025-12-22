/**
 * Network Shared Package
 * Common hooks, components, APIs, services, protocols and utilities used across all network apps
 */

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
} from './chains'
// Components
export {
  BanBanner,
  BanIndicator,
  BanOverlay,
} from './components/BanBanner'
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
// Database (CovenantSQL)
export {
  type ColumnDefinition,
  type ConsistencyLevel,
  CovenantSQLClient,
  type CovenantSQLConfig,
  createCovenantSQLClient,
  createTableMigration,
  getCovenantSQLClient,
  type IndexDefinition,
  type Migration,
  MigrationManager,
  type MigrationRecord,
  type MigrationResult,
  migrateData,
  type QueryOptions,
  type QueryResult as CovenantQueryResult,
  resetCovenantSQLClient,
  type TableSchema,
  type TransactionContext,
} from './db'
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
// Logger
export {
  createLogger,
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
  // Legacy A2A
  createA2AServer,
  // Legacy MCP
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
  type ServerInstance,
  type SkillContext,
  type SkillResult,
  skillError,
  skillRequiresPayment,
  skillSuccess,
  type ServerConfig,
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
  type CronConfig,
  type CronJob,
  type CronJobConfig,
  type CronService,
  cacheKeys,
  // Cache
  createCacheService,
  // Cron
  createCronService,
  // Database
  createDatabaseService,
  // JNS
  createJNSService,
  // KMS
  createKMSService,
  // Storage
  createStorageService,
  type DatabaseConfig,
  type DatabaseService,
  type DatabaseServiceConfig,
  type DeployConfig,
  type DeployResult,
  // Deploy
  deployApp,
  type EncryptionPolicy,
  type ExecResult,
  generateMigrationSQL,
  type JNSConfig,
  type JNSRecords,
  type JNSService,
  type KMSConfig,
  type KMSServiceClient,
  type MigrationConfig,
  type PinOptions,
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
// Token Utilities
export {
  calculateUsdValue,
  formatTokenAmount,
  formatTokenUsd,
  formatTokenWithSymbol,
  isSignificantAmount,
  parseTokenAmount,
} from './token-utils'
// Security Middleware
export {
  rateLimitMiddleware,
  type RateLimitConfig,
  securityMiddleware,
  type SecurityConfig,
} from './security-middleware'
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
