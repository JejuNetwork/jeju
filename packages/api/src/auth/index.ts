/**
 * Auth Module
 *
 * Framework-agnostic authentication with adapters for Elysia.
 *
 * @example
 * // Using core functions directly
 * import { authenticate, validateOAuth3Session } from '@jejunetwork/api/auth/core'
 *
 * // Using Elysia adapter
 * import { authPlugin, createElysiaAuth } from '@jejunetwork/api/auth/elysia'
 */

// Core - framework-agnostic functions
export {
  authenticate,
  type CombinedAuthConfig,
  constantTimeCompare,
  createWalletAuthMessage,
  extractAuthHeaders,
  parseWalletAuthMessage,
  requireAuth,
  validateAPIKey,
  validateAPIKeyFromHeaders,
  validateOAuth3FromHeaders,
  validateOAuth3Session,
  validateWalletSignature,
  validateWalletSignatureFromHeaders,
} from './core.js'
// Elysia adapter
export {
  type AuthContext,
  type AuthPluginConfig,
  apiKeyAuthPlugin,
  authErrorHandler,
  authPlugin,
  createAuthDerive,
  createAuthGuard,
  createElysiaAuth,
  oauth3AuthPlugin,
  requireAuthMiddleware,
  walletAuthPlugin,
  withAuth,
} from './elysia.js'
// Types
export {
  AdminRole,
  type AdminUser,
  type AdminValidationResult,
  type APIKeyConfig,
  type APIKeyInfo,
  type APIKeyValidationResult,
  AuthError,
  AuthErrorCode,
  type AuthHeaders,
  AuthMethod,
  type AuthResult,
  type AuthUser,
  type OAuth3Config,
  type OAuth3ValidationResult,
  type WalletSignatureConfig,
  type WalletSignatureValidationResult,
} from './types.js'
