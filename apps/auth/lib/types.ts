/**
 * Auth app types
 */

import type { AuthProvider } from '@jejunetwork/oauth3'
import type { Address, Hex } from 'viem'

export type { AuthProvider }

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

// ============ Verifiable Credentials ============

export interface VerifiableCredential {
  '@context': string[]
  type: string[]
  issuer: string
  issuanceDate: string
  expirationDate?: string
  credentialSubject: {
    id: string
    [key: string]: string | number | boolean | undefined
  }
  proof?: {
    type: string
    created: string
    verificationMethod: string
    proofPurpose: string
    proofValue: Hex
  }
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
