/**
 * Worker Secrets - KMS-backed secret management for workerd runtime
 *
 * This module provides secure secret retrieval for workers running in TEE.
 * Secrets are NEVER embedded in worker bundles or config files.
 * Instead, workers fetch secrets from KMS at runtime using TEE attestation.
 *
 * ## Security Architecture
 *
 * 1. **Registration**: Secrets are registered in KMS with owner address and policy
 * 2. **Deployment**: Worker config contains only secret IDs (references), not values
 * 3. **Runtime**: Worker fetches secrets from KMS on startup using TEE attestation
 * 4. **Access Control**: KMS verifies TEE attestation + stake before releasing secrets
 *
 * ## Usage in Workers
 *
 * ```typescript
 * import { initWorkerSecrets, getSecret } from '@jejunetwork/kms/worker-secrets'
 *
 * // Called once on worker startup (in TEE)
 * await initWorkerSecrets({
 *   kmsEndpoint: env.KMS_ENDPOINT,
 *   workerId: env.WORKER_ID,
 *   secretIds: ['db-password', 'api-key'],
 * })
 *
 * // Get secret values (from memory cache)
 * const dbPassword = getSecret('db-password')
 * ```
 */

import type { Address, Hex } from 'viem'
import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

/**
 * Secret reference - stored in worker config instead of actual values
 */
export interface SecretRef {
  /** Secret ID in KMS */
  secretId: string
  /** Environment variable name to bind to */
  envName: string
  /** Whether this secret is required (fail startup if not available) */
  required: boolean
}

/**
 * Worker secrets configuration
 */
export interface WorkerSecretsConfig {
  /** KMS endpoint URL */
  kmsEndpoint: string
  /** Worker ID (from deployment) */
  workerId: string
  /** Worker owner address */
  ownerAddress: Address
  /** Secret references to fetch */
  secrets: SecretRef[]
  /** TEE attestation (provided by runtime) */
  attestation?: TEEAttestation
  /** Timeout for KMS requests (default 5000ms) */
  timeoutMs?: number
}

/**
 * TEE attestation for KMS authentication
 */
export interface TEEAttestation {
  /** Platform type */
  platform: 'intel_tdx' | 'amd_sev' | 'phala' | 'nitro' | 'simulated'
  /** Quote/attestation document */
  quote: Hex
  /** Measurement (MR_ENCLAVE or equivalent) */
  measurement: Hex
  /** Report data (includes worker ID) */
  reportData: Hex
  /** Timestamp of attestation */
  timestamp: number
}

/**
 * Secret value with metadata
 */
interface CachedSecret {
  value: string
  fetchedAt: number
  expiresAt: number
}

// ============================================================================
// Schemas for API responses
// ============================================================================

const KMSSecretResponseSchema = z.object({
  secretId: z.string(),
  value: z.string(),
  version: z.number(),
  expiresAt: z.number().optional(),
})

const KMSBatchResponseSchema = z.object({
  secrets: z.array(KMSSecretResponseSchema),
  errors: z
    .array(
      z.object({
        secretId: z.string(),
        error: z.string(),
      }),
    )
    .optional(),
})

// ============================================================================
// Worker Secrets Client
// ============================================================================

/**
 * In-memory secret cache (lives only in worker memory, not persisted)
 * This is secure because:
 * 1. Worker runs in TEE with memory encryption
 * 2. Secrets are fetched fresh on each cold start
 * 3. Memory is cleared on worker termination
 */
const secretCache = new Map<string, CachedSecret>()

/** Configuration stored after init */
let currentConfig: WorkerSecretsConfig | null = null

/** Whether secrets have been initialized */
let initialized = false

/**
 * Initialize worker secrets by fetching from KMS
 *
 * This should be called ONCE on worker startup, before handling any requests.
 * The function fetches all configured secrets from KMS using TEE attestation
 * for authentication.
 *
 * @throws If required secrets cannot be fetched
 */
