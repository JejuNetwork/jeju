/**
 * TEE State Manager
 *
 * Manages agent state with TEE-backed encryption for Babylon game agents.
 * Ensures secrets (like event outcomes) remain protected in TEE memory.
 *
 * Features:
 * - Encrypted agent state storage
 * - Attestation-bound encryption keys
 * - Secure key derivation from TEE measurement
 * - State migration on re-attestation
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
} from 'node:crypto'
import { promisify } from 'node:util'
import { keccak256, toBytes } from 'viem'

const scryptAsync = promisify(scrypt)

// ============================================================================
// Types
// ============================================================================

export interface TEEStateConfig {
  /** TEE measurement for key derivation */
  mrEnclave: string
  /** Signer measurement */
  mrSigner: string
  /** Node ID for state namespace */
  nodeId: string
  /** Storage backend */
  storage?: StateStorage
  /** Key rotation interval (ms) */
  keyRotationInterval?: number
  /** Enable state persistence */
  persistState?: boolean
  /** State persistence path */
  statePath?: string
}

export interface StateStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  list(prefix: string): Promise<string[]>
}

export interface EncryptedState {
  /** Encrypted data (base64) */
  ciphertext: string
  /** Initialization vector (base64) */
  iv: string
  /** Authentication tag (base64) */
  authTag: string
  /** Key version */
  keyVersion: number
  /** Encryption timestamp */
  timestamp: number
  /** State schema version */
  schemaVersion: number
}

export interface AgentSecret {
  /** Secret identifier */
  id: string
  /** Secret type */
  type: 'event_outcome' | 'market_position' | 'internal_state' | 'custom'
  /** Encrypted value */
  value: EncryptedState
  /** When secret expires (0 = never) */
  expiresAt: number
  /** Access control list */
  acl?: string[]
}

export interface StateSnapshot {
  /** Agent ID */
  agentId: string
  /** Snapshot timestamp */
  timestamp: number
  /** Encrypted state */
  state: EncryptedState
  /** Current key version */
  keyVersion: number
  /** Attestation used for encryption */
  attestation: {
    mrEnclave: string
    mrSigner: string
    timestamp: number
  }
}

// ============================================================================
// In-Memory Storage (Default)
// ============================================================================

class InMemoryStorage implements StateStorage {
  private data: Map<string, string> = new Map()

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null
  }

  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key)
  }

  async list(prefix: string): Promise<string[]> {
    return Array.from(this.data.keys()).filter((k) => k.startsWith(prefix))
  }
}

// ============================================================================
// TEE State Manager
// ============================================================================

export class TEEStateManager {
  private config: TEEStateConfig
  private storage: StateStorage
  private masterKey: Buffer | null = null
  private keyVersion = 1
  private secrets: Map<string, AgentSecret> = new Map()
  private states: Map<string, StateSnapshot> = new Map()
  private latestSnapshots: Map<string, string> = new Map()
  private initialized = false

  constructor(config: TEEStateConfig) {
    this.config = {
      keyRotationInterval: 24 * 60 * 60 * 1000, // 24 hours
      persistState: true,
      ...config,
    }
    this.storage = config.storage ?? new InMemoryStorage()
  }

  /**
   * Initialize the state manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Derive master key from TEE measurements
    this.masterKey = await this.deriveKey(
      this.config.mrEnclave,
      this.config.mrSigner,
      this.config.nodeId,
    )

    // Load persisted state if available
    if (this.config.persistState) {
      await this.loadPersistedState()
    }

    this.initialized = true
  }

  /**
   * Derive encryption key from TEE measurements
   */
  private async deriveKey(
    mrEnclave: string,
    mrSigner: string,
    nodeId: string,
  ): Promise<Buffer> {
    // Create deterministic salt from measurements
    const salt = createHash('sha256')
      .update(mrEnclave)
      .update(mrSigner)
      .update(nodeId)
      .digest()

    // Derive key using scrypt (memory-hard)
    const keyMaterial = `${mrEnclave}:${mrSigner}:${nodeId}:v${this.keyVersion}`
    const key = (await scryptAsync(keyMaterial, salt, 32)) as Buffer

    return key
  }

  /**
   * Encrypt data with AES-256-GCM
   */
  private encrypt(data: Buffer): EncryptedState {
    if (!this.masterKey) {
      throw new Error('State manager not initialized')
    }

    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv)

    const encrypted = Buffer.concat([cipher.update(data), cipher.final()])
    const authTag = cipher.getAuthTag()

