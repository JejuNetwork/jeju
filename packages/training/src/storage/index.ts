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
  type LLMCallJSONLRecord,
  type StaticStorageConfig,
  StaticTrajectoryStorage,
  shutdownAllStaticStorage,
  type TrajectoryBatchReference,
  type TrajectoryJSONLRecord,
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
  DatasetReference,
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

export { TrainingDbPersistence, type TrainingDbClient } from './db-persistence'
export { ALL_TRAINING_SCHEMAS, DATASET_REFERENCE_SCHEMA, TRAJECTORY_BATCH_SCHEMA } from './db-schema'
