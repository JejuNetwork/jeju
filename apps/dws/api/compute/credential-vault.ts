/**
 * Credential Vault - Encrypted storage for cloud provider API keys
 *
 * Storage: Uses SQLit for persistence when available, falls back to in-memory for tests.
 * @environment DWS_VAULT_KEY - Required in production (32+ chars). Use `openssl rand -base64 32` to generate.
 * @environment SQLIT_URL - When set, enables persistent SQLit storage.
 */

import {
  getCurrentNetwork,
  getSQLitUrl,
  isProductionEnv,
  isTestMode,
} from '@jejunetwork/config'
import { type SQLitClient, getSQLit } from '@jejunetwork/db'
import type { Address } from 'viem'
import { keccak256, toBytes } from 'viem'
import { z } from 'zod'

// ============ Types ============

export type CloudProviderType =
  | 'aws'
  | 'gcp'
  | 'azure'
  | 'hetzner'
  | 'ovh'
  | 'digitalocean'
  | 'vultr'
  | 'linode'

export interface ProviderCredential {
  id: string
  provider: CloudProviderType
  name: string // Human-readable name
  owner: Address // Who owns this credential

  // Encrypted fields (never exposed)
  encryptedApiKey: string
  encryptedApiSecret: string | null
  encryptedProjectId: string | null

  // Metadata
  region: string | null
  scopes: string[] // What this credential can do
  expiresAt: number | null
  createdAt: number
  lastUsedAt: number
  usageCount: number

  // Status
  status: 'active' | 'expired' | 'revoked' | 'error'
  lastErrorAt: number | null
  lastError: string | null
}

export interface CredentialCreateRequest {
  provider: CloudProviderType
  name: string
  apiKey: string
  apiSecret?: string
  projectId?: string
  region?: string
  scopes?: string[]
  expiresAt?: number
  skipVerification?: boolean // For testing only - skips API verification
}

export const CredentialCreateSchema = z.object({
  provider: z.enum([
    'aws',
    'gcp',
    'azure',
    'hetzner',
    'ovh',
    'digitalocean',
    'vultr',
    'linode',
  ]),
  name: z.string().min(1).max(100),
  apiKey: z.string().min(1),
  apiSecret: z.string().optional(),
  projectId: z.string().optional(),
  region: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  expiresAt: z.number().optional(),
})

// ============ Encryption ============

// Dev fallback key - throws in production
const DEV_VAULT_KEY = 'dev-only-key-do-not-use-in-prod-32chars'
let vaultKeyWarningLogged = false

function getVaultKey(): string {
  const key = process.env.DWS_VAULT_KEY

  if (key && key.length >= 32) {
    return key
  }

  // In production, fail hard
  const isProduction = isProductionEnv() || getCurrentNetwork() === 'mainnet'
  if (isProduction) {
    throw new Error(
      'CRITICAL: DWS_VAULT_KEY must be set and at least 32 characters in production',
    )
  }

  // In development, use fallback but warn loudly (once)
  if (!vaultKeyWarningLogged) {
    console.warn(
      '⚠️  WARNING: DWS_VAULT_KEY not set - using insecure development key',
    )
    console.warn('⚠️  Set DWS_VAULT_KEY in .env for production use')
    vaultKeyWarningLogged = true
  }

  return DEV_VAULT_KEY
}

function deriveKey(owner: Address): Uint8Array {
  const vaultKey = getVaultKey()
  const material = `${vaultKey}:${owner.toLowerCase()}:credential-vault-v1`
  return toBytes(keccak256(toBytes(material)))
}

async function encrypt(plaintext: string, owner: Address): Promise<string> {
  const key = deriveKey(owner)
  const iv = crypto.getRandomValues(new Uint8Array(12))

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(key).buffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  )

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    new TextEncoder().encode(plaintext),
  )

  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), iv.length)
  return Buffer.from(combined).toString('base64')
}

