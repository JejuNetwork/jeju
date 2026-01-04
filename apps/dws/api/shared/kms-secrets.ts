/**
 * KMS Secrets - Secure secret access through KMS
 *
 * This module provides a secure way to access secrets that should NEVER
 * be stored in environment variables in production.
 *
 * SECURITY ARCHITECTURE:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * - In production: Secrets are stored in KMS SecretVault and retrieved via API
 * - In development: Falls back to env vars with warning, but BLOCKED in production
 *
 * SECRETS THAT MUST USE THIS MODULE (not env vars):
 * - VAULT_ENCRYPTION_SECRET - Vault encryption key
 * - API_KEY_ENCRYPTION_SECRET - API key encryption
 * - CI_ENCRYPTION_SECRET - CI secrets encryption
 * - HARDWARE_ID_SALT - Hardware ID hashing salt
 * - GITHUB_WEBHOOK_SECRET - GitHub webhook validation
 * - TEE_ATTESTATION_API_KEY - TEE attestation service
 * - HSM_API_KEY - HSM authentication
 *
 * For signing operations, use KMSSigner from @jejunetwork/kms instead.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import { isProductionEnv, isTestMode } from '@jejunetwork/config'
import { type Address, keccak256, toBytes } from 'viem'

// Service address for KMS secret access (system-level secrets)
const SYSTEM_SERVICE_ADDRESS =
  '0x0000000000000000000000000000000000000001' as Address

// Secret registry - maps secret names to their KMS secret IDs
interface SecretConfig {
  name: string
  envFallback: string // Env var to use in development ONLY
  description: string
  required: boolean // Required in production
}

const SECRETS_REGISTRY: Record<string, SecretConfig> = {
  vault_encryption: {
    name: 'VAULT_ENCRYPTION_SECRET',
    envFallback: 'VAULT_ENCRYPTION_SECRET',
    description: 'Master encryption key for API key vault',
    required: true,
  },
  api_key_encryption: {
    name: 'API_KEY_ENCRYPTION_SECRET',
    envFallback: 'API_KEY_ENCRYPTION_SECRET',
    description: 'Encryption key for API keys at rest',
    required: true,
  },
  ci_encryption: {
    name: 'CI_ENCRYPTION_SECRET',
    envFallback: 'CI_ENCRYPTION_SECRET',
    description: 'Encryption key for CI/CD secrets',
    required: true,
  },
  hardware_id_salt: {
    name: 'HARDWARE_ID_SALT',
    envFallback: 'HARDWARE_ID_SALT',
    description: 'Salt for hardware ID hashing (PoC verification)',
    required: true,
  },
  github_webhook: {
    name: 'GITHUB_WEBHOOK_SECRET',
    envFallback: 'GITHUB_WEBHOOK_SECRET',
    description: 'GitHub webhook signature validation secret',
    required: false,
  },
  tee_attestation_api_key: {
    name: 'TEE_ATTESTATION_API_KEY',
    envFallback: 'TEE_ATTESTATION_API_KEY',
    description: 'API key for TEE attestation service',
    required: false,
  },
  hsm_api_key: {
    name: 'HSM_API_KEY',
    envFallback: 'HSM_API_KEY',
    description: 'API key for HSM service',
    required: false,
  },
  signed_url_secret: {
    name: 'SIGNED_URL_SECRET',
    envFallback: 'SIGNED_URL_SECRET',
    description: 'Secret for signing URL tokens',
    required: true,
  },
} as const

export type SecretName = keyof typeof SECRETS_REGISTRY

// Track warnings to avoid spam
const warnedSecrets = new Set<string>()

// KMS endpoint for remote secret retrieval
let kmsEndpoint: string | null = null
let kmsInitialized = false

/**
 * Initialize the KMS secrets system
 */
export async function initializeKMSSecrets(): Promise<void> {
  if (kmsInitialized) return

  kmsEndpoint =
    process.env.KMS_ENDPOINT ?? process.env.DWS_KMS_URL ?? null

  if (!kmsEndpoint && isProductionEnv()) {
    throw new Error(
      'CRITICAL: KMS_ENDPOINT must be set in production for secure secret management. ' +
        'Secrets cannot be safely stored in environment variables.',
    )
  }

  kmsInitialized = true
}

/**
 * Get a secret from KMS (or env fallback in development)
 *
 * @param secretName - The secret identifier
 * @returns The secret value
 * @throws Error if secret not found and required in production
 */
