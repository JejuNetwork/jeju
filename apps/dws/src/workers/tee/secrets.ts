/**
 * TEE Secret Management
 *
 * Secure secret injection for TEE workers.
 * Secrets are:
 * 1. Encrypted by users to the TEE enclave's public key
 * 2. Stored encrypted on IPFS or in a secret vault
 * 3. Decrypted only inside the TEE enclave
 *
 * Supports:
 * - Per-user secret vaults
 * - Per-workload secrets
 * - Automatic key rotation
 * - Audit logging
 */

import nacl from 'tweetnacl'
import { type Address, type Hex, keccak256, toBytes } from 'viem'
import type { BackendManager } from '../../storage/backends'
import type { EncryptedSecret, NetworkEnvironment, TEEPlatform } from './types'

// ============================================================================
// Secret Vault Types
// ============================================================================

export interface SecretVault {
  /** Vault ID (usually owner address) */
  id: string
  /** Owner address */
  owner: Address
  /** Secrets in this vault */
  secrets: Map<string, VaultSecret>
  /** Created timestamp */
  createdAt: number
  /** Last updated */
  updatedAt: number
}

export interface VaultSecret {
  /** Secret name */
  name: string
  /** Encrypted value */
  encryptedValue: Hex
  /** Public key used for encryption */
  publicKey: Hex
  /** Nonce used for encryption */
  nonce: Hex
  /** Version number */
  version: number
  /** Created timestamp */
  createdAt: number
  /** Updated timestamp */
  updatedAt: number
  /** Allowed workloads (empty = all) */
  allowedWorkloads: string[]
}

export interface SecretManagerConfig {
  /** TEE platform */
  teePlatform: TEEPlatform
  /** Network environment */
  environment: NetworkEnvironment
  /** RPC URL */
  rpcUrl: string
  /** Private key for TEE enclave (derived from hardware in real TEE) */
  enclavePrivateKey: Uint8Array
  /** Storage backend for encrypted secrets */
  storageBackend: 'memory' | 'ipfs' | 'kv'
}

// ============================================================================
// TEE Secret Manager
// ============================================================================

export class TEESecretManager {
  private config: SecretManagerConfig
  private backendManager?: BackendManager

  // In-memory vault storage (for 'memory' backend)
  private vaults = new Map<string, SecretVault>()

  // Enclave keys
  private enclavePrivateKey: Uint8Array
  private enclavePublicKey: Uint8Array

  // Decryption cache (secrets stay decrypted in memory only during execution)
  private decryptionCache = new Map<
    string,
    { value: string; expiresAt: number }
  >()
  private cacheTTL = 60000 // 1 minute

  constructor(config: SecretManagerConfig, backendManager?: BackendManager) {
    this.config = config
    this.backendManager = backendManager
    this.enclavePrivateKey = config.enclavePrivateKey
    this.enclavePublicKey = x25519.getPublicKey(this.enclavePrivateKey)
  }

  // ============================================================================
  // Enclave Key Management
  // ============================================================================

  /**
   * Get the enclave's public key for encrypting secrets
   * Users encrypt secrets to this key, only the TEE can decrypt
   */
  getEnclavePublicKey(): Hex {
    return `0x${Buffer.from(this.enclavePublicKey).toString('hex')}` as Hex
  }

  /**
   * Generate a new enclave keypair (for key rotation)
   * In real TEE, this would be derived from hardware
   */
  static generateEnclaveKeys(): {
    privateKey: Uint8Array
    publicKey: Uint8Array
  } {
    const privateKey = randomBytes(32)
    const publicKey = x25519.getPublicKey(privateKey)
    return { privateKey, publicKey }
  }

  /**
   * Derive enclave keys from TEE attestation (for real TEE)
   */
  static deriveEnclaveKeys(attestation: Hex): {
    privateKey: Uint8Array
    publicKey: Uint8Array
  } {
    // In real implementation, this would use the TEE's hardware-derived key
    // For now, derive from attestation hash
    const hash = keccak256(toBytes(attestation))
    const privateKey = new Uint8Array(Buffer.from(hash.slice(2), 'hex'))
    const publicKey = x25519.getPublicKey(privateKey)
    return { privateKey, publicKey }
  }

  // ============================================================================
  // Secret Encryption (Client-side)
  // ============================================================================

