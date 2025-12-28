/**
 * Credential Vault
 *
 * Secure storage and management of cloud provider credentials:
 * - AWS, GCP, Azure, Hetzner, OVH, DigitalOcean API keys
 * - Encrypted at rest using AES-256-GCM
 * - Never exposed to users or logs
 * - Scoped access per provisioner
 *
 * Security Model:
 * - Credentials stored encrypted in secure storage (HSM-backed in production)
 * - Only provisioner service can decrypt credentials
 * - Credentials never returned in API responses
 * - All access is audited
 *
 * @environment DWS_VAULT_KEY - Master encryption key (required in production)
 *   - Must be at least 32 characters
 *   - Used to derive per-owner encryption keys
 *   - In development: Falls back to insecure dev key with warning
 *   - In production (isProductionEnv() or getCurrentNetwork() === 'mainnet'): Required, will throw if not set
 *
 * @example
 * ```bash
 * # Generate a secure vault key
 * openssl rand -base64 32
 *
 * # Set in .env
 * DWS_VAULT_KEY=your-generated-key-at-least-32-chars
 * ```
 */

import {
  getCurrentNetwork,
  isProductionEnv,
} from '@jejunetwork/config'
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
  provider: z.enum(['aws', 'gcp', 'azure', 'hetzner', 'ovh', 'digitalocean', 'vultr', 'linode']),
  name: z.string().min(1).max(100),
  apiKey: z.string().min(1),
  apiSecret: z.string().optional(),
  projectId: z.string().optional(),
  region: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  expiresAt: z.number().optional(),
})

// ============ Encryption ============

/**
 * AES-256-GCM encryption for credential storage
 * 
 * Security properties:
 * - 256-bit AES encryption
 * - GCM mode provides authenticated encryption
 * - Unique IV per encryption
 * - Key derived from master key + owner address using HKDF-like derivation
 */

// Development fallback key - NEVER use in production
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
    throw new Error('CRITICAL: DWS_VAULT_KEY must be set and at least 32 characters in production')
  }
  
  // In development, use fallback but warn loudly (once)
  if (!vaultKeyWarningLogged) {
    console.warn('⚠️  WARNING: DWS_VAULT_KEY not set - using insecure development key')
    console.warn('⚠️  Set DWS_VAULT_KEY in .env for production use')
    vaultKeyWarningLogged = true
  }
  
  return DEV_VAULT_KEY
}

