/**
 * Admin Module
 *
 * Framework-agnostic admin role validation with Elysia adapter.
 */

// Core
export {
  createAdminConfig,
  createAdminConfigFromEnv,
  hasPermission,
  isSuperAdmin,
  requireAdmin,
  requireRole,
  validateAdmin,
} from './core.js'
// Elysia adapter
export {
  type AdminContext,
  type AdminPluginConfig,
  adminPlugin,
  requireAdminMiddleware,
  requireRoleMiddleware,
  withAdmin,
  withRole,
} from './elysia.js'
// Types
export {
  type AdminConfig,
  AdminRole,
  type AdminUser,
  type AdminValidationResult,
  ROLE_HIERARCHY,
} from './types.js'
