/**
 * MPC Module - Threshold ECDSA for Ethereum
 *
 * Provides two implementations:
 * - MPCCoordinator: Shamir's Secret Sharing (key reconstructed during signing)
 * - FROSTMPCCoordinator: True threshold ECDSA (key NEVER reconstructed)
 */

export * from './coordinator.js'
export * from './frost-coordinator.js'
export * from './frost-signing.js'
export * from './types.js'
