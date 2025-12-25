/**
 * Storage Utilities
 *
 * Decentralized storage clients for IPFS/Arweave.
 *
 * @module @jejunetwork/shared/storage
 */

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
} from './jeju-storage'
