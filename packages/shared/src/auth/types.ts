/**
 * Auth Types
 */

import type { Address, Hex } from 'viem'

export type AuthMethod = 'siwe' | 'siwf' | 'passkey' | 'oauth3' | 'social'
export type SocialProvider =
  | 'google'
  | 'apple'
  | 'twitter'
  | 'github'
  | 'discord'

export interface AuthSession {
  id: string
  method: AuthMethod
  address: Address
  smartAccount?: Address
  expiresAt: number
  attestation?: TEEAttestation
  linkedProviders: LinkedProvider[]
}

export interface LinkedProvider {
  provider: SocialProvider | 'farcaster' | 'wallet'
  providerId: string
  handle: string
  linkedAt: number
  verified: boolean
}

export interface TEEAttestation {
  quote: Hex
  measurement: Hex
  timestamp: number
  verified: boolean
}

export interface SIWEMessage {
  domain: string
  address: Address
  statement?: string
  uri: string
  version: string
  chainId: number
  nonce: string
  issuedAt: string
  expirationTime?: string
  notBefore?: string
  requestId?: string
  resources?: string[]
}

export interface SIWFMessage {
  domain: string
  fid: number
  custody: Address
  nonce: string
  issuedAt: string
  expirationTime?: string
}

export interface PasskeyCredential {
  id: string
  publicKey: Uint8Array
  counter: number
  transports?: AuthenticatorTransport[]
  createdAt: number
  lastUsedAt?: number
  name?: string
}

export interface AuthConfig {
  appId: string
  appName: string
  chainId: number
  rpcUrl: string
  oauth3AgentUrl?: string
  decentralized?: boolean
  enablePasskeys?: boolean
  enableSocialLogins?: boolean
  allowedSocialProviders?: SocialProvider[]
}

export interface AuthState {
  session: AuthSession | null
  isLoading: boolean
  isAuthenticated: boolean
  error: string | null
}

export interface AuthActions {
  loginWithWallet: () => Promise<AuthSession>
  loginWithFarcaster: () => Promise<AuthSession>
  loginWithPasskey: () => Promise<AuthSession>
  loginWithSocial: (provider: SocialProvider) => Promise<AuthSession>
  logout: () => Promise<void>
  linkProvider: (
    provider: SocialProvider | 'farcaster',
  ) => Promise<LinkedProvider>
  unlinkProvider: (provider: SocialProvider | 'farcaster') => Promise<void>
  signMessage: (message: string | Uint8Array) => Promise<Hex>
  registerPasskey: (name?: string) => Promise<PasskeyCredential>
  refreshSession: () => Promise<AuthSession>
}

export type AuthContextType = AuthState & AuthActions
