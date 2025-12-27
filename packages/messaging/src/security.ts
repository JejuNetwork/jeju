/**
 * Security Utilities for Network Messaging
 *
 * This module provides runtime checks and enforcement for secure
 * cryptographic practices, protecting against side-channel attacks
 * on TEE enclaves.
 *
 * SECURITY PRINCIPLES:
 * 1. Private keys should NEVER exist in application memory
 * 2. All signing should be delegated to KMS/TEE
 * 3. All encryption should be delegated to KMS/TEE
 * 4. Local key operations are only allowed in development
 */

import { createLogger } from '@jejunetwork/shared'

const log = createLogger('security')

/**
 * Environment detection
 */
export type Environment = 'production' | 'staging' | 'development' | 'test'

/**
 * Detect the current environment
 */
export function detectEnvironment(): Environment {
  // Check explicit environment variable
  const env = process.env.NODE_ENV?.toLowerCase()
  if (env === 'production') return 'production'
  if (env === 'staging') return 'staging'
  if (env === 'test') return 'test'
  if (env === 'development') return 'development'

  // Check Jeju network
  const network = process.env.JEJU_NETWORK?.toLowerCase()
  if (network === 'mainnet') return 'production'
  if (network === 'testnet') return 'staging'
  if (network === 'local') return 'development'

  // Default to development
  return 'development'
}

/**
 * Check if local key operations are allowed
 */
export function isLocalKeyOperationAllowed(): boolean {
  const env = detectEnvironment()
  return env === 'development' || env === 'test'
}

/**
 * Security violation error
 */
export class SecurityViolationError extends Error {
  constructor(
    message: string,
    public readonly violation: SecurityViolationType,
  ) {
    super(`SECURITY VIOLATION: ${message}`)
    this.name = 'SecurityViolationError'
  }
}

export type SecurityViolationType =
  | 'LOCAL_KEY_IN_PRODUCTION'
  | 'MOCK_MODE_IN_PRODUCTION'
  | 'KEY_EXPORT_IN_PRODUCTION'
  | 'INSECURE_RANDOM'

/**
 * Enforce that local key operations are not used in production
 *
 * @throws SecurityViolationError if called in production
 */
export function enforceNoLocalKeysInProduction(operation: string): void {
  if (!isLocalKeyOperationAllowed()) {
    log.error('Security violation: local key operation in production', {
      operation,
      environment: detectEnvironment(),
    })
    throw new SecurityViolationError(
      `Local key operation "${operation}" is not allowed in production. ` +
        `Use KMS-backed operations instead.`,
      'LOCAL_KEY_IN_PRODUCTION',
    )
  }
}

/**
 * Enforce that mock mode is not used in production
 *
 * @throws SecurityViolationError if mock mode is enabled in production
 */
export function enforceNoMockModeInProduction(config: {
  mockMode?: boolean
  network?: string
}): void {
  const env = detectEnvironment()
  if (config.mockMode && (env === 'production' || env === 'staging')) {
    log.error('Security violation: mock mode in production', {
      mockMode: config.mockMode,
      network: config.network ?? 'unknown',
      environment: env,
    })
    throw new SecurityViolationError(
      `Mock mode is not allowed in ${env}. ` +
        `Set mockMode: false for production deployments.`,
      'MOCK_MODE_IN_PRODUCTION',
    )
  }
}

/**
 * Enforce that key export is not used in production
 *
 * @throws SecurityViolationError if key export is attempted in production
 */
export function enforceNoKeyExportInProduction(keyId: string): void {
  const env = detectEnvironment()
  if (env === 'production' || env === 'staging') {
    log.error('Security violation: key export in production', {
      keyId,
      environment: env,
    })
    throw new SecurityViolationError(
      `Key export is not allowed in ${env}. ` +
        `Use the KMS provider's secure backup mechanisms instead.`,
      'KEY_EXPORT_IN_PRODUCTION',
    )
  }
}

/**
 * Security audit log entry
 */
export interface SecurityAuditEntry {
  timestamp: number
  operation: string
  keyId?: string
  success: boolean
  error?: string
  metadata?: Record<string, string | number | boolean>
}

/**
 * Security audit log
 *
 * Maintains a log of security-sensitive operations for monitoring
 * and forensic analysis.
 */
class SecurityAuditLog {
  private entries: SecurityAuditEntry[] = []
  private readonly maxEntries: number = 10000

