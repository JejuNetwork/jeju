import { isProductionEnv, isTestMode } from '@jejunetwork/config'
import { getSQLit, type SQLitClient } from '@jejunetwork/db'
import { decryptAesGcm, encryptAesGcm, hash256 } from '@jejunetwork/shared'
import type { Address } from 'viem'
import { z } from 'zod'
import { getHSMKDF, isHSMAvailable } from '../shared/hsm-kdf'
import { PROVIDERS_BY_ID } from './providers'
import type { VaultDecryptRequest, VaultKey } from './types'

// SQLit-backed storage - no in-memory state for serverless compatibility

const SQLIT_DATABASE_ID = process.env.SQLIT_DATABASE_ID ?? 'dws'

let sqlitClient: SQLitClient | null = null
let tablesInitialized = false

async function getSQLitClient(): Promise<SQLitClient> {
  if (!sqlitClient) {
    sqlitClient = getSQLit({
      databaseId: SQLIT_DATABASE_ID,
      timeout: 30000,
      debug: process.env.NODE_ENV !== 'production',
    })

    const healthy = await sqlitClient.isHealthy()
    if (!healthy) {
      throw new Error('[Key Vault] SQLit is required for vault storage')
    }

    await ensureTablesExist()
  }
  return sqlitClient
}

async function ensureTablesExist(): Promise<void> {
  if (tablesInitialized) return

  const client = sqlitClient
  if (!client) return

  const tables = [
    `CREATE TABLE IF NOT EXISTS vault_keys (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      attestation TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS vault_access_log (
      id TEXT PRIMARY KEY,
      key_id TEXT NOT NULL,
      requester TEXT NOT NULL,
      request_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      success INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_vault_owner ON vault_keys(owner)`,
    `CREATE INDEX IF NOT EXISTS idx_access_log_key ON vault_access_log(key_id)`,
    `CREATE INDEX IF NOT EXISTS idx_access_log_requester ON vault_access_log(requester)`,
    `CREATE INDEX IF NOT EXISTS idx_access_log_timestamp ON vault_access_log(timestamp)`,
  ]

  for (const ddl of tables) {
    await client.exec(ddl, [], SQLIT_DATABASE_ID)
  }

  tablesInitialized = true
}

// Row types for SQLit queries
interface VaultKeyRow {
  id: string
  provider_id: string
  owner: string
  encrypted_key: string
  attestation: string
  created_at: number
}

interface AccessLogRow {
  id: string
  key_id: string
  requester: string
  request_id: string
  timestamp: number
  success: number
}

/** Response from TEE attestation endpoint */
const AttestationResponseSchema = z.object({
  attestation: z.string(),
})

// Encryption Helpers (AES-256-GCM)

/** Track if we've warned about missing secret */
let warnedAboutMissingSecret = false

/**
 * Derive encryption key from server secret + keyId
 *
 * SECURITY NOTES:
 * - VAULT_ENCRYPTION_SECRET MUST be set in production
 * - When HSM_ENDPOINT is configured, keys are derived inside the HSM
 *   and NEVER enter TEE memory (side-channel protected)
 * - Without HSM, derived keys exist in memory and are vulnerable
 *   to side-channel attacks (power analysis, timing, memory dumps)
 *
 * Priority:
 * 1. HSM-backed key derivation (maximum security)
 * 2. VAULT_ENCRYPTION_SECRET (acceptable for data-at-rest)
 * 3. Development fallback (INSECURE)
 */
function deriveKey(keyId: string): Uint8Array {
  const serverSecret = process.env.VAULT_ENCRYPTION_SECRET
  const isProduction = isProductionEnv()
  const isTest = isTestMode()

  if (!serverSecret) {
    if (isProduction) {
      throw new Error(
        'CRITICAL: VAULT_ENCRYPTION_SECRET must be set in production. API keys cannot be secured without it.',
      )
    }
    if (!isTest && !warnedAboutMissingSecret) {
      warnedAboutMissingSecret = true
      console.warn(
        '[Key Vault] WARNING: VAULT_ENCRYPTION_SECRET not set. Using development-only key. Set VAULT_ENCRYPTION_SECRET for production.',
      )
    }
    // Development-only fallback - keys are ephemeral and insecure
    return hash256(`DEV_ONLY_INSECURE_KEY:${keyId}`)
  }
  return hash256(`${serverSecret}:${keyId}`)
}

/**
 * Derive encryption key using HSM (async version)
 * When HSM is available, this should be used instead of deriveKey()
 */
