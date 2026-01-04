/**
 * Secure Worker Deployment
 *
 * This module provides utilities for deploying workers securely,
 * ensuring secrets are NEVER embedded in bundles or config files.
 *
 * ## Architecture
 *
 * 1. **Secret References**: Worker config contains only secret IDs, not values
 * 2. **KMS Registration**: Secrets are registered in KMS before deployment
 * 3. **Runtime Injection**: Workers fetch secrets from KMS on startup
 *
 * ## Usage
 *
 * ```typescript
 * // In deploy script
 * import { deployWorkerSecurely, registerWorkerSecrets } from './secure-deploy'
 *
 * // Step 1: Register secrets in KMS
 * const secretRefs = await registerWorkerSecrets(kmsEndpoint, owner, [
 *   { name: 'DATABASE_URL', value: secrets.databaseUrl, required: true },
 *   { name: 'API_KEY', value: secrets.apiKey, required: true },
 * ])
 *
 * // Step 2: Deploy with secret references (NOT values)
 * await deployWorkerSecurely({
 *   ...workerConfig,
 *   secretRefs,  // Only IDs, no values
 * })
 * ```
 */

import type { Address } from 'viem'

/**
 * Reference to a secret stored in KMS
 */
export interface SecretRef {
  /** KMS secret ID */
  secretId: string
  /** Environment variable name to expose the secret as */
  envName: string
  /** Whether this secret is required for the worker to function */
  required: boolean
}

// ============================================================================
// Types
// ============================================================================

/**
 * Secret to register during deployment
 */
export interface DeploymentSecret {
  /** Environment variable name (e.g., 'DATABASE_URL') */
  name: string
  /** The secret value */
  value: string
  /** Whether this secret is required for the worker to function */
  required: boolean
  /** Tags for organization */
  tags?: string[]
  /** TTL in milliseconds (optional) */
  ttlMs?: number
}

/**
 * Secure worker deployment configuration
 *
 * This differs from regular deployment by using secret references
 * instead of embedded values.
 */
export interface SecureWorkerConfig {
  /** Worker name */
  name: string
  /** Code CID (IPFS hash of the bundle) */
  codeCid: string
  /** Runtime */
  runtime: 'bun' | 'node' | 'deno'
  /** Handler entrypoint */
  handler: string
  /** Memory limit in MB */
  memory: number
  /** Timeout in ms */
  timeout: number
  /** API routes */
  routes?: string[]
  /** KMS endpoint for secret retrieval */
  kmsEndpoint: string
  /** Secret references (NOT values) */
  secretRefs: SecretRef[]
  /** Non-secret environment variables (public config only) */
  publicEnv?: Record<string, string>
}

/**
 * Result of secure deployment
 */
export interface SecureDeploymentResult {
  /** Worker ID */
  workerId: string
  /** Deployment status */
  status: 'success' | 'partial' | 'failed'
  /** Registered secret IDs */
  secretIds: string[]
  /** Any errors during deployment */
  errors: string[]
}

// ============================================================================
// Secret Registration
// ============================================================================

/**
 * Register secrets in KMS for a worker deployment
 *
 * This should be called BEFORE deploying the worker. The returned
 * secret references contain only IDs, not values.
 *
 * @param kmsEndpoint - KMS API endpoint
 * @param owner - Owner address (deployer wallet)
 * @param secrets - Secrets to register
 * @returns Array of secret references (IDs only)
 */
export async function registerWorkerSecrets(
  kmsEndpoint: string,
  owner: Address,
  secrets: DeploymentSecret[],
): Promise<SecretRef[]> {
  const refs: SecretRef[] = []

  for (const secret of secrets) {
    console.log(`[SecureDeploy] Registering secret: ${secret.name}`)

    const response = await fetch(`${kmsEndpoint}/vault/secrets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': owner,
      },
      body: JSON.stringify({
        name: secret.name,
        value: secret.value,
        tags: secret.tags ?? [],
        ttlMs: secret.ttlMs,
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to register secret ${secret.name}: ${error}`)
    }

    const result = (await response.json()) as { secretId: string }

    refs.push({
      secretId: result.secretId,
      envName: secret.name,
      required: secret.required,
    })

    console.log(
      `[SecureDeploy] Registered: ${secret.name} -> ${result.secretId}`,
    )
  }

  return refs
}

// ============================================================================
// Secure Deployment
// ============================================================================

/**
 * Deploy a worker securely with KMS-backed secrets
 *
 * This function:
 * 1. Creates a worker config with secret references (NOT values)
 * 2. Injects KMS initialization code into the worker
 * 3. Deploys the worker to DWS
 *
 * @param dwsEndpoint - DWS API endpoint
 * @param owner - Owner address
 * @param config - Secure worker configuration
 */
