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

// Factory (recommended entry point)
export {
  createDirectCastClient as createDCClient,
  createDevFarcasterClient,
  createFarcasterClient,
  createFarcasterPoster as createPoster,
  createProductionFarcasterClient,
  createSignerManager,
  type FarcasterClientBundle,
  type FarcasterClientConfig,
} from './factory'

// Direct Casts (encrypted DMs)
export * from './dc/api'
export * from './dc/client'
export {
  KMSDirectCastClient,
  type DCKMSEncryptionProvider,
  type DCKMSSigner,
  type KMSDCClientConfig,
} from './dc/kms-client'
export * from './dc/types'

// DWS Worker (decentralized deployment)
export {
  createFarcasterWorker,
  type FarcasterWorker,
  type FarcasterWorkerConfig,
} from './dws-worker/index.js'

// Frames
export * from './frames/types'

// Hub client (read operations)
export * from './hub/cast-builder'
export * from './hub/client'

// Hub posting (write operations)
export * from './hub/message-builder'
export {
  FarcasterPoster,
  type FarcasterPosterConfig,
  type PostedCast,
  type ReactionTarget,
  type UserDataUpdate,
} from './hub/poster'
export {
  KMSFarcasterPoster,
  type KMSPosterConfig,
  type KMSPosterSigner,
} from './hub/kms-poster'
export * from './hub/schemas'
export * from './hub/submitter'
export * from './hub/types'

// Identity
export * from './identity/link'

// Signer management
export * from './signer/manager'
export {
  KMSFarcasterSignerManager,
  type KMSFarcasterSigner,
  type KMSProvider,
  type KMSSignerManagerConfig,
} from './signer/kms-manager'
export * from './signer/registration'
export * from './signer/service'

// Unified KMS service
export {
  FarcasterKMSService,
  type FarcasterKMSServiceConfig,
  createFarcasterKMSService,
} from './kms-service'
