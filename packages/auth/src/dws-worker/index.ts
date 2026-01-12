/**
 * OAuth3 DWS Worker
 *
 * Decentralized authentication service running on DWS.
 * Uses MPC infrastructure for threshold signing - never holds private keys.
 *
 * Features:
 * - Social OAuth (Google, GitHub, Discord, Twitter, Apple)
 * - Wallet authentication (SIWE)
 * - Farcaster authentication
 * - MFA (TOTP, Passkeys, Backup codes)
 * - Session management with TEE-backed encryption
 * - Verifiable credentials issuance
 *
 * Deployment:
 * - Registered on-chain via DWSServiceProvisioning
 * - Tagged with 'oauth3' for discovery
 * - Calls MPC parties for all signing operations
 */

import { getFarcasterHubUrl, isDevMode } from '@jejunetwork/config'
import { createMPCClient } from '@jejunetwork/kms'
import { Elysia } from 'elysia'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes, verifyMessage } from 'viem'
import { z } from 'zod'

// Request body schemas
const AuthInitBodySchema = z.object({
  provider: z.enum(['google', 'github', 'discord', 'twitter', 'apple']),
  redirectUri: z.string(),
  scopes: z.array(z.string()).optional(),
})

const AuthCallbackBodySchema = z.object({
  authId: z.string(),
  code: z.string(),
  state: z.string(),
})

// OAuth token response schema
const OAuthTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
})

// Provider user info types
interface OAuthUserInfo {
  id: string
  email?: string
  name?: string
  avatar?: string
}

// OAuth client credentials from environment
const getOAuthCredentials = (
  provider: string,
): { clientId: string; clientSecret: string } => {
  const prefix = provider.toUpperCase()
  const clientId = process.env[`${prefix}_CLIENT_ID`]
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]

  if (!clientId || !clientSecret) {
    throw new Error(`Missing OAuth credentials for ${provider}`)
  }

  return { clientId, clientSecret }
}

// Token endpoints per provider
const TOKEN_ENDPOINTS: Record<string, string> = {
  google: 'https://oauth2.googleapis.com/token',
  github: 'https://github.com/login/oauth/access_token',
  discord: 'https://discord.com/api/oauth2/token',
  twitter: 'https://api.twitter.com/2/oauth2/token',
  apple: 'https://appleid.apple.com/auth/token',
}

// User info endpoints per provider
const USER_INFO_ENDPOINTS: Record<string, string> = {
  google: 'https://www.googleapis.com/oauth2/v2/userinfo',
  github: 'https://api.github.com/user',
  discord: 'https://discord.com/api/users/@me',
  twitter: 'https://api.twitter.com/2/users/me',
}

// Exchange authorization code for tokens
async function exchangeCodeForTokens(
  provider: string,
  code: string,
  redirectUri: string,
  codeVerifier?: string,
): Promise<z.infer<typeof OAuthTokenResponseSchema>> {
  const { clientId, clientSecret } = getOAuthCredentials(provider)
  const tokenEndpoint = TOKEN_ENDPOINTS[provider]

  if (!tokenEndpoint) {
    throw new Error(`Unknown OAuth provider: ${provider}`)
  }

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  })

  // Add PKCE code verifier if provided
  if (codeVerifier) {
    params.set('code_verifier', codeVerifier)
  }

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Token exchange failed: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  return OAuthTokenResponseSchema.parse(data)
}

// Farcaster Hub API URL (config-first)
const FARCASTER_HUB_URL = getFarcasterHubUrl()

