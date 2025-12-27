/**
 * Auth app types
 */

import type { Address, Hex } from 'viem'

// Local definition of AuthProvider to avoid importing React components from @jejunetwork/auth
export const AuthProvider = {
  WALLET: 'wallet',
  FARCASTER: 'farcaster',
  GOOGLE: 'google',
  APPLE: 'apple',
  TWITTER: 'twitter',
  GITHUB: 'github',
  DISCORD: 'discord',
  EMAIL: 'email',
  PHONE: 'phone',
} as const
export type AuthProvider = (typeof AuthProvider)[keyof typeof AuthProvider]

// ============ Session Types ============

/** Encrypted PII data stored separately from session */
export interface EncryptedSessionPII {
  /** Encrypted ciphertext containing address, email, fid */
  ciphertext: string
  /** Initialization vector */
  iv: string
  /** KMS key ID used for encryption */
  keyId: string
  /** When data was encrypted */
  encryptedAt: number
}

export interface AuthSession {
  sessionId: string
  userId: string
  provider: AuthProvider
  /**
   * @deprecated Use encryptedPII instead. Plain PII is insecure.
   */
  address?: Address
  /**
   * @deprecated Use encryptedPII instead.
   */
  fid?: number
  /**
   * @deprecated Use encryptedPII instead.
   */
  email?: string
  /** Encrypted PII (address, email, fid) */
  encryptedPII?: EncryptedSessionPII
  createdAt: number
  expiresAt: number
  metadata: Record<string, string>
  /** Ephemeral key ID for this session */
  ephemeralKeyId?: string
}

// ============ OAuth Flow Types ============

export interface AuthRequest {
  clientId: string
  redirectUri: string
  provider: AuthProvider
  scope?: string[]
  state?: string
  nonce?: string
  codeChallenge?: string
  codeChallengeMethod?: 'S256' | 'plain'
}

export interface AuthCallback {
  code: string
  state?: string
}

export interface AuthToken {
  accessToken: string
  tokenType: 'Bearer'
  expiresIn: number
  refreshToken?: string
  scope?: string[]
  idToken?: string
}

// ============ Wallet Auth Types ============

export interface WalletAuthChallenge {
  challengeId: string
  message: string
  expiresAt: number
}

export interface WalletAuthVerify {
  challengeId: string
  address: Address
  signature: Hex
}

// ============ Farcaster Auth Types ============

export interface FarcasterAuthRequest {
  fid?: number
  custody?: Address
  nonce: string
  domain: string
  siweUri: string
}

export interface FarcasterAuthVerify {
  message: string
  signature: Hex
  fid: number
  custody: Address
}

// ============ Client Registration ============

/** Moderation status for registered clients */
export const ClientModerationStatus = {
  ACTIVE: 'active',
  FLAGGED: 'flagged',
  SUSPENDED: 'suspended',
  BANNED: 'banned',
} as const
export type ClientModerationStatus =
  (typeof ClientModerationStatus)[keyof typeof ClientModerationStatus]

/** Report category for client violations */
export const ReportCategory = {
  SPAM: 'spam',
  PHISHING: 'phishing',
  MALWARE: 'malware',
  IMPERSONATION: 'impersonation',
  TOS_VIOLATION: 'tos_violation',
  SCAM: 'scam',
  OTHER: 'other',
} as const
export type ReportCategory =
  (typeof ReportCategory)[keyof typeof ReportCategory]

/** Staking tier for client registration */
export const ClientTier = {
  FREE: 0,
  BASIC: 1,
  PRO: 2,
  ENTERPRISE: 3,
} as const
export type ClientTier = (typeof ClientTier)[keyof typeof ClientTier]

export interface ClientStakeInfo {
  /** Amount staked in wei */
  amount: bigint
  /** Tier based on stake amount */
  tier: ClientTier
  /** When stake was verified */
  verifiedAt: number
  /** Transaction hash of stake */
  stakeTxHash?: Hex
}

