/**
 * Elysia Admin Adapter
 *
 * Provides Elysia plugins for admin access control.
 */

import { type Context, Elysia } from 'elysia'
import { AuthError, AuthErrorCode, type AuthUser } from '../auth/types.js'
import { requireAdmin, requireRole, validateAdmin } from './core.js'
import type { AdminConfig, AdminRole, AdminUser } from './types.js'

// ============ Types ============

/** Context with address from auth plugin */
interface AuthDerivedContext {
  address?: string
}

export interface AdminContext {
  admin?: AdminUser
  isAdmin: boolean
  /** Index signature for Elysia derive compatibility */
  [key: string]: AdminUser | boolean | undefined
}

export interface AdminPluginConfig extends AdminConfig {
  /** Routes to skip admin check */
  skipRoutes?: string[]
}

// ============ Elysia Plugin ============

/**
 * Create an Elysia plugin for admin access control.
 * Requires auth plugin to be applied first.
 */
export function adminPlugin(config: AdminPluginConfig) {
  const skipRoutes = new Set(config.skipRoutes ?? [])

  return new Elysia({ name: 'admin' })
    .derive((ctx): AdminContext => {
      // Auth plugin adds address to context
      const authCtx = ctx as Context & AuthDerivedContext
      const address = authCtx.address
      if (!address) {
        return { isAdmin: false }
      }

      const result = validateAdmin(
        { address: address as `0x${string}`, method: 'oauth3' },
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
      // AdminContext is added by derive above
      const adminCtx = ctx as Context & AdminContext
      const isAdmin = adminCtx.isAdmin

      if (skipRoutes.has(path)) {
        return undefined
      }

      if (!isAdmin) {
        set.status = 403
        return {
          error: 'Admin access required',
          code: AuthErrorCode.FORBIDDEN,
        }
      }

      return undefined
    })
}

/**
 * Create a require-admin middleware for specific routes
 */
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
      { address: address as `0x${string}`, method: 'oauth3' },
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

/**
 * Create a role-specific middleware
 */
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
      { address: address as `0x${string}`, method: 'oauth3' },
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

/**
 * Higher-order function for admin-only routes
 */
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

/**
 * Higher-order function for role-specific routes
 */
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
