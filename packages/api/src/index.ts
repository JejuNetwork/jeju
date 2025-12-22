/**
 * @jejunetwork/api
 *
 * Framework-agnostic API middleware with adapters for Elysia.
 *
 * This package provides:
 * - Authentication (OAuth3, wallet signature, API keys)
 * - Rate limiting with tiered support
 * - Admin role validation
 * - Standardized error handling
 *
 * @example
 * ```typescript
 * import { Elysia } from 'elysia'
 * import {
 *   createElysiaAuth,
 *   simpleRateLimit,
 *   createElysiaErrorHandler,
 * } from '@jejunetwork/api'
 *
 * const app = new Elysia()
 *   .use(createElysiaAuth({
 *     oauth3: { teeAgentUrl: '...', appId: '...' },
 *     walletSignature: { domain: 'example.com' },
 *   }))
 *   .use(simpleRateLimit(100, 60000))
 *   .onError(createElysiaErrorHandler(process.env.NODE_ENV === 'development'))
 *   .get('/protected', ({ address }) => ({ address }))
 * ```
 */

// ============ Auth Module ============

// Core functions
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
} from './auth/core.js'
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
} from './auth/elysia.js'
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
} from './auth/types.js'

// ============ Rate Limiting Module ============

// Core
export {
  createRateLimitHeaders,
  createRateLimitKey,
  extractClientIp,
  getRateLimiter,
  InMemoryRateLimitStore,
  initRateLimiter,
  RateLimiter,
  resetRateLimiter,
} from './rate-limiting/core.js'
// Elysia adapter
export {
  type RateLimitContext,
  type RateLimitPluginConfig,
  rateLimitPlugin,
  simpleRateLimit,
  tieredRateLimit,
  withRateLimit,
} from './rate-limiting/elysia.js'
// Types
export {
  type RateLimitEntry,
  type RateLimiterConfig,
  type RateLimitHeaders,
  type RateLimitResult,
  type RateLimitStore,
  type RateLimitTier,
  RateLimitTiers,
} from './rate-limiting/types.js'

// ============ Admin Module ============

export {
  createAdminConfig,
  createAdminConfigFromEnv,
  hasPermission,
  isSuperAdmin,
  requireAdmin,
  requireRole,
  validateAdmin,
} from './admin/core.js'
export {
  type AdminContext,
  type AdminPluginConfig,
  adminPlugin,
  requireAdminMiddleware,
  requireRoleMiddleware,
  withAdmin,
  withRole,
} from './admin/elysia.js'
export {
  type AdminConfig,
  ROLE_HIERARCHY,
} from './admin/types.js'

// ============ Error Handling ============

export {
  APIError,
  assert,
  ConflictError,
  createElysiaErrorHandler,
  type ErrorResponse,
  expectDefined,
  expectValid,
  getStatusCode,
  InternalError,
  NotFoundError,
  ServiceUnavailableError,
  sanitizeErrorMessage,
  toErrorResponse,
  ValidationError,
} from './error-handler.js'
