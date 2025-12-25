/**
 * Framework-Agnostic Auth Types
 *
 * Core types for authentication that don't depend on any specific framework.
 * These types are used by both the core validation logic and framework adapters.
 */

import type { Address, Hex } from 'viem'

/**
 * Supported authentication methods
 */
export const AuthMethod = {
  OAUTH3: 'oauth3',
  WALLET_SIGNATURE: 'wallet-signature',
  API_KEY: 'api-key',
} as const
export type AuthMethod = (typeof AuthMethod)[keyof typeof AuthMethod]

/**
 * User context populated after successful authentication
 */
export interface AuthUser {
  address: Address
  method: AuthMethod
  sessionId?: string
  permissions?: string[]
}

/**
 * OAuth3 session validation result - discriminated union for type safety
 */
export type OAuth3ValidationResult =
  | { valid: true; user: AuthUser; expired?: never; error?: never }
  | { valid: false; error: string; expired?: boolean; user?: never }

/**
 * Wallet signature validation result - discriminated union for type safety
 */
export type WalletSignatureValidationResult =
  | { valid: true; user: AuthUser; expired?: never; error?: never }
  | { valid: false; error: string; expired?: boolean; user?: never }

/**
 * API key validation result - discriminated union for type safety
 */
export type APIKeyValidationResult =
  | { valid: true; user: AuthUser; rateLimitTier: string; error?: never }
  | { valid: false; error: string; rateLimitTier?: never; user?: never }

/**
 * Combined authentication result from any method
 */
export type AuthResult =
  | { authenticated: true; user: AuthUser; method: AuthMethod; error?: never }
  | { authenticated: false; error: string; method?: AuthMethod; user?: never }

/**
 * Configuration for OAuth3 validation
 */
export interface OAuth3Config {
  teeAgentUrl: string
  appId: string | Hex
  sessionValidityWindowMs?: number
}

/**
 * Configuration for wallet signature validation
 */
export interface WalletSignatureConfig {
  /** Domain used as message prefix if messagePrefix is not set */
  domain?: string
  /** Time window in ms for signature validity (default: 5 minutes) */
  validityWindowMs?: number
  /** Message prefix for signing (takes precedence over domain) */
  messagePrefix?: string
}

/**
 * Configuration for API key validation
 */
export interface APIKeyConfig {
  keys: Map<string, APIKeyInfo>
  headerName?: string
}

/**
 * Information about an API key
 */
export interface APIKeyInfo {
  address: Address
  permissions: string[]
  rateLimitTier: string
  expiresAt?: number
}

/**
 * Raw headers from a request (framework-agnostic)
 */
export interface AuthHeaders {
  'x-oauth3-session'?: string
  'x-jeju-address'?: string
  'x-jeju-timestamp'?: string
  'x-jeju-signature'?: string
  'x-api-key'?: string
  authorization?: string
}

/**
 * Authentication error codes
 */
export const AuthErrorCode = {
  MISSING_CREDENTIALS: 'MISSING_CREDENTIALS',
  INVALID_SESSION: 'INVALID_SESSION',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  SIGNATURE_EXPIRED: 'SIGNATURE_EXPIRED',
  INVALID_API_KEY: 'INVALID_API_KEY',
  API_KEY_EXPIRED: 'API_KEY_EXPIRED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
} as const
export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode]

/**
 * Authentication error with typed code
 */
export class AuthError extends Error {
  constructor(
    message: string,
    public code: AuthErrorCode,
    public statusCode: number = 401,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

/**
 * Admin role for admin-only endpoints
 */
export const AdminRole = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  MODERATOR: 'moderator',
} as const
export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole]

/**
 * Admin user with role information
 */
export interface AdminUser extends AuthUser {
  role: AdminRole
}

/**
 * Result from admin validation - discriminated union for type safety
 */
export type AdminValidationResult =
  | { valid: true; admin: AdminUser; error?: never }
  | { valid: false; error: string; admin?: never }
