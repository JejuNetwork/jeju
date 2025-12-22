/**
 * MPC Types - Threshold ECDSA (2-of-3 testnet, 3-of-5 mainnet)
 */

import type { Address, Hex } from 'viem'

export interface MPCParty {
  id: string
  index: number
  endpoint: string
  publicKey: Hex
  address: Address
  enclaveId?: Hex
  attestation?: PartyAttestation
  stake: bigint
  registeredAt: number
  lastSeen: number
  status: 'active' | 'inactive' | 'slashed'
}

export interface PartyAttestation {
  quote: Hex
  measurement: Hex
  timestamp: number
  verified: boolean
}

export interface MPCKeyGenParams {
  keyId: string
  threshold: number
  totalParties: number
  partyIds: string[]
  curve: 'secp256k1'
  accessPolicy?: AccessPolicy
}

export interface MPCKeyGenResult {
  keyId: string
  publicKey: Hex
  address: Address
  threshold: number
  totalParties: number
  partyShares: Map<string, KeyShareMetadata>
  version: number
  createdAt: number
}

export interface KeyShareMetadata {
  partyId: string
  commitment: Hex
  publicShare: Hex
  encryptedShare?: Hex
  createdAt: number
  version: number
}

export interface MPCSignRequest {
  keyId: string
  message: Hex
  messageHash: Hex
  requester: Address
  accessProof?: AccessProof
}

export interface AccessProof {
  type: 'signature' | 'merkle' | 'stake' | 'role'
  proof: Hex
  timestamp: number
}

export interface MPCSignSession {
  sessionId: string
  keyId: string
  messageHash: Hex
  requester: Address
  participants: string[]
  threshold: number
  round: 'commitment' | 'reveal' | 'signature'
  commitments: Map<string, Hex>
  reveals: Map<string, PartialSignature>
  createdAt: number
  expiresAt: number
  status: 'pending' | 'signing' | 'complete' | 'failed' | 'expired'
}

export interface PartialSignature {
  partyId: string
  partialR: Hex
  partialS: Hex
  commitment: Hex
}

export interface MPCSignatureResult {
  signature: Hex
  r: Hex
  s: Hex
  v: number
  keyId: string
  sessionId: string
  participants: string[]
  signedAt: number
}

export interface AccessPolicy {
  type: 'open' | 'allowlist' | 'stake' | 'role' | 'contract'
  allowlist?: Address[]
  minStake?: bigint
  roles?: string[]
  contractAddress?: Address
  contractMethod?: string
}

export interface KeyRotationParams {
  keyId: string
  newThreshold?: number
  newParties?: string[]
  preserveAddress: boolean
}

export interface KeyRotationResult {
  keyId: string
  oldVersion: number
  newVersion: number
  publicKey: Hex
  address: Address
  partyShares: Map<string, KeyShareMetadata>
  rotatedAt: number
}

export interface KeyVersion {
  version: number
  publicKey: Hex
  address: Address
  threshold: number
  totalParties: number
  partyIds: string[]
  createdAt: number
  rotatedAt?: number
  status: 'active' | 'rotated' | 'revoked'
}

export interface MPCCoordinatorConfig {
  threshold: number
  totalParties: number
  sessionTimeout: number
  maxConcurrentSessions: number
  requireAttestation: boolean
  minPartyStake: bigint
  network: 'localnet' | 'testnet' | 'mainnet'
}

const MPC_CONFIGS = {
  localnet: {
    threshold: 2,
    totalParties: 3,
    sessionTimeout: 30_000,
    maxConcurrentSessions: 100,
    requireAttestation: false,
    minPartyStake: 0n,
  },
  testnet: {
    threshold: 2,
    totalParties: 3,
    sessionTimeout: 60_000,
    maxConcurrentSessions: 50,
    requireAttestation: true,
    minPartyStake: 100_000_000_000_000_000n,
  },
  mainnet: {
    threshold: 3,
    totalParties: 5,
    sessionTimeout: 120_000,
    maxConcurrentSessions: 25,
    requireAttestation: true,
    minPartyStake: 1_000_000_000_000_000_000n,
  },
} as const

export function getMPCConfig(
  network: MPCCoordinatorConfig['network'],
): MPCCoordinatorConfig {
  return { ...MPC_CONFIGS[network], network }
}

export const DEFAULT_MPC_CONFIG: MPCCoordinatorConfig = getMPCConfig('localnet')
