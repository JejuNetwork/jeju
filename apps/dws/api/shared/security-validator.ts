/**
 * Security Validator
 *
 * Validates security configuration at startup to ensure the system
 * is properly hardened against side-channel attacks and other threats.
 *
 * In production, this enforces:
 * - KMS-backed signing for all key operations
 * - HSM-backed encryption key derivation
 * - No direct private keys in environment
 * - No secrets in environment variables
 * - Proper KMS secrets configuration
 */

import { isProductionEnv } from '@jejunetwork/config'
import { isHSMAvailable } from './hsm-kdf'
import { validateNoEnvSecrets } from './kms-secrets'
import { isKMSAvailable } from './kms-wallet'

export interface SecurityValidationResult {
  valid: boolean
  mode: 'secure' | 'development' | 'insecure'
  warnings: string[]
  errors: string[]
  recommendations: string[]
}

interface SecurityCheck {
  name: string
  check: () => Promise<{ ok: boolean; message: string }>
  required: boolean // Required for production
  severity: 'critical' | 'warning' | 'info'
}

/**
 * Validate security configuration for TEE side-channel protection
 */
export async function validateSecurityConfiguration(): Promise<SecurityValidationResult> {
  const isProduction = isProductionEnv()
  const warnings: string[] = []
  const errors: string[] = []
  const recommendations: string[] = []

  const checks: SecurityCheck[] = [
    // KMS availability
    {
      name: 'KMS Service',
      check: async () => {
        const available = await isKMSAvailable()
        return {
          ok: available,
          message: available
            ? 'KMS available for FROST threshold signing'
            : 'KMS not available - signing uses direct keys',
        }
      },
      required: true,
      severity: 'critical',
    },

    // HSM availability
    {
      name: 'HSM Service',
      check: async () => {
        const available = await isHSMAvailable()
        return {
          ok: available,
          message: available
            ? 'HSM available for key derivation'
            : 'HSM not available - keys derived in memory',
        }
      },
      required: false, // Recommended but not required
      severity: 'warning',
    },

    // Direct key checks
    {
      name: 'No Direct Private Keys',
      check: async () => {
        const directKeyVars = [
          'PRIVATE_KEY',
          'DWS_PRIVATE_KEY',
          'FAUCET_PRIVATE_KEY',
          'POC_SIGNER_KEY',
          'JEJU_DEPLOY_KEY',
          'DA_OPERATOR_PRIVATE_KEY',
          'SOLVER_PRIVATE_KEY',
          'TEE_VERIFIER_PRIVATE_KEY',
          'OPERATOR_PRIVATE_KEY',
          'WORKER_PRIVATE_KEY',
          'ORACLE_PRIVATE_KEY',
        ]
        const found = directKeyVars.filter((v) => {
          const value = process.env[v]
          // Only flag if it's a private key (0x + 64 hex chars)
          return value && value.startsWith('0x') && value.length === 66
        })
        return {
          ok: found.length === 0,
          message:
            found.length === 0
              ? 'No direct private keys in environment'
              : `Direct keys found: ${found.join(', ')}`,
        }
      },
      required: true,
      severity: 'critical',
    },

    // No secrets in environment variables (production)
    {
      name: 'No Secrets in Environment',
      check: async () => {
        const result = validateNoEnvSecrets()
        return {
          ok: result.valid,
          message: result.valid
            ? 'No secrets exposed in environment variables'
            : `Secrets in env: ${result.violations.slice(0, 3).join('; ')}${result.violations.length > 3 ? '...' : ''}`,
        }
      },
      required: true,
      severity: 'critical',
    },

    // KMS key configuration
    {
      name: 'KMS Keys Configured',
      check: async () => {
        const kmsKeyVars = [
          'DWS_KMS_KEY_ID',
          'ORACLE_KMS_KEY_ID',
          'SOLVER_KMS_KEY_ID',
          'TEE_VERIFIER_KMS_KEY_ID',
          'STORAGE_PROOF_KMS_KEY_ID',
          'RETRIEVAL_MARKET_KMS_KEY_ID',
        ]
        const found = kmsKeyVars.filter((v) => process.env[v])
        return {
          ok: found.length >= 3, // At least 3 services using KMS
          message:
            found.length >= 3
              ? `${found.length} services using KMS-backed signing`
              : `Only ${found.length} services using KMS (recommend at least 3)`,
        }
      },
      required: false,
      severity: 'warning',
    },

    // KMS endpoint configured
    {
      name: 'KMS Secrets Endpoint',
      check: async () => {
        const hasEndpoint = !!(process.env.KMS_ENDPOINT ?? process.env.DWS_KMS_URL)
        return {
          ok: hasEndpoint,
          message: hasEndpoint
            ? 'KMS endpoint configured for secret management'
            : 'KMS_ENDPOINT not set - secrets must be in KMS',
        }
      },
      required: true,
      severity: 'critical',
    },

    // TEE enclave ID
    {
      name: 'TEE Enclave ID',
      check: async () => {
        const hasEnclaveId = !!process.env.TEE_ENCLAVE_ID
        return {
          ok: hasEnclaveId,
          message: hasEnclaveId
            ? 'TEE enclave ID configured'
            : 'TEE_ENCLAVE_ID not set',
        }
      },
      required: true,
      severity: 'critical',
    },
  ]

  // Run all checks
  for (const check of checks) {
    try {
      const result = await check.check()

      if (!result.ok) {
        if (check.severity === 'critical') {
          if (isProduction && check.required) {
            errors.push(`[${check.name}] ${result.message}`)
          } else {
            warnings.push(`[${check.name}] ${result.message}`)
          }
        } else if (check.severity === 'warning') {
          warnings.push(`[${check.name}] ${result.message}`)
        } else {
          recommendations.push(`[${check.name}] ${result.message}`)
        }
      }
    } catch (err) {
      warnings.push(
        `[${check.name}] Check failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      )
    }
  }

  // Add recommendations
  if (!process.env.HSM_ENDPOINT) {
    recommendations.push(
      'Set HSM_ENDPOINT and HSM_KEY_ID for maximum side-channel protection',
    )
  }

  if (
    !process.env.DWS_KMS_KEY_ID &&
    !process.env.ORACLE_KMS_KEY_ID &&
    !process.env.SOLVER_KMS_KEY_ID
  ) {
    recommendations.push(
      'Configure KMS keys for all services to prevent side-channel key extraction',
    )
  }

  if (!process.env.KMS_ENDPOINT && !process.env.DWS_KMS_URL) {
    recommendations.push(
      'Configure KMS_ENDPOINT for secure secret management - no secrets should be in environment variables',
    )
  }

  // Determine overall mode
  let mode: 'secure' | 'development' | 'insecure'
  if (errors.length > 0) {
    mode = 'insecure'
  } else if (warnings.length > 0) {
    mode = 'development'
  } else {
    mode = 'secure'
  }

  return {
    valid: errors.length === 0,
    mode,
    warnings,
    errors,
    recommendations,
  }
}

/**
 * Enforce security configuration at startup
 *
 * In production, this will exit the process if critical security
 * requirements are not met.
 */
export async function enforceSecurityAtStartup(
  serviceName: string,
): Promise<void> {
  const isProduction = isProductionEnv()

  console.log(`[${serviceName}] Validating security configuration...`)

  const result = await validateSecurityConfiguration()

  // Log recommendations
  if (result.recommendations.length > 0) {
    console.log(`[${serviceName}] Security recommendations:`)
    for (const rec of result.recommendations) {
      console.log(`  ℹ️  ${rec}`)
    }
  }

  // Log warnings
  if (result.warnings.length > 0) {
    console.log(`[${serviceName}] Security warnings:`)
    for (const warn of result.warnings) {
      console.warn(`  ⚠️  ${warn}`)
    }
  }

  // Log errors
  if (result.errors.length > 0) {
    console.error(`[${serviceName}] CRITICAL security errors:`)
    for (const err of result.errors) {
      console.error(`  ❌ ${err}`)
    }

    if (isProduction) {
      console.error(
        `[${serviceName}] Cannot start in production with security violations.`,
      )
      console.error(
        `[${serviceName}] Fix the above errors or set NODE_ENV=development for testing.`,
      )
      process.exit(1)
    }
  }

  // Log overall status
  if (result.mode === 'secure') {
    console.log(`[${serviceName}] ✅ Security configuration: SECURE`)
    console.log(`[${serviceName}]    - KMS-backed signing enabled`)
    console.log(`[${serviceName}]    - All secrets properly configured`)
  } else if (result.mode === 'development') {
    console.log(`[${serviceName}] ⚠️  Security configuration: DEVELOPMENT`)
    console.log(
      `[${serviceName}]    Some security features disabled for development`,
    )
  } else {
    console.error(`[${serviceName}] ❌ Security configuration: INSECURE`)
  }
}

/**
 * Get security status for health endpoints
 */
export async function getSecurityStatus(): Promise<{
  mode: string
  kms: boolean
  hsm: boolean
  kmsSecretsEndpoint: boolean
  directKeys: string[]
  envSecretViolations: string[]
  configured: string[]
}> {
  const kms = await isKMSAvailable()
  const hsm = await isHSMAvailable()
  const kmsSecretsEndpoint = !!(process.env.KMS_ENDPOINT ?? process.env.DWS_KMS_URL)

  const directKeyVars = [
    'PRIVATE_KEY',
    'DWS_PRIVATE_KEY',
    'FAUCET_PRIVATE_KEY',
    'POC_SIGNER_KEY',
    'JEJU_DEPLOY_KEY',
    'DA_OPERATOR_PRIVATE_KEY',
    'SOLVER_PRIVATE_KEY',
    'TEE_VERIFIER_PRIVATE_KEY',
    'OPERATOR_PRIVATE_KEY',
    'WORKER_PRIVATE_KEY',
    'ORACLE_PRIVATE_KEY',
  ]

  const kmsKeyVars = [
    'DWS_KMS_KEY_ID',
    'ORACLE_KMS_KEY_ID',
    'SOLVER_KMS_KEY_ID',
    'TEE_VERIFIER_KMS_KEY_ID',
    'STORAGE_PROOF_KMS_KEY_ID',
    'RETRIEVAL_MARKET_KMS_KEY_ID',
    'FAUCET_KMS_KEY_ID',
    'POC_VERIFIER_KMS_KEY_ID',
    'DEPLOY_HOOK_KMS_KEY_ID',
    'DA_OPERATOR_KMS_KEY_ID',
    'WORKERD_KMS_KEY_ID',
  ]

  const envSecretsResult = validateNoEnvSecrets()

  return {
    mode:
      kms && hsm && kmsSecretsEndpoint
        ? 'secure'
        : kms && kmsSecretsEndpoint
          ? 'kms-only'
          : hsm
            ? 'hsm-only'
            : 'development',
    kms,
    hsm,
    kmsSecretsEndpoint,
    directKeys: directKeyVars.filter((v) => {
      const value = process.env[v]
      return value && value.startsWith('0x') && value.length === 66
    }),
    envSecretViolations: envSecretsResult.violations,
    configured: kmsKeyVars.filter((v) => process.env[v]),
  }
}
