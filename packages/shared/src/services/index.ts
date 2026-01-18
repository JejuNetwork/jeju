/**
 * Decentralized Services
 *
 * Unified service layer for Jeju dApps:
 * - Database (SQLit)
 * - Cache (Compute Redis)
 * - Storage (IPFS)
 * - KMS (Key Management)
 * - Cron (Scheduled Tasks)
 * - JNS (Jeju Name Service)
 */

// Cache
export {
  type CacheConfig,
  type CacheService,
  cacheKeys,
  createCacheService,
  resetCacheService,
} from './cache'
// Content Versioning (Dev/Preview/Staging/Production)
export {
  type ContentResolution,
  type ContentVersioningConfig,
  ContentVersioningService,
  createContentVersioningService,
  type DeploymentMode,
  getCurrentDeploymentMode,
  isDevModeActive,
} from './content-versioning'
// Cron
export {
  type CronConfig,
  type CronJob,
  type CronJobConfig,
  type CronService,
  createCronService,
  resetCronService,
} from './cron'
// Database
export {
  createDatabaseService,
  type DatabaseConfig,
  type DatabaseService,
  type ExecResult,
  type QueryParam,
  type QueryResult,
  resetDatabaseService,
  type TransactionClient,
} from './database'
// IPNS (Preview Deployments)
export {
  createIPNSClient,
  createPreviewManager,
  decodeIPNSContenthash,
  encodeIPNSContenthash,
  getIPNSKeyName,
  IPNSClient,
  type IPNSKey,
  type IPNSPublishResult,
  type IPNSResolution,
  PreviewDeploymentManager,
} from './ipns'
// JNS
export {
  createJNSService,
  type JNSConfig,
  type JNSRecords,
  type JNSService,
  resetJNSService,
  setupDAppJNS,
} from './jns'
// KMS
export {
  createKMSService,
  type EncryptionPolicy,
  getKMSServiceFromEnv,
  type KMSConfig,
  type KMSServiceClient,
  resetKMSService,
} from './kms'
// Storage
export {
  createStorageService,
  type PinOptions,
  resetStorageService,
  type StorageConfig,
  type StorageService,
  type StorageTier,
  type UploadOptions,
  type UploadResult,
} from './storage'

// Types
export type {
  AppManifest,
  AuthHeaders,
  CacheServiceConfig,
  DatabaseServiceConfig,
  SecretsServiceConfig,
  ServiceHealth,
  StorageServiceConfig,
  TriggersServiceConfig,
} from './types'
