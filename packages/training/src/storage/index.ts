/**
 * Training Storage Module
 *
 * Provides storage infrastructure for training:
 * - Encrypted trajectory storage
 * - IPFS-based model/dataset storage
 */

export {
  EncryptedTrajectoryStorage,
  type EncryptionProvider,
  getEncryptedTrajectoryStorage,
  resetEncryptedTrajectoryStorage,
} from './encrypted-storage'

export {
  getStorage,
  getStorageProvider,
  StorageUtil,
  shouldUseStorage,
} from './storage-util'

export {
  isCIDResponse,
  isEncryptedPayload,
  isIPFSUploadResult,
  isJsonRecord,
} from './type-guards'

export type {
  AccessCondition,
  AccessControlPolicy,
  AuthSignature,
  CIDResponse,
  EncryptedPayload,
  EncryptedTrajectory,
  IPFSUploadResult,
  ModelMetadata,
  PolicyCondition,
  SecretPolicy,
  StorageConfig,
  StorageOptions,
  TrajectoryBatch,
} from './types'
