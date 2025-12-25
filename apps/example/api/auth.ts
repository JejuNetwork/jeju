import { getNetworkName } from '@jejunetwork/config'
import { isValidAddress } from '@jejunetwork/types'
import { type Context, Elysia } from 'elysia'
import type { Address } from 'viem'
import {
  type AuthCallbackQuery,
  authCallbackQuerySchema,
  authProviderSchema,
  type OAuth3AuthHeaders,
  oauth3AuthHeadersSchema,
} from '../lib/schemas'
import { AuthProvider } from '@jejunetwork/auth'
import { getOAuth3Service } from './services/auth'
import {
  expectDefined,
  expectValid,
  sanitizeErrorMessage,
  ValidationError,
} from './utils/validation'

export async function oauth3AuthDerive({ request }: Context): Promise<{
  address?: Address
  oauth3SessionId?: string
  authMethod?: 'oauth3'
}> {
  const oauth3Service = getOAuth3Service()
  const sessionId = request.headers.get('x-oauth3-session')

  if (!sessionId) {
    return {}
  }

  const validatedHeaders: OAuth3AuthHeaders = expectValid(
    oauth3AuthHeadersSchema,
    { 'x-oauth3-session': sessionId },
    'OAuth3 auth headers',
  )

  const session = oauth3Service.getSession()
  if (
    session &&
    session.sessionId === validatedHeaders['x-oauth3-session'] &&
    oauth3Service.isLoggedIn() &&
    isValidAddress(session.smartAccount)
  ) {
    return {
      address: session.smartAccount,
      oauth3SessionId: session.sessionId,
      authMethod: 'oauth3',
    }
  }

  await oauth3Service.initialize()
  const refreshedSession = oauth3Service.getSession()
  if (
    refreshedSession &&
    refreshedSession.sessionId === validatedHeaders['x-oauth3-session'] &&
    isValidAddress(refreshedSession.smartAccount)
  ) {
    return {
      address: refreshedSession.smartAccount,
      oauth3SessionId: refreshedSession.sessionId,
      authMethod: 'oauth3',
    }
  }

  return {}
}

export function requireAuth({
  address,
  set,
}: {
  address?: Address
  set: Context['set']
}):
  | {
      error: string
      details: string
      method: { header: string; value: string }
    }
  | undefined {
  if (!address) {
    set.status = 401
    return {
      error: 'Authentication required',
      details: 'Provide x-oauth3-session header',
      method: { header: 'x-oauth3-session', value: 'session-id' },
    }
  }
  return undefined
}

