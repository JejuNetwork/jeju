import { type Context, Elysia } from 'elysia'
import type { Address } from 'viem'
import {
  authenticate,
  type CombinedAuthConfig,
  extractAuthHeaders,
  requireAuth,
} from './core.js'
import {
  type APIKeyConfig,
  AuthError,
  AuthErrorCode,
  AuthMethod,
  type AuthUser,
  type OAuth3Config,
  type WalletSignatureConfig,
} from './types.js'

/** Context derived by auth plugin - index signature required for Elysia derive compatibility */
export interface AuthContext extends Record<string, Address | AuthUser | AuthMethod | string | boolean | undefined> {
  address?: Address
  authUser?: AuthUser
  authMethod?: AuthMethod
  oauth3SessionId?: string
  isAuthenticated: boolean
}

export interface AuthPluginConfig extends CombinedAuthConfig {
  /** Routes to skip authentication (e.g., ['/health', '/docs']) */
  skipRoutes?: string[]
  /** Whether to require authentication on all routes by default */
  requireAuth?: boolean
}

export function createAuthDerive(config: CombinedAuthConfig) {
  return async function authDerive({ request }: Context): Promise<AuthContext> {
    const headers = extractAuthHeaders(
      Object.fromEntries(request.headers.entries()),
    )

    const result = await authenticate(headers, config)

    if (result.authenticated && result.user) {
      return {
        address: result.user.address,
        authUser: result.user,
        authMethod: result.method,
        oauth3SessionId: result.user.sessionId,
        isAuthenticated: true,
      } satisfies AuthContext
    }

    return { isAuthenticated: false } satisfies AuthContext
  }
}

interface AuthMethodInfo {
  header?: string
  headers?: string[]
  message?: string
  description: string
}

interface AuthGuardErrorResponse {
  error: string
  code: AuthErrorCode
  methods: {
    oauth3: AuthMethodInfo
    walletSignature: AuthMethodInfo
    apiKey: AuthMethodInfo
  }
}

export function createAuthGuard(config: CombinedAuthConfig) {
  return async function authGuard({
    request,
    set,
  }: Context): Promise<AuthGuardErrorResponse | undefined> {
    const headers = extractAuthHeaders(
      Object.fromEntries(request.headers.entries()),
    )

    const result = await authenticate(headers, config)

    if (!result.authenticated) {
      set.status = 401
      return {
        error: result.error ?? 'Authentication required',
        code: AuthErrorCode.MISSING_CREDENTIALS,
        methods: {
          oauth3: {
            header: 'x-oauth3-session',
            description: 'OAuth3 session ID from TEE agent',
          },
          walletSignature: {
            headers: ['x-jeju-address', 'x-jeju-timestamp', 'x-jeju-signature'],
            message: 'jeju-dapp:{timestamp}',
            description: 'Sign timestamp with wallet',
          },
          apiKey: {
            header: 'x-api-key',
            description: 'API key for programmatic access',
          },
        },
      }
    }

    return undefined
  }
}

export function authPlugin(config: AuthPluginConfig) {
  const skipRoutes = new Set(config.skipRoutes ?? [])
  const authDerive = createAuthDerive(config)

  return new Elysia({ name: 'auth' })
    .derive(authDerive)
    .onBeforeHandle(async (ctx) => {
      const { path, request, set } = ctx
      // AuthContext is added by derive above
      const authCtx = ctx as Context & AuthContext
      const isAuthenticated = authCtx.isAuthenticated

      if (skipRoutes.has(path)) {
        return undefined
      }

      if (!config.requireAuth) {
        return undefined
      }

      if (isAuthenticated) {
        return undefined
      }

      const headers = extractAuthHeaders(
        Object.fromEntries(request.headers.entries()),
      )
      const result = await authenticate(headers, config)

      if (!result.authenticated) {
        set.status = 401
        return {
          error: result.error ?? 'Authentication required',
          code: AuthErrorCode.MISSING_CREDENTIALS,
        }
      }

      return undefined
    })
}

export function oauth3AuthPlugin(oauth3Config: OAuth3Config) {
  return authPlugin({
    oauth3: oauth3Config,
    priority: [AuthMethod.OAUTH3],
  })
}

export function walletAuthPlugin(walletConfig: WalletSignatureConfig) {
  return authPlugin({
    walletSignature: walletConfig,
    priority: [AuthMethod.WALLET_SIGNATURE],
  })
}

export function apiKeyAuthPlugin(apiKeyConfig: APIKeyConfig) {
  return authPlugin({
    apiKey: apiKeyConfig,
    priority: [AuthMethod.API_KEY],
  })
}

export function withAuth<T>(
  handler: (
    ctx: Context & { authUser: AuthUser; address: Address },
  ) => T | Promise<T>,
  config: CombinedAuthConfig,
) {
  return async (ctx: Context): Promise<T> => {
    const headers = extractAuthHeaders(
      Object.fromEntries(ctx.request.headers.entries()),
    )

    const user = await requireAuth(headers, config)

    return handler({
      ...ctx,
      authUser: user,
      address: user.address,
    } as Context & {
      authUser: AuthUser
      address: Address
    })
  }
}

export function requireAuthMiddleware(config: CombinedAuthConfig) {
  return async ({
    request,
    set,
  }: Context): Promise<
    | {
        error: string
        code: string
        statusCode: number
      }
    | undefined
  > => {
    const headers = extractAuthHeaders(
      Object.fromEntries(request.headers.entries()),
    )

    const result = await authenticate(headers, config)

    if (!result.authenticated) {
      set.status = 401
      return {
        error: result.error ?? 'Authentication required',
        code: AuthErrorCode.MISSING_CREDENTIALS,
        statusCode: 401,
      }
    }

    return undefined
  }
}

export function authErrorHandler({
  error,
  set,
}: {
  error: Error
  set: Context['set']
}): { error: string; code: string } | undefined {
  if (error instanceof AuthError) {
    set.status = error.statusCode
    return {
      error: error.message,
      code: error.code,
    }
  }
  return undefined
}

export function createElysiaAuth(options: {
  oauth3?: OAuth3Config
  walletSignature?: {
    domain?: string
    validityWindowMs?: number
    messagePrefix?: string
  }
  apiKeys?: Map<
    string,
    {
      address: Address
      permissions: string[]
      rateLimitTier: string
      expiresAt?: number
    }
  >
  skipRoutes?: string[]
  requireAuth?: boolean
}) {
  const config: AuthPluginConfig = {
    skipRoutes: options.skipRoutes ?? ['/health', '/', '/docs'],
    requireAuth: options.requireAuth ?? false,
  }

  if (options.oauth3) {
    config.oauth3 = options.oauth3
  }

  if (options.walletSignature) {
    config.walletSignature = {
      domain: options.walletSignature.domain,
      validityWindowMs: options.walletSignature.validityWindowMs,
      messagePrefix: options.walletSignature.messagePrefix,
    }
  }

  if (options.apiKeys) {
    config.apiKey = {
      keys: options.apiKeys,
    }
  }

  return authPlugin(config)
}
