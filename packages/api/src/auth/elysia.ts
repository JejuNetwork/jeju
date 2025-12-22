/**
 * Elysia Auth Adapter
 *
 * Thin wrapper that adapts the framework-agnostic auth core to Elysia.
 * Provides Elysia plugins and derive functions.
 */

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

// ============ Types for Elysia Context ============

export interface AuthContext {
  /** Authenticated user address */
  address?: Address
  /** Full auth user info */
  authUser?: AuthUser
  /** Authentication method used */
  authMethod?: AuthMethod
  /** OAuth3 session ID if OAuth3 auth */
  oauth3SessionId?: string
  /** Whether the request is authenticated */
  isAuthenticated: boolean
  /** Index signature for Elysia derive compatibility */
  [key: string]: Address | AuthUser | AuthMethod | string | boolean | undefined
}

export interface AuthPluginConfig extends CombinedAuthConfig {
  /** Routes to skip authentication (e.g., ['/health', '/docs']) */
  skipRoutes?: string[]
  /** Whether to require authentication on all routes by default */
  requireAuth?: boolean
}

// ============ Derive Functions ============

/**
 * Create an auth derive function for Elysia.
 * Adds auth context to all requests without requiring authentication.
 */
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
      }
    }

    return { isAuthenticated: false }
  }
}

/**
 * Create a guard function that requires authentication.
 * Use in onBeforeHandle to protect routes.
 */
export function createAuthGuard(config: CombinedAuthConfig) {
  return async function authGuard({ request, set }: Context): Promise<
    | {
        error: string
        code: AuthErrorCode
        methods: Record<string, unknown>
      }
    | undefined
  > {
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

// ============ Elysia Plugins ============

/**
 * Create an Elysia plugin for authentication.
 * Adds auth context and optionally enforces authentication.
 */
export function authPlugin(config: AuthPluginConfig) {
  const skipRoutes = new Set(config.skipRoutes ?? [])
  const authDerive = createAuthDerive(config)

  return new Elysia({ name: 'auth' })
    .derive(authDerive)
    .onBeforeHandle(async (ctx) => {
      const { path, request, set } = ctx
      const isAuthenticated = (ctx as unknown as { isAuthenticated?: boolean })
        .isAuthenticated

      // Skip auth check for specified routes
      if (skipRoutes.has(path)) {
        return undefined
      }

      // Skip if requireAuth is false
      if (!config.requireAuth) {
        return undefined
      }

      // If already authenticated from derive, allow through
      if (isAuthenticated) {
        return undefined
      }

      // Attempt authentication
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

/**
 * Create an OAuth3-only auth plugin
 */
export function oauth3AuthPlugin(oauth3Config: OAuth3Config) {
  return authPlugin({
    oauth3: oauth3Config,
    priority: [AuthMethod.OAUTH3],
  })
}

/**
 * Create a wallet signature auth plugin
 */
export function walletAuthPlugin(walletConfig: WalletSignatureConfig) {
  return authPlugin({
    walletSignature: walletConfig,
    priority: [AuthMethod.WALLET_SIGNATURE],
  })
}

/**
 * Create an API key auth plugin
 */
export function apiKeyAuthPlugin(apiKeyConfig: APIKeyConfig) {
  return authPlugin({
    apiKey: apiKeyConfig,
    priority: [AuthMethod.API_KEY],
  })
}

// ============ Route Decorators / Guards ============

/**
 * Higher-order function to create a protected route handler.
 * Throws 401 if not authenticated.
 */
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

/**
 * Create a require-auth middleware for specific routes.
 * Returns undefined if auth succeeds, or an error response if it fails.
 */
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

// ============ Error Handler ============

/**
 * Elysia error handler for auth errors
 */
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

// ============ Helper to Create Full Auth Plugin ============

/**
 * Create a complete auth plugin with common defaults.
 * This is the recommended way to add auth to an Elysia app.
 */
export function createElysiaAuth(options: {
  oauth3?: OAuth3Config
  walletSignature?: {
    domain: string
    validityWindowMs?: number
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
      messagePrefix: 'jeju-dapp',
    }
  }

  if (options.apiKeys) {
    config.apiKey = {
      keys: options.apiKeys,
    }
  }

  return authPlugin(config)
}