export function createAuthRoutes() {
  const networkName = getNetworkName()
  const isLocalnet = networkName === 'localnet' || networkName === 'Jeju'

  return new Elysia({ prefix: '/auth' })
    .onError(({ error, set }) => {
      console.error('[Auth Error]', error)

      if (error instanceof ValidationError) {
        set.status = 400
        return { error: error.message, code: 'VALIDATION_ERROR' }
      }

      const errorObj = error instanceof Error ? error : new Error(String(error))
      const safeMessage = sanitizeErrorMessage(errorObj, isLocalnet)
      set.status = 500
      return { error: safeMessage, code: 'INTERNAL_ERROR' }
    })
    .get('/providers', async () => {
      const oauth3Service = getOAuth3Service()

      await oauth3Service.initialize()
      const health = await oauth3Service.checkInfrastructureHealth()

      return {
        providers: [
          { id: AuthProvider.WALLET, name: 'Wallet', available: true },
          {
            id: AuthProvider.FARCASTER,
            name: 'Farcaster',
            available: health.teeNode,
          },
          {
            id: AuthProvider.GITHUB,
            name: 'GitHub',
            available: health.teeNode,
          },
          {
            id: AuthProvider.GOOGLE,
            name: 'Google',
            available: health.teeNode,
          },
          {
            id: AuthProvider.TWITTER,
            name: 'Twitter',
            available: health.teeNode,
          },
          {
            id: AuthProvider.DISCORD,
            name: 'Discord',
            available: health.teeNode,
          },
        ],
        infrastructure: health,
      }
    })
    .post('/login/wallet', async () => {
      const oauth3Service = getOAuth3Service()

      await oauth3Service.initialize()
      const session = await oauth3Service.loginWithWallet()

      return {
        success: true,
        session: {
          sessionId: session.sessionId,
          smartAccount: session.smartAccount,
          expiresAt: session.expiresAt,
        },
      }
    })
    .get('/login/:provider', async ({ params, set }) => {
      const providerStr = expectDefined(
        params.provider,
        'Provider parameter is required',
      )
      const validatedProvider = expectValid(
        authProviderSchema,
        providerStr,
        'Auth provider',
      )

      if (validatedProvider === AuthProvider.WALLET) {
        set.status = 400
        return {
          error: 'Wallet login must be initiated from client',
          hint: 'Use POST /auth/login/wallet',
        }
      }

      const oauth3Service = getOAuth3Service()
      const appId = oauth3Service.getAppId()
      const teeAgentUrl = oauth3Service.getTeeAgentUrl()

      return {
        method: 'redirect',
        url: `${teeAgentUrl}/auth/init`,
        params: {
          provider: validatedProvider,
          appId,
          redirectUri:
            process.env.OAUTH3_REDIRECT_URI ||
            'http://localhost:4501/auth/callback',
        },
      }
    })
    .get('/callback', async ({ query, set }) => {
      const queryParams = {
        code: query.code,
        state: query.state,
        error: query.error,
      }

      const validatedQuery: AuthCallbackQuery = expectValid(
        authCallbackQuerySchema,
        queryParams,
        'OAuth callback query',
      )

      const escapeForJson = (str: string): string => {
        return str
          .replace(/\\/g, '\\\\')
          .replace(/'/g, "\\'")
          .replace(/"/g, '\\"')
          .replace(/</g, '\\u003c')
          .replace(/>/g, '\\u003e')
          .replace(/&/g, '\\u0026')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
      }

      const expectedOrigin =
        process.env.OAUTH3_REDIRECT_ORIGIN ||
        process.env.OAUTH3_REDIRECT_URI?.replace(/\/[^/]*$/, '') ||
        ''

      const postMessageOriginScript = expectedOrigin
        ? `'${escapeForJson(expectedOrigin)}'`
        : 'window.location.origin'

      set.headers['content-type'] = 'text/html'

      if (validatedQuery.error) {
        const safeError = escapeForJson(validatedQuery.error)
        return `
          <!DOCTYPE html>
          <html>
            <head><title>OAuth3 Error</title></head>
            <body>
              <script>
                if (window.opener) {
                  const targetOrigin = ${postMessageOriginScript};
                  window.opener.postMessage({ error: '${safeError}', type: 'oauth3-callback' }, targetOrigin);
                }
                window.close();
              </script>
              <p>Authentication failed. This window will close automatically.</p>
            </body>
          </html>
        `
      }

      if (!validatedQuery.code || !validatedQuery.state) {
        throw new ValidationError('Missing code or state in callback')
      }

      const safeCode = escapeForJson(validatedQuery.code)
      const safeState = escapeForJson(validatedQuery.state)

      return `
        <!DOCTYPE html>
        <html>
          <head><title>OAuth3 Callback</title></head>
          <body>
            <script>
              if (window.opener) {
                const targetOrigin = ${postMessageOriginScript};
                window.opener.postMessage({
                  code: '${safeCode}',
                  state: '${safeState}',
                  type: 'oauth3-callback'
                }, targetOrigin);
              }
              window.close();
            </script>
            <p>Completing authentication. This window will close automatically.</p>
          </body>
        </html>
      `
    })
    .post('/logout', async () => {
      const oauth3Service = getOAuth3Service()
      await oauth3Service.logout()
      return { success: true, message: 'Logged out' }
    })
    .get('/session', async () => {
      const oauth3Service = getOAuth3Service()
      const session = oauth3Service.getSession()

      if (session && oauth3Service.isLoggedIn()) {
        return {
          isLoggedIn: true,
          session: {
            sessionId: session.sessionId,
            smartAccount: session.smartAccount,
            expiresAt: session.expiresAt,
            capabilities: session.capabilities,
          },
          identity: oauth3Service.getIdentity(),
        }
      }

      return { isLoggedIn: false, message: 'No active session' }
    })
    .get('/health', async ({ set }) => {
      const oauth3Service = getOAuth3Service()
      const health = await oauth3Service.checkInfrastructureHealth()
      const allHealthy = health.jns && health.storage && health.teeNode

      if (!allHealthy) {
        set.status = 503
      }

      return {
        status: allHealthy ? 'healthy' : 'degraded',
        components: health,
      }
    })
}
