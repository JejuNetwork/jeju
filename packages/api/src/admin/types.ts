import type { Address } from 'viem'
import {
  AdminRole,
  type AdminUser,
  type AdminValidationResult,
} from '../auth/types.js'

export interface AdminConfig {
  /** Map of addresses to their admin roles */
  admins: Map<Address, AdminRole>
  /** Required role for access (if not specified, any admin role works) */
  requiredRole?: AdminRole
}

export const ROLE_HIERARCHY: Record<AdminRole, number> = {
  [AdminRole.SUPER_ADMIN]: 3,
  [AdminRole.ADMIN]: 2,
  [AdminRole.MODERATOR]: 1,
}

export { AdminRole, type AdminUser, type AdminValidationResult }