  /**
   * Log a security operation
   */
  log(entry: Omit<SecurityAuditEntry, 'timestamp'>): void {
    const fullEntry: SecurityAuditEntry = {
      ...entry,
      timestamp: Date.now(),
    }

    this.entries.push(fullEntry)

    // Prune old entries
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries)
    }

    // Log to standard logger as well
    const logData: Record<string, string | number | boolean> = {
      operation: fullEntry.operation,
      success: fullEntry.success,
      timestamp: fullEntry.timestamp,
    }
    if (fullEntry.keyId !== undefined) {
      logData.keyId = fullEntry.keyId
    }
    if (fullEntry.error !== undefined) {
      logData.error = fullEntry.error
    }
    if (entry.success) {
      log.debug('Security audit', logData)
    } else {
      log.warn('Security audit (failure)', logData)
    }
  }

  /**
   * Get recent entries
   */
  getRecentEntries(limit: number = 100): SecurityAuditEntry[] {
    return this.entries.slice(-limit)
  }

  /**
   * Get entries by operation
   */
  getEntriesByOperation(operation: string): SecurityAuditEntry[] {
    return this.entries.filter((e) => e.operation === operation)
  }

  /**
   * Get failed operations
   */
  getFailedOperations(): SecurityAuditEntry[] {
    return this.entries.filter((e) => !e.success)
  }

  /**
   * Clear the audit log
   */
  clear(): void {
    this.entries = []
  }
}

/**
 * Global security audit log instance
 */
export const securityAudit = new SecurityAuditLog()

/**
 * Security-sensitive operation wrapper
 *
 * Wraps a function to log its execution to the security audit log.
 */
export function auditSecurityOperation<T extends (...args: unknown[]) => Promise<unknown>>(
  operation: string,
  fn: T,
  getKeyId?: (...args: Parameters<T>) => string | undefined,
): T {
  return (async (...args: Parameters<T>) => {
    const keyId = getKeyId?.(...args)

    try {
      const result = await fn(...args)
      securityAudit.log({
        operation,
        keyId,
        success: true,
      })
      return result
    } catch (error) {
      securityAudit.log({
        operation,
        keyId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      throw error
    }
  }) as T
}

/**
 * Security configuration validator
 */
export interface SecurityConfig {
  /** Require KMS for all signing operations */
  requireKMS?: boolean
  /** Require encryption for all messages */
  requireEncryption?: boolean
  /** Allow local key operations (development only) */
  allowLocalKeys?: boolean
  /** Allow mock mode (development only) */
  allowMockMode?: boolean
  /** Enable security audit logging */
  auditEnabled?: boolean
}

/**
 * Validate security configuration for the current environment
 */
export function validateSecurityConfig(config: SecurityConfig): void {
  const env = detectEnvironment()

  if (env === 'production' || env === 'staging') {
    // Production/staging requires KMS
    if (config.allowLocalKeys) {
      throw new SecurityViolationError(
        `allowLocalKeys is not permitted in ${env}`,
        'LOCAL_KEY_IN_PRODUCTION',
      )
    }

    if (config.allowMockMode) {
      throw new SecurityViolationError(
        `allowMockMode is not permitted in ${env}`,
        'MOCK_MODE_IN_PRODUCTION',
      )
    }

    // Warn if KMS is not required
    if (!config.requireKMS) {
      log.warn('Security: requireKMS is recommended for production')
    }

    // Warn if encryption is not required
    if (!config.requireEncryption) {
      log.warn('Security: requireEncryption is recommended for production')
    }
  }

  log.info('Security configuration validated', {
    environment: env,
    requireKMS: config.requireKMS ?? false,
    requireEncryption: config.requireEncryption ?? false,
    auditEnabled: config.auditEnabled ?? false,
  })
}

/**
 * Create recommended security configuration for the environment
 */
export function getRecommendedSecurityConfig(): SecurityConfig {
  const env = detectEnvironment()

  if (env === 'production') {
    return {
      requireKMS: true,
      requireEncryption: true,
      allowLocalKeys: false,
      allowMockMode: false,
      auditEnabled: true,
    }
  }

  if (env === 'staging') {
    return {
      requireKMS: true,
      requireEncryption: true,
      allowLocalKeys: false,
      allowMockMode: false,
      auditEnabled: true,
    }
  }

  // Development/test - more permissive
  return {
    requireKMS: false,
    requireEncryption: false,
    allowLocalKeys: true,
    allowMockMode: true,
    auditEnabled: false,
  }
}

