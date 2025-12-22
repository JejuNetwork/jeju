/**
 * @fileoverview Unified Secret Management
 * @module config/secrets
 *
 * Secret Resolution Order:
 * 1. Environment variables (for CI/CD and local dev)
 * 2. AWS Secrets Manager (if AWS_REGION + AWS_ACCESS_KEY_ID set)
 * 3. GCP Secret Manager (if GCP_PROJECT_ID set)
 * 4. Local file fallback (.secrets/ directory, gitignored)
 *
 * @example
 * ```ts
 * import { getSecret, requireSecret } from '@jejunetwork/config/secrets';
 *
 * // Optional secret (returns undefined if not found)
 * const apiKey = await getSecret('ETHERSCAN_API_KEY');
 *
 * // Required secret (throws if not found)
 * const deployerKey = await requireSecret('DEPLOYER_PRIVATE_KEY');
 * ```
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Local secrets directory (gitignored)
const SECRETS_DIR = join(__dirname, '../../.secrets')
const DEPLOYMENT_KEYS_DIR = join(__dirname, '../deployment/.keys')

// ============================================================================
// Types
// ============================================================================

export type SecretName =
  // Deployment keys
  | 'DEPLOYER_PRIVATE_KEY'
  | 'PRIVATE_KEY'
  | 'OPERATOR_PRIVATE_KEY'
  | 'WORKER_PRIVATE_KEY'
  | 'FAUCET_PRIVATE_KEY'
  | 'SOLVER_PRIVATE_KEY'
  | 'XLP_PRIVATE_KEY'
  | 'EVM_PRIVATE_KEY'
  | 'SOLANA_PRIVATE_KEY'
  // Operator keys
  | 'SEQUENCER_PRIVATE_KEY'
  | 'BATCHER_PRIVATE_KEY'
  | 'PROPOSER_PRIVATE_KEY'
  | 'CHALLENGER_PRIVATE_KEY'
  | 'COORDINATOR_PRIVATE_KEY'
  | 'ORACLE_PRIVATE_KEY'
  | 'FACILITATOR_PRIVATE_KEY'
  // Node signing keys
  | 'JEJU_PRIVATE_KEY'
  | 'OAUTH3_NODE_PRIVATE_KEY'
  | 'DAO_ADMIN_PRIVATE_KEY'
  // API keys - Block Explorers
  | 'ETHERSCAN_API_KEY'
  | 'BASESCAN_API_KEY'
  | 'ARBISCAN_API_KEY'
  | 'OPSCAN_API_KEY'
  // API keys - Frontend
  | 'WALLETCONNECT_PROJECT_ID'
  // API keys - Storage
  | 'PINATA_JWT'
  // API keys - Social
  | 'NEYNAR_API_KEY'
  | 'GITHUB_TOKEN'
  // API keys - AI/ML
  | 'OPENROUTER_API_KEY'
  | 'OPENAI_API_KEY'
  | 'ANTHROPIC_API_KEY'
  | 'GROQ_API_KEY'
  | 'HF_TOKEN'
  // API keys - Enhanced RPC
  | 'ALCHEMY_API_KEY'
  | 'HELIUS_API_KEY'
  // API keys - Data
  | 'CODEX_API_KEY'
  | 'DEFILLAMA_API_KEY'
  | 'COINGECKO_API_KEY'
  // API keys - Infrastructure
  | 'CLOUDFLARE_API_TOKEN'
  | 'CLOUDFLARE_ZONE_ID'
  // API keys - ZK Proving
  | 'SUCCINCT_API_KEY'
  // API keys - TEE
  | 'PHALA_API_KEY'
  // API keys - DEX
  | 'ONEINCH_API_KEY'
  // API keys - MPC
  | 'SIGNER_API_KEY'
  | 'CLOUD_API_KEY'
  // Platform tokens - Discord
  | 'DISCORD_BOT_TOKEN'
  | 'DISCORD_WEBHOOK'
  // Platform tokens - Telegram
  | 'TELEGRAM_BOT_TOKEN'
  | 'TELEGRAM_WEBHOOK_SECRET'
  // Platform tokens - Twitter
  | 'TWITTER_API_KEY'
  | 'TWITTER_API_SECRET'
  | 'TWITTER_ACCESS_TOKEN'
  | 'TWITTER_ACCESS_SECRET'
  | 'TWITTER_BEARER_TOKEN'
  // Platform tokens - Farcaster
  | 'FARCASTER_SIGNER_UUID'
  // Communication - Twilio
  | 'TWILIO_ACCOUNT_SID'
  | 'TWILIO_AUTH_TOKEN'
  | 'TWILIO_PHONE_NUMBER'
  // Communication - Email
  | 'SMTP_USER'
  | 'SMTP_PASSWORD'
  // AWS
  | 'AWS_ACCESS_KEY_ID'
  | 'AWS_SECRET_ACCESS_KEY'
  | 'AWS_REGION'
  | 'AWS_ROUTE53_ZONE_ID'
  | 'AWS_S3_ACCESS_KEY'
  | 'AWS_S3_SECRET_KEY'
  // GCP
  | 'GCP_PROJECT_ID'
  | 'GCP_DNS_ZONE_NAME'
  // Cloudflare R2
  | 'R2_ACCESS_KEY_ID'
  | 'R2_SECRET_ACCESS_KEY'
  | 'BLOB_READ_WRITE_TOKEN'
  // Database
  | 'DB_PASSWORD'
  | 'DB_USER'
  | 'REDIS_PASSWORD'
  | 'REDIS_ENCRYPTION_KEY'
  | 'CQL_PRIVATE_KEY'
  | 'COVENANTSQL_PRIVATE_KEY'
  | 'FACTORY_DB_PRIVATE_KEY'
  // Encryption
  | 'VAULT_ENCRYPTION_SECRET'
  | 'TEE_ENCRYPTION_SECRET'
  | 'MPC_ENCRYPTION_SECRET'
  | 'KMS_FALLBACK_SECRET'
  // HSM
  | 'HSM_API_KEY'
  | 'HSM_USERNAME'
  | 'HSM_PASSWORD'
  // Webhook secrets
  | 'WEBHOOK_SECRET'
  | 'ALERT_WEBHOOK'
  // Internal API keys
  | 'JEJU_INTERNAL_RPC_KEY'
  | 'BOT_API_KEY'
  | 'API_KEY'
  | 'FACILITATOR_KMS_SECRET_ID'
  // Test mnemonic
  | 'TEST_MNEMONIC'

export type SecretProvider = 'env' | 'aws' | 'gcp' | 'local'

export interface SecretResult {
  value: string
  provider: SecretProvider
}

interface AWSSecretsClient {
  getSecretValue(params: {
    SecretId: string
  }): Promise<{ SecretString?: string }>
}

interface GCPSecretsClient {
  accessSecretVersion(params: {
    name: string
  }): Promise<[{ payload?: { data?: Buffer | string } }]>
}

// ============================================================================
// Secret Provider Detection
// ============================================================================

let awsClient: AWSSecretsClient | null = null
let gcpClient: GCPSecretsClient | null = null

function isAWSAvailable(): boolean {
  return Boolean(
    process.env.AWS_REGION &&
      (process.env.AWS_ACCESS_KEY_ID ||
        process.env.AWS_PROFILE ||
        process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI),
  )
}

function isGCPAvailable(): boolean {
  return Boolean(
    process.env.GCP_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS,
  )
}

async function getAWSClient(): Promise<AWSSecretsClient | null> {
  if (awsClient) return awsClient
  if (!isAWSAvailable()) return null

  try {
    const { SecretsManagerClient, GetSecretValueCommand } = await import(
      '@aws-sdk/client-secrets-manager'
    )
    const client = new SecretsManagerClient({
      region: process.env.AWS_REGION || 'us-east-1',
    })
    awsClient = {
      async getSecretValue(params: { SecretId: string }) {
        const command = new GetSecretValueCommand(params)
        return client.send(command)
      },
    }
    return awsClient
  } catch {
    // AWS SDK not installed, which is fine
    return null
  }
}

async function getGCPClient(): Promise<GCPSecretsClient | null> {
  if (gcpClient) return gcpClient
  if (!isGCPAvailable()) return null

  try {
    const { SecretManagerServiceClient } = await import(
      '@google-cloud/secret-manager'
    )
    const client = new SecretManagerServiceClient()
    gcpClient = {
      async accessSecretVersion(params: { name: string }) {
        const [response] = await client.accessSecretVersion(params)
        return [response] as [{ payload?: { data?: Buffer | string } }]
      },
    }
    return gcpClient
  } catch {
    // GCP SDK not installed, which is fine
    return null
  }
}

// ============================================================================
// Secret Resolution
// ============================================================================

/**
 * Get a secret from environment, cloud provider, or local file
 */