async function decrypt(ciphertext: string, owner: Address): Promise<string> {
  const key = deriveKey(owner)
  const combined = Buffer.from(ciphertext, 'base64')

  if (combined.length < 13) {
    throw new Error('Invalid ciphertext: too short')
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(key).buffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  )

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(combined.subarray(0, 12)) },
    cryptoKey,
    new Uint8Array(combined.subarray(12)),
  )

  return new TextDecoder().decode(plaintext)
}

// ============ Storage Backend ============

const SQLIT_DATABASE_ID = 'dws-credentials'
let sqlitClient: SQLitClient | null = null
let tablesInitialized = false
let useSQLit = false

// In-memory fallback for tests
const memoryCredentials = new Map<string, ProviderCredential>()
const memoryOwnerCredentials = new Map<string, Set<string>>() // lowercase owner -> credential ids
const memoryAuditLog: AuditEntry[] = []

interface AuditEntry {
  timestamp: number
  action: 'create' | 'use' | 'revoke' | 'delete'
  credentialId: string
  owner: Address
  details: string
}

interface CredentialRow {
  id: string
  provider: string
  name: string
  owner: string
  encrypted_api_key: string
  encrypted_api_secret: string | null
  encrypted_project_id: string | null
  region: string | null
  scopes: string
  expires_at: number | null
  created_at: number
  last_used_at: number
  usage_count: number
  status: string
  last_error_at: number | null
  last_error: string | null
}

async function initSQLit(): Promise<boolean> {
  if (isTestMode()) {
    return false // Always use in-memory for tests
  }

  const sqlitUrl = getSQLitUrl()
  if (!sqlitUrl) {
    return false
  }

  sqlitClient = getSQLit({ databaseId: SQLIT_DATABASE_ID, timeout: 30000 })
  const healthy = await sqlitClient.isHealthy().catch(() => false)

  if (!healthy) {
    console.warn(
      '[CredentialVault] SQLit not available, using in-memory storage',
    )
    sqlitClient = null
    return false
  }

  await ensureTablesExist()
  useSQLit = true
  console.log('[CredentialVault] Using SQLit for persistent storage')
  return true
}

async function ensureTablesExist(): Promise<void> {
  if (tablesInitialized || !sqlitClient) return

  const tables = [
    `CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      name TEXT NOT NULL,
      owner TEXT NOT NULL,
      encrypted_api_key TEXT NOT NULL,
      encrypted_api_secret TEXT,
      encrypted_project_id TEXT,
      region TEXT,
      scopes TEXT NOT NULL,
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      usage_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      last_error_at INTEGER,
      last_error TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      action TEXT NOT NULL,
      credential_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      details TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_cred_owner ON credentials(owner)`,
    `CREATE INDEX IF NOT EXISTS idx_cred_status ON credentials(status)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_owner ON audit_log(owner)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)`,
  ]

  for (const ddl of tables) {
    await sqlitClient.exec(ddl, [], SQLIT_DATABASE_ID)
  }

  tablesInitialized = true
}

function rowToCredential(row: CredentialRow): ProviderCredential {
  return {
    id: row.id,
    provider: row.provider as CloudProviderType,
    name: row.name,
    owner: row.owner as Address,
    encryptedApiKey: row.encrypted_api_key,
    encryptedApiSecret: row.encrypted_api_secret,
    encryptedProjectId: row.encrypted_project_id,
    region: row.region,
    scopes: JSON.parse(row.scopes),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    usageCount: row.usage_count,
    status: row.status as ProviderCredential['status'],
    lastErrorAt: row.last_error_at,
    lastError: row.last_error,
  }
}