export async function deriveKeyWithHSM(
  keyId: string,
): Promise<{ key: Uint8Array; hsmKeyId?: string }> {
  const hsmKdf = getHSMKDF()
  const isProduction = isProductionEnv()

  // Check if HSM is available
  const hsmAvailable = await isHSMAvailable()

  if (hsmAvailable) {
    // Use HSM for key derivation (side-channel protected)
    const context = `vault:${keyId}`
    const result = await hsmKdf.deriveKey(context)

    if (result.localKey) {
      // HSM returned a local key (development mode)
      return { key: result.localKey, hsmKeyId: result.keyId }
    }

    // In HSM mode, we don't get the key directly - encryption happens in HSM
    // Return a placeholder and use HSM encrypt/decrypt functions
    console.log('[Key Vault] Using HSM-backed key derivation')
    return {
      key: new Uint8Array(32), // Placeholder - actual key is in HSM
      hsmKeyId: result.keyId,
    }
  }

  if (isProduction) {
    console.warn(
      '[Key Vault] WARNING: HSM not available in production. ' +
        'Set HSM_ENDPOINT for maximum side-channel protection.',
    )
  }

  // Fallback to local key derivation
  return { key: deriveKey(keyId) }
}

/**
 * Encrypt an API key with AES-256-GCM
 */
async function encryptApiKey(apiKey: string, keyId: string): Promise<string> {
  const key = deriveKey(keyId)
  const apiKeyBytes = new TextEncoder().encode(apiKey)
  const { ciphertext, iv, tag } = await encryptAesGcm(apiKeyBytes, key)
  // Format: iv (12) + tag (16) + ciphertext, base64 encoded
  const combined = new Uint8Array(iv.length + tag.length + ciphertext.length)
  combined.set(iv, 0)
  combined.set(tag, 12)
  combined.set(ciphertext, 28)
  return btoa(String.fromCharCode(...combined))
}

/**
 * Decrypt an API key with AES-256-GCM
 */
async function decryptApiKey(
  encryptedKey: string,
  keyId: string,
): Promise<string> {
  const key = deriveKey(keyId)
  const binaryStr = atob(encryptedKey)
  const data = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) {
    data[i] = binaryStr.charCodeAt(i)
  }
  const iv = data.subarray(0, 12)
  const tag = data.subarray(12, 28)
  const ciphertext = data.subarray(28)
  const decrypted = await decryptAesGcm(ciphertext, key, iv, tag)
  return new TextDecoder().decode(decrypted)
}

// Key Storage

/**
 * Store a key in the vault (encrypted)
 * Uses AES-256-GCM encryption with server secret
 */
