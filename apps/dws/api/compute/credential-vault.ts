/**
 * Credential Vault
 *
 * Secure storage and management of cloud provider credentials:
 * - AWS, GCP, Azure, Hetzner, OVH, DigitalOcean API keys
 * - Encrypted at rest using KMS
 * - Never exposed to users or logs
 * - Scoped access per provisioner
 *
 * Security Model:
 * - Credentials stored encrypted in secure storage (HSM-backed in production)
 * - Only provisioner service can decrypt credentials
 * - Credentials never returned in API responses
 * - All access is audited
 */

import type { Address, Hex } from 'viem'
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

// In production, this would use the KMS package with HSM backing
// For now, we use a simple encryption scheme with a derived key

const VAULT_KEY = process.env.DWS_VAULT_KEY ?? 'dev-vault-key-DO-NOT-USE-IN-PRODUCTION'

function deriveKey(seed: string): Uint8Array {
  const hash = keccak256(toBytes(seed + VAULT_KEY))
  return toBytes(hash)
}

function encrypt(plaintext: string, owner: Address): string {
  const key = deriveKey(owner)

  // Simple XOR encryption (would use AES-GCM in production with KMS)
  const plaintextBytes = new TextEncoder().encode(plaintext)
  const encrypted = new Uint8Array(plaintextBytes.length)

  for (let i = 0; i < plaintextBytes.length; i++) {
    encrypted[i] = plaintextBytes[i] ^ key[i % key.length]
  }

  return Buffer.from(encrypted).toString('base64')
}

function decrypt(ciphertext: string, owner: Address): string {
  const key = deriveKey(owner)
  const encrypted = Buffer.from(ciphertext, 'base64')

  const decrypted = new Uint8Array(encrypted.length)
  for (let i = 0; i < encrypted.length; i++) {
    decrypted[i] = encrypted[i] ^ key[i % key.length]
  }

  return new TextDecoder().decode(decrypted)
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

    const credential: ProviderCredential = {
      id,
      provider: validated.provider,
      name: validated.name,
      owner,
      encryptedApiKey: encrypt(validated.apiKey, owner),
      encryptedApiSecret: validated.apiSecret ? encrypt(validated.apiSecret, owner) : null,
      encryptedProjectId: validated.projectId ? encrypt(validated.projectId, owner) : null,
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

    // Verify credential works before storing
    const verifyResult = await this.verifyCredential(validated.provider, validated.apiKey, validated.apiSecret)
    if (!verifyResult.valid) {
      throw new Error(`Credential verification failed: ${verifyResult.error}`)
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
    return {
      apiKey: decrypt(credential.encryptedApiKey, credential.owner),
      apiSecret: credential.encryptedApiSecret
        ? decrypt(credential.encryptedApiSecret, credential.owner)
        : null,
      projectId: credential.encryptedProjectId
        ? decrypt(credential.encryptedProjectId, credential.owner)
        : null,
    }
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
   * Verify a credential works
   */
  private async verifyCredential(
    provider: CloudProviderType,
    apiKey: string,
    apiSecret?: string,
  ): Promise<{ valid: boolean; error?: string }> {
    // Verify against each provider's API

    switch (provider) {
      case 'hetzner': {
        const response = await fetch('https://api.hetzner.cloud/v1/datacenters', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        })
        if (!response.ok) {
          return { valid: false, error: `Hetzner API error: ${response.status}` }
        }
        return { valid: true }
      }

      case 'digitalocean': {
        const response = await fetch('https://api.digitalocean.com/v2/account', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        })
        if (!response.ok) {
          return { valid: false, error: `DigitalOcean API error: ${response.status}` }
        }
        return { valid: true }
      }

      case 'vultr': {
        const response = await fetch('https://api.vultr.com/v2/account', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        })
        if (!response.ok) {
          return { valid: false, error: `Vultr API error: ${response.status}` }
        }
        return { valid: true }
      }

      case 'aws': {
        // AWS requires signature - would need full AWS SDK
        // For now, just validate the key format
        if (!apiKey.startsWith('AKIA') && !apiKey.startsWith('ASIA')) {
          return { valid: false, error: 'Invalid AWS access key format' }
        }
        if (!apiSecret || apiSecret.length < 20) {
          return { valid: false, error: 'AWS secret key required' }
        }
        return { valid: true }
      }

      case 'gcp': {
        // GCP service account JSON
        try {
          JSON.parse(apiKey)
          return { valid: true }
        } catch {
          return { valid: false, error: 'Invalid GCP service account JSON' }
        }
      }

      default:
        // For other providers, just check key exists
        return { valid: apiKey.length > 10 }
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
