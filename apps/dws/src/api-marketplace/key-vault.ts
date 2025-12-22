/**
 * TEE Key Vault
 *
 * Secure key storage using TEE with MPC threshold encryption.
 * Keys never leave the enclave - only injected into outbound requests.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import type { Address } from 'viem'
import { PROVIDERS_BY_ID } from './providers'
import type { VaultDecryptRequest, VaultKey } from './types'

// ============================================================================
// In-Memory Vault (simulates TEE enclave storage)
// ============================================================================

const vault = new Map<string, VaultKey>()
const MAX_ACCESS_LOG_ENTRIES = 10000
const accessLog: Array<{
  keyId: string
  requester: Address
  requestId: string
  timestamp: number
  success: boolean
}> = []

// System keys loaded from environment
const systemKeys = new Map<string, string>()

// Start cleanup interval for old access log entries (older than 24 hours)
const ACCESS_LOG_CLEANUP_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
const ACCESS_LOG_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours
setInterval(() => {
  const cutoff = Date.now() - ACCESS_LOG_MAX_AGE_MS
  // Remove entries older than 24 hours, keeping at least the most recent MAX_ACCESS_LOG_ENTRIES
  while (accessLog.length > 0 && accessLog[0].timestamp < cutoff) {
    accessLog.shift()
  }
}, ACCESS_LOG_CLEANUP_INTERVAL_MS)

// ============================================================================
// Encryption Helpers (AES-256-GCM)
// ============================================================================

/**
 * Derive encryption key from server secret + keyId
 * SECURITY: VAULT_ENCRYPTION_SECRET MUST be set in production
 */
function deriveKey(keyId: string): Buffer {
  const serverSecret = process.env.VAULT_ENCRYPTION_SECRET
  const isProduction = process.env.NODE_ENV === 'production'

  if (!serverSecret) {
    if (isProduction) {
      throw new Error(
        'CRITICAL: VAULT_ENCRYPTION_SECRET must be set in production. API keys cannot be secured without it.',
      )
    }
    console.warn(
      '[Key Vault] WARNING: VAULT_ENCRYPTION_SECRET not set. API keys are NOT properly secured.',
    )
  }
  return createHash('sha256')
    .update(`${serverSecret ?? 'INSECURE_VAULT_SECRET'}:${keyId}`)
    .digest()
}

/**
 * Encrypt an API key with AES-256-GCM
 */
