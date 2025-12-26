import { type Context, Elysia } from 'elysia'
import {
  AuthError,
  AuthErrorCode,
  AuthMethod,
  type AuthUser,
} from '../auth/types.js'
import { requireAdmin, requireRole, validateAdmin } from './core.js'
import type { AdminConfig, AdminRole, AdminUser } from './types.js'

/** Context with address from auth plugin */
interface AuthDerivedContext {
  address?: string
}

/** Admin context - index signature required for Elysia derive compatibility */
export interface AdminContext
  extends Record<string, AdminUser | boolean | undefined> {
  admin?: AdminUser
  isAdmin: boolean
}

export interface AdminPluginConfig extends AdminConfig {
  /** Routes to skip admin check */
  skipRoutes?: string[]
}

export function adminPlugin(config: AdminPluginConfig) {
  const skipRoutes = new Set(config.skipRoutes ?? [])

  return new Elysia({ name: 'admin' })
    .derive((ctx): AdminContext => {
      const authCtx = ctx as Context & AuthDerivedContext
      const address = authCtx.address
      if (!address) {
        return { isAdmin: false }
      }

      const result = validateAdmin(
        { address: address as `0x${string}`, method: AuthMethod.OAUTH3 },
        config,
      )

      if (result.valid && result.admin) {
        return {
          admin: result.admin,
          isAdmin: true,
        }
      }

      return { isAdmin: false }
    })
    .onBeforeHandle((ctx) => {
      const { path, set } = ctx
      const adminCtx = ctx as Context & AdminContext

      if (skipRoutes.has(path)) {
        return undefined
      }

      if (!adminCtx.isAdmin) {
        set.status = 403
        return {
          error: 'Admin access required',
          code: AuthErrorCode.FORBIDDEN,
        }
      }

      return undefined
    })
}

export function requireAdminMiddleware(config: AdminConfig) {
  return async ({
    address,
    set,
  }: Context & { address?: string }): Promise<
    { error: string; code: string } | undefined
  > => {
    if (!address) {
      set.status = 401
      return {
        error: 'Authentication required',
        code: AuthErrorCode.MISSING_CREDENTIALS,
      }
    }

    const result = validateAdmin(
      { address: address as `0x${string}`, method: AuthMethod.OAUTH3 },
      config,
    )

    if (!result.valid) {
      set.status = 403
      return {
        error: result.error ?? 'Admin access required',
        code: AuthErrorCode.FORBIDDEN,
      }
    }

    return undefined
  }
}

export function requireRoleMiddleware(config: AdminConfig, role: AdminRole) {
  return async ({
    address,
    set,
  }: Context & { address?: string }): Promise<
    { error: string; code: string } | undefined
  > => {
    if (!address) {
      set.status = 401
      return {
        error: 'Authentication required',
        code: AuthErrorCode.MISSING_CREDENTIALS,
      }
    }

    const configWithRole: AdminConfig = { ...config, requiredRole: role }
    const result = validateAdmin(
      { address: address as `0x${string}`, method: AuthMethod.OAUTH3 },
      configWithRole,
    )

    if (!result.valid) {
      set.status = 403
      return {
        error: result.error ?? `${role} access required`,
        code: AuthErrorCode.FORBIDDEN,
      }
    }

    return undefined
  }
}

export function withAdmin<T>(
  handler: (ctx: Context & { admin: AdminUser }) => T | Promise<T>,
  config: AdminConfig,
) {
  return async (
    ctx: Context & { address?: string; authUser?: AuthUser },
  ): Promise<T> => {
    if (!ctx.address || !ctx.authUser) {
      throw new AuthError(
        'Authentication required',
        AuthErrorCode.MISSING_CREDENTIALS,
        401,
      )
    }

    const admin = requireAdmin(ctx.authUser, config)
    return handler({ ...ctx, admin } as Context & { admin: AdminUser })
  }
}

export function withRole<T>(
  handler: (ctx: Context & { admin: AdminUser }) => T | Promise<T>,
  config: AdminConfig,
  role: AdminRole,
) {
  return async (
    ctx: Context & { address?: string; authUser?: AuthUser },
  ): Promise<T> => {
    if (!ctx.address || !ctx.authUser) {
      throw new AuthError(
        'Authentication required',
        AuthErrorCode.MISSING_CREDENTIALS,
        401,
      )
    }

    const admin = requireRole(ctx.authUser, config, role)
    return handler({ ...ctx, admin } as Context & { admin: AdminUser })
  }
}
