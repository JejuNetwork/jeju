/**
 * Training Storage Module
 *
 * Provides storage infrastructure for training:
 * - Encrypted trajectory storage
 * - IPFS-based model/dataset storage
 * - Static file storage for trajectory batches
 */

export {
  EncryptedTrajectoryStorage,
  type EncryptionProvider,
  getEncryptedTrajectoryStorage,
  resetEncryptedTrajectoryStorage,
} from './encrypted-storage'

export {
  createStaticTrajectoryStorage,
  downloadTrajectoryBatch,
  getStaticTrajectoryStorage,
  shutdownAllStaticStorage,
  type StaticStorageConfig,
  StaticTrajectoryStorage,
  type TrajectoryBatchReference,
} from './static-storage'

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
