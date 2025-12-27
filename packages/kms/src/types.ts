/**
 * @jejunetwork/kms - Key Management Types
 */

import type { TEEAttestation as TEEAttestationType } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'

// Re-export TEE types from shared types package
export type {
  TEEAttestation,
  TEEAttestationVerificationResult,
  TEEKeyInfo,
  TEENodeInfo,
  TEEPlatform,
} from '@jejunetwork/types'
export {
  TEEAttestationSchema,
  TEEAttestationVerificationResultSchema,
  TEEKeyInfoSchema,
  TEENodeInfoSchema,
  TEEPlatform as TEEPlatformEnum,
  TEEPlatformSchema,
} from '@jejunetwork/types'

export const KMSProviderType = {
  ENCRYPTION: 'encryption',
  TEE: 'tee',
  MPC: 'mpc',
} as const
export type KMSProviderType =
  (typeof KMSProviderType)[keyof typeof KMSProviderType]

export interface KMSProvider {
  type: KMSProviderType
  isAvailable(): Promise<boolean>
  connect(): Promise<void>
  disconnect(): Promise<void>
}

export const ConditionOperator = {
  EQUALS: '=',
  NOT_EQUALS: '!=',
  GREATER_THAN: '>',
  LESS_THAN: '<',
  GREATER_THAN_OR_EQUAL: '>=',
  LESS_THAN_OR_EQUAL: '<=',
  CONTAINS: 'contains',
} as const
export type ConditionOperator =
  (typeof ConditionOperator)[keyof typeof ConditionOperator]

export interface ContractCondition {
  type: 'contract'
  contractAddress: Address
  chain: string
  method: string
  parameters: (string | number | boolean)[]
  returnValueTest: { comparator: ConditionOperator; value: string }
}

export interface TimestampCondition {
  type: 'timestamp'
  chain: string
  comparator: ConditionOperator
  value: number
}

export interface BalanceCondition {
  type: 'balance'
  chain: string
  tokenAddress?: Address
  comparator: ConditionOperator
  value: string
}

export interface StakeCondition {
  type: 'stake'
  registryAddress: Address
  chain: string
  minStakeUSD: number
}

export interface RoleCondition {
  type: 'role'
  registryAddress: Address
  chain: string
  role: string
}

export interface AgentCondition {
  type: 'agent'
  registryAddress: Address
  chain: string
  agentId: number
}

export type AccessCondition =
  | ContractCondition
  | TimestampCondition
  | BalanceCondition
  | StakeCondition
  | RoleCondition
  | AgentCondition

export interface AccessControlPolicy {
  conditions: AccessCondition[]
  operator: 'and' | 'or'
}

export type KeyType = 'encryption' | 'signing' | 'session'
export type KeyCurve = 'secp256k1' | 'ed25519' | 'bls12-381' | 'x25519'

export interface KeyMetadata {
  id: string
  type: KeyType
  curve: KeyCurve
  createdAt: number
  expiresAt?: number
  owner: Address
  policy: AccessControlPolicy
  providerType: KMSProviderType
  providerKeyId?: string
}

export interface GeneratedKey {
  metadata: KeyMetadata
  publicKey: Hex
}

export interface EncryptedPayload {
  ciphertext: string
  dataHash: Hex
  accessControlHash: Hex
  policy: AccessControlPolicy
  providerType: KMSProviderType
  encryptedAt: number
  keyId: string
  metadata?: Record<string, string>
}

export interface EncryptRequest {
  data: string | Uint8Array
  policy: AccessControlPolicy
  keyId?: string
  metadata?: Record<string, string>
}

export interface DecryptRequest {
  payload: EncryptedPayload
  authSig?: AuthSignature
}

export interface SignRequest {
  message: string | Uint8Array
  keyId: string
  hashAlgorithm?: 'keccak256' | 'sha256' | 'none'
}

export interface SignedMessage {
  message: Hex
  signature: Hex
  recoveryId?: number
  keyId: string
  signedAt: number
}

export interface ThresholdSignRequest {
  message: string | Uint8Array
  keyId: string
  threshold: number
  totalParties: number
  hashAlgorithm?: 'keccak256' | 'sha256'
}

export interface ThresholdSignature {
  signature: Hex
  participantCount: number
  threshold: number
  keyId: string
  signedAt: number
}

export interface AuthSignature {
  sig: Hex
  derivedVia: 'web3.eth.personal.sign' | 'EIP712' | 'siwe'
  signedMessage: string
  address: Address
}

export interface SessionKey {
  publicKey: Hex
  expiration: number
  capabilities: string[]
  authSig: AuthSignature
}

export interface MPCKeyShare {
  shareId: string
  publicKey: Hex
  threshold: number
  totalShares: number
  createdAt: number
}

export interface MPCSigningSession {
  sessionId: string
  keyId: string
  message: Hex
  participants: Address[]
  threshold: number
  collectedShares: number
  status: 'pending' | 'signing' | 'complete' | 'failed'
  createdAt: number
  expiresAt: number
}

export interface EncryptionConfig {
  debug?: boolean
}

export interface TEEConfig {
  endpoint?: string
}

export interface MPCConfig {
  threshold: number
  totalParties: number
  coordinatorEndpoint?: string
}

export interface KMSConfig {
  providers: { encryption?: EncryptionConfig; tee?: TEEConfig; mpc?: MPCConfig }
  defaultProvider: KMSProviderType
  defaultChain: string
  registryAddress?: Address
}

// Provider status types for getStatus() return values
interface EncryptionProviderStatus {
  connected: boolean
  keyCount: number
  sessionCount: number
}

interface TEEProviderStatus {
  connected: boolean
  mode: 'remote' | 'local'
  attestation?: TEEAttestationType
}

interface MPCProviderStatus {
  connected: boolean
  threshold: number
  totalParties: number
  activeParties: number
  keyCount: number
}

export type ProviderStatus =
  | EncryptionProviderStatus
  | TEEProviderStatus
  | MPCProviderStatus
