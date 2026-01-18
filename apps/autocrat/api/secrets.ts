/**
 * Autocrat Secrets Management
 *
 * Centralized secrets access using @jejunetwork/kms SecretVault.
 * ALL secrets MUST be accessed through this module - never via process.env directly.
 *
 * SECURITY:
 * - Secrets are encrypted at rest in the vault
 * - Access is logged and auditable
 * - Production requires VAULT_ENCRYPTION_SECRET to be set
 * - Development mode falls back to env vars with warnings
 */

import { getCurrentNetwork, isProductionEnv } from '@jejunetwork/config'
import {
  createKMSSigner,
  getSecretVault,
  type KMSSigner,
  validateSecureSigning,
} from '@jejunetwork/kms'
import type { Address, Hex } from 'viem'

// ════════════════════════════════════════════════════════════════════════════
//                              TYPES
// ════════════════════════════════════════════════════════════════════════════

export interface AutocratSecrets {
  // Signing keys (managed via KMS signer, not raw keys)
  operatorSigner: KMSSigner
  directorSigner: KMSSigner

  // API keys (managed via SecretVault)
  openaiApiKey?: string
  anthropicApiKey?: string
  googleApiKey?: string
  etherscanApiKey?: string

  // Database credentials
  sqlitPrivateKey?: Hex
  sqlitKeyId?: string

  // TEE encryption
  teeEncryptionKeyId: string
}

// ════════════════════════════════════════════════════════════════════════════
//                        SIGNERS (KEY MANAGEMENT)
// ════════════════════════════════════════════════════════════════════════════

let operatorSigner: KMSSigner | null = null
let directorSigner: KMSSigner | null = null

/**
 * Get the operator signer for blockchain transactions
 * Uses KMS MPC threshold signing in production
 */
export async function getOperatorSigner(): Promise<KMSSigner> {
  if (operatorSigner) return operatorSigner

  const network = getCurrentNetwork()
  const isProduction = isProductionEnv()

  operatorSigner = createKMSSigner({
    serviceId: `autocrat-operator-${network}`,
    allowLocalDev: !isProduction,
  })

  await operatorSigner.initialize()
  return operatorSigner
}

/**
 * Get the director signer for governance operations
 * Uses KMS MPC threshold signing in production
 */
export async function getDirectorSigner(): Promise<KMSSigner> {
  if (directorSigner) return directorSigner

  const network = getCurrentNetwork()
  const isProduction = isProductionEnv()

  directorSigner = createKMSSigner({
    serviceId: `autocrat-director-${network}`,
    allowLocalDev: !isProduction,
  })

  await directorSigner.initialize()
  return directorSigner
}

// ════════════════════════════════════════════════════════════════════════════
//                      SECRET VAULT (API KEYS, CREDENTIALS)
// ════════════════════════════════════════════════════════════════════════════

let vaultInitialized = false
const secretCache = new Map<string, string>()

/**
 * Initialize the secret vault
 */
async function ensureVaultInitialized(): Promise<void> {
  if (vaultInitialized) return

  const vault = getSecretVault()
  await vault.initialize()
  vaultInitialized = true
}

/**
 * Get a secret from the vault
 * Falls back to env vars in development with warning
 */
export async function getSecret(
  secretName: string,
  envFallback?: string,
): Promise<string | undefined> {
  // Check cache first
  const cached = secretCache.get(secretName)
  if (cached) return cached

  const isProduction = isProductionEnv()

  try {
    await ensureVaultInitialized()
    const vault = getSecretVault()

    // Try to get from vault using a system accessor
    const value = await vault.getSecret(
      secretName,
      '0x0000000000000000000000000000000000000000' as Address,
    )
    secretCache.set(secretName, value)
    return value
  } catch (error) {
    if (isProduction) {
      console.error(
        `[Secrets] PRODUCTION ERROR: Secret "${secretName}" not found in vault`,
      )
      throw error
    }

    // Development fallback to env vars
    if (envFallback) {
      const envValue = process.env[envFallback]
      if (envValue) {
        console.warn(
          `[Secrets] DEV MODE: Using env var ${envFallback} for ${secretName}. ` +
            'Store in SecretVault for production.',
        )
        return envValue
      }
    }

    return undefined
  }
}

// ════════════════════════════════════════════════════════════════════════════
//                         API KEY ACCESSORS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Get OpenAI API key from vault
 */
export async function getOpenAIKey(): Promise<string | undefined> {
  return getSecret('openai-api-key', 'OPENAI_API_KEY')
}

/**
 * Get Anthropic API key from vault
 */
export async function getAnthropicKey(): Promise<string | undefined> {
  return getSecret('anthropic-api-key', 'ANTHROPIC_API_KEY')
}

/**
 * Get Google AI API key from vault
 */
export async function getGoogleAIKey(): Promise<string | undefined> {
  return getSecret('google-api-key', 'GOOGLE_API_KEY')
}

/**
 * Get Etherscan API key from vault
 */
export async function getEtherscanKey(): Promise<string | undefined> {
  return getSecret('etherscan-api-key', 'ETHERSCAN_API_KEY')
}

/**
 * Get SQLit private key from vault
 */
export async function getSQLitPrivateKey(): Promise<Hex | undefined> {
  const key = await getSecret('sqlit-private-key', 'SQLIT_PRIVATE_KEY')
  return key as Hex | undefined
}

/**
 * Get SQLit key ID from vault
 */
export async function getSQLitKeyId(): Promise<string | undefined> {
  return getSecret('sqlit-key-id', 'SQLIT_KEY_ID')
}

// ════════════════════════════════════════════════════════════════════════════
//                         TEE ENCRYPTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Get TEE encryption key ID from vault
 * This key ID references a key stored in KMS, not the raw key
 */
export async function getTEEEncryptionKeyId(): Promise<string> {
  const keyId = await getSecret(
    'tee-encryption-key-id',
    'TEE_ENCRYPTION_KEY_ID',
  )

  if (!keyId) {
    const isProduction = isProductionEnv()
    if (isProduction) {
      throw new Error(
        'TEE_ENCRYPTION_KEY_ID is required in production. ' +
          'Create a key in KMS and store the key ID in the vault.',
      )
    }
    // Development fallback - use a deterministic key ID
    return 'autocrat-tee-dev-key'
  }

  return keyId
}

// ════════════════════════════════════════════════════════════════════════════
//                         MODEL AVAILABILITY CHECK
// ════════════════════════════════════════════════════════════════════════════

/**
 * Check which AI models are available based on configured API keys
 */
export async function getAvailableModels(): Promise<{
  hasOpenAI: boolean
  hasAnthropic: boolean
  hasGoogle: boolean
}> {
  const [openai, anthropic, google] = await Promise.all([
    getOpenAIKey(),
    getAnthropicKey(),
    getGoogleAIKey(),
  ])

  return {
    hasOpenAI: !!openai,
    hasAnthropic: !!anthropic,
    hasGoogle: !!google,
  }
}

// ════════════════════════════════════════════════════════════════════════════
//                         INITIALIZATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Initialize all secrets and signers
 * Call this at application startup
 */
export async function initializeSecrets(): Promise<void> {
  // Validate secure signing in production
  validateSecureSigning()

  // Initialize signers
  await getOperatorSigner()

  console.log('[Secrets] Initialized')
}

/**
 * Shutdown and clear all secrets from memory
 */
export function shutdownSecrets(): void {
  secretCache.clear()
  operatorSigner = null
  directorSigner = null
  vaultInitialized = false
  console.log('[Secrets] Shutdown - all secrets cleared from memory')
}
