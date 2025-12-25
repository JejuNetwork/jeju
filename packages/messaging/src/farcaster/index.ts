/**
 * Farcaster Integration Module
 *
 * Public/social messaging via Farcaster protocol.
 * Includes Hub client (read), posting (write), Direct Casts (encrypted DMs),
 * signer management, and DWS worker for decentralized deployment.
 */

// Direct Casts (encrypted DMs)
export * from './dc/api'
export * from './dc/client'
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
export * from './hub/poster'
export * from './hub/schemas'
export * from './hub/submitter'
export * from './hub/types'

// Identity
export * from './identity/link'

// Signer management
export * from './signer/manager'
export * from './signer/registration'
export * from './signer/service'