export async function getKMSSecret(
  secretName: SecretName,
): Promise<string | undefined> {
  await initializeKMSSecrets()

  const config = SECRETS_REGISTRY[secretName]
  const isProduction = isProductionEnv()
  const isTest = isTestMode()

  // In production, MUST use KMS
  if (isProduction) {
    if (!kmsEndpoint) {
      throw new Error(
        `SECURITY: Cannot access secret ${config.name} without KMS in production`,
      )
    }

    const value = await fetchSecretFromKMS(config.name)
    if (!value && config.required) {
      throw new Error(
        `CRITICAL: Required secret ${config.name} not found in KMS. ` +
          'Store secrets using: jeju secrets set <name> <value>',
      )
    }
    return value
  }

  // In development/test, allow env fallback with warning
  const envValue = process.env[config.envFallback]

  if (envValue) {
    // Only warn once per secret
    if (!isTest && !warnedSecrets.has(secretName)) {
      warnedSecrets.add(secretName)
      console.warn(
        `[KMS Secrets] WARNING: Using env var ${config.envFallback} for development. ` +
          'In production, secrets must be stored in KMS.',
      )
    }
    return envValue
  }

  // Try KMS even in development if endpoint is configured
  if (kmsEndpoint) {
    const value = await fetchSecretFromKMS(config.name)
    if (value) return value
  }

  // No value found
  if (config.required && !isTest) {
    console.warn(
      `[KMS Secrets] Secret ${config.name} not found. ` +
        `Set ${config.envFallback} for development or use 'jeju secrets set' for production.`,
    )
  }

  return undefined
}

/**
 * Get a required secret - throws if not available
 */
export async function requireKMSSecret(secretName: SecretName): Promise<string> {
  const value = await getKMSSecret(secretName)
  if (!value) {
    const config = SECRETS_REGISTRY[secretName]
    throw new Error(
      `Required secret ${config.name} not available. ` +
        `Set ${config.envFallback} for development or store in KMS for production.`,
    )
  }
  return value
}

/**
 * Fetch a secret from the KMS service
 */
async function fetchSecretFromKMS(name: string): Promise<string | undefined> {
  if (!kmsEndpoint) return undefined

  try {
    const response = await fetch(`${kmsEndpoint}/secrets/get`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Address': SYSTEM_SERVICE_ADDRESS,
      },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      if (response.status === 404) {
        return undefined
      }
      console.error(
        `[KMS Secrets] Failed to fetch secret ${name}: ${response.status}`,
      )
      return undefined
    }

    const data = (await response.json()) as { value?: string }
    return data.value
  } catch (error) {
    console.error(
      `[KMS Secrets] Error fetching secret ${name}:`,
      error instanceof Error ? error.message : 'Unknown error',
    )
    return undefined
  }
}

/**
 * Check if a secret is available (without retrieving it)
 */
export async function hasKMSSecret(secretName: SecretName): Promise<boolean> {
  const value = await getKMSSecret(secretName)
  return value !== undefined
}

/**
 * Get all available secrets' status (for health checks)
 */
export async function getSecretsStatus(): Promise<{
  mode: 'kms' | 'env' | 'unavailable'
  available: string[]
  missing: string[]
  warnings: string[]
}> {
  await initializeKMSSecrets()

  const isProduction = isProductionEnv()
  const mode = kmsEndpoint ? 'kms' : isProduction ? 'unavailable' : 'env'
  const available: string[] = []
  const missing: string[] = []
  const warnings: string[] = []

  for (const [key, config] of Object.entries(SECRETS_REGISTRY)) {
    const value = await getKMSSecret(key as SecretName)
    if (value) {
      available.push(config.name)
    } else if (config.required) {
      missing.push(config.name)
    }
  }

  if (mode === 'env' && isProduction) {
    warnings.push('Using environment variables for secrets in production is insecure')
  }

  if (missing.length > 0 && isProduction) {
    warnings.push(`Missing required secrets: ${missing.join(', ')}`)
  }

  return { mode, available, missing, warnings }
}

/**
 * Validate that no secrets are leaked in environment variables in production
 *
 * Call this at startup to catch misconfigurations early
 */
export function validateNoEnvSecrets(): {
  valid: boolean
  violations: string[]
} {
  const isProduction = isProductionEnv()
  const violations: string[] = []

  if (!isProduction) {
    return { valid: true, violations: [] }
  }

  // Check for direct secret env vars in production
  for (const [_key, config] of Object.entries(SECRETS_REGISTRY)) {
    if (process.env[config.envFallback]) {
      violations.push(
        `${config.envFallback} found in environment - must use KMS in production`,
      )
    }
  }

  // Check for private keys in env
  const privateKeyVars = [
    'PRIVATE_KEY',
    'DWS_PRIVATE_KEY',
    'FAUCET_PRIVATE_KEY',
    'POC_SIGNER_KEY',
    'JEJU_DEPLOY_KEY',
    'DA_OPERATOR_PRIVATE_KEY',
    'SOLVER_PRIVATE_KEY',
    'ORACLE_PRIVATE_KEY',
    'TEE_VERIFIER_PRIVATE_KEY',
  ]

  for (const varName of privateKeyVars) {
    const value = process.env[varName]
    if (value && value.startsWith('0x') && value.length === 66) {
      violations.push(
        `${varName} contains private key - must use KMS signer in production`,
      )
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  }
}

/**
 * Derive an encryption key from a KMS-stored secret
 * Used when you need a deterministic key derived from a secret
 */
export async function deriveKeyFromKMSSecret(
  secretName: SecretName,
  context: string,
): Promise<Uint8Array> {
  const secret = await requireKMSSecret(secretName)
  const combined = `${secret}:${context}`
  const hash = keccak256(toBytes(combined))
  return toBytes(hash)
}

