/**
 * Storage API - Main exports
 */

// Server
export { createServer, type ServerConfig } from './server';

// SDK
export {
  createUnifiedStorage,
  UnifiedStorageSDK,
  type UnifiedStorageConfig,
  type UploadOptions,
  type UploadResult,
  type DownloadOptions,
} from './sdk/unified-storage';

// Backends
export {
  BackendManager,
  createBackendManager,
  IPFSBackend,
  LocalBackend,
  ArweaveBackend,
  type StorageBackend,
  type StorageUploadOptions,
  type StorageUploadResult,
} from './backends';

export {
  TorrentBackend,
  getTorrentBackend,
  resetTorrentBackend,
  type TorrentBackendConfig,
} from './backends/torrent';

// Moderation
export {
  ContentModerationService,
  getModerationService,
  resetModerationService,
  type ModerationConfig,
  type ScanContext,
} from './moderation';

// Encryption
export {
  EncryptionService,
  getEncryptionService,
  resetEncryptionService,
  type AccessCondition,
  type AccessPolicy,
  type EncryptedPayload,
  type EncryptionConfig,
} from './encryption';

// Router
export {
  ContentRouter,
  getContentRouter,
  resetContentRouter,
} from './router/content-router';

// Oracle
export { SeedingOracle, createSeedingOracle } from './oracle/seeding-oracle';

// Errors
export * from './errors';
