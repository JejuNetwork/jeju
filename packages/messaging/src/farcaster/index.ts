/**
 * Farcaster Integration Module
 *
 * Public/social messaging via Farcaster protocol.
 * Includes Hub client (read), posting (write), Direct Casts (encrypted DMs),
 * signer management, and DWS worker for decentralized deployment.
 *
 * SECURITY:
 * For production, use the factory functions which automatically select
 * KMS-backed implementations. See {@link ./factory.ts}
 */

// Direct Casts (encrypted DMs)
export * from './dc/api'
export * from './dc/client'
export {
  type DCKMSEncryptionProvider,
  type DCKMSSigner,
  type KMSDCClientConfig,
  KMSDirectCastClient,
} from './dc/kms-client'
export * from './dc/types'
// DWS Worker (decentralized deployment)
export {
  createFarcasterWorker,
  type FarcasterWorker,
  type FarcasterWorkerConfig,
} from './dws-worker/index.js'
// Factory (recommended entry point)
export {
  createDevFarcasterClient,
  createDirectCastClient as createDCClient,
  createFarcasterClient,
  createFarcasterPoster as createPoster,
  createProductionFarcasterClient,
  createSignerManager,
  type FarcasterClientBundle,
  type FarcasterClientConfig,
} from './factory'

// Frames
export * from './frames/types'

// Hub client (read operations)
export * from './hub/cast-builder'
export * from './hub/client'
export {
  KMSFarcasterPoster,
  type KMSPosterConfig,
  type KMSPosterSigner,
} from './hub/kms-poster'
// Hub posting (write operations)
export * from './hub/message-builder'
export {
  FarcasterPoster,
  type FarcasterPosterConfig,
  type PostedCast,
  type ReactionTarget,
  type UserDataUpdate,
} from './hub/poster'
export * from './hub/schemas'
export * from './hub/submitter'
export * from './hub/types'

// Identity
export * from './identity/link'
// Unified KMS service
export {
  createFarcasterKMSService,
  FarcasterKMSService,
  type FarcasterKMSServiceConfig,
} from './kms-service'
export {
  type KMSFarcasterSigner,
  KMSFarcasterSignerManager,
  type KMSProvider,
  type KMSSignerManagerConfig,
} from './signer/kms-manager'
// Signer management
export * from './signer/manager'
export * from './signer/registration'
export * from './signer/service'
