/**
 * Farcaster FID Registration Types
 *
 * Type definitions for FID registration and onboarding.
 */

import type { Address, Hex } from 'viem'
export interface FIDInfo {
  /** Farcaster ID */
  fid: number
  /** Custody address */
  custodyAddress: Address
  /** Recovery address */
  recoveryAddress?: Address
  /** Registration timestamp */
  registeredAt: number
  /** Registration transaction hash */
  txHash: Hex
}

export interface FIDAvailability {
  /** Is the FID available */
  available: boolean
  /** Current owner if not available */
  owner?: Address
  /** Reason if not available */
  reason?: 'taken' | 'reserved' | 'invalid'
}
export interface StorageUnit {
  /** Number of storage units */
  units: number
  /** Expiration timestamp */
  expiresAt: number
  /** Price paid in wei */
  price: bigint
}

export interface StorageInfo {
  /** FID */
  fid: number
  /** Total units */
  totalUnits: number
  /** Used units */
  usedUnits: number
  /** Storage units */
  units: StorageUnit[]
}
export interface RegistrationConfig {
  /** Optimism RPC URL */
  rpcUrl: string
  /** ID Gateway contract address */
  idGatewayAddress?: Address
  /** Storage Registry address */
  storageRegistryAddress?: Address
  /** Key Registry address */
  keyRegistryAddress?: Address
  /** Bundler address */
  bundlerAddress?: Address
}
export interface RegisterFIDRequest {
  /** Custody address (wallet that will own the FID) */
  custodyAddress: Address
  /** Recovery address (optional) */
  recoveryAddress?: Address
  /** Initial storage units to purchase (default: 1) */
  storageUnits?: number
  /** Initial signer key to register */
  signerPublicKey?: Hex
  /** Referrer FID for rewards */
  referrerFid?: number
}

export interface RegisterFIDResult {
  /** Assigned FID */
  fid: number
  /** Transaction hash */
  txHash: Hex
  /** Gas used */
  gasUsed: bigint
  /** Total cost in ETH */
  totalCost: bigint
  /** Storage units purchased */
  storageUnits: number
}
export interface BundledRegistrationRequest {
  /** Custody address */
  custodyAddress: Address
  /** Recovery address */
  recoveryAddress?: Address
  /** Username to register */
  username?: string
  /** Storage units */
  storageUnits: number
  /** Signer public key */
  signerPublicKey: Hex
  /** Signer key type (1 = Ed25519) */
  signerKeyType?: number
  /** Signer metadata */
  signerMetadata?: Hex
  /** Extra ETH to send for gas */
  extraEth?: bigint
}

export interface BundledRegistrationResult {
  /** Assigned FID */
  fid: number
  /** Transaction hash */
  txHash: Hex
  /** Username (if registered) */
  username?: string
  /** Storage expiration */
  storageExpiresAt: number
  /** Signer registered */
  signerRegistered: boolean
}
export interface UsernameInfo {
  /** Username */
  username: string
  /** Owner FID */
  ownerFid: number
  /** Custody address */
  custodyAddress: Address
  /** Timestamp */
  timestamp: number
  /** Proof signature */
  signature: Hex
}

export interface UsernameAvailability {
  /** Is available */
  available: boolean
  /** Reason if not available */
  reason?: 'taken' | 'reserved' | 'invalid' | 'too_short'
}
export interface RegistrationPrice {
  /** Base price for FID registration */
  fidPrice: bigint
  /** Price per storage unit */
  storageUnitPrice: bigint
  /** Total price */
  totalPrice: bigint
  /** Price in USD (if available) */
  priceUsd?: number
}
interface BaseRegistrationEvent {
  fid: number
  txHash: Hex
  timestamp: number
}

export interface FIDRegisteredEvent extends BaseRegistrationEvent {
  type: 'fid_registered'
  data: {
    custodyAddress: Address
    recoveryAddress?: Address
  }
}

export interface SignerAddedEvent extends BaseRegistrationEvent {
  type: 'signer_added'
  data: {
    signerPublicKey: Hex
    keyType: number
  }
}

export interface StoragePurchasedEvent extends BaseRegistrationEvent {
  type: 'storage_purchased'
  data: {
    units: number
    price: bigint
    expiresAt: number
  }
}

export interface UsernameRegisteredEvent extends BaseRegistrationEvent {
  type: 'username_registered'
  data: {
    username: string
  }
}

export interface RecoverySetEvent extends BaseRegistrationEvent {
  type: 'recovery_set'
  data: {
    recoveryAddress: Address
  }
}

export type RegistrationEvent =
  | FIDRegisteredEvent
  | SignerAddedEvent
  | StoragePurchasedEvent
  | UsernameRegisteredEvent
  | RecoverySetEvent

export type RegistrationEventType = RegistrationEvent['type']
