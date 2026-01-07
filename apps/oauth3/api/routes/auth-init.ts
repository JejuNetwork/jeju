/**
 * Auth initialization routes for programmatic auth flow initiation
 * This allows clients to initialize auth flows via API calls
 */

import {
  getCurrentNetwork,
  getLocalhostHost,
  getOAuth3Url,
  isProductionEnv,
} from '@jejunetwork/config'
import { Elysia, t } from 'elysia'
import type { Address, Hex } from 'viem'
import { isAddress, isHex, verifyMessage } from 'viem'
import type { AuthConfig } from '../../lib/types'
import { getEphemeralKey } from '../services/kms'
import { clientState, sessionState } from '../services/state'

const InitBodySchema = t.Object({
  provider: t.String(),
  redirectUri: t.String(),
  appId: t.Optional(t.String()),
  state: t.Optional(t.String()),
})

const WalletAuthBodySchema = t.Object({
  address: t.String({ pattern: '^0x[a-fA-F0-9]{40}$' }),
  signature: t.String({ pattern: '^0x[a-fA-F0-9]+$' }),
  message: t.String(),
  appId: t.Optional(t.String()),
})

/**
 * SECURITY: Validate redirect URI against client's registered patterns.
 * Prevents open redirect attacks by:
 * 1. Only allowing http/https schemes
 * 2. Strict pattern matching with proper escaping
 * 3. Not allowing data:, javascript:, or other dangerous schemes
 */
function validateRedirectUri(
  redirectUri: string,
  allowedPatterns: string[],
): boolean {
  // Parse the redirect URI to validate its structure
  let parsed: URL
  try {
    parsed = new URL(redirectUri)
  } catch {
    return false // Invalid URL format
  }

  // SECURITY: Only allow http/https schemes
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return false
  }

  // SECURITY: Block localhost in production patterns (but allow explicit localhost patterns)
  const hasLocalhostPattern = allowedPatterns.some(
    (p) =>
      p.includes('localhost') || p.includes('127.0.0.1') || p.includes('[::1]'),
  )

  if (
    !hasLocalhostPattern &&
    (parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]')
  ) {
    return false
  }

  for (const pattern of allowedPatterns) {
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
    const regex = new RegExp(`^${regexPattern}$`)
    if (regex.test(redirectUri)) {
      return true
    }
  }
  return false
}

