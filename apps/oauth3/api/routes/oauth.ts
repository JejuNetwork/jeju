/**
 * OAuth3 routes - main authentication flows
 */

import {
  AuthProvider,
  createOAuthProvider,
  type OAuthConfig,
  type OAuthState,
} from '@jejunetwork/auth'
import { Elysia, t } from 'elysia'
import type { Hex } from 'viem'
import { keccak256, toBytes, toHex } from 'viem'
import { z } from 'zod'
import type { AuthConfig, AuthSession, AuthToken } from '../../lib/types'
import {
  authCodeState,
  clientState,
  initializeState,
  oauthStateStore,
  refreshTokenState,
  sessionState,
} from '../services/state'

// Zod schema for JWT payload validation
const JwtPayloadSchema = z.object({
  sub: z.string(),
  iat: z.number(),
  exp: z.number(),
})

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

// OAuth config from environment
function getOAuthConfig(
  provider: AuthProvider,
  baseRedirectUri: string,
): OAuthConfig {
  const configs: Record<string, OAuthConfig> = {
    [AuthProvider.GITHUB]: {
      clientId: process.env.GITHUB_CLIENT_ID ?? '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
      redirectUri: `${baseRedirectUri}/oauth/callback/github`,
      scopes: ['read:user', 'user:email'],
    },
    [AuthProvider.GOOGLE]: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirectUri: `${baseRedirectUri}/oauth/callback/google`,
      scopes: ['openid', 'email', 'profile'],
    },
    [AuthProvider.TWITTER]: {
      clientId: process.env.TWITTER_CLIENT_ID ?? '',
      clientSecret: process.env.TWITTER_CLIENT_SECRET ?? '',
      redirectUri: `${baseRedirectUri}/oauth/callback/twitter`,
      scopes: ['users.read', 'tweet.read'],
    },
    [AuthProvider.DISCORD]: {
      clientId: process.env.DISCORD_CLIENT_ID ?? '',
      clientSecret: process.env.DISCORD_CLIENT_SECRET ?? '',
      redirectUri: `${baseRedirectUri}/oauth/callback/discord`,
      scopes: ['identify', 'email'],
    },
  }

  const config = configs[provider]
  if (!config) {
    throw new Error(`No OAuth config for provider: ${provider}`)
  }

  if (!config.clientId || !config.clientSecret) {
    throw new Error(
      `Missing OAuth credentials for ${provider}. Set ${provider.toUpperCase()}_CLIENT_ID and ${provider.toUpperCase()}_CLIENT_SECRET`,
    )
  }

  return config
}

export async function createOAuthRouter(config: AuthConfig) {
  // Initialize database tables
  await initializeState()

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
    <div class="client-name">Sign in to ${client.name}</div>
    
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

            const authCode = await authCodeState.get(body.code)
            if (!authCode) {
              set.status = 400
              return { error: 'invalid_grant' }
            }

            if (authCode.clientId !== body.client_id) {
              set.status = 400
              return { error: 'invalid_grant' }
            }

            // Verify PKCE if used
            if (authCode.codeChallenge && body.code_verifier) {
              const verifierHash = keccak256(toBytes(body.code_verifier))
              if (verifierHash !== authCode.codeChallenge) {
                set.status = 400
                return {
                  error: 'invalid_grant',
                  error_description: 'PKCE verification failed',
                }
              }
            }

            // Generate tokens
            const accessToken = generateToken(authCode.userId, config.jwtSecret)
            const refreshToken = crypto.randomUUID()

            // Create session
            const session: AuthSession = {
              sessionId: crypto.randomUUID(),
              userId: authCode.userId,
              provider: 'wallet',
              createdAt: Date.now(),
              expiresAt: Date.now() + config.sessionDuration,
              metadata: {},
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

            // Generate new tokens
            const accessToken = generateToken(
              storedToken.userId,
              config.jwtSecret,
            )
            const newRefreshToken = crypto.randomUUID()

            // Create new session
            const session: AuthSession = {
              sessionId: crypto.randomUUID(),
              userId: storedToken.userId,
              provider: 'wallet',
              createdAt: Date.now(),
              expiresAt: Date.now() + config.sessionDuration,
              metadata: {},
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
        const userId = verifyToken(token, config.jwtSecret)
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

          // Check if credentials are configured
          const envPrefix = providerName.toUpperCase()
          if (
            !process.env[`${envPrefix}_CLIENT_ID`] ||
            !process.env[`${envPrefix}_CLIENT_SECRET`]
          ) {
            set.status = 503
            return {
              error: 'provider_not_configured',
              message: `${providerName} OAuth is not configured. Set ${envPrefix}_CLIENT_ID and ${envPrefix}_CLIENT_SECRET environment variables.`,
            }
          }

          const oauthConfig = getOAuthConfig(provider, baseUrl)
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

          const oauthConfig = getOAuthConfig(provider, baseUrl)
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

// Simple JWT-like token generation
function generateToken(userId: string, secret: string): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = btoa(
    JSON.stringify({
      sub: userId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  )
  const signature = keccak256(toBytes(`${header}.${payload}.${secret}`)).slice(
    0,
    32,
  )
  return `${header}.${payload}.${signature}`
}

type JwtPayload = z.infer<typeof JwtPayloadSchema>

function verifyToken(token: string, secret: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const expectedSig = keccak256(
    toBytes(`${parts[0]}.${parts[1]}.${secret}`),
  ).slice(0, 32)
  if (parts[2] !== expectedSig) return null

  const parseResult = JwtPayloadSchema.safeParse(JSON.parse(atob(parts[1])))
  if (!parseResult.success) return null

  const decoded: JwtPayload = parseResult.data
  if (decoded.exp < Math.floor(Date.now() / 1000)) return null

  return decoded.sub
}