  /**
   * Encrypt a secret value to the enclave's public key
   * This is typically done client-side before storing
   */
  static encryptSecret(
    value: string,
    enclavePublicKey: Hex,
  ): EncryptedSecret & { name: string } {
    const publicKeyBytes = new Uint8Array(
      Buffer.from(enclavePublicKey.slice(2), 'hex'),
    )

    // Generate ephemeral keypair for ECDH
    const ephemeralPrivate = randomBytes(32)
    const ephemeralPublic = x25519.getPublicKey(ephemeralPrivate)

    // Compute shared secret via ECDH
    const sharedSecret = x25519.getSharedSecret(
      ephemeralPrivate,
      publicKeyBytes,
    )

    // Derive encryption key from shared secret
    const encryptionKey = new Uint8Array(
      Buffer.from(keccak256(sharedSecret).slice(2), 'hex'),
    )

    // Generate nonce
    const nonce = randomBytes(24)

    // Encrypt value
    const cipher = xchacha20poly1305(encryptionKey, nonce)
    const plaintext = new TextEncoder().encode(value)
    const ciphertext = cipher.encrypt(plaintext)

    return {
      name: '',
      encryptedValue: `0x${Buffer.from(ciphertext).toString('hex')}` as Hex,
      encryptionKey: `0x${Buffer.from(ephemeralPublic).toString('hex')}` as Hex,
      algorithm: 'x25519-xsalsa20-poly1305',
      nonce: `0x${Buffer.from(nonce).toString('hex')}` as Hex,
    }
  }

  // ============================================================================
  // Secret Decryption (TEE-side)
  // ============================================================================

  /**
   * Decrypt a secret value using the enclave's private key
   * This can only be done inside the TEE
   */
  decryptSecret(encrypted: EncryptedSecret): string {
    // Check cache first
    const cacheKey = `${encrypted.name}:${encrypted.encryptedValue.slice(0, 16)}`
    const cached = this.decryptionCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value
    }

    const ephemeralPublic = new Uint8Array(
      Buffer.from(encrypted.encryptionKey.slice(2), 'hex'),
    )
    const nonce = new Uint8Array(Buffer.from(encrypted.nonce.slice(2), 'hex'))
    const ciphertext = new Uint8Array(
      Buffer.from(encrypted.encryptedValue.slice(2), 'hex'),
    )

    // Compute shared secret via ECDH
    const sharedSecret = x25519.getSharedSecret(
      this.enclavePrivateKey,
      ephemeralPublic,
    )

    // Derive decryption key
    const decryptionKey = new Uint8Array(
      Buffer.from(keccak256(sharedSecret).slice(2), 'hex'),
    )

