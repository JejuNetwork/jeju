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
  type JejuStorageConfig,
  JejuStorageClient,
  type JejuUploadOptions,
  type JejuUploadResult,
  type ModelStorageOptions,
  resetJejuStorageClient,
  type StoredModel,
} from './jeju-storage'