export interface ClientReputationInfo {
  /** Reputation score 0-10000 (basis points) */
  score: number
  /** Number of successful authentications */
  successfulAuths: number
  /** Number of reported issues */
  reportCount: number
  /** Last updated timestamp */
  lastUpdated: number
}

export interface ClientModerationInfo {
  /** Current moderation status */
  status: ClientModerationStatus
  /** Number of active reports */
  activeReports: number
  /** Last report timestamp */
  lastReportedAt?: number
  /** Suspension reason if suspended */
  suspensionReason?: string
  /** Suspension end time if temporarily suspended */
  suspensionEndsAt?: number
  /** Ban transaction hash if banned on-chain */
  banTxHash?: Hex
}

/** Hashed client secret for secure storage */
export interface HashedClientSecret {
  /** Argon2id/PBKDF2 hash of the secret */
  hash: string
  /** Per-client random salt */
  salt: string
  /** Hash algorithm used */
  algorithm: 'argon2id' | 'pbkdf2'
  /** Schema version for migrations */
  version: number
}

export interface RegisteredClient {
  clientId: string
  /**
   * @deprecated Use clientSecretHash instead. Plain secrets are insecure.
   * Only present for migration purposes.
   */
  clientSecret?: Hex
  /** Hashed client secret (secure storage) */
  clientSecretHash?: HashedClientSecret
  name: string
  redirectUris: string[]
  allowedProviders: AuthProvider[]
  owner: Address
  createdAt: number
  active: boolean
  /** Staking information */
  stake?: ClientStakeInfo
  /** Reputation information */
  reputation?: ClientReputationInfo
  /** Moderation information */
  moderation?: ClientModerationInfo
}

/** Minimum stake amounts per tier (in wei) */
export const CLIENT_TIER_THRESHOLDS: Record<ClientTier, bigint> = {
  [ClientTier.FREE]: 0n,
  [ClientTier.BASIC]: 10n * 10n ** 18n, // 10 JEJU
  [ClientTier.PRO]: 100n * 10n ** 18n, // 100 JEJU
  [ClientTier.ENTERPRISE]: 1000n * 10n ** 18n, // 1000 JEJU
}

/** Rate limits per tier */
export const CLIENT_TIER_RATE_LIMITS: Record<ClientTier, number> = {
  [ClientTier.FREE]: 100, // 100 requests/min
  [ClientTier.BASIC]: 1000, // 1000 requests/min
  [ClientTier.PRO]: 10000, // 10000 requests/min
  [ClientTier.ENTERPRISE]: 100000, // 100000 requests/min
}

/** Minimum reputation score to register a client */
export const MIN_REPUTATION_SCORE = 3000 // 30%

/** Report stake required to file a report (in wei) */
export const REPORT_STAKE_AMOUNT = 1n * 10n ** 18n // 1 JEJU

// ============ Sealed OAuth Secrets ============

/** Sealed secret that can only be decrypted inside verified TEE */
export interface SealedSecret {
  /** AES-GCM encrypted ciphertext */
  ciphertext: string
  /** Initialization vector */
  iv: string
  /** Authentication tag */
  tag: string
  /** When secret was sealed */
  sealedAt: number
}

/** OAuth provider configuration with sealed secrets */
export interface SealedOAuthProvider {
  clientId: string
  /** Sealed client secret - requires TEE attestation to decrypt */
  sealedSecret: SealedSecret
  redirectUri: string
  scopes: string[]
}

// ============ Config ============

export interface AuthConfig {
  rpcUrl: string
  mpcRegistryAddress: Address
  identityRegistryAddress: Address
  serviceAgentId: string
  /**
   * @deprecated Use KMS-backed signing instead.
   * This field will be removed in favor of MPC threshold signing.
   */
  jwtSecret: string
  /** MPC key ID for JWT signing (replaces jwtSecret) */
  jwtSigningKeyId?: string
  /** MPC signer address for JWT verification */
  jwtSignerAddress?: Address
  sessionDuration: number
  allowedOrigins: string[]
  /** Chain ID for KMS access policies */
  chainId?: string
  /** Whether running in dev mode (no MPC) */
  devMode?: boolean
}
