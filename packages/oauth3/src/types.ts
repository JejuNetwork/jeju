/**
 * OAuth3 Core Types
 *
 * Decentralized authentication with TEE-backed key management,
 * threshold MPC signing, and W3C Verifiable Credentials.
 */

import type { Address, Hex } from 'viem'

// ============ JSON Value Types ============
// Use these instead of `unknown` when dealing with JSON data

/** Represents any valid JSON value */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | JsonRecord

/** Represents a JSON object with string keys */
export type JsonRecord = { [key: string]: JsonValue }

// ============ Provider Types ============

export enum AuthProvider {
  WALLET = 'wallet',
  FARCASTER = 'farcaster',
  GOOGLE = 'google',
  APPLE = 'apple',
  TWITTER = 'twitter',
  GITHUB = 'github',
  DISCORD = 'discord',
  EMAIL = 'email',
  PHONE = 'phone',
}

export enum ChainId {
  // Jeju Network
  JEJU_LOCALNET = 420691,
  JEJU_TESTNET = 420690,
  JEJU_MAINNET = 420692,
  // Ethereum & L2s
  ETHEREUM = 1,
  OPTIMISM = 10,
  ARBITRUM = 42161,
  BASE = 8453,
  BASE_SEPOLIA = 84532,
  // Other EVM chains
  BSC = 56,
  POLYGON = 137,
  AVALANCHE = 43114,
}

// ============ Identity Types ============

export interface OAuth3Identity {
  id: Hex
  owner: Address
  smartAccount: Address
  providers: LinkedProvider[]
  createdAt: number
  updatedAt: number
  nonce: bigint
  metadata: IdentityMetadata
}

export interface LinkedProvider {
  provider: AuthProvider
  providerId: string
  providerHandle: string
  linkedAt: number
  verified: boolean
  credential: VerifiableCredential | null
}

export interface IdentityMetadata {
  name: string
  avatar: string
  bio: string
  url: string
  jnsName: string | null
}

// ============ Session Types ============

/**
 * Public session data that can be safely exposed to clients.
 * SECURITY: The signing key is intentionally excluded and kept only in the TEE.
 */
export interface OAuth3Session {
  sessionId: Hex
  identityId: Hex
  smartAccount: Address
  expiresAt: number
  capabilities: SessionCapability[]
  /** Public key derived from the signing key - can be used to verify signatures */
  signingPublicKey: Hex
  attestation: TEEAttestation
}

/**
 * Internal session data used only within the TEE.
 * SECURITY: This type should NEVER be exposed to clients or stored in localStorage.
 * @internal
 */
export interface OAuth3InternalSession extends OAuth3Session {
  /** Private signing key - MUST stay within the TEE */
  signingKey: Hex
}

export enum SessionCapability {
  SIGN_TRANSACTION = 'sign_transaction',
  SIGN_MESSAGE = 'sign_message',
  MANAGE_IDENTITY = 'manage_identity',
  DELEGATE = 'delegate',
}

// ============ TEE Types ============

export interface TEEAttestation {
  quote: Hex
  measurement: Hex
  reportData: Hex
  timestamp: number
  provider: TEEProvider
  verified: boolean
}

export enum TEEProvider {
  DSTACK = 'dstack',
  PHALA = 'phala',
  SIMULATED = 'simulated',
}

export interface TEENodeInfo {
  nodeId: string
  endpoint: string
  provider: TEEProvider
  attestation: TEEAttestation
  publicKey: Hex
  stake: bigint
  active: boolean
}

// ============ MPC Types ============

export interface MPCCluster {
  clusterId: string
  nodes: MPCNode[]
  threshold: number
  totalNodes: number
  publicKey: Hex
  networkPublicKey: Hex
}

export interface MPCNode {
  nodeId: string
  index: number
  endpoint: string
  publicKey: Hex
  teeAttestation: TEEAttestation
  active: boolean
}

export interface MPCSignatureRequest {
  requestId: Hex
  keyId: string
  message: Hex
  messageHash: Hex
  requester: Address
  threshold: number
  participants: string[]
  status: MPCSignatureStatus
  createdAt: number
  expiresAt: number
}

export enum MPCSignatureStatus {
  PENDING = 'pending',
  SIGNING = 'signing',
  COMPLETE = 'complete',
  FAILED = 'failed',
  EXPIRED = 'expired',
}

export interface MPCSignatureResult {
  signature: Hex
  r: Hex
  s: Hex
  v: number
  participants: string[]
  requestId: Hex
}

// ============ OAuth App Types (Multi-tenant) ============

export interface OAuth3App {
  appId: Hex
  name: string
  description: string
  owner: Address
  council: Address
  redirectUris: string[]
  allowedProviders: AuthProvider[]
  jnsName: string
  createdAt: number
  active: boolean
  metadata: OAuth3AppMetadata
}

export interface OAuth3AppMetadata {
  logoUri: string
  policyUri: string
  termsUri: string
  supportEmail: string
  webhookUrl: string
}

export interface OAuth3AppCredentials {
  clientId: Hex
  clientSecretHash: Hex
  encryptedClientSecret: Hex
}

// ============ Farcaster Types ============

export interface FarcasterIdentity {
  fid: number
  username: string
  displayName: string
  pfpUrl: string
  bio: string
  custodyAddress: Address
  verifiedAddresses: Address[]
  signerPublicKey: Hex
}

export interface FarcasterSignerRequest {
  fid: number
  signerPublicKey: Hex
  signature: Hex
  deadline: number
}

