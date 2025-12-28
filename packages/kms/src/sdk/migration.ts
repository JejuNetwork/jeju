/**
 * KMS Migration Utilities
 *
 * This module provides tools to help migrate from raw private key usage
 * to KMS-backed signing. Use these utilities during the migration process.
 *
 * MIGRATION PROCESS:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 1. Call `auditPrivateKeyUsage()` to identify all direct key usage
 * 2. Use `createMigrationWalletClient()` as a drop-in replacement
 * 3. Once KMS is configured, set `ENFORCE_KMS_SIGNING=true`
 * 4. Remove the migration wrapper and use `createKMSWalletClient()` directly
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import {
  getCurrentNetwork,
  getEnvBool,
  getKmsServiceUrl,
  isProductionEnv,
} from '@jejunetwork/config'
import type {
  Address,
  Chain,
  Hex,
  LocalAccount,
  PublicClient,
  WalletClient,
} from 'viem'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createKMSSigner, validateSecureSigning } from './signer.js'

// ════════════════════════════════════════════════════════════════════════════
//                            TYPES
// ════════════════════════════════════════════════════════════════════════════

export interface MigrationWalletConfig {
  /** Service ID for KMS key lookup */
  serviceId: string
  /** Chain for transactions */
  chain: Chain
  /** RPC URL */
  rpcUrl: string
  /** Fallback private key (ONLY for development during migration) */
  fallbackPrivateKey?: Hex
  /** Force KMS even in development */
  forceKMS?: boolean
}

export interface MigrationWalletResult {
  /** Wallet client (either KMS-backed or local fallback) */
  client: WalletClient
  /** Public client for reads */
  publicClient: PublicClient
  /** The account */
  account: LocalAccount
  /** Address */
  address: Address
  /** Whether using KMS or local fallback */
  mode: 'kms' | 'local-fallback'
  /** Warnings about insecure usage */
  warnings: string[]
}

export interface PrivateKeyUsageAudit {
  /** Environment variables containing private keys */
  envVarsWithKeys: string[]
  /** Whether running in production */
  isProduction: boolean
  /** Recommendations */
  recommendations: string[]
  /** Whether the configuration is secure */
  isSecure: boolean
}

// ════════════════════════════════════════════════════════════════════════════
//                         MIGRATION WALLET CLIENT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Create a wallet client that automatically falls back from KMS to local key
 *
 * USE DURING MIGRATION ONLY. Once KMS is fully configured, switch to
 * `createKMSWalletClient()` directly.
 *
 * @example
 * ```typescript
 * // During migration - will use KMS if available, fallback to local key
 * const { client, mode, warnings } = await createMigrationWalletClient({
 *   serviceId: 'my-service',
 *   chain: mainnet,
 *   rpcUrl: 'https://...',
 *   fallbackPrivateKey: process.env.PRIVATE_KEY as Hex,
 * })
 *
 * if (warnings.length > 0) {
 *   console.warn('Migration warnings:', warnings)
 * }
 *
 * // After migration - remove fallbackPrivateKey and use KMS only
 * const { client } = await createKMSWalletClient({
 *   serviceId: 'my-service',
 *   chain: mainnet,
 *   rpcUrl: 'https://...',
 * })
 * ```
 */
