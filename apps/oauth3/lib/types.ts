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

export interface AuthSession {
  sessionId: string
  userId: string
  provider: AuthProvider | string
  address?: Address
  fid?: number
  email?: string
  createdAt: number
  expiresAt: number
  metadata: Record<string, string>
  ephemeralKeyId?: string
}

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

export const ClientModerationStatus = {
  ACTIVE: 'active',
  FLAGGED: 'flagged',
  SUSPENDED: 'suspended',
  BANNED: 'banned',
} as const
export type ClientModerationStatus =
  (typeof ClientModerationStatus)[keyof typeof ClientModerationStatus]

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

export const ClientTier = {
  FREE: 0,
  BASIC: 1,
  PRO: 2,
  ENTERPRISE: 3,
} as const
export type ClientTier = (typeof ClientTier)[keyof typeof ClientTier]

export interface ClientStakeInfo {
  amount: bigint
  tier: ClientTier
  verifiedAt: number
  stakeTxHash?: Hex
}

export interface ClientReputationInfo {
  score: number
  successfulAuths: number
  reportCount: number
  lastUpdated: number
}

export interface ClientModerationInfo {
  status: ClientModerationStatus
  activeReports: number
  lastReportedAt?: number
  suspensionReason?: string
  suspensionEndsAt?: number
  banTxHash?: Hex
}

export interface HashedClientSecret {
  hash: string
  salt: string
  algorithm: 'argon2id' | 'pbkdf2'
  version: number
}

export interface RegisteredClient {
  clientId: string
  clientSecret?: Hex
  clientSecretHash?: HashedClientSecret
  name: string
  redirectUris: string[]
  allowedProviders: AuthProvider[]
  owner: Address
  createdAt: number
  active: boolean
  requireSecret?: boolean
  id?: string
  allowedScopes?: string[]
  stake?: ClientStakeInfo
  reputation?: ClientReputationInfo
  moderation?: ClientModerationInfo
}

export const CLIENT_TIER_THRESHOLDS: Record<ClientTier, bigint> = {
  [ClientTier.FREE]: 0n,
  [ClientTier.BASIC]: 10n * 10n ** 18n,
  [ClientTier.PRO]: 100n * 10n ** 18n,
  [ClientTier.ENTERPRISE]: 1000n * 10n ** 18n,
}

export const CLIENT_TIER_RATE_LIMITS: Record<ClientTier, number> = {
  [ClientTier.FREE]: 100,
  [ClientTier.BASIC]: 1000,
  [ClientTier.PRO]: 10000,
  [ClientTier.ENTERPRISE]: 100000,
}

export const MIN_REPUTATION_SCORE = 3000

export const REPORT_STAKE_AMOUNT = 1n * 10n ** 18n

export interface SealedSecret {
  ciphertext: string
  iv: string
  tag: string
  sealedAt: number
}

export interface SealedOAuthProvider {
  clientId: string
  sealedSecret: SealedSecret
  redirectUri: string
  scopes: string[]
}

export interface AuthConfig {
  rpcUrl: string
  mpcRegistryAddress: Address
  identityRegistryAddress: Address
  serviceAgentId: string
  jwtSecret?: string
  jwtSigningKeyId?: string
  jwtSignerAddress?: Address
  sessionDuration: number
  allowedOrigins: string[]
  chainId?: string
  devMode?: boolean
}
