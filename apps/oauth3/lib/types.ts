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

export interface RegisteredClient {
  clientId: string
  clientSecret?: Hex
  name: string
  redirectUris: string[]
  allowedProviders: AuthProvider[]
  owner: Address
  createdAt: number
  active: boolean
}

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
