/**
 * Framework-Agnostic Admin Validation
 *
 * Pure functions for admin role validation.
 */

import type { Address } from 'viem'
import { AuthError, AuthErrorCode, type AuthUser } from '../auth/types.js'
import {
  type AdminConfig,
  AdminRole,
  type AdminUser,
  type AdminValidationResult,
  ROLE_HIERARCHY,
} from './types.js'

/**
 * Check if an address is an admin
 */
export function validateAdmin(
  user: AuthUser,
  config: AdminConfig,
): AdminValidationResult {
  const role = config.admins.get(user.address)

  if (!role) {
    return {
      valid: false,
      error: 'User is not an admin',
    }
  }

  // Check required role if specified
  if (config.requiredRole) {
    const userLevel = ROLE_HIERARCHY[role]
    const requiredLevel = ROLE_HIERARCHY[config.requiredRole]

    if (userLevel < requiredLevel) {
      return {
        valid: false,
        error: `Insufficient permissions. Required: ${config.requiredRole}, has: ${role}`,
      }
    }
  }

  return {
    valid: true,
    admin: {
      ...user,
      role,
    },
  }
}

/**
 * Check if a role has sufficient permissions
 */
export function hasPermission(
  userRole: AdminRole,
  requiredRole: AdminRole,
): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole]
}

/**
 * Require admin access - throws if not admin
 */
export function requireAdmin(user: AuthUser, config: AdminConfig): AdminUser {
  const result = validateAdmin(user, config)

  if (!result.valid || !result.admin) {
    throw new AuthError(
      result.error ?? 'Admin access required',
      AuthErrorCode.FORBIDDEN,
      403,
    )
  }

  return result.admin
}

/**
 * Require specific admin role - throws if insufficient permissions
 */
export function requireRole(
  user: AuthUser,
  config: AdminConfig,
  role: AdminRole,
): AdminUser {
  const configWithRole: AdminConfig = {
    ...config,
    requiredRole: role,
  }

  return requireAdmin(user, configWithRole)
}

/**
 * Check if an address is a super admin
 */
export function isSuperAdmin(address: Address, config: AdminConfig): boolean {
  return config.admins.get(address) === AdminRole.SUPER_ADMIN
}

/**
 * Create an admin config from an array of admin entries
 */
export function createAdminConfig(
  admins: Array<{ address: Address; role: AdminRole }>,
  requiredRole?: AdminRole,
): AdminConfig {
  const adminMap = new Map<Address, AdminRole>()
  for (const admin of admins) {
    adminMap.set(admin.address, admin.role)
  }
  return { admins: adminMap, requiredRole }
}

/**
 * Create an admin config from environment variable
 * Format: "address1:role1,address2:role2"
 */
export function createAdminConfigFromEnv(
  envValue: string,
  requiredRole?: AdminRole,
): AdminConfig {
  const admins = new Map<Address, AdminRole>()

  const entries = envValue.split(',').filter(Boolean)
  for (const entry of entries) {
    const [address, role] = entry.split(':')
    if (address && role && isValidRole(role)) {
      admins.set(address.trim() as Address, role as AdminRole)
    }
  }

  return { admins, requiredRole }
}

function isValidRole(role: string): role is AdminRole {
  return Object.values(AdminRole).includes(role as AdminRole)
}
