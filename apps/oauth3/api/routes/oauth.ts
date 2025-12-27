/**
 * OAuth3 routes - main authentication flows
 *
 * SECURITY: This module uses KMS-backed signing for JWT tokens.
 * - No JWT secrets in memory (MPC threshold signing)
 * - OAuth provider secrets are sealed to TEE attestation
 * - Short-lived tokens with ephemeral keys
 */

import {
  createOAuthProvider,
  type OAuthConfig,
  type OAuthState,
} from '@jejunetwork/auth'
import { Elysia, t } from 'elysia'
import type { Hex } from 'viem'
import { toHex } from 'viem'
import type { AuthConfig, AuthSession, AuthToken } from '../../lib/types'
import { AuthProvider } from '../../lib/types'
import {
  generateSecureToken,
  getEphemeralKey,
  initializeKMS,
  verifySecureToken,
} from '../services/kms'
import {
  getOAuthConfig as getSealedOAuthConfig,
  isProviderConfigured,
  loadSealedProviders,
} from '../services/sealed-oauth'
import {
  authCodeState,
  clientState,
  initializeState,
  oauthStateStore,
  refreshTokenState,
  sessionState,
  verifyClientSecret,
} from '../services/state'

/**
 * HTML escape to prevent XSS in rendered templates.
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

const AuthorizeQuerySchema = t.Object({
  client_id: t.Optional(t.String()),
  redirect_uri: t.Optional(t.String()),
  response_type: t.Optional(t.String()),
  scope: t.Optional(t.String()),
  state: t.Optional(t.String()),
  code_challenge: t.Optional(t.String()),
  code_challenge_method: t.Optional(t.String()),
  provider: t.Optional(t.String()),
})

const TokenBodySchema = t.Object({
  grant_type: t.Optional(t.String()),
  code: t.Optional(t.String()),
  redirect_uri: t.Optional(t.String()),
  client_id: t.Optional(t.String()),
  client_secret: t.Optional(t.String()),
  code_verifier: t.Optional(t.String()),
  refresh_token: t.Optional(t.String()),
})

const SocialCallbackQuerySchema = t.Object({
  code: t.Optional(t.String()),
  state: t.Optional(t.String()),
  error: t.Optional(t.String()),
  error_description: t.Optional(t.String()),
})

/**
 * Get OAuth config for a provider using sealed secrets.
 * Falls back to plaintext env vars for migration.
 */
async function getOAuthConfigSecure(
  provider: AuthProvider,
  baseRedirectUri: string,
): Promise<OAuthConfig> {
  // Try sealed secrets first
  const sealedConfig = await getSealedOAuthConfig(provider, baseRedirectUri)
  if (sealedConfig) {
    return sealedConfig
  }

  // Not configured
  throw new Error(
    `OAuth provider ${provider} not configured.\n` +
      `Set ${provider.toUpperCase()}_CLIENT_ID and either:\n` +
      `  - ${provider.toUpperCase()}_SEALED_SECRET (recommended, secure)\n` +
      `  - ${provider.toUpperCase()}_CLIENT_SECRET (legacy, insecure)`,
  )
}

