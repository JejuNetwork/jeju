/**
 * Admin Types
 *
 * Admin-specific configuration types. Core admin types (AdminUser, AdminRole,
 * AdminValidationResult) are re-exported from auth/types for consistency.
 */

import type { Address } from 'viem'
import {
  AdminRole,
  type AdminUser,
  type AdminValidationResult,
} from '../auth/types.js'

/**
 * Admin configuration
 */
export interface AdminConfig {
  /** Map of addresses to their admin roles */
  admins: Map<Address, AdminRole>
  /** Required role for access (if not specified, any admin role works) */
  requiredRole?: AdminRole
}

/**
 * Role hierarchy for permission checks
 */
export const ROLE_HIERARCHY: Record<AdminRole, number> = {
  [AdminRole.SUPER_ADMIN]: 3,
  [AdminRole.ADMIN]: 2,
  [AdminRole.MODERATOR]: 1,
}

export { AdminRole, type AdminUser, type AdminValidationResult }