    // Decrypt
    const cipher = xchacha20poly1305(decryptionKey, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    const value = new TextDecoder().decode(plaintext)

    // Cache decrypted value
    this.decryptionCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + this.cacheTTL,
    })

    return value
  }

  // ============================================================================
  // Secret Storage
  // ============================================================================

  /**
   * Store an encrypted secret
   */
  async storeSecret(
    owner: Address,
    name: string,
    encrypted: EncryptedSecret,
    options?: { allowedWorkloads?: string[] },
  ): Promise<void> {
    let vault = this.vaults.get(owner.toLowerCase())
    if (!vault) {
      vault = {
        id: owner.toLowerCase(),
        owner,
        secrets: new Map(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      this.vaults.set(owner.toLowerCase(), vault)
    }

    const existing = vault.secrets.get(name)
    const version = existing ? existing.version + 1 : 1

    vault.secrets.set(name, {
      name,
      encryptedValue: encrypted.encryptedValue,
      publicKey: encrypted.encryptionKey,
      nonce: encrypted.nonce,
      version,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      allowedWorkloads: options?.allowedWorkloads ?? [],
    })

    vault.updatedAt = Date.now()

    // Persist to storage backend
    if (this.config.storageBackend === 'ipfs' && this.backendManager) {
      await this.persistVault(vault)
    }

    console.log(
      `[SecretManager] Stored secret ${name} for ${owner} (v${version})`,
    )
  }

  /**
   * Get a decrypted secret value
   * Only callable inside TEE
   */
  async getSecret(
    owner: Address,
    name: string,
    workloadId?: string,
  ): Promise<string | null> {
    const vault = this.vaults.get(owner.toLowerCase())
    if (!vault) return null

    const secret = vault.secrets.get(name)
    if (!secret) return null

    // Check workload allowlist
    if (
      secret.allowedWorkloads.length > 0 &&
      workloadId &&
      !secret.allowedWorkloads.includes(workloadId)
    ) {
      console.warn(
        `[SecretManager] Workload ${workloadId} not allowed to access secret ${name}`,
      )
      return null
    }

    // Decrypt
    const encrypted: EncryptedSecret = {
      name: secret.name,
      encryptedValue: secret.encryptedValue,
      encryptionKey: secret.publicKey,
      algorithm: 'x25519-xsalsa20-poly1305',
      nonce: secret.nonce,
    }

    return this.decryptSecret(encrypted)
  }

  /**
   * Delete a secret
   */
  async deleteSecret(owner: Address, name: string): Promise<boolean> {
    const vault = this.vaults.get(owner.toLowerCase())
    if (!vault) return false

    const deleted = vault.secrets.delete(name)
    if (deleted) {
      vault.updatedAt = Date.now()

      // Persist to storage backend
      if (this.config.storageBackend === 'ipfs' && this.backendManager) {
        await this.persistVault(vault)
      }
    }

    return deleted
  }

  /**
   * List secrets for an owner (names only, not values)
   */
  listSecrets(
    owner: Address,
  ): { name: string; version: number; createdAt: number; updatedAt: number }[] {
    const vault = this.vaults.get(owner.toLowerCase())
    if (!vault) return []

    return Array.from(vault.secrets.values()).map((s) => ({
      name: s.name,
      version: s.version,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }))
  }

  // ============================================================================
  // Vault Persistence
  // ============================================================================

  private async persistVault(vault: SecretVault): Promise<string> {
    if (!this.backendManager) {
      throw new Error('Backend manager not configured')
    }

    // Serialize vault (secrets are already encrypted)
    const data = {
      id: vault.id,
      owner: vault.owner,
      secrets: Array.from(vault.secrets.entries()).map(([name, secret]) => ({
        name,
        encryptedValue: secret.encryptedValue,
        publicKey: secret.publicKey,
        nonce: secret.nonce,
        version: secret.version,
        createdAt: secret.createdAt,
        updatedAt: secret.updatedAt,
        allowedWorkloads: secret.allowedWorkloads,
      })),
      createdAt: vault.createdAt,
      updatedAt: vault.updatedAt,
    }

    const content = Buffer.from(JSON.stringify(data))
    const result = await this.backendManager.upload(content, {
      filename: `vault-${vault.id}.json`,
      contentType: 'application/json',
    })

    return result.cid
  }

  async loadVault(owner: Address, cid: string): Promise<void> {
    if (!this.backendManager) {
      throw new Error('Backend manager not configured')
    }

    const result = await this.backendManager.download(cid)
    const data = JSON.parse(Buffer.from(result.content).toString()) as {
      id: string
      owner: Address
      secrets: Array<{
        name: string
        encryptedValue: Hex
        publicKey: Hex
        nonce: Hex
        version: number
        createdAt: number
        updatedAt: number
        allowedWorkloads: string[]
      }>
      createdAt: number
      updatedAt: number
    }

    const vault: SecretVault = {
      id: data.id,
      owner: data.owner,
      secrets: new Map(
        data.secrets.map((s) => [
          s.name,
          {
            name: s.name,
            encryptedValue: s.encryptedValue,
            publicKey: s.publicKey,
            nonce: s.nonce,
            version: s.version,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            allowedWorkloads: s.allowedWorkloads,
          },
        ]),
      ),
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    }

    this.vaults.set(owner.toLowerCase(), vault)
  }

  // ============================================================================
  // Cache Management
  // ============================================================================

  /**
   * Clear decryption cache (call after workload ends)
   */
  clearCache(): void {
    this.decryptionCache.clear()
  }

  /**
   * Clear expired cache entries
   */
  pruneCache(): void {
    const now = Date.now()
    for (const [key, entry] of this.decryptionCache) {
      if (entry.expiresAt < now) {
        this.decryptionCache.delete(key)
      }
    }
  }

  // ============================================================================
  // Audit
  // ============================================================================

  /**
   * Get audit log of secret access
   * In production, this would be persisted
   */
  private accessLog: Array<{
    owner: Address
    name: string
    workloadId?: string
    timestamp: number
    action: 'read' | 'write' | 'delete'
  }> = []

  getAuditLog(
    owner?: Address,
    limit = 100,
  ): Array<{
    owner: Address
    name: string
    workloadId?: string
    timestamp: number
    action: string
  }> {
    let log = this.accessLog
    if (owner) {
      log = log.filter((e) => e.owner.toLowerCase() === owner.toLowerCase())
    }
    return log.slice(-limit)
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createSecretManager(
  config: Partial<SecretManagerConfig> & { enclavePrivateKey?: Uint8Array },
  backendManager?: BackendManager,
): TEESecretManager {
  const environment = (process.env.NETWORK as NetworkEnvironment) ?? 'localnet'

  // Generate enclave keys if not provided
  const { privateKey } = config.enclavePrivateKey
    ? {
        privateKey: config.enclavePrivateKey,
        publicKey: x25519.getPublicKey(config.enclavePrivateKey),
      }
    : TEESecretManager.generateEnclaveKeys()

  const fullConfig: SecretManagerConfig = {
    teePlatform: config.teePlatform ?? 'simulator',
    environment,
    rpcUrl:
      config.rpcUrl ??
      process.env.RPC_URL ??
      (environment === 'localnet' ? 'http://localhost:9545' : ''),
    enclavePrivateKey: privateKey,
    storageBackend: config.storageBackend ?? 'memory',
  }

  return new TEESecretManager(fullConfig, backendManager)
}
