/**
 * Crucible Secrets Management
 *
 * Centralized secret access through KMS SecretVault.
 * All secrets are encrypted at rest and require proper authentication.
 *
 * SECURITY:
 * - Never access secrets directly from process.env in production
 * - All secret access is audit-logged
 * - Secrets are encrypted with KMS-managed keys
 * - Access policies can be enforced per-secret
 */

import { getCurrentNetwork } from '@jejunetwork/config'
import { getSecretVault, type SecretPolicy } from '@jejunetwork/kms'
import type { Address, Hex } from 'viem'
import { createLogger } from './logger'

const log = createLogger('Secrets')

// Secret identifiers (stored in SecretVault)
export const SecretIds = {
  PRIVATE_KEY: 'crucible:private-key',
  API_KEY: 'crucible:api-key',
  CRON_SECRET: 'crucible:cron-secret',
  OPENAI_API_KEY: 'crucible:openai-api-key',
  ANTHROPIC_API_KEY: 'crucible:anthropic-api-key',
  GROQ_API_KEY: 'crucible:groq-api-key',
  ELIZA_API_KEY: 'crucible:eliza-api-key',
} as const

export type SecretId = (typeof SecretIds)[keyof typeof SecretIds]

// Anvil default private key - ONLY for localnet
const ANVIL_DEFAULT_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const

let secretsInitialized = false
let cachedSecrets: Map<SecretId, string> | null = null

/**
 * Initialize the secrets system.
 *
 * In localnet: Uses environment variables directly
 * In testnet/mainnet: Loads secrets from SecretVault with KMS encryption
 */
export async function initializeSecrets(
  accessor: Address,
): Promise<void> {
  if (secretsInitialized) return

  const network = getCurrentNetwork()

  if (network === 'localnet') {
    // In localnet, we allow direct env access for development convenience
    // But we still don't expose secrets in logs or error messages
    log.info('Secrets initialized in localnet mode (direct env access)')
    secretsInitialized = true
    return
  }

  // Production: Use SecretVault
  const vault = getSecretVault()
  await vault.initialize()

  // Pre-load required secrets to validate they exist
  const requiredSecrets: SecretId[] = [SecretIds.PRIVATE_KEY]

  for (const secretId of requiredSecrets) {
    const exists = vault.listSecrets(accessor).some((s) => s.name === secretId)
    if (!exists) {
      log.warn(`Required secret not found in vault: ${secretId}`, {
        secretId,
        network,
      })
    }
  }

  secretsInitialized = true
  log.info('Secrets initialized from SecretVault', { network })
}

/**
 * Get a secret by ID.
 *
 * SECURITY: Never log or expose the returned value.
 *
 * @param secretId - The secret identifier
 * @param accessor - The address requesting access (for audit logging)
 * @throws Error if secret not found or access denied
 */
export async function getSecret(
  secretId: SecretId,
  accessor: Address,
): Promise<string> {
  const network = getCurrentNetwork()

  // Localnet: Direct env access with proper mapping
  if (network === 'localnet') {
    return getLocalnetSecret(secretId)
  }

  // Production: Use SecretVault
  const vault = getSecretVault()
  return vault.getSecret(secretId, accessor)
}

/**
 * Get the private key for signing operations.
 *
 * IMPORTANT: In production, prefer using KMS signing directly.
 * This method should only be used when raw key access is unavoidable.
 *
 * @param accessor - The address requesting access
 * @returns The private key as Hex
 * @throws Error if not available or access denied
 */
export async function getPrivateKey(accessor: Address): Promise<Hex> {
  const network = getCurrentNetwork()

  if (network === 'localnet') {
    // In localnet, use env var or fall back to Anvil default
    const envKey = process.env.PRIVATE_KEY ?? process.env.SQLIT_PRIVATE_KEY
    if (envKey) {
      return envKey as Hex
    }
    return ANVIL_DEFAULT_PRIVATE_KEY
  }

  // Production: Get from SecretVault
  const key = await getSecret(SecretIds.PRIVATE_KEY, accessor)
  return key as Hex
}

/**
 * Get API key for authentication.
 */
