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

export interface AuthSession {
  sessionId: string
  userId: string
  provider: AuthProvider
  address?: Address
  fid?: number
  email?: string
  createdAt: number
  expiresAt: number
  metadata: Record<string, string>
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

export interface RegisteredClient {
  clientId: string
  clientSecret?: Hex
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

// ============ Config ============

export interface AuthConfig {
  rpcUrl: string
  mpcRegistryAddress: Address
  identityRegistryAddress: Address
  serviceAgentId: string
  jwtSecret: string
  sessionDuration: number
  allowedOrigins: string[]
}