    return {
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      keyVersion: this.keyVersion,
      timestamp: Date.now(),
      schemaVersion: 1,
    }
  }

  /**
   * Decrypt data with AES-256-GCM
   */
  private decrypt(encrypted: EncryptedState): Buffer {
    if (!this.masterKey) {
      throw new Error('State manager not initialized')
    }

    // Handle key version mismatch (would need key rotation logic)
    if (encrypted.keyVersion !== this.keyVersion) {
      throw new Error(
        `Key version mismatch: expected ${this.keyVersion}, got ${encrypted.keyVersion}`,
      )
    }

    const iv = Buffer.from(encrypted.iv, 'base64')
    const authTag = Buffer.from(encrypted.authTag, 'base64')
    const ciphertext = Buffer.from(encrypted.ciphertext, 'base64')

    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv)
    decipher.setAuthTag(authTag)

    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  }

  // ============================================================================
  // Secret Management
  // ============================================================================

  /**
   * Store an agent secret
   */
  async storeSecret(
    id: string,
    type: AgentSecret['type'],
    value: unknown,
    options?: {
      expiresAt?: number
      acl?: string[]
    },
  ): Promise<void> {
    if (!this.initialized) await this.initialize()

    const serialized = JSON.stringify(value)
    const encrypted = this.encrypt(Buffer.from(serialized, 'utf-8'))

    const secret: AgentSecret = {
      id,
      type,
      value: encrypted,
      expiresAt: options?.expiresAt ?? 0,
      acl: options?.acl,
    }

    this.secrets.set(id, secret)

    // Persist
    if (this.config.persistState) {
      await this.storage.set(
        `secret:${this.config.nodeId}:${id}`,
        JSON.stringify(secret),
      )
    }
  }

  /**
   * Retrieve an agent secret
   */
  async getSecret<T>(id: string, requestor?: string): Promise<T | null> {
    if (!this.initialized) await this.initialize()

    const secret = this.secrets.get(id)
    if (!secret) {
      // Try loading from storage
      const stored = await this.storage.get(
        `secret:${this.config.nodeId}:${id}`,
      )
      if (stored) {
        const parsed = JSON.parse(stored) as AgentSecret
        this.secrets.set(id, parsed)
        return this.getSecret<T>(id, requestor)
      }
      return null
    }

    // Check expiration
    if (secret.expiresAt > 0 && Date.now() > secret.expiresAt) {
      await this.deleteSecret(id)
      return null
    }

    // Check ACL
    if (secret.acl && secret.acl.length > 0 && requestor) {
      if (!secret.acl.includes(requestor)) {
        throw new Error('Access denied to secret')
      }
    }

    // Decrypt
    const decrypted = this.decrypt(secret.value)
    return JSON.parse(decrypted.toString('utf-8')) as T
  }

  /**
   * Delete an agent secret
   */
  async deleteSecret(id: string): Promise<void> {
    this.secrets.delete(id)

    if (this.config.persistState) {
      await this.storage.delete(`secret:${this.config.nodeId}:${id}`)
    }
  }

  /**
   * List all secrets of a given type
   */
  async listSecrets(type?: AgentSecret['type']): Promise<string[]> {
    if (!this.initialized) await this.initialize()

    const allSecrets = Array.from(this.secrets.entries())

    if (type) {
      return allSecrets.filter(([, s]) => s.type === type).map(([id]) => id)
    }

    return allSecrets.map(([id]) => id)
  }

  // ============================================================================
  // State Management
  // ============================================================================

  /**
   * Save agent state snapshot
   */
  async saveState(agentId: string, state: unknown): Promise<string> {
    if (!this.initialized) await this.initialize()

    const serialized = JSON.stringify(state)
    const encrypted = this.encrypt(Buffer.from(serialized, 'utf-8'))

    const snapshot: StateSnapshot = {
      agentId,
      timestamp: Date.now(),
      state: encrypted,
      keyVersion: this.keyVersion,
      attestation: {
        mrEnclave: this.config.mrEnclave,
        mrSigner: this.config.mrSigner,
        timestamp: Date.now(),
      },
    }

    const snapshotId = keccak256(
      toBytes(`${agentId}:${snapshot.timestamp}`),
    ).slice(0, 18)

    // Always keep in memory
    const stateKey = `${agentId}:${snapshotId}`
    this.states.set(stateKey, snapshot)
    this.latestSnapshots.set(agentId, snapshotId)

    // Optionally persist to storage
    if (this.config.persistState) {
      await this.storage.set(
        `state:${this.config.nodeId}:${agentId}:${snapshotId}`,
        JSON.stringify(snapshot),
      )

      // Update latest pointer
      await this.storage.set(
        `state:${this.config.nodeId}:${agentId}:latest`,
        snapshotId,
      )
    }

    return snapshotId
  }

  /**
   * Load agent state snapshot
   */
  async loadState<T>(agentId: string, snapshotId?: string): Promise<T | null> {
    if (!this.initialized) await this.initialize()

    // Get snapshot ID - check memory first, then storage
    let id = snapshotId
    if (!id) {
      id = this.latestSnapshots.get(agentId) ?? null
      if (!id && this.config.persistState) {
        id = await this.storage.get(
          `state:${this.config.nodeId}:${agentId}:latest`,
        )
      }
      if (!id) return null
    }

    // Load snapshot - check memory first
    const stateKey = `${agentId}:${id}`
    let snapshot = this.states.get(stateKey)

    if (!snapshot && this.config.persistState) {
      const stored = await this.storage.get(
        `state:${this.config.nodeId}:${agentId}:${id}`,
      )
      if (stored) {
        snapshot = JSON.parse(stored) as StateSnapshot
        // Cache in memory
        this.states.set(stateKey, snapshot)
      }
    }

    if (!snapshot) return null

    // Verify attestation matches
    if (
      snapshot.attestation.mrEnclave !== this.config.mrEnclave ||
      snapshot.attestation.mrSigner !== this.config.mrSigner
    ) {
      throw new Error(
        'State was encrypted with different TEE attestation. Migration required.',
      )
    }

    // Decrypt
    const decrypted = this.decrypt(snapshot.state)
    return JSON.parse(decrypted.toString('utf-8')) as T
  }

  /**
   * List state snapshots for an agent
   */
  async listSnapshots(agentId: string): Promise<string[]> {
    const keys = await this.storage.list(
      `state:${this.config.nodeId}:${agentId}:`,
    )

    return keys
      .filter((k) => !k.endsWith(':latest'))
      .map((k) => k.split(':').pop()!)
  }

  // ============================================================================
  // Key Rotation
  // ============================================================================

  /**
   * Rotate encryption key (requires re-encryption of all data)
   */
  async rotateKey(newMrEnclave: string, newMrSigner: string): Promise<void> {
    if (!this.initialized) await this.initialize()

    const oldKey = this.masterKey!
    const _oldVersion = this.keyVersion

    // Derive new key
    this.keyVersion++
    this.masterKey = await this.deriveKey(
      newMrEnclave,
      newMrSigner,
      this.config.nodeId,
    )

    // Re-encrypt all secrets
    const secretEntries = Array.from(this.secrets.entries())
    for (let i = 0; i < secretEntries.length; i++) {
      const [id, secret] = secretEntries[i]
      // Decrypt with old key
      const oldMasterKey = this.masterKey
      this.masterKey = oldKey

      const decrypted = this.decrypt(secret.value)

      // Re-encrypt with new key
      this.masterKey = oldMasterKey
      const reencrypted = this.encrypt(decrypted)

      secret.value = reencrypted

      // Persist
      if (this.config.persistState) {
        await this.storage.set(
          `secret:${this.config.nodeId}:${id}`,
          JSON.stringify(secret),
        )
      }
    }

    // Update config
    this.config.mrEnclave = newMrEnclave
    this.config.mrSigner = newMrSigner
  }

  // ============================================================================
  // Persistence
  // ============================================================================

  private async loadPersistedState(): Promise<void> {
    // Load secrets
    const secretKeys = await this.storage.list(`secret:${this.config.nodeId}:`)

    for (const key of secretKeys) {
      const stored = await this.storage.get(key)
      if (stored) {
        const secret = JSON.parse(stored) as AgentSecret
        this.secrets.set(secret.id, secret)
      }
    }
  }

  /**
   * Clear all state (dangerous!)
   */
  async clearAll(): Promise<void> {
    this.secrets.clear()

    if (this.config.persistState) {
      const secretKeys = await this.storage.list(
        `secret:${this.config.nodeId}:`,
      )
      for (const key of secretKeys) {
        await this.storage.delete(key)
      }

      const stateKeys = await this.storage.list(`state:${this.config.nodeId}:`)
      for (const key of stateKeys) {
        await this.storage.delete(key)
      }
    }
  }

  /**
   * Get current attestation info
   */
  getAttestation(): { mrEnclave: string; mrSigner: string; nodeId: string } {
    return {
      mrEnclave: this.config.mrEnclave,
      mrSigner: this.config.mrSigner,
      nodeId: this.config.nodeId,
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createTEEStateManager(config: TEEStateConfig): TEEStateManager {
  return new TEEStateManager(config)
}
