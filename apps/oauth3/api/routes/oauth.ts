/**
 * OAuth3 routes - main authentication flows
 */

import { Elysia, t } from 'elysia'
import { keccak256, toBytes } from 'viem'
import { z } from 'zod'
import type {
  AuthConfig,
  AuthSession,
  AuthToken,
  RegisteredClient,
} from '../../lib/types'

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

const SocialQuerySchema = t.Object({
  client_id: t.Optional(t.String()),
  redirect_uri: t.Optional(t.String()),
  state: t.Optional(t.String()),
})

// In-memory stores (would be CQL in production)
export const authorizationCodes = new Map<
  string,
  {
    clientId: string
    redirectUri: string
    userId: string
    scope: string[]
    expiresAt: number
    codeChallenge?: string
    codeChallengeMethod?: string
  }
>()

export const sessions = new Map<string, AuthSession>()
export const clients = new Map<string, RegisteredClient>()

// Initialize default client for jeju apps
clients.set('jeju-default', {
  clientId: 'jeju-default',
  name: 'Jeju Network Apps',
  redirectUris: [
    'https://*.jejunetwork.org/callback',
    'http://localhost:*/callback',
  ],
  allowedProviders: [
    'wallet',
    'farcaster',
    'github',
    'google',
    'twitter',
    'discord',
  ],
  owner: '0x0000000000000000000000000000000000000000',
  createdAt: Date.now(),
  active: true,
})

export function createOAuthRouter(config: AuthConfig) {
  return new Elysia({ name: 'oauth', prefix: '/oauth' })
    .get(
      '/authorize',
      async ({ query, set }) => {
        // Validate required params
        if (!query.client_id || !query.redirect_uri) {
          set.status = 400
          return {
            error: 'invalid_request',
            error_description: 'Missing required parameters',
          }
        }

        // Validate client
        const client = clients.get(query.client_id)
        if (!client || !client.active) {
          set.status = 400
          return {
            error: 'invalid_client',
            error_description: 'Unknown client',
          }
        }

        // Validate redirect URI (simple wildcard matching)
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

        // Return authorization page HTML
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
    .provider-btn.primary:hover {
      opacity: 0.9;
    }
    .icon {
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
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
    </div>
    
    <div class="footer">
      Powered by <a href="https://jejunetwork.org">Jeju Network</a>
    </div>
  </div>
</body>
</html>`,
          {
            headers: { 'Content-Type': 'text/html' },
          },
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

          const authCode = authorizationCodes.get(body.code)
          if (!authCode || authCode.expiresAt < Date.now()) {
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
          sessions.set(session.sessionId, session)

          // Clean up auth code
          authorizationCodes.delete(body.code)

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
          set.status = 400
          return { error: 'unsupported_grant_type' }
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

      // Find session
      const session = Array.from(sessions.values()).find(
        (s) => s.userId === userId && s.expiresAt > Date.now(),
      )

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

    .get(
      '/social/:provider',
      async ({ params, query, set }) => {
        // Placeholder for social OAuth - would redirect to provider
        const providerName = params.provider
        const clientId = query.client_id ?? ''
        const redirectUri = query.redirect_uri ?? ''
        const state = query.state ?? ''

        // For now, return not implemented
        set.status = 501
        return {
          error: 'not_implemented',
          message: `Social provider ${providerName} integration coming soon`,
          provider: providerName,
          clientId,
          redirectUri,
          state,
        }
      },
      { query: SocialQuerySchema },
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