export function createAuthInitRouter(_config: AuthConfig) {
  const network = getCurrentNetwork()
  const host = getLocalhostHost()
  const baseUrl =
    (typeof process !== 'undefined' ? process.env.BASE_URL : undefined) ??
    (network === 'localnet' ? `http://${host}:4200` : getOAuth3Url(network))

  return (
    new Elysia({ name: 'auth-init', prefix: '/auth' })
      .post(
        '/init',
        async ({ body, set }) => {
          const { provider, redirectUri, appId = 'jeju-default', state } = body

          // Find or use default client
          let client = await clientState.get(appId)
          if (!client) {
            // Try default client
            client = await clientState.get('jeju-default')
          }

          // For development, create a permissive client if none exists
          if (!client) {
            // Auto-register the client for dev (in production this should fail)
            const isDev = !isProductionEnv()
            if (isDev) {
              console.log(
                `[OAuth3] Auto-registering development client: ${appId}`,
              )
              await clientState.save({
                clientId: appId,
                clientSecretHash: {
                  hash: '',
                  salt: '',
                  algorithm: 'pbkdf2',
                  version: 1,
                },
                name: appId,
                redirectUris: [
                  `http://localhost:*`,
                  `http://${getLocalhostHost()}:*`,
                  'https://*.jejunetwork.org/*',
                ],
                allowedProviders: ['wallet', 'farcaster', 'github', 'google'],
                owner:
                  '0x0000000000000000000000000000000000000000' as `0x${string}`,
                active: true,
                createdAt: Date.now(),
              })
              client = await clientState.get(appId)
            }
          }

          if (!client || !client.active) {
            set.status = 400
            return {
              error: 'invalid_client',
              message: 'Unknown or inactive client',
            }
          }

          // Validate redirect URI (relaxed for development)
          const isDev = !isProductionEnv()
          if (
            !isDev &&
            !validateRedirectUri(redirectUri, client.redirectUris)
          ) {
            set.status = 400
            return {
              error: 'invalid_redirect_uri',
              message: 'Redirect URI not allowed',
            }
          }

          const authState = state ?? crypto.randomUUID()
          const encodedRedirectUri = encodeURIComponent(redirectUri)

          // Build the appropriate auth URL based on provider
          let authUrl: string

          switch (provider.toLowerCase()) {
            case 'wallet':
              authUrl = `${baseUrl}/wallet/challenge?client_id=${appId}&redirect_uri=${encodedRedirectUri}&state=${authState}`
              break

            case 'farcaster':
              authUrl = `${baseUrl}/farcaster/init?client_id=${appId}&redirect_uri=${encodedRedirectUri}&state=${authState}`
              break

            case 'github':
            case 'google':
            case 'twitter':
            case 'discord':
              authUrl = `${baseUrl}/oauth/social/${provider.toLowerCase()}?client_id=${appId}&redirect_uri=${encodedRedirectUri}&state=${authState}`
              break

            case 'email':
              // Email provider - for now redirect to authorize page
              authUrl = `${baseUrl}/oauth/authorize?client_id=${appId}&redirect_uri=${encodedRedirectUri}&state=${authState}&provider=email`
              break

            default:
              set.status = 400
              return {
                error: 'unsupported_provider',
                message: `Provider "${provider}" is not supported. Use: wallet, farcaster, github, google, twitter, discord`,
              }
          }

          return {
            authUrl,
            state: authState,
            provider: provider.toLowerCase(),
          }
        },
        { body: InitBodySchema },
      )

      .get('/providers', () => {
        // Return available providers and their status
        return {
          providers: [
            { id: 'wallet', name: 'Wallet', enabled: true, icon: '🔐' },
            { id: 'farcaster', name: 'Farcaster', enabled: true, icon: '🟣' },
            {
              id: 'github',
              name: 'GitHub',
              enabled: Boolean(process.env.GITHUB_CLIENT_ID),
              icon: '🐙',
            },
            {
              id: 'google',
              name: 'Google',
              enabled: Boolean(process.env.GOOGLE_CLIENT_ID),
              icon: '🔵',
            },
            {
              id: 'twitter',
              name: 'Twitter',
              enabled: Boolean(process.env.TWITTER_CLIENT_ID),
              icon: '🐦',
            },
            {
              id: 'discord',
              name: 'Discord',
              enabled: Boolean(process.env.DISCORD_CLIENT_ID),
              icon: '💬',
            },
          ],
        }
      })

      // Direct wallet authentication endpoint for SDK usage
      // This is a single-request auth flow used by the OAuth3 client SDK
      .post(
        '/wallet',
        async ({ body, set }) => {
          if (!isAddress(body.address)) {
            set.status = 400
            return { error: 'invalid_address' }
          }
          if (!isHex(body.signature)) {
            set.status = 400
            return { error: 'invalid_signature_format' }
          }

          const address: Address = body.address
          const signature: Hex = body.signature
          const appId = body.appId ?? 'jeju-default'

          // Verify the message is a valid sign-in message
          // Accept any SIWE-style message from known domains
          const validDomains = [
            'auth.jejunetwork.org',
            'oauth3.jejunetwork.org',
            'crucible.testnet.jejunetwork.org',
            'crucible.jejunetwork.org',
            'localhost',
            getLocalhostHost(),
          ]
          const messageHasDomain = validDomains.some(
            (d) =>
              body.message.includes(d) ||
              body.message.includes('wants you to sign in'),
          )
          if (!messageHasDomain) {
            set.status = 400
            return {
              error: 'invalid_message',
              message: 'Message must be a valid sign-in request',
            }
          }

          // Verify signature
          const valid = await verifyMessage({
            address,
            message: body.message,
            signature,
          })

          if (!valid) {
            set.status = 401
            return { error: 'invalid_signature' }
          }

          // Create session
          const sessionId = `0x${crypto.randomUUID().replace(/-/g, '')}` as Hex
          const userId = `wallet:${address.toLowerCase()}`

          const ephemeralKey = await getEphemeralKey(sessionId)

          const expiresAt = Date.now() + 24 * 60 * 60 * 1000 // 24 hours

          await sessionState.save({
            sessionId,
            userId,
            provider: 'wallet',
            address,
            createdAt: Date.now(),
            expiresAt,
            metadata: { appId },
            ephemeralKeyId: ephemeralKey.keyId,
          })

          console.log('[OAuth3] Direct wallet auth session created:', {
            sessionId: `${sessionId.substring(0, 10)}...`,
            address: `${address.substring(0, 6)}...${address.slice(-4)}`,
            appId,
          })

          // Return session in OAuth3Session format expected by the SDK
          return {
            sessionId,
            identityId: sessionId, // Use session as identity for wallet auth
            smartAccount: address,
            expiresAt,
            capabilities: ['sign_message', 'sign_transaction'],
            signingPublicKey: ephemeralKey.publicKey,
            attestation: {
              quote: '0x' as Hex,
              measurement: '0x' as Hex,
              reportData: '0x' as Hex,
              timestamp: Date.now(),
              platform: 'simulated',
              verified: false,
            },
          }
        },
        { body: WalletAuthBodySchema },
      )
  )
}