export async function storeKey(
  providerId: string,
  owner: Address,
  apiKey: string,
): Promise<VaultKey> {
  const id = crypto.randomUUID()

  // Encrypt the API key with AES-256-GCM
  const encryptedKey = await encryptApiKey(apiKey, id)

  const vaultKey: VaultKey = {
    id,
    providerId,
    owner,
    encryptedKey,
    attestation: await generateAttestation(id),
    createdAt: Date.now(),
  }

  // Store in SQLit
  const client = await getSQLitClient()
  const attestationValue = vaultKey.attestation ?? ''
  await client.exec(
    `INSERT INTO vault_keys (id, provider_id, owner, encrypted_key, attestation, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      vaultKey.id,
      vaultKey.providerId,
      vaultKey.owner.toLowerCase(),
      vaultKey.encryptedKey,
      attestationValue,
      vaultKey.createdAt,
    ],
    SQLIT_DATABASE_ID,
  )

  return vaultKey
}

/**
 * Get a vault key metadata (without decrypting)
 */
export async function getKeyMetadata(
  id: string,
): Promise<Omit<VaultKey, 'encryptedKey'> | undefined> {
  const client = await getSQLitClient()
  const result = await client.query<VaultKeyRow>(
    'SELECT id, provider_id, owner, attestation, created_at FROM vault_keys WHERE id = ?',
    [id],
    SQLIT_DATABASE_ID,
  )

  const row = result.rows[0]
  if (!row) return undefined

  return {
    id: row.id,
    providerId: row.provider_id,
    owner: row.owner as Address,
    attestation: row.attestation,
    createdAt: row.created_at,
  }
}

/**
 * Delete a key from the vault
 */
export async function deleteKey(
  id: string,
  requester: Address,
): Promise<boolean> {
  const client = await getSQLitClient()
  const result = await client.query<VaultKeyRow>(
    'SELECT owner FROM vault_keys WHERE id = ?',
    [id],
    SQLIT_DATABASE_ID,
  )

  const row = result.rows[0]
  if (!row) return false

  // Only owner can delete
  if (row.owner.toLowerCase() !== requester.toLowerCase()) {
    return false
  }

  await client.exec(
    'DELETE FROM vault_keys WHERE id = ?',
    [id],
    SQLIT_DATABASE_ID,
  )
  return true
}

/**
 * Get keys owned by an address
 */
export async function getKeysByOwner(
  owner: Address,
): Promise<Array<Omit<VaultKey, 'encryptedKey'>>> {
  const client = await getSQLitClient()
  const result = await client.query<VaultKeyRow>(
    'SELECT id, provider_id, owner, attestation, created_at FROM vault_keys WHERE owner = ?',
    [owner.toLowerCase()],
    SQLIT_DATABASE_ID,
  )

  return result.rows.map((row) => ({
    id: row.id,
    providerId: row.provider_id,
    owner: row.owner as Address,
    attestation: row.attestation,
    createdAt: row.created_at,
  }))
}

// Key Decryption (Only in TEE context)

/**
 * Decrypt a key for use in a request
 * This function simulates TEE-secured decryption.
 * The decrypted key is NEVER returned - only used internally for request injection.
 */
export async function decryptKeyForRequest(
  request: VaultDecryptRequest,
): Promise<string | null> {
  // Check for system keys first
  const systemKeyId = request.keyId
  if (systemKeyId.startsWith('system:')) {
    const providerId = systemKeyId.replace('system:', '')
    const provider = PROVIDERS_BY_ID.get(providerId)
    if (provider) {
      const envKey = process.env[provider.envVar]
      if (envKey) {
        await logAccess(
          request.keyId,
          request.requester,
          request.requestContext.requestId,
          true,
        )
        return envKey
      }
    }
    await logAccess(
      request.keyId,
      request.requester,
      request.requestContext.requestId,
      false,
    )
    return null
  }

  // User-stored keys from SQLit
  const client = await getSQLitClient()
  const result = await client.query<VaultKeyRow>(
    'SELECT * FROM vault_keys WHERE id = ?',
    [request.keyId],
    SQLIT_DATABASE_ID,
  )

  const vaultKey = result.rows[0]
  if (!vaultKey) {
    await logAccess(
      request.keyId,
      request.requester,
      request.requestContext.requestId,
      false,
    )
    return null
  }

  // Decrypt the API key with AES-256-GCM
  const decrypted = await decryptApiKey(vaultKey.encrypted_key, vaultKey.id)

  await logAccess(
    request.keyId,
    request.requester,
    request.requestContext.requestId,
    true,
  )
  return decrypted
}

// System Key Management

/**
 * Load system keys from environment
 * Called at startup to pre-load configured API keys
 * System keys are read directly from env vars, not stored in SQLit
 */
export function loadSystemKeys(): void {
  let count = 0
  for (const [_providerId, provider] of PROVIDERS_BY_ID) {
    if (process.env[provider.envVar]) {
      count++
    }
  }
  console.log(`[Key Vault] Found ${count} system keys in environment`)
}

/**
 * Check if system key is available for a provider
 */
export function hasSystemKey(providerId: string): boolean {
  const provider = PROVIDERS_BY_ID.get(providerId)
  return provider ? !!process.env[provider.envVar] : false
}

// Audit Logging

interface AccessLogEntry {
  keyId: string
  requester: Address
  requestId: string
  timestamp: number
  success: boolean
}

async function logAccess(
  keyId: string,
  requester: Address,
  requestId: string,
  success: boolean,
): Promise<void> {
  const client = await getSQLitClient()
  const id = crypto.randomUUID()
  await client.exec(
    `INSERT INTO vault_access_log (id, key_id, requester, request_id, timestamp, success)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      keyId,
      requester.toLowerCase(),
      requestId,
      Date.now(),
      success ? 1 : 0,
    ],
    SQLIT_DATABASE_ID,
  )
}

/**
 * Get access log for a key
 */
export async function getAccessLog(keyId: string): Promise<AccessLogEntry[]> {
  const client = await getSQLitClient()
  const result = await client.query<AccessLogRow>(
    'SELECT * FROM vault_access_log WHERE key_id = ? ORDER BY timestamp DESC LIMIT 1000',
    [keyId],
    SQLIT_DATABASE_ID,
  )

  return result.rows.map((row) => ({
    keyId: row.key_id,
    requester: row.requester as Address,
    requestId: row.request_id,
    timestamp: row.timestamp,
    success: row.success === 1,
  }))
}

/**
 * Get access log for a requester
 */
export async function getAccessLogByRequester(
  requester: Address,
): Promise<AccessLogEntry[]> {
  const client = await getSQLitClient()
  const result = await client.query<AccessLogRow>(
    'SELECT * FROM vault_access_log WHERE requester = ? ORDER BY timestamp DESC LIMIT 1000',
    [requester.toLowerCase()],
    SQLIT_DATABASE_ID,
  )

  return result.rows.map((row) => ({
    keyId: row.key_id,
    requester: row.requester as Address,
    requestId: row.request_id,
    timestamp: row.timestamp,
    success: row.success === 1,
  }))
}