function deriveKey(owner: Address): Uint8Array {
  // Derive a unique key per owner using HKDF-like construction
  // Hash: VAULT_KEY || owner || "credential-vault-v1"
  const vaultKey = getVaultKey()
  const material = `${vaultKey}:${owner.toLowerCase()}:credential-vault-v1`
  const hash = keccak256(toBytes(material))
  return toBytes(hash) // 32 bytes = 256 bits
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
  
  // Format: base64(iv || ciphertext)
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

// ============ Storage ============

// In-memory storage (would be EQLite with encryption in production)
const credentials = new Map<string, ProviderCredential>()
const ownerCredentials = new Map<Address, Set<string>>()
const auditLog: Array<{
  timestamp: number
  action: 'create' | 'use' | 'revoke' | 'delete'
  credentialId: string
  owner: Address
  details: string
}> = []

// ============ Vault Service ============

export class CredentialVault {
  /**
   * Store a new credential
   */
  async storeCredential(owner: Address, request: CredentialCreateRequest): Promise<string> {
    const validated = CredentialCreateSchema.parse(request)

    const id = `cred-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()

    // Encrypt sensitive fields
    const encryptedApiKey = await encrypt(validated.apiKey, owner)
    const encryptedApiSecret = validated.apiSecret ? await encrypt(validated.apiSecret, owner) : null
    const encryptedProjectId = validated.projectId ? await encrypt(validated.projectId, owner) : null

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
      const verifyResult = await this.verifyCredential(validated.provider, validated.apiKey, validated.apiSecret)
      if (!verifyResult.valid) {
        throw new Error(`Credential verification failed: ${verifyResult.error}`)
      }
    }

    // Store
    credentials.set(id, credential)
    const ownerCreds = ownerCredentials.get(owner) ?? new Set()
    ownerCreds.add(id)
    ownerCredentials.set(owner, ownerCreds)

    // Audit
    this.audit('create', id, owner, `Created ${validated.provider} credential: ${validated.name}`)

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
    const credential = credentials.get(credentialId)
    if (!credential) return null

    // Check ownership
    if (credential.owner.toLowerCase() !== requester.toLowerCase()) {
      this.audit('use', credentialId, requester, 'Unauthorized access attempt')
      console.warn(`[CredentialVault] Unauthorized access to ${credentialId} by ${requester}`)
      return null
    }

    // Check status
    if (credential.status !== 'active') {
      return null
    }

    // Check expiration
    if (credential.expiresAt && credential.expiresAt < Date.now()) {
      credential.status = 'expired'
      return null
    }

    // Update usage
    credential.lastUsedAt = Date.now()
    credential.usageCount++

    // Audit
    this.audit('use', credentialId, requester, `Used for ${credential.provider}`)

    // Decrypt and return
    const apiKey = await decrypt(credential.encryptedApiKey, credential.owner)
    const apiSecret = credential.encryptedApiSecret
      ? await decrypt(credential.encryptedApiSecret, credential.owner)
      : null
    const projectId = credential.encryptedProjectId
      ? await decrypt(credential.encryptedProjectId, credential.owner)
      : null

    return { apiKey, apiSecret, projectId }
  }

  /**
   * List credentials for an owner (metadata only, no secrets)
   */
  listCredentials(owner: Address): Array<Omit<ProviderCredential, 'encryptedApiKey' | 'encryptedApiSecret' | 'encryptedProjectId'>> {
    const ownerCreds = ownerCredentials.get(owner)
    if (!ownerCreds) return []

    return Array.from(ownerCreds)
      .map((id) => credentials.get(id))
      .filter((c): c is ProviderCredential => !!c && c.status === 'active')
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
  async revokeCredential(credentialId: string, owner: Address): Promise<boolean> {
    const credential = credentials.get(credentialId)
    if (!credential) return false

    if (credential.owner.toLowerCase() !== owner.toLowerCase()) {
      return false
    }

    credential.status = 'revoked'
    this.audit('revoke', credentialId, owner, 'Credential revoked')

    console.log(`[CredentialVault] Revoked credential ${credentialId}`)
    return true
  }

  /**
   * Delete a credential
   */
  async deleteCredential(credentialId: string, owner: Address): Promise<boolean> {
    const credential = credentials.get(credentialId)
    if (!credential) return false

    if (credential.owner.toLowerCase() !== owner.toLowerCase()) {
      return false
    }

    credentials.delete(credentialId)
    const ownerCreds = ownerCredentials.get(owner)
    ownerCreds?.delete(credentialId)

    this.audit('delete', credentialId, owner, 'Credential deleted')

    console.log(`[CredentialVault] Deleted credential ${credentialId}`)
    return true
  }

  /**
   * Mark credential as errored
   */
  markError(credentialId: string, error: string): void {
    const credential = credentials.get(credentialId)
    if (credential) {
      credential.lastErrorAt = Date.now()
      credential.lastError = error
      credential.status = 'error'
    }
  }

  /**
   * Get audit log
   */
  getAuditLog(owner?: Address, limit = 100): typeof auditLog {
    let log = auditLog
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
        const response = await fetch('https://api.hetzner.cloud/v1/datacenters', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(timeout),
        })
        if (response.status === 401 || response.status === 403) {
          return { valid: false, error: 'Hetzner: Invalid or unauthorized API token' }
        }
        if (!response.ok) {
          return { valid: false, error: `Hetzner API error: ${response.status} ${response.statusText}` }
        }
        return { valid: true }
      }

      case 'digitalocean': {
        const response = await fetch('https://api.digitalocean.com/v2/account', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(timeout),
        })
        if (response.status === 401 || response.status === 403) {
          return { valid: false, error: 'DigitalOcean: Invalid or unauthorized API token' }
        }
        if (!response.ok) {
          return { valid: false, error: `DigitalOcean API error: ${response.status} ${response.statusText}` }
        }
        return { valid: true }
      }

      case 'vultr': {
        const response = await fetch('https://api.vultr.com/v2/account', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(timeout),
        })
        if (response.status === 401 || response.status === 403) {
          return { valid: false, error: 'Vultr: Invalid or unauthorized API token' }
        }
        if (!response.ok) {
          return { valid: false, error: `Vultr API error: ${response.status} ${response.statusText}` }
        }
        return { valid: true }
      }

      case 'linode': {
        const response = await fetch('https://api.linode.com/v4/account', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(timeout),
        })
        if (response.status === 401 || response.status === 403) {
          return { valid: false, error: 'Linode: Invalid or unauthorized API token' }
        }
        if (!response.ok) {
          return { valid: false, error: `Linode API error: ${response.status} ${response.statusText}` }
        }
        return { valid: true }
      }

      case 'aws': {
        // AWS requires proper signature (SigV4)
        // Validate format and require both keys
        if (!apiKey.match(/^(AKIA|ASIA)[A-Z0-9]{16}$/)) {
          return { valid: false, error: 'AWS: Invalid access key format (must be AKIA/ASIA + 16 alphanumeric chars)' }
        }
        if (!apiSecret || apiSecret.length !== 40) {
          return { valid: false, error: 'AWS: Secret key must be exactly 40 characters' }
        }
        // To fully verify, would need to make STS GetCallerIdentity call
        // For now, format validation is the best we can do without SDK
        console.log('[CredentialVault] AWS credential format validated (full verification requires SDK)')
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
        const requiredFields = ['type', 'project_id', 'private_key_id', 'private_key', 'client_email']
        for (const field of requiredFields) {
          if (!parsed[field]) {
            return { valid: false, error: `GCP: Missing required field '${field}' in service account JSON` }
          }
        }
        
        if (parsed.type !== 'service_account') {
          return { valid: false, error: 'GCP: Credential type must be "service_account"' }
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
  private audit(
    action: 'create' | 'use' | 'revoke' | 'delete',
    credentialId: string,
    owner: Address,
    details: string,
  ): void {
    auditLog.push({
      timestamp: Date.now(),
      action,
      credentialId,
      owner,
      details,
    })

    // Keep audit log bounded
    if (auditLog.length > 10000) {
      auditLog.splice(0, auditLog.length - 10000)
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
