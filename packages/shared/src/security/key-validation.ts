/**
 * Key Security Validation
 *
 * Enforces secure key management patterns across the codebase.
 * In production, all cryptographic operations MUST use KMS with threshold signing.
 *
 * TEE Side-Channel Attack Mitigation:
 * - Private keys NEVER exist in full form in server memory
 * - All signing uses FROST threshold signatures (t-of-n)
 * - Keys distributed across multiple MPC parties
 * - TEE attestation required before key operations
 */

import { isProductionEnv } from '@jejunetwork/config'

// Environment variables that indicate insecure direct key usage
const INSECURE_KEY_VARS = [
  'PRIVATE_KEY',
  'DWS_PRIVATE_KEY',
  'SOLVER_PRIVATE_KEY',
  'TEE_VERIFIER_PRIVATE_KEY',
  'OPERATOR_PRIVATE_KEY',
  'WORKER_PRIVATE_KEY',
  'NODE_PRIVATE_KEY',
  'SEQUENCER_PRIVATE_KEY',
  'BATCHER_PRIVATE_KEY',
  'PROPOSER_PRIVATE_KEY',
  'CHALLENGER_PRIVATE_KEY',
  'ORACLE_PRIVATE_KEY',
  'ADMIN_PRIVATE_KEY',
  'DEPLOYER_PRIVATE_KEY',
] as const

// Required KMS configuration for production
const REQUIRED_KMS_VARS = ['KMS_ENDPOINT', 'KMS_KEY_ID'] as const

// Optional but recommended KMS configuration
const RECOMMENDED_KMS_VARS = [
  'TEE_ENDPOINT',
  'MPC_COORDINATOR_ENDPOINT',
  'TEE_ENCRYPTION_SECRET',
] as const

export interface KeySecurityValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  mode: 'production-kms' | 'development-kms' | 'development-local' | 'invalid'
}

/**
 * Validate key security configuration
 *
 * In production:
 * - MUST have KMS configuration
 * - MUST NOT have direct private key environment variables
 * - SHOULD have TEE/MPC configuration
 *
 * In development:
 * - SHOULD prefer KMS but allows direct keys with warnings
 */
export function validateKeySecurityConfig(): KeySecurityValidationResult {
  const isProduction = isProductionEnv()
  const errors: string[] = []
  const warnings: string[] = []

  // Check for insecure direct key variables
  const foundInsecureKeys = INSECURE_KEY_VARS.filter((v) => process.env[v])

  // Check for required KMS configuration
  const missingKmsVars = REQUIRED_KMS_VARS.filter((v) => !process.env[v])
  const hasKmsConfig = missingKmsVars.length === 0

  // Check for recommended KMS configuration
  const missingRecommendedVars = RECOMMENDED_KMS_VARS.filter(
    (v) => !process.env[v],
  )

  if (isProduction) {
    // Production: Strict enforcement

    if (foundInsecureKeys.length > 0) {
      errors.push(
        `CRITICAL: Direct private key environment variables found in production: ${foundInsecureKeys.join(', ')}. ` +
          'These MUST be removed and replaced with KMS key IDs. ' +
          'Direct keys in memory are vulnerable to side-channel attacks.',
      )
    }

    if (!hasKmsConfig) {
      errors.push(
        `CRITICAL: Missing required KMS configuration: ${missingKmsVars.join(', ')}. ` +
          'Production MUST use KMS for all signing operations.',
      )
    }

    if (missingRecommendedVars.length > 0) {
      warnings.push(
        `WARNING: Missing recommended security configuration: ${missingRecommendedVars.join(', ')}. ` +
          'Consider adding TEE/MPC configuration for enhanced security.',
      )
    }

    // Check TEE attestation configuration
    if (!process.env.TEE_ENDPOINT && !process.env.MPC_COORDINATOR_ENDPOINT) {
      warnings.push(
        'WARNING: No TEE or MPC endpoint configured. ' +
          'Production should use hardware-backed key protection.',
      )
    }

    if (errors.length > 0) {
      return { valid: false, errors, warnings, mode: 'invalid' }
    }

    return { valid: true, errors: [], warnings, mode: 'production-kms' }
  }

  // Development: Warn but allow
  if (foundInsecureKeys.length > 0) {
    warnings.push(
      `Development mode: Using direct private keys: ${foundInsecureKeys.join(', ')}. ` +
        'This is INSECURE and must not be used in production.',
    )

    if (!hasKmsConfig) {
      return { valid: true, errors: [], warnings, mode: 'development-local' }
    }
  }

  if (hasKmsConfig) {
    return { valid: true, errors: [], warnings, mode: 'development-kms' }
  }

  return { valid: true, errors: [], warnings, mode: 'development-local' }
}

/**
 * Enforce key security at service startup
 *
 * This should be called at the entry point of all services that perform
 * cryptographic operations. In production, it will throw if the configuration
 * is insecure.
 *
 * @param serviceName - Name of the service for error messages
 * @throws Error if configuration is insecure in production
 */
export function enforceKeySecurityAtStartup(serviceName: string): void {
  const result = validateKeySecurityConfig()

  // Log warnings
  for (const warning of result.warnings) {
    console.warn(`[${serviceName}] ${warning}`)
  }

  // In production, errors are fatal
  if (!result.valid) {
    for (const error of result.errors) {
      console.error(`[${serviceName}] ${error}`)
    }
    throw new Error(
      `[${serviceName}] Key security validation failed. ` +
        'Cannot start service with insecure key configuration in production. ' +
        `Errors: ${result.errors.join('; ')}`,
    )
  }

  // Log mode
  const modeMessages: Record<typeof result.mode, string> = {
    'production-kms': '🔐 Running in production mode with KMS (secure)',
    'development-kms': '🔐 Running in development mode with KMS (recommended)',
    'development-local':
      '⚠️  Running in development mode with local keys (INSECURE)',
    invalid: '❌ Invalid configuration',
  }
  console.log(`[${serviceName}] ${modeMessages[result.mode]}`)
}

/**
 * Check if a service should use KMS
 *
 * Returns true if:
 * - In production (KMS required)
 * - In development with KMS configured
 */
export function shouldUseKMS(): boolean {
  const result = validateKeySecurityConfig()
  return result.mode === 'production-kms' || result.mode === 'development-kms'
}

/**
 * Get the KMS configuration
 *
 * @throws Error if KMS is required but not configured
 */
export function getKMSConfig(): {
  endpoint: string
  keyId: string
  teeEndpoint?: string
  mpcEndpoint?: string
} {
  const endpoint = process.env.KMS_ENDPOINT
  const keyId = process.env.KMS_KEY_ID

  if (!endpoint || !keyId) {
    if (isProductionEnv()) {
      throw new Error(
        'KMS configuration required in production. ' +
          'Set KMS_ENDPOINT and KMS_KEY_ID environment variables.',
      )
    }
    throw new Error('KMS not configured')
  }

  return {
    endpoint,
    keyId,
    teeEndpoint: process.env.TEE_ENDPOINT,
    mpcEndpoint: process.env.MPC_COORDINATOR_ENDPOINT,
  }
}

