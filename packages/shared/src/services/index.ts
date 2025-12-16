/**
 * Decentralized Services
 * 
 * Unified service layer for Jeju dApps:
 * - Database (CQL)
 * - Cache (Compute Redis)
 * - Storage (IPFS)
 * - KMS (Key Management)
 * - Cron (Scheduled Tasks)
 * - JNS (Jeju Name Service)
 * - Deploy (Deployment utilities)
 */

// Database
export {
  createDatabaseService,
  resetDatabaseService,
  type DatabaseConfig,
  type DatabaseService,
  type QueryParam,
  type QueryResult,
  type ExecResult,
  type TransactionClient,
} from './database';

// Cache
export {
  createCacheService,
  resetCacheService,
  cacheKeys,
  type CacheConfig,
  type CacheService,
} from './cache';

// Storage
export {
  createStorageService,
  resetStorageService,
  type StorageConfig,
  type StorageService,
  type StorageTier,
  type UploadOptions,
  type UploadResult,
  type PinOptions,
} from './storage';

// KMS
export {
  createKMSService,
  resetKMSService,
  type KMSConfig,
  type KMSServiceClient,
  type EncryptionPolicy,
} from './kms';

// Cron
export {
  createCronService,
  resetCronService,
  type CronConfig,
  type CronService,
  type CronJob,
  type CronJobConfig,
} from './cron';

// JNS
export {
  createJNSService,
  resetJNSService,
  setupDAppJNS,
  type JNSConfig,
  type JNSService,
  type JNSRecords,
} from './jns';

// Deploy
export {
  deployApp,
  generateMigrationSQL,
  type DeployConfig,
  type DeployResult,
  type MigrationConfig,
} from './deploy';

// Types
export type {
  ServiceHealth,
  AppManifest,
  DatabaseServiceConfig,
  CacheServiceConfig,
  StorageServiceConfig,
  SecretsServiceConfig,
  TriggersServiceConfig,
  AuthHeaders,
} from './types';