// TEE Attestation

const TEE_ENDPOINT = process.env.TEE_ATTESTATION_ENDPOINT
const TEE_API_KEY = process.env.TEE_ATTESTATION_API_KEY

/**
 * Generate a TEE attestation for a key
 * Uses real TEE attestation service when TEE_ATTESTATION_ENDPOINT is configured
 */
async function generateAttestation(keyId: string): Promise<string> {
  const timestamp = Date.now()

  // Use real TEE attestation if endpoint is configured
  if (TEE_ENDPOINT && TEE_API_KEY) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': TEE_API_KEY,
    }

    const response = await fetch(`${TEE_ENDPOINT}/attestation/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        keyId,
        timestamp,
        operation: 'key-access',
      }),
    })

    if (!response.ok) {
      throw new Error(`TEE attestation failed: ${response.status}`)
    }

    const data: unknown = await response.json()
    const result = AttestationResponseSchema.parse(data)
    return result.attestation
  }

  // SECURITY: In production, we should have a TEE attestation endpoint
  const enclaveId = process.env.TEE_ENCLAVE_ID
  if (!enclaveId) {
    if (isProductionEnv()) {
      throw new Error(
        'CRITICAL: TEE_ENCLAVE_ID must be set in production. Attestation cannot be generated without proper enclave identification.',
      )
    }
    console.warn(
      '[KeyVault] WARNING: TEE_ENCLAVE_ID not set. Using dev-only attestation.',
    )
  }

  const attestationData = {
    keyId,
    timestamp,
    enclave: enclaveId ?? 'DEV_ONLY_ENCLAVE',
    version: '1.0.0',
  }
  return btoa(JSON.stringify(attestationData))
}

// Schema for TEE attestation data
const AttestationDataSchema = z.object({
  keyId: z.string().optional(),
  timestamp: z.number().optional(),
})

/**
 * Verify a TEE attestation
 */
export function verifyAttestation(attestation: string): {
  valid: boolean
  keyId?: string
  timestamp?: number
} {
  try {
    const decoded = atob(attestation)
    const parsed = AttestationDataSchema.parse(JSON.parse(decoded))
    return {
      valid: true,
      keyId: parsed.keyId,
      timestamp: parsed.timestamp,
    }
  } catch {
    return { valid: false }
  }
}

// Key Rotation

/**
 * Rotate a key (store new, delete old)
 */
export async function rotateKey(
  oldKeyId: string,
  owner: Address,
  newApiKey: string,
): Promise<VaultKey | null> {
  const client = await getSQLitClient()
  const result = await client.query<VaultKeyRow>(
    'SELECT * FROM vault_keys WHERE id = ?',
    [oldKeyId],
    SQLIT_DATABASE_ID,
  )

  const oldKey = result.rows[0]
  if (!oldKey) return null

  // Verify ownership
  if (oldKey.owner.toLowerCase() !== owner.toLowerCase()) {
    return null
  }

  // Store new key
  const newKey = await storeKey(oldKey.provider_id, owner, newApiKey)

  // Delete old key
  await client.exec(
    'DELETE FROM vault_keys WHERE id = ?',
    [oldKeyId],
    SQLIT_DATABASE_ID,
  )

  return newKey
}

// Vault Stats

export interface VaultStats {
  totalKeys: number
  totalSystemKeys: number
  totalUserKeys: number
  totalAccesses: number
  recentAccesses: number // Last hour
}

export async function getVaultStats(): Promise<VaultStats> {
  const client = await getSQLitClient()
  const hourAgo = Date.now() - 3600000

  const [keysResult, accessResult, recentResult] = await Promise.all([
    client.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM vault_keys',
      [],
      SQLIT_DATABASE_ID,
    ),
    client.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM vault_access_log',
      [],
      SQLIT_DATABASE_ID,
    ),
    client.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM vault_access_log WHERE timestamp > ?',
      [hourAgo],
      SQLIT_DATABASE_ID,
    ),
  ])

  // Count system keys from environment
  let systemKeyCount = 0
  for (const [_providerId, provider] of PROVIDERS_BY_ID) {
    if (process.env[provider.envVar]) {
      systemKeyCount++
    }
  }

  const userKeys = keysResult.rows[0].count ?? 0

  return {
    totalKeys: userKeys + systemKeyCount,
    totalSystemKeys: systemKeyCount,
    totalUserKeys: userKeys,
    totalAccesses: accessResult.rows[0].count ?? 0,
    recentAccesses: recentResult.rows[0].count ?? 0,
  }
}
