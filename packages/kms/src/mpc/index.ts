/**
 * MPC Module - Threshold ECDSA for Ethereum
 *
 * Provides:
 * - MPCCoordinator: Shamir's Secret Sharing based key management
 * - FROSTCoordinator: FROST threshold signing (key NEVER reconstructed)
 */

export * from './coordinator.js'
export * from './frost-signing.js'
export * from './types.js'