export async function createOAuthRouter(config: AuthConfig) {
  // Initialize database tables
  await initializeState()

  // Initialize KMS for secure token signing
  await initializeKMS({
    jwtSigningKeyId: config.jwtSigningKeyId ?? 'oauth3-jwt-signing',
    jwtSignerAddress:
      config.jwtSignerAddress ??
      ('0x0000000000000000000000000000000000000000' as `0x${string}`),
    serviceAgentId: config.serviceAgentId,
    chainId: config.chainId ?? 'eip155:420691',
    devMode: config.devMode ?? process.env.NODE_ENV !== 'production',
  })

  // Load sealed OAuth provider secrets
  await loadSealedProviders()

  const baseUrl = process.env.BASE_URL ?? 'http://localhost:4200'

  return (
    new Elysia({ name: 'oauth', prefix: '/oauth' })
      .get(
        '/authorize',
        async ({ query, set }) => {
          if (!query.client_id || !query.redirect_uri) {
            set.status = 400
            return {
              error: 'invalid_request',
              error_description: 'Missing required parameters',
            }
          }

          const client = await clientState.get(query.client_id)
          if (!client || !client.active) {
            set.status = 400
            return {
              error: 'invalid_client',
              error_description: 'Unknown client',
            }
          }

          // Validate redirect URI
          const validRedirect = client.redirectUris.some((pattern) => {
            const regex = new RegExp(
              `^${pattern.replace(/\*/g, '.*').replace(/\//g, '\\/')}$`,
            )
            return regex.test(query.redirect_uri ?? '')
          })

          if (!validRedirect) {
            set.status = 400
            return {
              error: 'invalid_request',
              error_description: 'Invalid redirect_uri',
            }
          }

          const state = query.state ?? crypto.randomUUID()
          const clientId = query.client_id
          const redirectUri = encodeURIComponent(query.redirect_uri)

          return new Response(
            `<!DOCTYPE html>
<html>
<head>
  <title>Sign in - Jeju Network</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'JetBrains Mono', 'SF Mono', monospace;
      background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #e0e0e0;
    }
    .container {
      background: rgba(20, 20, 30, 0.9);
      border: 1px solid rgba(100, 255, 218, 0.2);
      border-radius: 16px;
      padding: 48px;
      max-width: 420px;
      width: 90%;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }
    .logo {
      font-size: 32px;
      font-weight: 700;
      background: linear-gradient(135deg, #64ffda 0%, #00bcd4 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      text-align: center;
      margin-bottom: 8px;
    }
    .subtitle {
      text-align: center;
      color: #888;
      font-size: 14px;
      margin-bottom: 32px;
    }
    .client-name {
      text-align: center;
      font-size: 18px;
      margin-bottom: 24px;
      color: #fff;
    }
    .providers {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .provider-btn {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      border: 1px solid rgba(100, 255, 218, 0.3);
      border-radius: 12px;
      background: rgba(30, 30, 45, 0.8);
      color: #fff;
      font-size: 16px;
      cursor: pointer;
      transition: all 0.2s;
      text-decoration: none;
    }
    .provider-btn:hover {
      background: rgba(100, 255, 218, 0.1);
      border-color: #64ffda;
      transform: translateY(-2px);
    }
    .provider-btn.primary {
      background: linear-gradient(135deg, #64ffda 0%, #00bcd4 100%);
      color: #0a0a0a;
      font-weight: 600;
      border: none;
    }
    .provider-btn.primary:hover { opacity: 0.9; }
    .icon { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; }
    .divider {
      display: flex;
      align-items: center;
      margin: 24px 0;
      color: #666;
      font-size: 12px;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: rgba(255,255,255,0.1);
    }
    .divider span { padding: 0 16px; }
    .footer {
      text-align: center;
      margin-top: 24px;
      font-size: 12px;
      color: #666;
    }
    .footer a { color: #64ffda; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">JEJU</div>
    <div class="subtitle">Decentralized Authentication</div>
    <div class="client-name">Sign in to ${escapeHtml(client.name)}</div>
    
    <div class="providers">
      <a href="/wallet/challenge?client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}" class="provider-btn primary">
        <span class="icon">🔐</span>
        Connect Wallet
      </a>
      
      <a href="/farcaster/init?client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}" class="provider-btn">
        <span class="icon">🟣</span>
        Sign in with Farcaster
      </a>
      
      <div class="divider"><span>or continue with</span></div>
      
      <a href="/oauth/social/github?client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}" class="provider-btn">
        <span class="icon">🐙</span>
        GitHub
      </a>
      
      <a href="/oauth/social/google?client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}" class="provider-btn">
        <span class="icon">🔵</span>
        Google
      </a>
      
      <a href="/oauth/social/twitter?client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}" class="provider-btn">
        <span class="icon">🐦</span>
        Twitter
      </a>
      
      <a href="/oauth/social/discord?client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}" class="provider-btn">
        <span class="icon">💬</span>
        Discord
      </a>
    </div>
    
    <div class="footer">
      Powered by <a href="https://jejunetwork.org">Jeju Network</a>
    </div>
  </div>
</body>
</html>`,
            { headers: { 'Content-Type': 'text/html' } },
          )
        },
        { query: AuthorizeQuerySchema },
      )

      .post(
        '/token',
        async ({ body, set }) => {
          if (body.grant_type === 'authorization_code') {
            if (!body.code || !body.client_id) {
              set.status = 400
              return { error: 'invalid_request' }
            }

            // Verify client credentials
            const secretResult = await verifyClientSecret(
              body.client_id,
              body.client_secret,
            )
            if (!secretResult.valid) {
              set.status = 401
              return {
                error: secretResult.error,
                error_description:
                  secretResult.error === 'client_secret_required'
                    ? 'This client requires a client_secret'
                    : 'Invalid client credentials',
              }
            }

            const authCode = await authCodeState.get(body.code)
            if (!authCode) {
              set.status = 400
              return { error: 'invalid_grant' }
            }

            if (authCode.clientId !== body.client_id) {
              set.status = 400
              return { error: 'invalid_grant' }
            }

            // Verify PKCE if challenge was provided during authorization
            if (authCode.codeChallenge) {
              if (!body.code_verifier) {
                set.status = 400
                return {
                  error: 'invalid_grant',
                  error_description: 'PKCE code_verifier required',
                }
              }
              // Use SHA-256 per OAuth2 PKCE spec (RFC 7636)
              const verifierHash = await sha256Base64Url(body.code_verifier)
              if (verifierHash !== authCode.codeChallenge) {
                set.status = 400
                return {
                  error: 'invalid_grant',
                  error_description: 'PKCE verification failed',
                }
              }
            }

            // Generate tokens using KMS-backed signing
            const accessToken = await generateSecureToken(authCode.userId, {
              expiresInSeconds: 3600,
              issuer: 'jeju:oauth3',
              audience: 'gateway',
            })
            const refreshToken = crypto.randomUUID()

            // Create session with ephemeral key
            const sessionId = crypto.randomUUID()
            const ephemeralKey = await getEphemeralKey(sessionId)

            const session: AuthSession = {
              sessionId,
              userId: authCode.userId,
              provider: 'wallet',
              createdAt: Date.now(),
              expiresAt: Date.now() + config.sessionDuration,
              metadata: {},
              ephemeralKeyId: ephemeralKey.keyId,
            }
            await sessionState.save(session)

            // Save refresh token
            await refreshTokenState.save(refreshToken, {
              sessionId: session.sessionId,
              clientId: body.client_id,
              userId: authCode.userId,
              expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
            })

            // Clean up auth code
            await authCodeState.delete(body.code)

            const token: AuthToken = {
              accessToken,
              tokenType: 'Bearer',
              expiresIn: 3600,
              refreshToken,
              scope: authCode.scope,
            }

            return token
          }

          if (body.grant_type === 'refresh_token') {
            if (!body.refresh_token || !body.client_id) {
              set.status = 400
              return { error: 'invalid_request' }
            }

            // Verify client credentials
            const secretResult = await verifyClientSecret(
              body.client_id,
              body.client_secret,
            )
            if (!secretResult.valid) {
              set.status = 401
              return {
                error: secretResult.error,
                error_description: 'Invalid client credentials',
              }
            }

            const storedToken = await refreshTokenState.get(body.refresh_token)
            if (!storedToken) {
              set.status = 400
              return {
                error: 'invalid_grant',
                error_description: 'Invalid refresh token',
              }
            }

            if (storedToken.revoked) {
              set.status = 400
              return {
                error: 'invalid_grant',
                error_description: 'Refresh token revoked',
              }
            }

            if (storedToken.expiresAt < Date.now()) {
              set.status = 400
              return {
                error: 'invalid_grant',
                error_description: 'Refresh token expired',
              }
            }

            if (storedToken.clientId !== body.client_id) {
              set.status = 400
              return { error: 'invalid_grant' }
            }

            // Revoke old refresh token
            await refreshTokenState.revoke(body.refresh_token)

            // Generate new tokens using KMS-backed signing
            const accessToken = await generateSecureToken(storedToken.userId, {
              expiresInSeconds: 3600,
              issuer: 'jeju:oauth3',
              audience: 'gateway',
            })
            const newRefreshToken = crypto.randomUUID()

            // Create new session with ephemeral key
            const sessionId = crypto.randomUUID()
            const ephemeralKey = await getEphemeralKey(sessionId)

            const session: AuthSession = {
              sessionId,
              userId: storedToken.userId,
              provider: 'wallet',
              createdAt: Date.now(),
              expiresAt: Date.now() + config.sessionDuration,
              metadata: {},
              ephemeralKeyId: ephemeralKey.keyId,
            }
            await sessionState.save(session)

            // Save new refresh token
            await refreshTokenState.save(newRefreshToken, {
              sessionId: session.sessionId,
              clientId: body.client_id,
              userId: storedToken.userId,
              expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
            })

            return {
              accessToken,
              tokenType: 'Bearer' as const,
              expiresIn: 3600,
              refreshToken: newRefreshToken,
            }
          }

          set.status = 400
          return { error: 'unsupported_grant_type' }
        },
        { body: TokenBodySchema },
      )

      .get('/userinfo', async ({ headers, set }) => {
        const auth = headers.authorization
        if (!auth?.startsWith('Bearer ')) {
          set.status = 401
          return { error: 'invalid_token' }
        }

        const token = auth.slice(7)
        // Verify using KMS-backed verification
        const userId = await verifySecureToken(token)
        if (!userId) {
          set.status = 401
          return { error: 'invalid_token' }
        }

        // Find active session
        const sessions = await sessionState.findByUserId(userId)
        const session = sessions.find((s) => s.expiresAt > Date.now())

        if (!session) {
          set.status = 401
          return { error: 'invalid_token' }
        }

        return {
          sub: session.userId,
          address: session.address,
          fid: session.fid,
          email: session.email,
          provider: session.provider,
        }
      })

      // Social OAuth - Initiate flow
      .get(
        '/social/:provider',
        async ({ params, query, set }) => {
          const providerName = params.provider.toLowerCase()

          // Map to AuthProvider enum
          const providerMap: Record<string, AuthProvider> = {
            github: AuthProvider.GITHUB,
            google: AuthProvider.GOOGLE,
            twitter: AuthProvider.TWITTER,
            discord: AuthProvider.DISCORD,
          }

          const provider = providerMap[providerName]
          if (!provider) {
            set.status = 400
            return {
              error: 'unsupported_provider',
              message: `Provider ${providerName} is not supported`,
            }
          }

          // Check if provider is configured (sealed or legacy)
          if (!isProviderConfigured(provider)) {
            set.status = 503
            return {
              error: 'provider_not_configured',
              message: `${providerName} OAuth is not configured. Set ${providerName.toUpperCase()}_CLIENT_ID and ${providerName.toUpperCase()}_SEALED_SECRET.`,
            }
          }

          // Get config with sealed secrets
          const oauthConfig = await getOAuthConfigSecure(provider, baseUrl)
          const oauthProvider = createOAuthProvider(provider, oauthConfig)

          // Generate state for CSRF protection
          const stateBytes = crypto.getRandomValues(new Uint8Array(32))
          const nonceBytes = crypto.getRandomValues(new Uint8Array(16))
          const state: OAuthState = {
            state: toHex(stateBytes).slice(2),
            nonce: toHex(nonceBytes).slice(2),
            provider,
            appId: '0x00' as Hex,
            createdAt: Date.now(),
          }

          // Get authorization URL (may mutate state for PKCE)
          const authUrl = await oauthProvider.getAuthorizationUrl(state)

          // Store state for callback verification
          await oauthStateStore.save(state.state, {
            nonce: state.nonce,
            provider: providerName,
            clientId: query.client_id ?? 'jeju-default',
            redirectUri: query.redirect_uri ?? '',
            codeVerifier: state.codeVerifier,
            expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
          })

          set.redirect = authUrl
          return { redirectTo: authUrl }
        },
        {
          query: t.Object({
            client_id: t.Optional(t.String()),
            redirect_uri: t.Optional(t.String()),
            state: t.Optional(t.String()),
          }),
        },
      )

      // Social OAuth - Callback handler
      .get(
        '/callback/:provider',
        async ({ params, query, set }) => {
          const providerName = params.provider.toLowerCase()

          if (query.error) {
            set.status = 400
            return {
              error: query.error,
              error_description:
                query.error_description ?? 'OAuth flow cancelled',
            }
          }

          if (!query.code || !query.state) {
            set.status = 400
            return {
              error: 'invalid_request',
              error_description: 'Missing code or state',
            }
          }

          // Verify state
          const storedState = await oauthStateStore.get(query.state)
          if (!storedState) {
            set.status = 400
            return {
              error: 'invalid_state',
              error_description: 'Invalid or expired state',
            }
          }

          // Clean up state
          await oauthStateStore.delete(query.state)

          // Map to AuthProvider
          const providerMap: Record<string, AuthProvider> = {
            github: AuthProvider.GITHUB,
            google: AuthProvider.GOOGLE,
            twitter: AuthProvider.TWITTER,
            discord: AuthProvider.DISCORD,
          }

          const provider = providerMap[providerName]
          if (!provider) {
            set.status = 400
            return { error: 'unsupported_provider' }
          }

          // Get config with sealed secrets
          const oauthConfig = await getOAuthConfigSecure(provider, baseUrl)
          const oauthProvider = createOAuthProvider(provider, oauthConfig)

          // Exchange code for token
          const oauthState: OAuthState = {
            state: query.state,
            nonce: storedState.nonce,
            provider,
            appId: '0x00' as Hex,
            createdAt: Date.now(),
            codeVerifier: storedState.codeVerifier,
          }

          const tokens = await oauthProvider.exchangeCode(
            query.code,
            oauthState,
          )
          const profile = await oauthProvider.getProfile(tokens)

          // Create user ID from provider info
          const userId = `${providerName}:${profile.id}`

          // Create authorization code for the original client
          const code = crypto.randomUUID()
          await authCodeState.save(code, {
            clientId: storedState.clientId,
            redirectUri: storedState.redirectUri,
            userId,
            scope: ['openid', 'profile', providerName],
            expiresAt: Date.now() + 5 * 60 * 1000,
          })

          // Create session
          const sessionId = crypto.randomUUID()
          await sessionState.save({
            sessionId,
            userId,
            provider,
            email: profile.email,
            createdAt: Date.now(),
            expiresAt: Date.now() + 24 * 60 * 60 * 1000,
            metadata: {
              name: profile.name ?? '',
              avatar: profile.avatar ?? '',
              handle: profile.handle ?? '',
            },
          })

          // Redirect back to client
          if (storedState.redirectUri) {
            const redirectUrl = new URL(storedState.redirectUri)
            redirectUrl.searchParams.set('code', code)
            set.redirect = redirectUrl.toString()
            return { redirectTo: redirectUrl.toString() }
          }

          // No redirect URI, return success
          return {
            success: true,
            code,
            profile: {
              id: profile.id,
              email: profile.email,
              name: profile.name,
              handle: profile.handle,
            },
          }
        },
        { query: SocialCallbackQuerySchema },
      )
  )
}

/**
 * SHA-256 hash with Base64URL encoding for PKCE (RFC 7636).
 * This is the standard S256 code_challenge_method.
 */
async function sha256Base64Url(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)

  // Convert to base64url (RFC 4648 Section 5)
  let binary = ''
  for (const byte of hashArray) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Note: JWT signing/verification is now handled by KMS service
// See api/services/kms.ts for secure MPC-backed implementation
