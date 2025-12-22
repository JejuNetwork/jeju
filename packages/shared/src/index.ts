/**
 * Network Shared Package
 * Common hooks, components, APIs, services, protocols and utilities used across all network apps
 */

// Shared Types
export type {
  SqlParam,
  SqlDefaultValue,
  SqlRow,
  JsonRpcId,
  RpcParam,
  JsonRpcError,
  JsonRpcRequest,
  JsonRpcResponse,
  ProtocolData,
  ProtocolValue,
  WebhookBody,
} from './types';

// Hooks
export { 
  useBanStatus, 
  getBanTypeLabel, 
  getBanTypeColor,
  BanType,
  type BanStatus,
  type BanCheckConfig 
} from './hooks/useBanStatus';

// Components
export { 
  BanBanner, 
  BanIndicator, 
  BanOverlay 
} from './components/BanBanner';

// Moderation API
export {
  ModerationAPI,
  createModerationAPI,
  BAN_TYPES,
  CASE_STATUS,
  REPUTATION_TIERS,
  REPORT_TYPES,
  SEVERITY_LEVELS,
  LABELS,
  type ModerationConfig,
  type BanStatus as ModerationBanStatus,
  type ModeratorProfile,
  type ModerationCase,
  type Report,
  type AgentLabels,
  type ModerationStats,
  type TransactionRequest,
} from './api/moderation';

// Health Check Middleware
export {
  healthMiddleware,
  healthChecks,
} from './health-middleware';

// Branding
export {
  getBrandingCssVars,
  applyBrandingToDocument,
} from './branding';

// Chains
export {
  getLocalnetChain,
  getTestnetChain,
  getMainnetChain,
  getNetworkChains,
  getChain,
  getProviderInfo,
  getServiceName,
  createAgentCard,
} from './chains';

// Federation
export {
  FederationClient,
  createFederationClient,
  FederationDiscovery,
  createFederationDiscovery,
  NETWORK_REGISTRY_ABI,
  FEDERATED_IDENTITY_ABI,
  FEDERATED_SOLVER_ABI,
  FEDERATED_LIQUIDITY_ABI,
  type FederationConfig,
  type DiscoveryConfig,
  type NetworkInfo,
  type NetworkContracts,
  type FederatedAgent,
  type FederatedSolver,
  type NetworkLiquidity,
  type TrustRelation,
  type RouteInfo,
  type IdentityVerification,
  type XLP,
  type LiquidityRequest,
  type CrossNetworkAttestation,
} from './federation';

// Decentralized Services
export {
  // Database
  createDatabaseService,
  resetDatabaseService,
  type DatabaseConfig,
  type DatabaseService,
  type QueryParam,
  type QueryResult,
  type ExecResult,
  type TransactionClient,
  // Cache
  createCacheService,
  resetCacheService,
  cacheKeys,
  type CacheConfig,
  type CacheService,
  // Storage
  createStorageService,
  resetStorageService,
  type StorageConfig,
  type StorageService,
  type StorageTier,
  type UploadOptions,
  type UploadResult,
  type PinOptions,
  // KMS
  createKMSService,
  resetKMSService,
  type KMSConfig,
  type KMSServiceClient,
  type EncryptionPolicy,
  // Cron
  createCronService,
  resetCronService,
  type CronConfig,
  type CronService,
  type CronJob,
  type CronJobConfig,
  // JNS
  createJNSService,
  resetJNSService,
  setupDAppJNS,
  type JNSConfig,
  type JNSService,
  type JNSRecords,
  // Deploy
  deployApp,
  generateMigrationSQL,
  type DeployConfig,
  type DeployResult,
  type MigrationConfig,
  // Types
  type ServiceHealth,
  type AppManifest,
  type DatabaseServiceConfig,
  type CacheServiceConfig,
  type StorageServiceConfig,
  type SecretsServiceConfig,
  type TriggersServiceConfig,
  type AuthHeaders,
} from './services';

// Cache Client
export {
  getCacheClient,
  resetCacheClients,
  getCacheRentalClient,
  resetCacheRentalClient,
  type CacheClient,
  type CacheClientConfig,
  type CacheStats,
  type CacheInstance,
} from './cache';

// Database (CovenantSQL)
export {
  CovenantSQLClient,
  createCovenantSQLClient,
  getCovenantSQLClient,
  resetCovenantSQLClient,
  MigrationManager,
  createTableMigration,
  migrateData,
  type CovenantSQLConfig,
  type ConsistencyLevel,
  type QueryOptions,
  type QueryResult as CovenantQueryResult,
  type TransactionContext,
  type TableSchema,
  type ColumnDefinition,
  type IndexDefinition,
  type Migration,
  type MigrationRecord,
  type MigrationResult,
} from './db';

// Crypto (HSM)
export {
  HSMClient,
  getHSMClient,
  resetHSMClient,
  type HSMProvider,
  type HSMConfig,
  type HSMCredentials,
  type HSMKey,
  type KeyAttributes,
  type SignatureRequest,
  type SignatureResult,
  type EncryptionResult,
} from './crypto';

// Service Worker
export {
  registerServiceWorker,
  unregisterServiceWorker,
  checkForUpdates,
  sendMessageToSW,
  skipWaiting,
  cacheUrls,
  clearCache,
  type SWRegistrationOptions,
} from './service-worker';

// Protocol Servers
export {
  // Unified Server
  createUnifiedServer,
  startServer,
  createServerlessHandler,
  skillSuccess,
  skillError,
  skillRequiresPayment,
  type UnifiedServerConfig,
  type A2ASkill,
  type MCPResource,
  type MCPTool,
  type MCPPrompt,
  type SkillContext,
  type SkillResult,
  type PaymentRequirement,
  type ServerInstance,
  // Legacy A2A
  createA2AServer,
  type A2AConfig,
  type A2AResult,
  type AgentCard,
  // Legacy MCP
  createMCPServer,
  type MCPConfig,
  type MCPPromptResult,
  // Middleware
  configureERC8004,
  configureX402,
  configureProtocolMiddleware,
  erc8004Middleware,
  x402Middleware,
  getAgentInfo,
  createPaymentRequirement,
  verifyX402Payment,
  parseX402Header,
  type ERC8004Config,
  type X402Config,
  type ProtocolMiddlewareConfig,
  type AgentInfo,
  type X402PaymentPayload,
} from './protocols';
