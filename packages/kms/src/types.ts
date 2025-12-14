/**
 * @jeju/kms - Key Management Types
 */

import type { Address, Hex } from 'viem';

export enum KMSProviderType {
  LIT = 'lit',
  TEE = 'tee',
  MPC = 'mpc',
}

export interface KMSProvider {
  type: KMSProviderType;
  isAvailable(): Promise<boolean>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export enum ConditionOperator {
  EQUALS = '=',
  NOT_EQUALS = '!=',
  GREATER_THAN = '>',
  LESS_THAN = '<',
  GREATER_THAN_OR_EQUAL = '>=',
  LESS_THAN_OR_EQUAL = '<=',
  CONTAINS = 'contains',
}

export interface ContractCondition {
  type: 'contract';
  contractAddress: Address;
  chain: string;
  method: string;
  parameters: (string | number | boolean)[];
  returnValueTest: { comparator: ConditionOperator; value: string };
}

export interface TimestampCondition {
  type: 'timestamp';
  chain: string;
  comparator: ConditionOperator;
  value: number;
}

export interface BalanceCondition {
  type: 'balance';
  chain: string;
  tokenAddress?: Address;
  comparator: ConditionOperator;
  value: string;
}

export interface StakeCondition {
  type: 'stake';
  registryAddress: Address;
  chain: string;
  minStakeUSD: number;
}

export interface RoleCondition {
  type: 'role';
  registryAddress: Address;
  chain: string;
  role: string;
}

export interface AgentCondition {
  type: 'agent';
  registryAddress: Address;
  chain: string;
  agentId: number;
}

export type AccessCondition = ContractCondition | TimestampCondition | BalanceCondition | StakeCondition | RoleCondition | AgentCondition;

export interface AccessControlPolicy {
  conditions: AccessCondition[];
  operator: 'and' | 'or';
}

export type KeyType = 'encryption' | 'signing' | 'session';
export type KeyCurve = 'secp256k1' | 'ed25519' | 'bls12-381';

export interface KeyMetadata {
  id: string;
  type: KeyType;
  curve: KeyCurve;
  createdAt: number;
  expiresAt?: number;
  owner: Address;
  policy: AccessControlPolicy;
  providerType: KMSProviderType;
  providerKeyId?: string;
}

export interface GeneratedKey {
  metadata: KeyMetadata;
  publicKey: Hex;
}

export interface EncryptedPayload {
  ciphertext: string;
  dataHash: Hex;
  accessControlHash: Hex;
  policy: AccessControlPolicy;
  providerType: KMSProviderType;
  encryptedAt: number;
  keyId: string;
  metadata?: Record<string, string>;
}

export interface EncryptRequest {
  data: string | Uint8Array;
  policy: AccessControlPolicy;
  keyId?: string;
  metadata?: Record<string, string>;
}

export interface DecryptRequest {
  payload: EncryptedPayload;
  authSig?: AuthSignature;
}

export interface SignRequest {
  message: string | Uint8Array;
  keyId: string;
  hashAlgorithm?: 'keccak256' | 'sha256' | 'none';
}

export interface SignedMessage {
  message: Hex;
  signature: Hex;
  recoveryId?: number;
  keyId: string;
  signedAt: number;
}

export interface ThresholdSignRequest {
  message: string | Uint8Array;
  keyId: string;
  threshold: number;
  totalParties: number;
  hashAlgorithm?: 'keccak256' | 'sha256';
}

export interface ThresholdSignature {
  signature: Hex;
  participantCount: number;
  threshold: number;
  keyId: string;
  signedAt: number;
}

export interface AuthSignature {
  sig: Hex;
  derivedVia: 'web3.eth.personal.sign' | 'EIP712' | 'siwe';
  signedMessage: string;
  address: Address;
}

export interface SessionKey {
  publicKey: Hex;
  expiration: number;
  capabilities: string[];
  authSig: AuthSignature;
}

export interface MPCKeyShare {
  shareId: string;
  publicKey: Hex;
  threshold: number;
  totalShares: number;
  createdAt: number;
}

export interface MPCSigningSession {
  sessionId: string;
  keyId: string;
  message: Hex;
  participants: Address[];
  threshold: number;
  collectedShares: number;
  status: 'pending' | 'signing' | 'complete' | 'failed';
  createdAt: number;
  expiresAt: number;
}

export interface TEEAttestation {
  quote: Hex;
  measurement: Hex;
  timestamp: number;
  verified: boolean;
  verifierSignature?: Hex;
}

export interface TEEKeyInfo {
  keyId: string;
  publicKey: Hex;
  attestation: TEEAttestation;
  enclaveId: string;
}

export interface LitConfig {
  network: 'cayenne' | 'manzano' | 'habanero' | 'datil-dev' | 'datil-test';
  debug?: boolean;
}

export interface TEEConfig {
  provider: 'phala' | 'marlin' | 'oasis';
  endpoint: string;
  apiKey?: string;
  clusterId?: string;
}

export interface MPCConfig {
  threshold: number;
  totalParties: number;
  coordinatorEndpoint: string;
}

export interface KMSConfig {
  providers: { lit?: LitConfig; tee?: TEEConfig; mpc?: MPCConfig };
  defaultProvider: KMSProviderType;
  defaultChain: string;
  registryAddress?: Address;
  fallbackEnabled?: boolean;
}