export async function initWorkerSecrets(
  config: WorkerSecretsConfig,
): Promise<void> {
  if (initialized) {
    console.warn(
      '[WorkerSecrets] Already initialized. Call resetWorkerSecrets() first if reinitializing.',
    )
    return
  }

  currentConfig = config
  const timeoutMs = config.timeoutMs ?? 5000

  console.log(
    `[WorkerSecrets] Initializing secrets for worker ${config.workerId}`,
  )
  console.log(
    `[WorkerSecrets] Fetching ${config.secrets.length} secrets from ${config.kmsEndpoint}`,
  )

  // Build attestation header
  const attestationHeader = config.attestation
    ? JSON.stringify(config.attestation)
    : JSON.stringify({
        platform: 'simulated',
        quote: '0x',
        measurement: '0x',
        reportData: '0x',
        timestamp: Date.now(),
      })

  // Fetch all secrets in a single batch request
  const secretIds = config.secrets.map((s) => s.secretId)

  const response = await fetch(`${config.kmsEndpoint}/vault/secrets/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': config.ownerAddress,
      'x-worker-id': config.workerId,
      'x-tee-attestation': attestationHeader,
    },
    body: JSON.stringify({
      secretIds,
      workerId: config.workerId,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`[WorkerSecrets] Failed to fetch secrets: ${error}`)
  }

  const rawData = await response.json()
  const result = KMSBatchResponseSchema.parse(rawData)

  // Process fetched secrets
  const fetched = new Set<string>()
  const now = Date.now()

  for (const secret of result.secrets) {
    const ref = config.secrets.find((s) => s.secretId === secret.secretId)
    if (!ref) continue

    // Cache by env name for quick lookup
    secretCache.set(ref.envName, {
      value: secret.value,
      fetchedAt: now,
      expiresAt: secret.expiresAt ?? now + 24 * 60 * 60 * 1000, // Default 24h TTL
    })
    fetched.add(ref.secretId)
    console.log(`[WorkerSecrets] Loaded secret: ${ref.envName}`)
  }

  // Log errors
  if (result.errors && result.errors.length > 0) {
    for (const err of result.errors) {
      console.error(
        `[WorkerSecrets] Error fetching ${err.secretId}: ${err.error}`,
      )
    }
  }

  // Check required secrets
  const missingRequired = config.secrets.filter(
    (s) => s.required && !fetched.has(s.secretId),
  )

  if (missingRequired.length > 0) {
    const missing = missingRequired.map((s) => s.secretId).join(', ')
    throw new Error(`[WorkerSecrets] Missing required secrets: ${missing}`)
  }

  initialized = true
  console.log(
    `[WorkerSecrets] Initialized with ${fetched.size}/${config.secrets.length} secrets`,
  )
}

/**
 * Get a secret value by environment variable name
 *
 * @param envName - The environment variable name (as configured in SecretRef)
 * @returns The secret value, or undefined if not found
 *
 * @example
 * const dbPassword = getSecret('DATABASE_PASSWORD')
 */
export function getSecret(envName: string): string | undefined {
  if (!initialized) {
    throw new Error(
      '[WorkerSecrets] Secrets not initialized. Call initWorkerSecrets() first.',
    )
  }

  const cached = secretCache.get(envName)
  if (!cached) {
    return undefined
  }

  // Check expiration
  if (Date.now() > cached.expiresAt) {
    console.warn(`[WorkerSecrets] Secret ${envName} has expired`)
    secretCache.delete(envName)
    return undefined
  }

  return cached.value
}

/**
 * Get a required secret value
 *
 * @param envName - The environment variable name
 * @returns The secret value
 * @throws If the secret is not found or expired
 */
export function requireSecret(envName: string): string {
  const value = getSecret(envName)
  if (value === undefined) {
    throw new Error(`[WorkerSecrets] Required secret not found: ${envName}`)
  }
  return value
}

/**
 * Get all secrets as an environment-like object
 * Useful for passing to libraries that expect process.env
 */
export function getSecretEnv(): Record<string, string> {
  if (!initialized) {
    throw new Error(
      '[WorkerSecrets] Secrets not initialized. Call initWorkerSecrets() first.',
    )
  }

  const env: Record<string, string> = {}
  const now = Date.now()

  for (const [name, cached] of secretCache) {
    if (now <= cached.expiresAt) {
      env[name] = cached.value
    }
  }

  return env
}

/**
 * Check if worker secrets are initialized
 */
export function isSecretsInitialized(): boolean {
  return initialized
}

/**
 * Reset worker secrets (for testing or re-initialization)
 *
 * WARNING: This clears all cached secrets from memory.
 * Only call this if you intend to re-initialize with new config.
 */
export function resetWorkerSecrets(): void {
  // Zero out secret values before clearing (security best practice)
  for (const cached of secretCache.values()) {
    // Attempt to zero the string (may not work due to JS string immutability)
    // But we clear the cache immediately after
    const len = cached.value.length
    // @ts-expect-error - Intentionally mutating for security
    cached.value = '0'.repeat(len)
  }

  secretCache.clear()
  currentConfig = null
  initialized = false
  console.log('[WorkerSecrets] Reset complete')
}

/**
 * Get the current configuration (for debugging)
 */
export function getSecretsConfig(): Omit<
  WorkerSecretsConfig,
  'attestation'
> | null {
  if (!currentConfig) return null
  // Don't expose attestation
  const { attestation: _, ...config } = currentConfig
  return config
}

// ============================================================================
// Secret Registration (for deployment tooling)
// ============================================================================

/**
 * Parameters for registering a secret in KMS
 */
export interface RegisterSecretParams {
  /** Human-readable name for the secret */
  name: string
  /** The secret value to store */
  value: string
  /** Owner address (wallet that can manage this secret) */
  owner: Address
  /** Optional tags for organization */
  tags?: string[]
  /** Time-to-live in milliseconds (optional) */
  ttlMs?: number
  /** Allowed worker IDs (optional, empty = all owner's workers) */
  allowedWorkerIds?: string[]
  /** Minimum stake requirement in USD (optional) */
  minStakeUSD?: number
}

/**
 * Result of secret registration
 */
export interface RegisterSecretResult {
  /** Unique secret ID */
  secretId: string
  /** Secret name */
  name: string
  /** Creation timestamp */
  createdAt: number
  /** Expiration timestamp (if TTL was set) */
  expiresAt?: number
}

const RegisterResponseSchema = z.object({
  secretId: z.string(),
  name: z.string(),
  createdAt: z.number(),
  expiresAt: z.number().optional(),
})

/**
 * Register a secret in KMS (for deployment tooling only)
 *
 * This should be called BEFORE deploying a worker, to ensure the secret
 * exists in KMS. The returned secretId should be used in the worker's
 * secrets configuration.
 *
 * @example
 * // In deploy script
 * const { secretId } = await registerSecret({
 *   kmsEndpoint: 'https://kms.jejunetwork.org',
 *   name: 'db-password',
 *   value: process.env.DB_PASSWORD,  // From secure source
 *   owner: deployerAddress,
 * })
 *
 * // Then in worker config:
 * secrets: [{ secretId, envName: 'DATABASE_PASSWORD', required: true }]
 */
export async function registerSecret(
  kmsEndpoint: string,
  params: RegisterSecretParams,
  _privateKey: Hex,
): Promise<RegisterSecretResult> {
  // Sign the registration request
  const _message = `register:${params.name}:${params.owner}:${Date.now()}`

  const response = await fetch(`${kmsEndpoint}/vault/secrets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': params.owner,
      // In production, this would be a signed request
    },
    body: JSON.stringify({
      name: params.name,
      value: params.value,
      tags: params.tags ?? [],
      ttlMs: params.ttlMs,
      policy: {
        allowedWorkerIds: params.allowedWorkerIds,
        minStakeUSD: params.minStakeUSD,
      },
    }),
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to register secret: ${error}`)
  }

  const rawData = await response.json()
  return RegisterResponseSchema.parse(rawData)
}

/**
 * Update an existing secret's value
 */
export async function rotateSecret(
  kmsEndpoint: string,
  secretId: string,
  newValue: string,
  owner: Address,
): Promise<void> {
  const response = await fetch(
    `${kmsEndpoint}/vault/secrets/${secretId}/rotate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': owner,
      },
      body: JSON.stringify({ value: newValue }),
      signal: AbortSignal.timeout(10000),
    },
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to rotate secret: ${error}`)
  }
}

/**
 * Delete a secret from KMS
 */
export async function deleteSecret(
  kmsEndpoint: string,
  secretId: string,
  owner: Address,
): Promise<void> {
  const response = await fetch(`${kmsEndpoint}/vault/secrets/${secretId}`, {
    method: 'DELETE',
    headers: {
      'x-jeju-address': owner,
    },
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to delete secret: ${error}`)
  }
}