export async function getSecret(name: SecretName): Promise<string | undefined> {
  const result = await getSecretWithProvider(name)
  return result?.value
}

/**
 * Get a secret with information about where it came from
 */
export async function getSecretWithProvider(
  name: SecretName,
): Promise<SecretResult | undefined> {
  // 1. Check environment first (fastest, works in CI/CD)
  const envValue = process.env[name]
  if (envValue) {
    return { value: envValue, provider: 'env' }
  }

  // 2. Try AWS Secrets Manager
  const awsValue = await getFromAWS(name)
  if (awsValue) {
    return { value: awsValue, provider: 'aws' }
  }

  // 3. Try GCP Secret Manager
  const gcpValue = await getFromGCP(name)
  if (gcpValue) {
    return { value: gcpValue, provider: 'gcp' }
  }

  // 4. Fall back to local file
  const localValue = getFromLocalFile(name)
  if (localValue) {
    return { value: localValue, provider: 'local' }
  }

  return undefined
}

/**
 * Require a secret - throws if not found
 *
 * In production, error messages are minimal to prevent information leakage.
 * Set DEBUG_SECRETS=true for detailed error messages during development.
 */
export async function requireSecret(name: SecretName): Promise<string> {
  const result = await getSecretWithProvider(name)
  if (!result) {
    const isDebug =
      process.env.DEBUG_SECRETS === 'true' ||
      process.env.NODE_ENV === 'development'

    if (isDebug) {
      throw new Error(
        `Required secret ${name} not found. Set it via:\n` +
          `  - Environment variable: export ${name}=...\n` +
          `  - Cloud secret manager (AWS/GCP)\n` +
          `  - Local secrets directory`,
      )
    }

    throw new Error(`Required secret not found: ${name}`)
  }
  return result.value
}