// ============ Verifiable Credentials ============

export interface VerifiableCredential {
  '@context': string[]
  type: string[]
  id: string
  issuer: CredentialIssuer
  issuanceDate: string
  expirationDate: string
  credentialSubject: CredentialSubject
  proof: CredentialProof
}

export interface CredentialIssuer {
  id: string
  name: string
}

export interface CredentialSubject {
  id: string
  provider: AuthProvider
  providerId: string
  providerHandle: string
  walletAddress: Address
  verifiedAt: string
}

export interface CredentialProof {
  type: string
  created: string
  verificationMethod: string
  proofPurpose: string
  proofValue: Hex
  jws?: string
}

export enum CredentialType {
  OAUTH3_IDENTITY = 'OAuth3Identity',
  FARCASTER_ACCOUNT = 'FarcasterAccount',
  GOOGLE_ACCOUNT = 'GoogleAccount',
  TWITTER_ACCOUNT = 'TwitterAccount',
  GITHUB_ACCOUNT = 'GitHubAccount',
}

// ============ Smart Account Types ============

export interface AccountFactoryConfig {
  entryPoint: Address
  defaultValidator: Address
  recoveryModule: Address
  sessionKeyModule: Address
}

export interface SmartAccountInfo {
  address: Address
  owner: Address
  identityId: Hex
  nonce: bigint
  deployed: boolean
  modules: Address[]
  sessionKeys: SessionKeyInfo[]
}

export interface SessionKeyInfo {
  publicKey: Hex
  permissions: SessionPermission[]
  validAfter: number
  validUntil: number
  active: boolean
}

export interface SessionPermission {
  target: Address
  selector: Hex
  maxValue: bigint
  rateLimit: number
}

// ============ Council Integration Types ============

export interface CouncilConfig {
  councilId: Hex
  name: string
  treasury: Address
  ceoAgent: Address
  councilAgents: Address[]
  oauth3App: Hex
  jnsName: string
}

export enum CouncilType {
  JEJU = 'jeju',
  BABYLON = 'babylon',
  ELIZA = 'eliza',
}

// ============ Open Intent Types ============

export interface CrossChainIdentity {
  identityId: Hex
  homeChain: ChainId
  deployedChains: ChainId[]
  smartAccounts: Map<ChainId, Address>
  intentNonce: bigint
}

export interface IdentityIntent {
  intentId: Hex
  identityId: Hex
  sourceChain: ChainId
  destinationChain: ChainId
  action: IdentityIntentAction
  payload: Hex
  signature: Hex
  status: IntentStatus
}

export enum IdentityIntentAction {
  DEPLOY_ACCOUNT = 'deploy_account',
  LINK_PROVIDER = 'link_provider',
  UNLINK_PROVIDER = 'unlink_provider',
  UPDATE_METADATA = 'update_metadata',
  ROTATE_KEY = 'rotate_key',
}

export enum IntentStatus {
  PENDING = 'pending',
  SUBMITTED = 'submitted',
  FILLED = 'filled',
  EXPIRED = 'expired',
  FAILED = 'failed',
}

export interface CrossChainIntent {
  intentId: Hex
  sourceChain: ChainId
  targetChain: ChainId
  sender: Address
  receiver: Address
  tokenAddress: Address
  amount: bigint
  data: Hex
  deadline: number
  signature: Hex
}

export interface IntentSolution {
  solverId: Address
  intentId: Hex
  executionData: Hex
  gasUsed: bigint
  timestamp: number
}

// ============ Error Types ============

export interface OAuth3ErrorDetails {
  /** Provider that caused the error */
  provider?: AuthProvider
  /** Session ID related to the error */
  sessionId?: Hex
  /** Identity ID related to the error */
  identityId?: Hex
  /** App ID related to the error */
  appId?: Hex
  /** Address involved in the error */
  address?: Address
  /** Credential ID related to the error */
  credentialId?: string
  /** Chain ID where the error occurred */
  chainId?: number
  /** Expected value in validation errors */
  expected?: string
  /** Actual value in validation errors */
  actual?: string
  /** Threshold-related info for MPC errors */
  threshold?: number
  /** Number of participants in MPC errors */
  participants?: number
}

export class OAuth3Error extends Error {
  constructor(
    message: string,
    public code: OAuth3ErrorCode,
    public details?: OAuth3ErrorDetails,
  ) {
    super(message)
    this.name = 'OAuth3Error'
  }
}

export enum OAuth3ErrorCode {
  INVALID_PROVIDER = 'INVALID_PROVIDER',
  PROVIDER_NOT_LINKED = 'PROVIDER_NOT_LINKED',
  PROVIDER_ALREADY_LINKED = 'PROVIDER_ALREADY_LINKED',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  INSUFFICIENT_THRESHOLD = 'INSUFFICIENT_THRESHOLD',
  TEE_ATTESTATION_FAILED = 'TEE_ATTESTATION_FAILED',
  MPC_SIGNING_FAILED = 'MPC_SIGNING_FAILED',
  IDENTITY_NOT_FOUND = 'IDENTITY_NOT_FOUND',
  ACCOUNT_NOT_DEPLOYED = 'ACCOUNT_NOT_DEPLOYED',
  CREDENTIAL_INVALID = 'CREDENTIAL_INVALID',
  CREDENTIAL_EXPIRED = 'CREDENTIAL_EXPIRED',
  APP_NOT_FOUND = 'APP_NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
}