export async function getApiKey(accessor: Address): Promise<string | null> {
  const network = getCurrentNetwork()

  if (network === 'localnet') {
    return process.env.API_KEY ?? null
  }

  try {
    return await getSecret(SecretIds.API_KEY, accessor)
  } catch {
    return null
  }
}

/**
 * Get cron secret for protected endpoints.
 */
export async function getCronSecret(accessor: Address): Promise<string | null> {
  const network = getCurrentNetwork()

  if (network === 'localnet') {
    return process.env.CRON_SECRET ?? null
  }

  try {
    return await getSecret(SecretIds.CRON_SECRET, accessor)
  } catch {
    return null
  }
}

/**
 * Get AI provider API key.
 */
export async function getAIProviderKey(
  provider: 'openai' | 'anthropic' | 'groq' | 'eliza',
  accessor: Address,
): Promise<string | null> {
  const network = getCurrentNetwork()
  const secretId = {
    openai: SecretIds.OPENAI_API_KEY,
    anthropic: SecretIds.ANTHROPIC_API_KEY,
    groq: SecretIds.GROQ_API_KEY,
    eliza: SecretIds.ELIZA_API_KEY,
  }[provider]

  if (network === 'localnet') {
    const envKey = {
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      groq: 'GROQ_API_KEY',
      eliza: 'ELIZA_API_KEY',
    }[provider]
    return process.env[envKey] ?? null
  }

  try {
    return await getSecret(secretId, accessor)
  } catch {
    return null
  }
}

/**
 * Store a secret in the vault.
 *
 * Only available to authorized addresses.
 */
export async function storeSecret(
  secretId: SecretId,
  value: string,
  owner: Address,
  policy?: SecretPolicy,
): Promise<void> {
  const network = getCurrentNetwork()

  if (network === 'localnet') {
    log.warn('Cannot store secrets in localnet mode - use environment variables')
    return
  }

  const vault = getSecretVault()
  await vault.storeSecret(secretId, value, owner, policy)
  log.info('Secret stored', { secretId })
}

/**
 * Check if we're in a production environment where secrets must be in vault.
 */
export function requiresSecretVault(): boolean {
  return getCurrentNetwork() !== 'localnet'
}

/**
 * Validate that required secrets are available.
 *
 * @param requiredSecrets - List of secret IDs that must be present
 * @param accessor - Address requesting validation
 * @throws Error if any required secret is missing
 */
export async function validateRequiredSecrets(
  requiredSecrets: SecretId[],
  accessor: Address,
): Promise<void> {
  const missing: SecretId[] = []

  for (const secretId of requiredSecrets) {
    try {
      await getSecret(secretId, accessor)
    } catch {
      missing.push(secretId)
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required secrets: ${missing.join(', ')}. ` +
        `Use 'jeju secrets set' to configure them.`,
    )
  }
}

/**
 * Get secret from environment for localnet development.
 */
function getLocalnetSecret(secretId: SecretId): string {
  const envMapping: Record<SecretId, string> = {
    [SecretIds.PRIVATE_KEY]: 'PRIVATE_KEY',
    [SecretIds.API_KEY]: 'API_KEY',
    [SecretIds.CRON_SECRET]: 'CRON_SECRET',
    [SecretIds.OPENAI_API_KEY]: 'OPENAI_API_KEY',
    [SecretIds.ANTHROPIC_API_KEY]: 'ANTHROPIC_API_KEY',
    [SecretIds.GROQ_API_KEY]: 'GROQ_API_KEY',
    [SecretIds.ELIZA_API_KEY]: 'ELIZA_API_KEY',
  }

  const envKey = envMapping[secretId]
  const value = process.env[envKey]

  // Special case: private key can fall back to Anvil default in localnet
  if (!value && secretId === SecretIds.PRIVATE_KEY) {
    return ANVIL_DEFAULT_PRIVATE_KEY
  }

  if (!value) {
    throw new Error(
      `Secret ${secretId} not found. Set ${envKey} environment variable.`,
    )
  }

  return value
}

/**
 * Clear cached secrets (for testing/rotation).
 */
export function clearSecretCache(): void {
  cachedSecrets = null
  secretsInitialized = false
}