export async function deployWorkerSecurely(
  dwsEndpoint: string,
  owner: Address,
  config: SecureWorkerConfig,
): Promise<SecureDeploymentResult> {
  console.log(`[SecureDeploy] Deploying worker: ${config.name}`)
  console.log(`[SecureDeploy] Secret refs: ${config.secretRefs.length}`)

  // Build deployment request
  // IMPORTANT: We only include secret IDs, never values
  const deployRequest = {
    name: config.name,
    codeCid: config.codeCid,
    runtime: config.runtime,
    handler: config.handler,
    memory: config.memory,
    timeout: config.timeout,
    routes: config.routes,
    // Public environment variables only
    env: {
      ...config.publicEnv,
      // KMS configuration for runtime secret fetching
      KMS_ENDPOINT: config.kmsEndpoint,
      KMS_SECRET_IDS: JSON.stringify(
        config.secretRefs.map((r) => ({
          secretId: r.secretId,
          envName: r.envName,
          required: r.required,
        })),
      ),
    },
    // Secret metadata (IDs only, for documentation)
    secrets: config.secretRefs.map((r) => r.envName),
  }

  const response = await fetch(`${dwsEndpoint}/deploy/worker`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': owner,
    },
    body: JSON.stringify(deployRequest),
    signal: AbortSignal.timeout(60000),
  })

  if (!response.ok) {
    const error = await response.text()
    return {
      workerId: '',
      status: 'failed',
      secretIds: config.secretRefs.map((r) => r.secretId),
      errors: [`Deployment failed: ${error}`],
    }
  }

  const result = (await response.json()) as {
    functionId?: string
    workerId?: string
  }

  return {
    workerId: result.functionId ?? result.workerId ?? '',
    status: 'success',
    secretIds: config.secretRefs.map((r) => r.secretId),
    errors: [],
  }
}

// ============================================================================
// Worker Initialization Code Generator
// ============================================================================

/**
 * Generate code to inject into workers for KMS secret initialization
 *
 * This code runs on worker startup, before handling any requests.
 * It fetches secrets from KMS and makes them available via environment.
 */
export function generateSecretInitCode(): string {
  return `
// ═══════════════════════════════════════════════════════════════════════════
// KMS Secret Initialization (injected by secure-deploy)
// ═══════════════════════════════════════════════════════════════════════════

import { initWorkerSecrets, getSecretEnv } from '@jejunetwork/kms';

// Parse secret configuration from environment
const KMS_ENDPOINT = env.KMS_ENDPOINT;
const KMS_SECRET_IDS = env.KMS_SECRET_IDS ? JSON.parse(env.KMS_SECRET_IDS) : [];
const WORKER_ID = env.WORKER_ID || env.FUNCTION_ID || 'unknown';
const OWNER_ADDRESS = env.OWNER_ADDRESS || '0x0000000000000000000000000000000000000000';

// Initialize secrets on cold start
let secretsInitialized = false;
let secretEnv = {};

async function ensureSecretsInitialized() {
  if (secretsInitialized) return;
  
  if (!KMS_ENDPOINT || KMS_SECRET_IDS.length === 0) {
    console.log('[Worker] No KMS secrets configured');
    secretsInitialized = true;
    return;
  }
  
  try {
    await initWorkerSecrets({
      kmsEndpoint: KMS_ENDPOINT,
      workerId: WORKER_ID,
      ownerAddress: OWNER_ADDRESS,
      secrets: KMS_SECRET_IDS,
    });
    
    secretEnv = getSecretEnv();
    secretsInitialized = true;
    console.log('[Worker] Secrets initialized successfully');
  } catch (error) {
    console.error('[Worker] Failed to initialize secrets:', error);
    throw error;
  }
}

// Expose secrets through a proxy that looks like process.env
const secureEnv = new Proxy(env, {
  get(target, prop) {
    // Check secrets first
    if (typeof prop === 'string' && secretEnv[prop]) {
      return secretEnv[prop];
    }
    // Fall back to regular env
    return target[prop];
  },
  has(target, prop) {
    if (typeof prop === 'string' && secretEnv[prop]) {
      return true;
    }
    return prop in target;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
`
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate that a deployment config doesn't contain embedded secrets
 *
 * This should be run before deployment to catch accidental secret embedding.
 */
export function validateNoEmbeddedSecrets(env: Record<string, string>): {
  valid: boolean
  violations: string[]
} {
  const violations: string[] = []

  // Patterns that indicate embedded secrets
  const secretPatterns = [
    /private.?key/i,
    /api.?key/i,
    /api.?secret/i,
    /secret/i,
    /password/i,
    /token/i,
    /credential/i,
    /^0x[a-fA-F0-9]{64}$/, // Private keys
    /^sk-[a-zA-Z0-9]+/, // OpenAI keys
    /^xoxb-/, // Slack tokens
    /^ghp_/, // GitHub tokens
    /^gho_/, // GitHub OAuth tokens
  ]

  for (const [key, value] of Object.entries(env)) {
    // Check key name
    for (const pattern of secretPatterns) {
      if (typeof pattern === 'object' && pattern.test(key)) {
        violations.push(
          `Key "${key}" looks like a secret name - use KMS instead`,
        )
        break
      }
    }

    // Check value
    if (value && value.length > 20) {
      for (const pattern of secretPatterns) {
        if (typeof pattern === 'object' && pattern.test(value)) {
          violations.push(
            `Value for "${key}" looks like an embedded secret - use KMS instead`,
          )
          break
        }
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  }
}

// ============================================================================
// Migration Helpers
// ============================================================================

/**
 * Convert legacy env-based config to secure KMS-based config
 *
 * This helps migrate existing deployments from embedded secrets
 * to KMS-backed secrets.
 */
export function migrateToSecureConfig(
  legacyEnv: Record<string, string>,
  secretKeys: string[],
): {
  publicEnv: Record<string, string>
  secrets: DeploymentSecret[]
} {
  const publicEnv: Record<string, string> = {}
  const secrets: DeploymentSecret[] = []

  for (const [key, value] of Object.entries(legacyEnv)) {
    if (secretKeys.includes(key)) {
      secrets.push({
        name: key,
        value,
        required: true,
      })
    } else {
      publicEnv[key] = value
    }
  }

  return { publicEnv, secrets }
}
