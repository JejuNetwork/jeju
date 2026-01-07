import {
  createOAuthProvider,
  type OAuthConfig,
  type OAuthState,
} from '@jejunetwork/auth/providers'
import {
  getCurrentNetwork,
  getLocalhostHost,
  getOAuth3Url,
} from '@jejunetwork/config'
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
import { createHtmlPage, escapeHtml } from '../shared/html-templates'

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

/**
 * Generate the authorize page HTML
 */
function generateAuthorizePage(
  clientName: string,
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  const encodedRedirectUri = encodeURIComponent(redirectUri)

  const content = `
  <main class="card" role="main">
    <div class="logo">JEJU</div>
    <div class="client-name" role="status">
      <strong>${escapeHtml(clientName)}</strong>
    </div>
    
    <nav class="providers" aria-label="Sign in options">
      <a href="/wallet/challenge?client_id=${clientId}&redirect_uri=${encodedRedirectUri}&state=${state}" 
         class="provider-btn primary"
         role="button">
        <span class="icon" aria-hidden="true">🔐</span>
        Connect Wallet
      </a>
      
      <a href="/farcaster/init?client_id=${clientId}&redirect_uri=${encodedRedirectUri}&state=${state}" 
         class="provider-btn"
         role="button">
        <span class="icon" aria-hidden="true">🟣</span>
        Sign in with Farcaster
      </a>
      
      <div class="divider" role="separator"><span>or continue with</span></div>
      
      <a href="/oauth/social/github?client_id=${clientId}&redirect_uri=${encodedRedirectUri}&state=${state}" 
         class="provider-btn"
         role="button">
        <span class="icon" aria-hidden="true">🐙</span>
        GitHub
      </a>
      
      <a href="/oauth/social/google?client_id=${clientId}&redirect_uri=${encodedRedirectUri}&state=${state}" 
         class="provider-btn"
         role="button">
        <span class="icon" aria-hidden="true">🔵</span>
        Google
      </a>
      
      <a href="/oauth/social/twitter?client_id=${clientId}&redirect_uri=${encodedRedirectUri}&state=${state}" 
         class="provider-btn"
         role="button">
        <span class="icon" aria-hidden="true">🐦</span>
        Twitter
      </a>
      
      <a href="/oauth/social/discord?client_id=${clientId}&redirect_uri=${encodedRedirectUri}&state=${state}" 
         class="provider-btn"
         role="button">
        <span class="icon" aria-hidden="true">💬</span>
        Discord
      </a>
    </nav>
    
    <footer class="footer">
      <a href="https://jejunetwork.org">Jeju Network</a>
    </footer>
  </main>`

  return createHtmlPage({
    title: 'Sign In',
    content,
  })
}

// Lazy initialization state
let isInitialized = false
let initializationPromise: Promise<void> | null = null

async function ensureInitialized(config: AuthConfig): Promise<void> {
  if (isInitialized) return
  if (initializationPromise) {
    await initializationPromise
    return
  }

  initializationPromise = (async () => {
    console.log('[OAuth3] Lazy initialization starting...')

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
    })

    // Load sealed OAuth provider secrets
    await loadSealedProviders()

    isInitialized = true
    console.log('[OAuth3] Lazy initialization complete')
  })()

  await initializationPromise
}

export function createOAuthRouter(config: AuthConfig) {
  const network = getCurrentNetwork()
  const host = getLocalhostHost()
  const baseUrl =
    (typeof process !== 'undefined' ? process.env.BASE_URL : undefined) ??
    (network === 'localnet' ? `http://${host}:4200` : getOAuth3Url(network))

  return (
    new Elysia({ name: 'oauth', prefix: '/oauth' })
      .get(
        '/authorize',
        async ({ query, set }) => {
          await ensureInitialized(config)

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
          const html = generateAuthorizePage(
            client.name,
            query.client_id,
            query.redirect_uri,
            state,
          )

          return new Response(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        },
        { query: AuthorizeQuerySchema },
      )

      .post(
        '/token',
        async ({ body, set }) => {
          await ensureInitialized(config)

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
              console.log('[OAuth3] Token exchange failed: auth code not found')
              set.status = 400
              return {
                error: 'invalid_grant',
                error_description: 'Authorization code not found or expired',
              }
            }

            // SECURITY: Only log non-sensitive metadata for debugging
            console.log('[OAuth3] Token exchange: auth code verified', {
              clientId: body.client_id,
              hasUser: Boolean(authCode.userId),
            })

            if (authCode.clientId !== body.client_id) {
              console.log('[OAuth3] Token exchange failed: client_id mismatch')
              set.status = 400
              return {
                error: 'invalid_grant',
                error_description: 'Client ID mismatch',
              }
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
        await ensureInitialized(config)

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
          await ensureInitialized(config)

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
          await ensureInitialized(config)

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

async function sha256Base64Url(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)

  let binary = ''
  for (const byte of hashArray) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