/**
 * Require a secret synchronously (env or local only)
 *
 * In production, error messages are minimal to prevent information leakage.
 */
export function requireSecretSync(name: SecretName): string {
  const envValue = process.env[name]
  if (envValue) return envValue

  const localValue = getFromLocalFile(name)
  if (localValue) return localValue

  const isDebug =
    process.env.DEBUG_SECRETS === 'true' ||
    process.env.NODE_ENV === 'development'

  if (isDebug) {
    throw new Error(
      `Required secret ${name} not found synchronously. ` +
        `For async cloud provider lookup, use requireSecret() instead.`,
    )
  }

  throw new Error(`Required secret not found: ${name}`)
}

// ============================================================================
// Provider Implementations
// ============================================================================

async function getFromAWS(name: SecretName): Promise<string | undefined> {
  const client = await getAWSClient()
  if (!client) return undefined

  // AWS secret names use lowercase with slashes
  const secretId = `jeju/secrets/${name.toLowerCase().replace(/_/g, '-')}`

  try {
    const response = await client.getSecretValue({ SecretId: secretId })
    return response.SecretString
  } catch {
    // Secret not found in AWS
    return undefined
  }
}

async function getFromGCP(name: SecretName): Promise<string | undefined> {
  const client = await getGCPClient()
  if (!client) return undefined

  const projectId =
    process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT
  if (!projectId) return undefined

  // GCP secret names use lowercase with dashes
  const secretName = name.toLowerCase().replace(/_/g, '-')
  const versionName = `projects/${projectId}/secrets/${secretName}/versions/latest`

  try {
    const [version] = await client.accessSecretVersion({ name: versionName })
    const payload = version.payload?.data
    if (!payload) return undefined
    return typeof payload === 'string' ? payload : payload.toString('utf8')
  } catch {
    // Secret not found in GCP
    return undefined
  }
}