export async function createMigrationWalletClient(
  config: MigrationWalletConfig,
): Promise<MigrationWalletResult> {
  const isProduction = isProductionEnv()
  const enforceKMS =
    config.forceKMS ?? getEnvBool('ENFORCE_KMS_SIGNING', isProduction)
  const warnings: string[] = []

  // In production, ALWAYS use KMS - no fallback allowed
  if (isProduction && config.fallbackPrivateKey) {
    throw new Error(
      'SECURITY: fallbackPrivateKey is forbidden in production. ' +
        'Use KMS signing only. Remove the fallbackPrivateKey configuration.',
    )
  }

  // Try to use KMS first
  const kmsEndpoint = getKmsServiceUrl()
  let kmsAvailable = false

  try {
    const healthResponse = await fetch(`${kmsEndpoint}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    kmsAvailable = healthResponse.ok
  } catch {
    kmsAvailable = false
  }

  // If KMS is available or enforcement is enabled, use KMS
  if (kmsAvailable || enforceKMS) {
    const signer = createKMSSigner({ serviceId: config.serviceId })
    await signer.initialize()

    const account = signer.getViemAccount()
    const address = signer.getAddress()

    const publicClient = createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    })

    const client = createWalletClient({
      account,
      chain: config.chain,
      transport: http(config.rpcUrl),
    })

    return {
      client,
      publicClient,
      account,
      address,
      mode: 'kms',
      warnings,
    }
  }

  // KMS not available and not enforced - use fallback (development only)
  if (!config.fallbackPrivateKey) {
    throw new Error(
      'KMS service unavailable and no fallbackPrivateKey provided. ' +
        'Either start the KMS service or provide a fallback key for development.',
    )
  }

  // Validate the fallback key format
  if (
    !config.fallbackPrivateKey.startsWith('0x') ||
    config.fallbackPrivateKey.length !== 66
  ) {
    throw new Error(
      'Invalid fallbackPrivateKey format. Must be 0x-prefixed 32-byte hex.',
    )
  }

  warnings.push(
    'INSECURE: Using local private key fallback. This should only be used during migration.',
    'Set ENFORCE_KMS_SIGNING=true once KMS is configured to block this fallback.',
  )

  console.warn(
    '[Migration] KMS unavailable - using local key fallback. ' +
      'This is NOT secure for production.',
  )

  const account = privateKeyToAccount(config.fallbackPrivateKey)

  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  })

  const client = createWalletClient({
    account,
    chain: config.chain,
    transport: http(config.rpcUrl),
  })

  return {
    client,
    publicClient,
    account,
    address: account.address,
    mode: 'local-fallback',
    warnings,
  }
}

// ════════════════════════════════════════════════════════════════════════════
//                         AUDIT UTILITIES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Audit the current environment for insecure private key usage
 *
 * Call this during application startup to identify potential security issues.
 *
 * @example
 * ```typescript
 * const audit = auditPrivateKeyUsage()
 * if (!audit.isSecure) {
 *   console.error('Security issues found:')
 *   audit.recommendations.forEach(r => console.error(`  - ${r}`))
 * }
 * ```
 */
export function auditPrivateKeyUsage(): PrivateKeyUsageAudit {
  const isProduction = isProductionEnv()
  const recommendations: string[] = []
  const envVarsWithKeys: string[] = []

  // Known environment variables that might contain private keys
  const potentialKeyVars = [
    'PRIVATE_KEY',
    'OPERATOR_KEY',
    'OPERATOR_PRIVATE_KEY',
    'WORKER_PRIVATE_KEY',
    'SOLVER_PRIVATE_KEY',
    'VERIFIER_PRIVATE_KEY',
    'ORACLE_PRIVATE_KEY',
    'DWS_PRIVATE_KEY',
    'TEE_VERIFIER_PRIVATE_KEY',
    'FAUCET_PRIVATE_KEY',
    'DEPLOYER_PRIVATE_KEY',
    'ADMIN_PRIVATE_KEY',
  ]

  // Check each variable
  for (const varName of potentialKeyVars) {
    const value = process.env[varName]
    if (value?.startsWith('0x') && value.length === 66) {
      envVarsWithKeys.push(varName)
    }
  }

  // Generate recommendations
  if (envVarsWithKeys.length > 0) {
    if (isProduction) {
      recommendations.push(
        `CRITICAL: ${envVarsWithKeys.length} raw private key(s) detected in production environment.`,
        'These MUST be migrated to KMS before production deployment.',
      )
    } else {
      recommendations.push(
        `${envVarsWithKeys.length} raw private key(s) detected: ${envVarsWithKeys.join(', ')}`,
        'Consider migrating to KMS for improved security.',
      )
    }

    for (const varName of envVarsWithKeys) {
      const serviceId = varName
        .replace(/_PRIVATE_KEY$/, '')
        .replace(/_KEY$/, '')
        .toLowerCase()
        .replace(/_/g, '-')

      recommendations.push(
        `Replace ${varName} with createKMSSigner({ serviceId: '${serviceId}' })`,
      )
    }
  }

  // Check KMS configuration
  const kmsEndpoint = process.env.KMS_ENDPOINT
  if (!kmsEndpoint && isProduction) {
    recommendations.push(
      'KMS_ENDPOINT not configured. Required for production.',
    )
  }

  const isSecure = isProduction
    ? envVarsWithKeys.length === 0 && !!kmsEndpoint
    : true // In development, we're lenient

  return {
    envVarsWithKeys,
    isProduction,
    recommendations,
    isSecure,
  }
}

/**
 * Log a security audit report to the console
 *
 * Call this at application startup for visibility into security posture.
 */
export function logSecurityAudit(): void {
  const audit = auditPrivateKeyUsage()
  const network = getCurrentNetwork()

  console.log(
    '╔════════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║              Jeju KMS Security Audit                           ║',
  )
  console.log(
    '╠════════════════════════════════════════════════════════════════╣',
  )
  console.log(`║ Network: ${network.padEnd(52)} ║`)
  console.log(
    `║ Environment: ${(audit.isProduction ? 'PRODUCTION' : 'Development').padEnd(48)} ║`,
  )
  console.log(
    `║ Security Status: ${(audit.isSecure ? '✓ SECURE' : '✗ ISSUES FOUND').padEnd(44)} ║`,
  )

  if (audit.envVarsWithKeys.length > 0) {
    console.log(
      '╠════════════════════════════════════════════════════════════════╣',
    )
    console.log(
      '║ Private Keys Detected:                                         ║',
    )
    for (const varName of audit.envVarsWithKeys) {
      console.log(`║   - ${varName.padEnd(58)} ║`)
    }
  }

  if (audit.recommendations.length > 0) {
    console.log(
      '╠════════════════════════════════════════════════════════════════╣',
    )
    console.log(
      '║ Recommendations:                                               ║',
    )
    for (const rec of audit.recommendations) {
      // Wrap long recommendations
      const lines = wrapText(rec, 60)
      for (const line of lines) {
        console.log(`║   ${line.padEnd(60)} ║`)
      }
    }
  }

  console.log(
    '╚════════════════════════════════════════════════════════════════╝',
  )
}

function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= maxWidth) {
      currentLine += (currentLine ? ' ' : '') + word
    } else {
      if (currentLine) lines.push(currentLine)
      currentLine = word
    }
  }

  if (currentLine) lines.push(currentLine)
  return lines
}

// ════════════════════════════════════════════════════════════════════════════
//                         STARTUP VALIDATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Validate and enforce KMS signing at application startup
 *
 * Call this at the top of your main() function to ensure security.
 *
 * @param options Configuration options
 * @throws Error in production if configuration is insecure
 *
 * @example
 * ```typescript
 * // In your main.ts or index.ts
 * import { enforceKMSSigningOnStartup } from '@jejunetwork/kms'
 *
 * async function main() {
 *   // This will throw in production if private keys are detected
 *   enforceKMSSigningOnStartup({
 *     serviceName: 'my-service',
 *     requireKMSInProduction: true,
 *   })
 *
 *   // Rest of your application...
 * }
 * ```
 */
export function enforceKMSSigningOnStartup(options: {
  /** Name of this service (for logging) */
  serviceName: string
  /** Whether to require KMS in production (default: true) */
  requireKMSInProduction?: boolean
  /** Whether to log the security audit (default: true) */
  logAudit?: boolean
}): void {
  const {
    serviceName,
    requireKMSInProduction = true,
    logAudit = true,
  } = options

  if (logAudit) {
    console.log(`\n[${serviceName}] Running security audit...`)
    logSecurityAudit()
  }

  if (requireKMSInProduction) {
    try {
      validateSecureSigning()
    } catch (error) {
      if (isProductionEnv()) {
        throw error
      }
      console.warn(
        `[${serviceName}] Security warning (non-blocking in development):`,
        error instanceof Error ? error.message : error,
      )
    }
  }
}