// Storage operations - abstracts SQLit vs in-memory
const storage = {
  async get(id: string): Promise<ProviderCredential | null> {
    if (useSQLit && sqlitClient) {
      const result = await sqlitClient.query<CredentialRow>(
        'SELECT * FROM credentials WHERE id = ?',
        [id],
        SQLIT_DATABASE_ID,
      )
      return result.rows[0] ? rowToCredential(result.rows[0]) : null
    }
    return memoryCredentials.get(id) ?? null
  },

  async set(credential: ProviderCredential): Promise<void> {
    if (useSQLit && sqlitClient) {
      await sqlitClient.exec(
        `INSERT OR REPLACE INTO credentials 
         (id, provider, name, owner, encrypted_api_key, encrypted_api_secret, encrypted_project_id, 
          region, scopes, expires_at, created_at, last_used_at, usage_count, status, last_error_at, last_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          credential.id,
          credential.provider,
          credential.name,
          credential.owner,
          credential.encryptedApiKey,
          credential.encryptedApiSecret,
          credential.encryptedProjectId,
          credential.region,
          JSON.stringify(credential.scopes),
          credential.expiresAt,
          credential.createdAt,
          credential.lastUsedAt,
          credential.usageCount,
          credential.status,
          credential.lastErrorAt,
          credential.lastError,
        ],
        SQLIT_DATABASE_ID,
      )
    } else {
      memoryCredentials.set(credential.id, credential)
      const ownerKey = credential.owner.toLowerCase()
      if (!memoryOwnerCredentials.has(ownerKey)) {
        memoryOwnerCredentials.set(ownerKey, new Set())
      }
      memoryOwnerCredentials.get(ownerKey)?.add(credential.id)
    }
  },

  async delete(id: string): Promise<boolean> {
    if (useSQLit && sqlitClient) {
      const result = await sqlitClient.exec(
        'DELETE FROM credentials WHERE id = ?',
        [id],
        SQLIT_DATABASE_ID,
      )
      return result.rowsAffected > 0
    }
    const cred = memoryCredentials.get(id)
    if (!cred) return false
    memoryCredentials.delete(id)
    const ownerKey = cred.owner.toLowerCase()
    memoryOwnerCredentials.get(ownerKey)?.delete(id)
    return true
  },

  async listByOwner(owner: Address): Promise<ProviderCredential[]> {
    if (useSQLit && sqlitClient) {
      const result = await sqlitClient.query<CredentialRow>(
        'SELECT * FROM credentials WHERE LOWER(owner) = LOWER(?)',
        [owner],
        SQLIT_DATABASE_ID,
      )
      return result.rows.map(rowToCredential)
    }
    const ownerKey = owner.toLowerCase()
    const ids = memoryOwnerCredentials.get(ownerKey)
    if (!ids) return []
    return Array.from(ids)
      .map((id) => memoryCredentials.get(id))
      .filter((cred): cred is ProviderCredential => cred !== undefined)
  },

  async count(): Promise<number> {
    if (useSQLit && sqlitClient) {
      const result = await sqlitClient.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM credentials',
        [],
        SQLIT_DATABASE_ID,
      )
      return result.rows[0]?.count ?? 0
    }
    return memoryCredentials.size
  },

  async countActive(): Promise<number> {
    if (useSQLit && sqlitClient) {
      const result = await sqlitClient.query<{ count: number }>(
        "SELECT COUNT(*) as count FROM credentials WHERE status = 'active'",
        [],
        SQLIT_DATABASE_ID,
      )
      return result.rows[0]?.count ?? 0
    }
    return Array.from(memoryCredentials.values()).filter(
      (c) => c.status === 'active',
    ).length
  },

  async audit(entry: AuditEntry): Promise<void> {
    if (useSQLit && sqlitClient) {
      await sqlitClient.exec(
        'INSERT INTO audit_log (timestamp, action, credential_id, owner, details) VALUES (?, ?, ?, ?, ?)',
        [
          entry.timestamp,
          entry.action,
          entry.credentialId,
          entry.owner,
          entry.details,
        ],
        SQLIT_DATABASE_ID,
      )
    } else {
      memoryAuditLog.push(entry)
    }
  },
}

// Initialize storage on module load (non-blocking)
initSQLit().catch(() => {})

// Metrics for Prometheus
const metrics = {
  storeCount: 0,
  retrieveCount: 0,
  revokeCount: 0,
  unauthorizedCount: 0,
}

export async function getCredentialVaultMetrics() {
  return {
    ...metrics,
    totalCredentials: await storage.count(),
    activeCredentials: await storage.countActive(),
    storageBackend: useSQLit ? 'sqlit' : 'memory',
  }
}

// ============ Vault Service ============

export class CredentialVault {
  /**
   * Store a new credential
   */
  async storeCredential(
    owner: Address,
    request: CredentialCreateRequest,
  ): Promise<string> {
    const validated = CredentialCreateSchema.parse(request)

    const id = `cred-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()

    // Encrypt sensitive fields
    const encryptedApiKey = await encrypt(validated.apiKey, owner)
    const encryptedApiSecret = validated.apiSecret
      ? await encrypt(validated.apiSecret, owner)
      : null
    const encryptedProjectId = validated.projectId
      ? await encrypt(validated.projectId, owner)
      : null

    const credential: ProviderCredential = {
      id,
      provider: validated.provider,
      name: validated.name,
      owner,
      encryptedApiKey,
      encryptedApiSecret,
      encryptedProjectId,
      region: validated.region ?? null,
      scopes: validated.scopes ?? ['*'],
      expiresAt: validated.expiresAt ?? null,
      createdAt: now,
      lastUsedAt: now,
      usageCount: 0,
      status: 'active',
      lastErrorAt: null,
      lastError: null,
    }

    // Verify credential works before storing (unless explicitly skipped for testing)
    if (!request.skipVerification) {
      const verifyResult = await this.verifyCredential(
        validated.provider,
        validated.apiKey,
        validated.apiSecret,
      )
      if (!verifyResult.valid) {
        throw new Error(`Credential verification failed: ${verifyResult.error}`)
      }
    }

    // Store
    await storage.set(credential)

    // Audit
    await this.audit(
      'create',
      id,
      owner,
      `Created ${validated.provider} credential: ${validated.name}`,
    )

    metrics.storeCount++
    console.log(`[CredentialVault] Stored credential ${id} for ${owner}`)
    return id
  }

  /**
   * Get decrypted credential for internal use only
   * This should ONLY be called by the provisioner service
   */
  async getDecryptedCredential(
    credentialId: string,
    requester: Address,
  ): Promise<{
    apiKey: string
    apiSecret: string | null
    projectId: string | null
  } | null> {
    const credential = await storage.get(credentialId)
    if (!credential) return null

    // Check ownership
    if (credential.owner.toLowerCase() !== requester.toLowerCase()) {
      await this.audit(
        'use',
        credentialId,
        requester,
        'Unauthorized access attempt',
      )
      console.warn(
        `[CredentialVault] Unauthorized access to ${credentialId} by ${requester}`,
      )
      metrics.unauthorizedCount++
      return null
    }

    // Check status
    if (credential.status !== 'active') {
      return null
    }

    // Check expiration
    if (credential.expiresAt && credential.expiresAt < Date.now()) {
      credential.status = 'expired'
      await storage.set(credential)
      return null
    }

    // Update usage
    credential.lastUsedAt = Date.now()
    credential.usageCount++
    await storage.set(credential)

    // Audit
    await this.audit(
      'use',
      credentialId,
      requester,
      `Used for ${credential.provider}`,
    )

    // Decrypt and return
    const apiKey = await decrypt(credential.encryptedApiKey, credential.owner)
    const apiSecret = credential.encryptedApiSecret
      ? await decrypt(credential.encryptedApiSecret, credential.owner)
      : null
    const projectId = credential.encryptedProjectId
      ? await decrypt(credential.encryptedProjectId, credential.owner)
      : null

    metrics.retrieveCount++
    return { apiKey, apiSecret, projectId }
  }

  /**
   * List credentials for an owner (metadata only, no secrets)
   */
  async listCredentials(
    owner: Address,
  ): Promise<
    Array<
      Omit<
        ProviderCredential,
        'encryptedApiKey' | 'encryptedApiSecret' | 'encryptedProjectId'
      >
    >
  > {
    const creds = await storage.listByOwner(owner)

    return creds
      .filter((c) => c.status === 'active')
      .map((c) => ({
        id: c.id,
        provider: c.provider,
        name: c.name,
        owner: c.owner,
        region: c.region,
        scopes: c.scopes,
        expiresAt: c.expiresAt,
        createdAt: c.createdAt,
        lastUsedAt: c.lastUsedAt,
        usageCount: c.usageCount,
        status: c.status,
        lastErrorAt: c.lastErrorAt,
        lastError: c.lastError,
      }))
  }

  /**
   * Revoke a credential
   */
  async revokeCredential(
    credentialId: string,
    owner: Address,
  ): Promise<boolean> {
    const credential = await storage.get(credentialId)
    if (!credential) return false

    if (credential.owner.toLowerCase() !== owner.toLowerCase()) {
      return false
    }

    credential.status = 'revoked'
    await storage.set(credential)
    await this.audit('revoke', credentialId, owner, 'Credential revoked')

    metrics.revokeCount++
    console.log(`[CredentialVault] Revoked credential ${credentialId}`)
    return true
  }

  /**
   * Delete a credential
   */
  async deleteCredential(
    credentialId: string,
    owner: Address,
  ): Promise<boolean> {
    const credential = await storage.get(credentialId)
    if (!credential) return false

    if (credential.owner.toLowerCase() !== owner.toLowerCase()) {
      return false
    }

    await storage.delete(credentialId)
    await this.audit('delete', credentialId, owner, 'Credential deleted')

    console.log(`[CredentialVault] Deleted credential ${credentialId}`)
    return true
  }

  /**
   * Mark credential as errored
   */
  async markError(credentialId: string, error: string): Promise<void> {
    const credential = await storage.get(credentialId)
    if (credential) {
      credential.lastErrorAt = Date.now()
      credential.lastError = error
      credential.status = 'error'
      await storage.set(credential)
    }
  }

  /**
   * Get audit log (in-memory only - SQLit audit log retrieval not implemented yet)
   */
  getAuditLog(owner?: Address, limit = 100): AuditEntry[] {
    let log = memoryAuditLog
    if (owner) {
      log = log.filter((e) => e.owner.toLowerCase() === owner.toLowerCase())
    }
    return log.slice(-limit)
  }

  /**
   * Verify a credential works by making an actual API call
   */
  private async verifyCredential(
    provider: CloudProviderType,
    apiKey: string,
    apiSecret?: string,
  ): Promise<{ valid: boolean; error?: string }> {
    const timeout = 15000

    switch (provider) {
      case 'hetzner': {
        const response = await fetch(
          'https://api.hetzner.cloud/v1/datacenters',
          {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(timeout),
          },
        )
        if (response.status === 401 || response.status === 403) {
          return {
            valid: false,
            error: 'Hetzner: Invalid or unauthorized API token',
          }
        }
        if (!response.ok) {
          return {
            valid: false,
            error: `Hetzner API error: ${response.status} ${response.statusText}`,
          }
        }
        return { valid: true }
      }

      case 'digitalocean': {
        const response = await fetch(
          'https://api.digitalocean.com/v2/account',
          {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(timeout),
          },
        )
        if (response.status === 401 || response.status === 403) {
          return {
            valid: false,
            error: 'DigitalOcean: Invalid or unauthorized API token',
          }
        }
        if (!response.ok) {
          return {
            valid: false,
            error: `DigitalOcean API error: ${response.status} ${response.statusText}`,
          }
        }
        return { valid: true }
      }

      case 'vultr': {
        const response = await fetch('https://api.vultr.com/v2/account', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(timeout),
        })
        if (response.status === 401 || response.status === 403) {
          return {
            valid: false,
            error: 'Vultr: Invalid or unauthorized API token',
          }
        }
        if (!response.ok) {
          return {
            valid: false,
            error: `Vultr API error: ${response.status} ${response.statusText}`,
          }
        }
        return { valid: true }
      }

      case 'linode': {
        const response = await fetch('https://api.linode.com/v4/account', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(timeout),
        })
        if (response.status === 401 || response.status === 403) {
          return {
            valid: false,
            error: 'Linode: Invalid or unauthorized API token',
          }
        }
        if (!response.ok) {
          return {
            valid: false,
            error: `Linode API error: ${response.status} ${response.statusText}`,
          }
        }
        return { valid: true }
      }

      case 'aws': {
        // AWS requires proper signature (SigV4)
        // Validate format and require both keys
        if (!apiKey.match(/^(AKIA|ASIA)[A-Z0-9]{16}$/)) {
          return {
            valid: false,
            error:
              'AWS: Invalid access key format (must be AKIA/ASIA + 16 alphanumeric chars)',
          }
        }
        if (!apiSecret || apiSecret.length !== 40) {
          return {
            valid: false,
            error: 'AWS: Secret key must be exactly 40 characters',
          }
        }
        // To fully verify, would need to make STS GetCallerIdentity call
        // For now, format validation is the best we can do without SDK
        console.log(
          '[CredentialVault] AWS credential format validated (full verification requires SDK)',
        )
        return { valid: true }
      }

      case 'gcp': {
        // GCP service account JSON must have specific structure
        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(apiKey) as Record<string, unknown>
        } catch {
          return { valid: false, error: 'GCP: Invalid JSON format' }
        }

        // Validate required fields in service account JSON
        const requiredFields = [
          'type',
          'project_id',
          'private_key_id',
          'private_key',
          'client_email',
        ]
        for (const field of requiredFields) {
          if (!parsed[field]) {
            return {
              valid: false,
              error: `GCP: Missing required field '${field}' in service account JSON`,
            }
          }
        }

        if (parsed.type !== 'service_account') {
          return {
            valid: false,
            error: 'GCP: Credential type must be "service_account"',
          }
        }

        console.log('[CredentialVault] GCP service account JSON validated')
        return { valid: true }
      }

      case 'azure': {
        // Azure requires subscription_id, tenant_id, client_id, and client_secret
        if (!apiKey || apiKey.length < 10) {
          return { valid: false, error: 'Azure: Client ID required' }
        }
        if (!apiSecret || apiSecret.length < 10) {
          return { valid: false, error: 'Azure: Client secret required' }
        }
        // Full validation would require OAuth token request
        console.log('[CredentialVault] Azure credential format validated')
        return { valid: true }
      }

      case 'ovh': {
        // OVH requires application key, application secret, and consumer key
        if (!apiKey || apiKey.length < 10) {
          return { valid: false, error: 'OVH: Application key required' }
        }
        if (!apiSecret || apiSecret.length < 10) {
          return { valid: false, error: 'OVH: Application secret required' }
        }
        console.log('[CredentialVault] OVH credential format validated')
        return { valid: true }
      }

      default: {
        const _exhaustive: never = provider
        return { valid: false, error: `Unsupported provider: ${_exhaustive}` }
      }
    }
  }

  /**
   * Add audit log entry
   */
  private async audit(
    action: 'create' | 'use' | 'revoke' | 'delete',
    credentialId: string,
    owner: Address,
    details: string,
  ): Promise<void> {
    await storage.audit({
      timestamp: Date.now(),
      action,
      credentialId,
      owner,
      details,
    })

    // Keep in-memory audit log bounded
    if (memoryAuditLog.length > 10000) {
      memoryAuditLog.splice(0, memoryAuditLog.length - 10000)
    }
  }
}

// ============ Singleton ============

let vault: CredentialVault | null = null

export function getCredentialVault(): CredentialVault {
  if (!vault) {
    vault = new CredentialVault()
  }
  return vault
}