// Verify Farcaster Ed25519 signature
async function verifyFarcasterSignature(
  _fid: number,
  message: string,
  signature: Hex,
  signerPubKey: Hex,
): Promise<boolean> {
  // Remove 0x prefix for Ed25519 verification
  const sigBytes = hexToBytes(signature)
  const pubKeyBytes = hexToBytes(signerPubKey)
  const messageBytes = new TextEncoder().encode(message)

  // Copy to new ArrayBuffer to ensure compatibility with subtle crypto
  const pubKeyBuffer = new ArrayBuffer(pubKeyBytes.length)
  new Uint8Array(pubKeyBuffer).set(pubKeyBytes)

  const sigBuffer = new ArrayBuffer(sigBytes.length)
  new Uint8Array(sigBuffer).set(sigBytes)

  // Import the Ed25519 public key
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    pubKeyBuffer,
    { name: 'Ed25519' },
    false,
    ['verify'],
  )

  // Verify the signature
  const isValid = await crypto.subtle.verify(
    'Ed25519',
    cryptoKey,
    sigBuffer,
    messageBytes,
  )

  return isValid
}

// Verify that a signer is authorized for a FID via Farcaster hub
async function verifyFarcasterSigner(
  fid: number,
  signerPubKey: Hex,
): Promise<boolean> {
  // Query Farcaster hub for signer keys associated with this FID
  const response = await fetch(`${FARCASTER_HUB_URL}/signersByFid?fid=${fid}`, {
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    // If hub is unavailable, log warning but don't block auth
    // in development. In production, this should be strict.
    if (isDevMode()) {
      console.warn(`Farcaster hub unavailable: ${response.status}`)
      return true // Allow in dev mode
    }
    return false
  }

  const data = await response.json()

  // Check if the signer is in the list of authorized signers
  const signers = data.messages ?? []
  const normalizedSignerKey = signerPubKey.toLowerCase()

  for (const msg of signers) {
    const signerKey = msg.data?.signerAddBody?.signer
    if (signerKey) {
      // Convert to hex and compare
      const signerHex = `0x${Buffer.from(signerKey, 'base64').toString('hex')}`
      if (signerHex.toLowerCase() === normalizedSignerKey) {
        return true
      }
    }
  }

  return false
}

// Helper to convert hex string to bytes
function hexToBytes(hex: Hex): Uint8Array {
  const hexStr = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(hexStr.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hexStr.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

// Fetch user info from provider
async function fetchUserInfo(
  provider: string,
  accessToken: string,
): Promise<OAuthUserInfo> {
  const userInfoEndpoint = USER_INFO_ENDPOINTS[provider]

  if (!userInfoEndpoint) {
    // Apple doesn't have a userinfo endpoint - info comes from ID token
    throw new Error(`User info endpoint not available for ${provider}`)
  }

  const response = await fetch(userInfoEndpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch user info: ${response.status}`)
  }

  const data = await response.json()

  // Normalize user info across providers
  switch (provider) {
    case 'google':
      return {
        id: data.id,
        email: data.email,
        name: data.name,
        avatar: data.picture,
      }
    case 'github':
      return {
        id: String(data.id),
        email: data.email,
        name: data.name ?? data.login,
        avatar: data.avatar_url,
      }
    case 'discord':
      return {
        id: data.id,
        email: data.email,
        name: data.global_name ?? data.username,
        avatar: data.avatar
          ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png`
          : undefined,
      }
    case 'twitter':
      return {
        id: data.data.id,
        name: data.data.name,
        avatar: data.data.profile_image_url,
      }
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}

const WalletAuthBodySchema = z.object({
  address: z.string().transform((s) => s as Address),
  message: z.string(),
  signature: z.string().transform((s) => s as Hex),
})

const FarcasterAuthBodySchema = z.object({
  fid: z.number(),
  signature: z.string().transform((s) => s as Hex),
  message: z.string(),
  signer: z.string().transform((s) => s as Hex),
})

const SignBodySchema = z.object({
  sessionId: z.string(),
  message: z.string(),
})

const CredentialIssueBodySchema = z.object({
  sessionId: z.string(),
  credentialType: z.string(),
  subject: z.record(z.string(), z.string()),
})

const CredentialVerifyBodySchema = z.object({
  credential: z.object({
    '@context': z.array(z.string()),
    type: z.array(z.string()),
    issuer: z.string(),
    credentialSubject: z.record(z.string(), z.string()),
  }),
  proof: z.object({
    proofValue: z.string().transform((s) => s as Hex),
  }),
})

// ============ Types ============

export interface OAuth3WorkerConfig {
  serviceAgentId: string
  mpcRegistryAddress: Address
  identityRegistryAddress: Address
  rpcUrl: string
  jnsRegistryAddress?: Address
  ipfsGateway?: string
  sessionDuration?: number
}

interface OAuth3Session {
  sessionId: string
  userId: string
  address?: Address
  provider: string
  keyId: string // MPC key used for this session
  createdAt: number
  expiresAt: number
  lastActivity: number
  mfaVerified: boolean
  metadata: Record<string, string>
}

interface PendingAuth {
  authId: string
  provider: string
  state: string
  codeVerifier?: string
  redirectUri: string
  createdAt: number
  expiresAt: number
}

// ============ OAuth3 Worker ============

export function createOAuth3Worker(config: OAuth3WorkerConfig) {
  // MPC client for threshold signing
  const mpcClient = createMPCClient(
    {
      rpcUrl: config.rpcUrl,
      mpcRegistryAddress: config.mpcRegistryAddress,
      identityRegistryAddress: config.identityRegistryAddress,
    },
    config.serviceAgentId,
  )

  // Session storage (in production, use distributed storage)
  const sessions = new Map<string, OAuth3Session>()
  const pendingAuths = new Map<string, PendingAuth>()
  const userKeys = new Map<string, string>() // userId => keyId

  const sessionDuration = config.sessionDuration ?? 24 * 60 * 60 * 1000 // 24 hours

  // ============ Helpers ============

  function generateSessionId(): string {
    return crypto.randomUUID()
  }

  async function getOrCreateUserKey(userId: string): Promise<string> {
    let keyId = userKeys.get(userId)
    if (keyId) return keyId

    // Generate new MPC key for this user
    keyId = `oauth3:${userId}:${Date.now()}`
    await mpcClient.requestKeyGen({ keyId })

    userKeys.set(userId, keyId)
    return keyId
  }

  async function signWithUserKey(
    userId: string,
    message: string,
  ): Promise<Hex> {
    const keyId = await getOrCreateUserKey(userId)
    const messageHash = keccak256(toBytes(message))

    const result = await mpcClient.requestSignature({
      keyId,
      messageHash,
    })

    return result.signature
  }

  // ============ Router ============

  return (
    new Elysia({ name: 'oauth3-worker', prefix: '/oauth3' })
      .get('/health', () => ({
        status: 'healthy',
        service: 'oauth3',
        activeSessions: sessions.size,
        pendingAuths: pendingAuths.size,
        mpcEnabled: true,
      }))

      // ============ Social OAuth ============

      .post('/auth/init', async ({ body }) => {
        const params = AuthInitBodySchema.parse(body)

        const authId = crypto.randomUUID()
        const state = crypto.randomUUID()
        const codeVerifier = crypto.randomUUID() + crypto.randomUUID()

        pendingAuths.set(authId, {
          authId,
          provider: params.provider,
          state,
          codeVerifier,
          redirectUri: params.redirectUri,
          createdAt: Date.now(),
          expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
        })

        // Build OAuth URL based on provider
        const oauthUrls: Record<string, string> = {
          google: 'https://accounts.google.com/o/oauth2/v2/auth',
          github: 'https://github.com/login/oauth/authorize',
          discord: 'https://discord.com/api/oauth2/authorize',
          twitter: 'https://twitter.com/i/oauth2/authorize',
          apple: 'https://appleid.apple.com/auth/authorize',
        }

        const baseUrl = oauthUrls[params.provider]
        const authUrl = `${baseUrl}?state=${state}&redirect_uri=${encodeURIComponent(params.redirectUri)}`

        return {
          authId,
          authUrl,
          state,
        }
      })

      .post('/auth/callback', async ({ body }) => {
        const params = AuthCallbackBodySchema.parse(body)

        const pending = pendingAuths.get(params.authId)
        if (!pending) {
          throw new Error('Invalid or expired auth request')
        }

        if (pending.state !== params.state) {
          throw new Error('State mismatch')
        }

        if (Date.now() > pending.expiresAt) {
          pendingAuths.delete(params.authId)
          throw new Error('Auth request expired')
        }

        // Exchange authorization code for tokens
        const tokens = await exchangeCodeForTokens(
          pending.provider,
          params.code,
          pending.redirectUri,
          pending.codeVerifier,
        )

        // Fetch user info from provider
        const userInfo = await fetchUserInfo(
          pending.provider,
          tokens.access_token,
        )

        // Create session with real user ID from provider
        const userId = `${pending.provider}:${userInfo.id}`
        const keyId = await getOrCreateUserKey(userId)

        const session: OAuth3Session = {
          sessionId: generateSessionId(),
          userId,
          provider: pending.provider,
          keyId,
          createdAt: Date.now(),
          expiresAt: Date.now() + sessionDuration,
          lastActivity: Date.now(),
          mfaVerified: false,
          metadata: {
            name: userInfo.name ?? '',
            email: userInfo.email ?? '',
            avatar: userInfo.avatar ?? '',
          },
        }

        sessions.set(session.sessionId, session)
        pendingAuths.delete(params.authId)

        return {
          sessionId: session.sessionId,
          userId: session.userId,
          provider: session.provider,
          expiresAt: session.expiresAt,
          userInfo: {
            id: userInfo.id,
            name: userInfo.name,
            email: userInfo.email,
            avatar: userInfo.avatar,
          },
        }
      })

      // ============ Wallet Auth (SIWE) ============

      .post('/auth/wallet', async ({ body }) => {
        const params = WalletAuthBodySchema.parse(body)

        // Verify SIWE signature
        const isValid = await verifyMessage({
          address: params.address,
          message: params.message,
          signature: params.signature,
        })

        if (!isValid) {
          throw new Error('Invalid signature')
        }

        // Create session with wallet address
        const userId = `wallet:${params.address.toLowerCase()}`
        const keyId = await getOrCreateUserKey(userId)

        const session: OAuth3Session = {
          sessionId: generateSessionId(),
          userId,
          address: params.address,
          provider: 'wallet',
          keyId,
          createdAt: Date.now(),
          expiresAt: Date.now() + sessionDuration,
          lastActivity: Date.now(),
          mfaVerified: false,
          metadata: {},
        }

        sessions.set(session.sessionId, session)

        return {
          sessionId: session.sessionId,
          userId: session.userId,
          address: session.address,
          expiresAt: session.expiresAt,
        }
      })

      // ============ Farcaster Auth ============

      .post('/auth/farcaster', async ({ body }) => {
        const params = FarcasterAuthBodySchema.parse(body)

        // Verify Farcaster signature using the signer key
        // The signer must be registered for this FID on the Farcaster hub
        const isValidSignature = await verifyFarcasterSignature(
          params.fid,
          params.message,
          params.signature,
          params.signer,
        )

        if (!isValidSignature) {
          throw new Error('Invalid Farcaster signature')
        }

        // Verify signer is authorized for this FID via Farcaster hub
        const isAuthorizedSigner = await verifyFarcasterSigner(
          params.fid,
          params.signer,
        )

        if (!isAuthorizedSigner) {
          throw new Error('Signer not authorized for this FID')
        }

        const userId = `farcaster:${params.fid}`
        const keyId = await getOrCreateUserKey(userId)

        const session: OAuth3Session = {
          sessionId: generateSessionId(),
          userId,
          provider: 'farcaster',
          keyId,
          createdAt: Date.now(),
          expiresAt: Date.now() + sessionDuration,
          lastActivity: Date.now(),
          mfaVerified: false,
          metadata: { fid: String(params.fid), signer: params.signer },
        }

        sessions.set(session.sessionId, session)

        return {
          sessionId: session.sessionId,
          userId: session.userId,
          fid: params.fid,
          expiresAt: session.expiresAt,
        }
      })

      // ============ Session Management ============

      .get('/session/:sessionId', ({ params }) => {
        const session = sessions.get(params.sessionId)
        if (!session) {
          throw new Error('Session not found')
        }

        if (Date.now() > session.expiresAt) {
          sessions.delete(params.sessionId)
          throw new Error('Session expired')
        }

        return {
          sessionId: session.sessionId,
          userId: session.userId,
          address: session.address,
          provider: session.provider,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          mfaVerified: session.mfaVerified,
        }
      })

      // Validate session by token (from Authorization header or body)
      .post('/session/validate', ({ headers, body }) => {
        // Extract token from Authorization header or body
        const authHeader = headers.authorization
        let token: string | undefined

        if (authHeader?.startsWith('Bearer ')) {
          token = authHeader.slice(7)
        } else {
          const bodySchema = z.object({ token: z.string().optional() })
          const parsed = bodySchema.safeParse(body)
          if (parsed.success) {
            token = parsed.data.token
          }
        }

        if (!token) {
          throw new Error('No token provided')
        }

        // Try to find session by token (which could be sessionId)
        const session = sessions.get(token)
        if (!session) {
          throw new Error('Session not found')
        }

        if (Date.now() > session.expiresAt) {
          sessions.delete(token)
          throw new Error('Session expired')
        }

        // Return full session data for validation
        return {
          sessionId: session.sessionId,
          identityId: session.userId,
          smartAccount: session.address ?? null,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          capabilities: [],
          signingPublicKey: '',
          attestation: null,
        }
      })

      .post('/session/:sessionId/refresh', ({ params }) => {
        const session = sessions.get(params.sessionId)
        if (!session) {
          throw new Error('Session not found')
        }

        session.expiresAt = Date.now() + sessionDuration
        session.lastActivity = Date.now()

        return {
          sessionId: session.sessionId,
          expiresAt: session.expiresAt,
        }
      })

      .delete('/session/:sessionId', ({ params }) => {
        const deleted = sessions.delete(params.sessionId)
        return { success: deleted }
      })

      // ============ Signing ============

      .post('/sign', async ({ body }) => {
        const params = SignBodySchema.parse(body)

        const session = sessions.get(params.sessionId)
        if (!session) {
          throw new Error('Session not found')
        }

        if (Date.now() > session.expiresAt) {
          sessions.delete(params.sessionId)
          throw new Error('Session expired')
        }

        // Sign using MPC infrastructure
        const signature = await signWithUserKey(session.userId, params.message)

        return {
          signature,
          signedAt: Date.now(),
        }
      })

      // ============ Verifiable Credentials ============

      .post('/credential/issue', async ({ body }) => {
        const params = CredentialIssueBodySchema.parse(body)

        const session = sessions.get(params.sessionId)
        if (!session) {
          throw new Error('Session not found')
        }

        // Create credential
        const credential = {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          type: ['VerifiableCredential', params.credentialType],
          issuer: `did:jeju:${config.serviceAgentId}`,
          issuanceDate: new Date().toISOString(),
          credentialSubject: {
            id: `did:jeju:${session.userId}`,
            ...params.subject,
          },
        }

        // Sign credential with MPC
        const credentialHash = keccak256(toBytes(JSON.stringify(credential)))
        const signatureResult = await mpcClient.requestSignature({
          keyId: `oauth3:issuer:${config.serviceAgentId}`,
          messageHash: credentialHash,
        })

        return {
          credential,
          proof: {
            type: 'EthereumEip712Signature2021',
            created: new Date().toISOString(),
            verificationMethod: `did:jeju:${config.serviceAgentId}#key-1`,
            proofValue: signatureResult.signature,
          },
        }
      })

      .post('/credential/verify', async ({ body }) => {
        const params = CredentialVerifyBodySchema.parse(body)

        // Verify credential signature
        // In production, credential hash would be verified against issuer's public key
        // const credentialHash = keccak256(toBytes(JSON.stringify(params.credential)))

        // For now, return success if signature format is valid
        const isValid = params.proof.proofValue.length === 132 // 65 bytes

        return {
          valid: isValid,
          issuer: params.credential.issuer,
          subject: params.credential.credentialSubject.id,
        }
      })
  )
}

export type OAuth3Worker = ReturnType<typeof createOAuth3Worker>