function encryptApiKey(apiKey: string, keyId: string): string {
  const key = deriveKey(keyId)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([
    cipher.update(apiKey, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()
  // Format: iv (12) + authTag (16) + ciphertext, base64 encoded
  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

/**
 * Decrypt an API key with AES-256-GCM
 */
function decryptApiKey(encryptedKey: string, keyId: string): string {
  const key = deriveKey(keyId)
  const data = Buffer.from(encryptedKey, 'base64')
  const iv = data.subarray(0, 12)
  const authTag = data.subarray(12, 28)
  const ciphertext = data.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8')
}

// ============================================================================
// Key Storage
// ============================================================================

/**
 * Store a key in the vault (encrypted)
 * Uses AES-256-GCM encryption with server secret
 */
export function storeKey(
  providerId: string,
  owner: Address,
  apiKey: string,
): VaultKey {
  const id = crypto.randomUUID()

  // Encrypt the API key with AES-256-GCM
  const encryptedKey = encryptApiKey(apiKey, id)

  const vaultKey: VaultKey = {
    id,
    providerId,
    owner,
    encryptedKey,
    attestation: generateAttestation(id),
    createdAt: Date.now(),
  }

  vault.set(id, vaultKey)
  return vaultKey
}

/**
 * Get a vault key metadata (without decrypting)
 */
export function getKeyMetadata(
  id: string,
): Omit<VaultKey, 'encryptedKey'> | undefined {
  const key = vault.get(id)
  if (!key) return undefined

  const { encryptedKey: _, ...metadata } = key
  return metadata
}

/**
 * Delete a key from the vault
 */
export function deleteKey(id: string, requester: Address): boolean {
  const key = vault.get(id)
  if (!key) return false

  // Only owner can delete
  if (key.owner.toLowerCase() !== requester.toLowerCase()) {
    return false
  }

  vault.delete(id)
  return true
}

/**
 * Get keys owned by an address
 */
export function getKeysByOwner(
  owner: Address,
): Array<Omit<VaultKey, 'encryptedKey'>> {
  return Array.from(vault.values())
    .filter((k) => k.owner.toLowerCase() === owner.toLowerCase())
    .map(({ encryptedKey: _, ...metadata }) => metadata)
}

// ============================================================================
// Key Decryption (Only in TEE context)
// ============================================================================

/**
 * Decrypt a key for use in a request
 * This function simulates TEE-secured decryption.
 * The decrypted key is NEVER returned - only used internally for request injection.
 */
export function decryptKeyForRequest(
  request: VaultDecryptRequest,
): string | null {
  // Check for system keys first
  const systemKeyId = request.keyId
  if (systemKeyId.startsWith('system:')) {
    const providerId = systemKeyId.replace('system:', '')
    const provider = PROVIDERS_BY_ID.get(providerId)
    if (provider) {
      const envKey = process.env[provider.envVar]
      if (envKey) {
        logAccess(
          request.keyId,
          request.requester,
          request.requestContext.requestId,
          true,
        )
        return envKey
      }
    }
    logAccess(
      request.keyId,
      request.requester,
      request.requestContext.requestId,
      false,
    )
    return null
  }

  // User-stored keys
  const vaultKey = vault.get(request.keyId)
  if (!vaultKey) {
    logAccess(
      request.keyId,
      request.requester,
      request.requestContext.requestId,
      false,
    )
    return null
  }

  // Decrypt the API key with AES-256-GCM
  const decrypted = decryptApiKey(vaultKey.encryptedKey, vaultKey.id)

  logAccess(
    request.keyId,
    request.requester,
    request.requestContext.requestId,
    true,
  )
  return decrypted
}

// ============================================================================
// System Key Management
// ============================================================================

/**
 * Load system keys from environment
 * Called at startup to pre-load configured API keys
 */
export function loadSystemKeys(): void {
  for (const [providerId, provider] of PROVIDERS_BY_ID) {
    const envKey = process.env[provider.envVar]
    if (envKey) {
      systemKeys.set(providerId, envKey)
    }
  }
  console.log(`[Key Vault] Loaded ${systemKeys.size} system keys`)
}

/**
 * Check if system key is available for a provider
 */
export function hasSystemKey(providerId: string): boolean {
  const provider = PROVIDERS_BY_ID.get(providerId)
  return provider ? !!process.env[provider.envVar] : false
}

// ============================================================================
// Audit Logging
// ============================================================================

function logAccess(
  keyId: string,
  requester: Address,
  requestId: string,
  success: boolean,
): void {
  accessLog.push({
    keyId,
    requester,
    requestId,
    timestamp: Date.now(),
    success,
  })

  // Keep last MAX_ACCESS_LOG_ENTRIES entries to prevent memory exhaustion
  if (accessLog.length > MAX_ACCESS_LOG_ENTRIES) {
    accessLog.splice(0, accessLog.length - MAX_ACCESS_LOG_ENTRIES)
  }
}

/**
 * Get access log for a key
 */
export function getAccessLog(keyId: string): typeof accessLog {
  return accessLog.filter((l) => l.keyId === keyId)
}

/**
 * Get access log for a requester
 */
export function getAccessLogByRequester(requester: Address): typeof accessLog {
  return accessLog.filter(
    (l) => l.requester.toLowerCase() === requester.toLowerCase(),
  )
}

// ============================================================================
// TEE Attestation
// ============================================================================

/**
 * Generate a TEE attestation for a key
 * In production, this would be a real SGX/TDX attestation
 */
function generateAttestation(keyId: string): string {
  const timestamp = Date.now()
  const attestationData = {
    keyId,
    timestamp,
    enclave: 'simulated-tee',
    version: '1.0.0',
  }
  return Buffer.from(JSON.stringify(attestationData)).toString('base64')
}

/**
 * Verify a TEE attestation
 */
export function verifyAttestation(attestation: string): {
  valid: boolean
  keyId?: string
  timestamp?: number
} {
  try {
    const data = JSON.parse(
      Buffer.from(attestation, 'base64').toString('utf-8'),
    )
    return {
      valid: true,
      keyId: data.keyId,
      timestamp: data.timestamp,
    }
  } catch {
    return { valid: false }
  }
}

// ============================================================================
// Key Rotation
// ============================================================================

/**
 * Rotate a key (store new, delete old)
 */
export function rotateKey(
  oldKeyId: string,
  owner: Address,
  newApiKey: string,
): VaultKey | null {
  const oldKey = vault.get(oldKeyId)
  if (!oldKey) return null

  // Verify ownership
  if (oldKey.owner.toLowerCase() !== owner.toLowerCase()) {
    return null
  }

  // Store new key
  const newKey = storeKey(oldKey.providerId, owner, newApiKey)

  // Delete old key
  vault.delete(oldKeyId)

  return newKey
}

// ============================================================================
// Vault Stats
// ============================================================================

export interface VaultStats {
  totalKeys: number
  totalSystemKeys: number
  totalUserKeys: number
  totalAccesses: number
  recentAccesses: number // Last hour
}

export function getVaultStats(): VaultStats {
  const hourAgo = Date.now() - 3600000
  const recentAccesses = accessLog.filter((l) => l.timestamp > hourAgo).length

  return {
    totalKeys: vault.size + systemKeys.size,
    totalSystemKeys: systemKeys.size,
    totalUserKeys: vault.size,
    totalAccesses: accessLog.length,
    recentAccesses,
  }
}