function getFromLocalFile(name: SecretName): string | undefined {
  const filename = name.toLowerCase().replace(/_/g, '-')

  // Check .secrets directory first
  const secretsPath = join(SECRETS_DIR, `${filename}.txt`)
  if (existsSync(secretsPath)) {
    return readFileSync(secretsPath, 'utf-8').trim()
  }

  // Check deployment keys directory for private keys
  if (name.endsWith('_PRIVATE_KEY')) {
    const keysPath = join(DEPLOYMENT_KEYS_DIR, `${filename}.txt`)
    if (existsSync(keysPath)) {
      return readFileSync(keysPath, 'utf-8').trim()
    }
  }

  return undefined
}

// ============================================================================
// Secret Storage (for generated keys)
// ============================================================================

/**
 * Store a secret to local file (for generated keys during setup)
 */
export function storeLocalSecret(name: SecretName, value: string): void {
  if (!existsSync(SECRETS_DIR)) {
    mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 })
  }

  const filename = name.toLowerCase().replace(/_/g, '-')
  const filepath = join(SECRETS_DIR, `${filename}.txt`)
  writeFileSync(filepath, value, { mode: 0o600 })
}

/**
 * Store a secret to AWS Secrets Manager
 */
export async function storeAWSSecret(
  name: SecretName,
  value: string,
): Promise<boolean> {
  if (!isAWSAvailable()) return false

  try {
    const { SecretsManagerClient, CreateSecretCommand, PutSecretValueCommand } =
      await import('@aws-sdk/client-secrets-manager')

    const client = new SecretsManagerClient({
      region: process.env.AWS_REGION || 'us-east-1',
    })
    const secretId = `jeju/secrets/${name.toLowerCase().replace(/_/g, '-')}`

    try {
      // Try to update existing secret
      await client.send(
        new PutSecretValueCommand({
          SecretId: secretId,
          SecretString: value,
        }),
      )
    } catch {
      // Create new secret if it doesn't exist
      await client.send(
        new CreateSecretCommand({
          Name: secretId,
          SecretString: value,
        }),
      )
    }
    return true
  } catch {
    return false
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Check which secret provider is being used
 */
export function getActiveProvider(): SecretProvider {
  if (isAWSAvailable()) return 'aws'
  if (isGCPAvailable()) return 'gcp'
  return 'local'
}

/**
 * Validate that required secrets exist for a given operation
 */
export async function validateSecrets(
  required: SecretName[],
  operation: string,
): Promise<{ valid: boolean; missing: SecretName[] }> {
  const missing: SecretName[] = []

  for (const name of required) {
    const value = await getSecret(name)
    if (!value) missing.push(name)
  }

  if (missing.length > 0) {
    console.error(`Missing secrets for ${operation}:`, missing.join(', '))
  }

  return { valid: missing.length === 0, missing }
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize secrets directory with proper permissions
 */
export function initSecretsDirectory(): void {
  if (!existsSync(SECRETS_DIR)) {
    mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 })
  }

  // Create .gitignore in secrets dir
  const gitignorePath = join(SECRETS_DIR, '.gitignore')
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, '*\n!.gitignore\n')
  }
}
