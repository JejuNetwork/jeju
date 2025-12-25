/**
 * TEE Cache Provider
 *
 * Provides TEE-backed cache instances with:
 * - Memory encryption via CVM
 * - Attestation for cache operations
 * - Key escrow with TEE-protected key vault
 * - Audit logging
 *
 * Supports: Phala, Intel TDX, AMD SEV, dstack, LOCAL (simulator)
 */

import { HexSchema } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes, toHex } from 'viem'
import { z } from 'zod'
import { CacheEngine } from './engine'
import {
  CacheError,
  CacheErrorCode,
  type CacheInstance,
  CacheInstanceStatus,
  type CacheSetOptions,
  type CacheStats,
  type CacheTEEAttestation,
  CacheTEEProvider,
  CacheTier,
  type HashEntry,
  type SortedSetMember,
} from './types'

// Validation schemas for TEE responses

const TEEAttestationResponseSchema = z.object({
  quote: HexSchema,
  mr_enclave: HexSchema,
  mr_signer: HexSchema,
  report_data: HexSchema,
  timestamp: z.number(),
})

const TEEEncryptResponseSchema = z.object({
  ciphertext: z.string(),
  nonce: z.string(),
  tag: z.string(),
})

const TEEDecryptResponseSchema = z.object({
  plaintext: z.string(),
})

// TEE Provider Configuration

export interface TEECacheProviderConfig {
  provider: CacheTEEProvider
  endpoint?: string
  apiKey?: string
  encryptionEnabled: boolean
  attestationIntervalMs: number
  maxMemoryMb: number
}

// Encrypted cache entry wrapper

interface EncryptedEntry {
  ciphertext: string
  nonce: string
  tag: string
  keyId: string
}

/**
 * TEE-backed cache provider
 *
 * Wraps CacheEngine with TEE attestation and optional encryption.
 */
export class TEECacheProvider {
  private config: TEECacheProviderConfig
  private engine: CacheEngine
  private attestation: CacheTEEAttestation | null = null
  private attestationInterval: ReturnType<typeof setInterval> | null = null
  private encryptionKeyId: string | null = null
  private initialized = false
  private nodeId: string

  constructor(config: TEECacheProviderConfig, nodeId: string) {
    this.config = config
    this.nodeId = nodeId
    this.engine = new CacheEngine({
      maxMemoryMb: config.maxMemoryMb,
      defaultTtlSeconds: 3600,
      maxTtlSeconds: 86400 * 30,
      evictionPolicy: 'lru',
      persistenceEnabled: false,
      replicationFactor: 1,
      teeProvider: config.provider,
      teeEndpoint: config.endpoint,
    })
  }

  /**
   * Check if running in simulated mode
   */
  isSimulated(): boolean {
    return this.config.provider === CacheTEEProvider.LOCAL
  }

  /**
   * Initialize the TEE provider
   */
  async initialize(): Promise<CacheTEEAttestation> {
    console.log(
      `[TEE-Cache] Initializing ${this.config.provider} provider for node ${this.nodeId}`,
    )

    // Generate initial attestation
    this.attestation = await this.generateAttestation()

    // Initialize encryption key if encryption is enabled
    if (this.config.encryptionEnabled) {
      this.encryptionKeyId = await this.initializeEncryptionKey()
    }

    // Start attestation refresh interval
    this.attestationInterval = setInterval(
      () => this.refreshAttestation(),
      this.config.attestationIntervalMs,
    )

    this.initialized = true
    console.log(`[TEE-Cache] Provider ${this.nodeId} initialized`)

    return this.attestation
  }

  /**
   * Stop the TEE provider
   */
  async stop(): Promise<void> {
    if (this.attestationInterval) {
      clearInterval(this.attestationInterval)
      this.attestationInterval = null
    }
    this.engine.stop()
    this.initialized = false
    console.log(`[TEE-Cache] Provider ${this.nodeId} stopped`)
  }

  /**
   * Get current attestation
   */
  getAttestation(): CacheTEEAttestation | null {
    return this.attestation
  }

  /**
   * Create a cache instance
   */
  async createInstance(
    instanceId: string,
    owner: Address,
    namespace: string,
    maxMemoryMb: number,
    expiresAt: number,
  ): Promise<CacheInstance> {
    this.requireInit()

    const now = Date.now()
    const instance: CacheInstance = {
      id: instanceId,
      owner,
      namespace,
      tier: CacheTier.TEE,
      maxMemoryMb,
      usedMemoryMb: 0,
      keyCount: 0,
      createdAt: now,
      expiresAt,
      status: CacheInstanceStatus.RUNNING,
      teeProvider: this.config.provider,
      teeAttestation: this.attestation ?? undefined,
      nodeId: this.nodeId,
    }

    return instance
  }

  // ============================================================================
  // String Operations (with optional encryption)
  // ============================================================================

  /**
   * Get a value
   */
  async get(namespace: string, key: string): Promise<string | null> {
    this.requireInit()

    if (this.config.encryptionEnabled) {
      const encrypted = this.engine.get(namespace, key)
      if (!encrypted) return null
      return this.decrypt(encrypted)
    }

    return this.engine.get(namespace, key)
  }

  /**
   * Set a value
   */
  async set(
    namespace: string,
    key: string,
    value: string,
    options: CacheSetOptions = {},
  ): Promise<boolean> {
    this.requireInit()

    if (this.config.encryptionEnabled) {
      const encrypted = await this.encrypt(value)
      return this.engine.set(namespace, key, encrypted, options)
    }

    return this.engine.set(namespace, key, value, options)
  }

  /**
   * Delete keys
   */
  async del(namespace: string, ...keys: string[]): Promise<number> {
    this.requireInit()
    return this.engine.del(namespace, ...keys)
  }

  /**
   * Check existence
   */
  async exists(namespace: string, ...keys: string[]): Promise<number> {
    this.requireInit()
    return this.engine.exists(namespace, ...keys)
  }

  /**
   * Increment
   */
  async incr(namespace: string, key: string, by = 1): Promise<number> {
    this.requireInit()

    if (this.config.encryptionEnabled) {
      const current = await this.get(namespace, key)
      const num = current ? parseInt(current, 10) : 0
      if (Number.isNaN(num)) {
        throw new CacheError(
          CacheErrorCode.INVALID_OPERATION,
          'Value is not an integer',
        )
      }
      const newValue = num + by
      await this.set(namespace, key, newValue.toString())
      return newValue
    }

    return this.engine.incr(namespace, key, by)
  }

  /**
   * Decrement
   */
  async decr(namespace: string, key: string, by = 1): Promise<number> {
    return this.incr(namespace, key, -by)
  }

  // ============================================================================
  // TTL Operations
  // ============================================================================

  /**
   * Set expiration
   */
  async expire(
    namespace: string,
    key: string,
    seconds: number,
  ): Promise<boolean> {
    this.requireInit()
    return this.engine.expire(namespace, key, seconds)
  }

  /**
   * Get TTL
   */
  async ttl(namespace: string, key: string): Promise<number> {
    this.requireInit()
    return this.engine.ttl(namespace, key)
  }

  // ============================================================================
  // Hash Operations
  // ============================================================================

  /**
   * Get hash field
   */
  async hget(
    namespace: string,
    key: string,
    field: string,
  ): Promise<string | null> {
    this.requireInit()

    if (this.config.encryptionEnabled) {
      const encrypted = this.engine.hget(namespace, key, field)
      if (!encrypted) return null
      return this.decrypt(encrypted)
    }

    return this.engine.hget(namespace, key, field)
  }

  /**
   * Set hash field
   */
  async hset(
    namespace: string,
    key: string,
    field: string,
    value: string,
  ): Promise<number> {
    this.requireInit()

    if (this.config.encryptionEnabled) {
      const encrypted = await this.encrypt(value)
      return this.engine.hset(namespace, key, field, encrypted)
    }

    return this.engine.hset(namespace, key, field, value)
  }

  /**
   * Get all hash fields
   */
  async hgetall(namespace: string, key: string): Promise<HashEntry> {
    this.requireInit()

    const hash = this.engine.hgetall(namespace, key)

    if (this.config.encryptionEnabled) {
      const decrypted: HashEntry = {}
      for (const [field, value] of Object.entries(hash)) {
        decrypted[field] = await this.decrypt(value)
      }
      return decrypted
    }

    return hash
  }

  /**
   * Delete hash fields
   */
  async hdel(
    namespace: string,
    key: string,
    ...fields: string[]
  ): Promise<number> {
    this.requireInit()
    return this.engine.hdel(namespace, key, ...fields)
  }

  // ============================================================================
  // List Operations
  // ============================================================================

  /**
   * Push to left of list
   */
  async lpush(
    namespace: string,
    key: string,
    ...values: string[]
  ): Promise<number> {
    this.requireInit()

    if (this.config.encryptionEnabled) {
      const encrypted = await Promise.all(values.map((v) => this.encrypt(v)))
      return this.engine.lpush(namespace, key, ...encrypted)
    }

    return this.engine.lpush(namespace, key, ...values)
  }

  /**
   * Push to right of list
   */
  async rpush(
    namespace: string,
    key: string,
    ...values: string[]
  ): Promise<number> {
    this.requireInit()

    if (this.config.encryptionEnabled) {
      const encrypted = await Promise.all(values.map((v) => this.encrypt(v)))
      return this.engine.rpush(namespace, key, ...encrypted)
    }

    return this.engine.rpush(namespace, key, ...values)
  }

  /**
   * Pop from left
   */
  async lpop(namespace: string, key: string): Promise<string | null> {
    this.requireInit()

    const value = this.engine.lpop(namespace, key)
    if (!value) return null

    if (this.config.encryptionEnabled) {
      return this.decrypt(value)
    }

    return value
  }

  /**
   * Pop from right
   */
  async rpop(namespace: string, key: string): Promise<string | null> {
    this.requireInit()

    const value = this.engine.rpop(namespace, key)
    if (!value) return null

    if (this.config.encryptionEnabled) {
      return this.decrypt(value)
    }

    return value
  }

  /**
   * Get list range
   */
  async lrange(
    namespace: string,
    key: string,
    start: number,
    stop: number,
  ): Promise<string[]> {
    this.requireInit()

    const values = this.engine.lrange(namespace, key, start, stop)

    if (this.config.encryptionEnabled) {
      return Promise.all(values.map((v) => this.decrypt(v)))
    }

    return values
  }

  /**
   * Get list length
   */
  async llen(namespace: string, key: string): Promise<number> {
    this.requireInit()
    return this.engine.llen(namespace, key)
  }

  // ============================================================================
  // Set Operations
  // ============================================================================

  /**
   * Add to set
   */
  async sadd(
    namespace: string,
    key: string,
    ...members: string[]
  ): Promise<number> {
    this.requireInit()

    if (this.config.encryptionEnabled) {
      const encrypted = await Promise.all(members.map((m) => this.encrypt(m)))
      return this.engine.sadd(namespace, key, ...encrypted)
    }

    return this.engine.sadd(namespace, key, ...members)
  }

  /**
   * Remove from set
   */
  async srem(
    namespace: string,
    key: string,
    ...members: string[]
  ): Promise<number> {
    this.requireInit()

    if (this.config.encryptionEnabled) {
      const encrypted = await Promise.all(members.map((m) => this.encrypt(m)))
      return this.engine.srem(namespace, key, ...encrypted)
    }

    return this.engine.srem(namespace, key, ...members)
  }

  /**
   * Get set members
   */
  async smembers(namespace: string, key: string): Promise<string[]> {
    this.requireInit()

    const members = this.engine.smembers(namespace, key)

    if (this.config.encryptionEnabled) {
      return Promise.all(members.map((m) => this.decrypt(m)))
    }

    return members
  }

  /**
   * Check set membership
   */
  async sismember(
    namespace: string,
    key: string,
    member: string,
  ): Promise<boolean> {
    this.requireInit()

    if (this.config.encryptionEnabled) {
      const encrypted = await this.encrypt(member)
      return this.engine.sismember(namespace, key, encrypted)
    }

    return this.engine.sismember(namespace, key, member)
  }

  /**
   * Get set size
   */
  async scard(namespace: string, key: string): Promise<number> {
    this.requireInit()
    return this.engine.scard(namespace, key)
  }

  // ============================================================================
  // Sorted Set Operations
  // ============================================================================

  /**
   * Add to sorted set
   */
  async zadd(
    namespace: string,
    key: string,
    ...members: SortedSetMember[]
  ): Promise<number> {
    this.requireInit()

    if (this.config.encryptionEnabled) {
      const encrypted = await Promise.all(
        members.map(async (m) => ({
          member: await this.encrypt(m.member),
          score: m.score,
        })),
      )
      return this.engine.zadd(namespace, key, ...encrypted)
    }

    return this.engine.zadd(namespace, key, ...members)
  }

  /**
   * Get sorted set range
   */
  async zrange(
    namespace: string,
    key: string,
    start: number,
    stop: number,
  ): Promise<string[]> {
    this.requireInit()

    const result = this.engine.zrange(
      namespace,
      key,
      start,
      stop,
      false,
    ) as string[]

    if (this.config.encryptionEnabled) {
      return Promise.all(result.map((m) => this.decrypt(m)))
    }

    return result
  }

  /**
   * Get sorted set size
   */
  async zcard(namespace: string, key: string): Promise<number> {
    this.requireInit()
    return this.engine.zcard(namespace, key)
  }

  // ============================================================================
  // Key Operations
  // ============================================================================

  /**
   * Get keys matching pattern
   */
  async keys(namespace: string, pattern = '*'): Promise<string[]> {
    this.requireInit()
    return this.engine.keys(namespace, pattern)
  }

  /**
   * Clear namespace
   */
  async flushdb(namespace: string): Promise<void> {
    this.requireInit()
    this.engine.flushdb(namespace)
  }

  /**
   * Get stats
   */
  getStats(): CacheStats {
    return this.engine.getStats()
  }

  // ============================================================================
  // TEE Operations
  // ============================================================================

  /**
   * Generate attestation
   */
  private async generateAttestation(): Promise<CacheTEEAttestation> {
    // LOCAL mode - generate simulated attestation
    if (this.config.provider === CacheTEEProvider.LOCAL) {
      const timestamp = Date.now()
      const mrEnclave = keccak256(toBytes(`${this.nodeId}:${timestamp}`))

      console.log(`[TEE-Cache] Generating SIMULATED attestation (LOCAL mode)`)

      return {
        quote: `0x${'00'.repeat(256)}` as Hex,
        mrEnclave,
        mrSigner: keccak256(toBytes(this.nodeId)),
        reportData: keccak256(toBytes(`cache:${mrEnclave}`)),
        timestamp,
        provider: CacheTEEProvider.LOCAL,
        simulated: true,
      }
    }

    // dstack TEE simulator
    if (this.config.provider === CacheTEEProvider.DSTACK) {
      return this.getDstackAttestation()
    }

    // Real TEE attestation (Phala, TDX, SEV)
    const endpoint = this.config.endpoint
    if (!endpoint) {
      throw new CacheError(
        CacheErrorCode.ATTESTATION_FAILED,
        'TEE endpoint not configured',
      )
    }

    const response = await fetch(`${endpoint}/attestation/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { 'X-API-Key': this.config.apiKey } : {}),
      },
      body: JSON.stringify({
        nodeId: this.nodeId,
        service: 'cache',
      }),
    })

    if (!response.ok) {
      throw new CacheError(
        CacheErrorCode.ATTESTATION_FAILED,
        `TEE attestation failed: ${response.status} ${await response.text()}`,
      )
    }

    const data = TEEAttestationResponseSchema.parse(await response.json())

    return {
      quote: data.quote as Hex,
      mrEnclave: data.mr_enclave as Hex,
      mrSigner: data.mr_signer as Hex,
      reportData: data.report_data as Hex,
      timestamp: data.timestamp,
      provider: this.config.provider,
      simulated: false,
    }
  }

  /**
   * Get dstack TEE attestation
   */
  private async getDstackAttestation(): Promise<CacheTEEAttestation> {
    const endpoint = this.config.endpoint ?? 'http://localhost:8090'

    const response = await fetch(`${endpoint}/prover/tdx/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        report_data: toHex(toBytes(`cache:${this.nodeId}:${Date.now()}`)),
      }),
    }).catch(() => null)

    if (!response || !response.ok) {
      // Fallback to simulated if dstack not available
      console.log(
        '[TEE-Cache] dstack not available, using simulated attestation',
      )
      const timestamp = Date.now()
      const mrEnclave = keccak256(toBytes(`dstack:${this.nodeId}:${timestamp}`))

      return {
        quote: `0x${'00'.repeat(256)}` as Hex,
        mrEnclave,
        mrSigner: keccak256(toBytes('dstack-simulator')),
        reportData: keccak256(toBytes(`cache:${mrEnclave}`)),
        timestamp,
        provider: CacheTEEProvider.DSTACK,
        simulated: true,
      }
    }

    const data = TEEAttestationResponseSchema.parse(await response.json())

    return {
      quote: data.quote as Hex,
      mrEnclave: data.mr_enclave as Hex,
      mrSigner: data.mr_signer as Hex,
      reportData: data.report_data as Hex,
      timestamp: data.timestamp,
      provider: CacheTEEProvider.DSTACK,
      simulated: false,
    }
  }

  /**
   * Refresh attestation
   */
  private async refreshAttestation(): Promise<void> {
    this.attestation = await this.generateAttestation()
    console.log(`[TEE-Cache] Attestation refreshed for ${this.nodeId}`)
  }

  /**
   * Initialize encryption key
   */
  private async initializeEncryptionKey(): Promise<string> {
    // LOCAL/dstack mode - generate local key
    if (
      this.config.provider === CacheTEEProvider.LOCAL ||
      this.config.provider === CacheTEEProvider.DSTACK
    ) {
      const keyId = keccak256(
        toBytes(`cache-key:${this.nodeId}:${Date.now()}`),
      ).slice(2, 34)
      console.log(
        `[TEE-Cache] Generated simulated encryption key: ${keyId.slice(0, 8)}...`,
      )
      return keyId
    }

    // Real TEE - request key from key vault
    const endpoint = this.config.endpoint
    if (!endpoint) {
      throw new CacheError(
        CacheErrorCode.ATTESTATION_FAILED,
        'TEE endpoint not configured',
      )
    }

    const response = await fetch(`${endpoint}/keys/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { 'X-API-Key': this.config.apiKey } : {}),
      },
      body: JSON.stringify({
        nodeId: this.nodeId,
        purpose: 'cache-encryption',
        algorithm: 'aes-256-gcm',
      }),
    })

    if (!response.ok) {
      throw new CacheError(
        CacheErrorCode.ATTESTATION_FAILED,
        `Key creation failed: ${response.status}`,
      )
    }

    const result = z.object({ keyId: z.string() }).parse(await response.json())

    console.log(
      `[TEE-Cache] Created TEE encryption key: ${result.keyId.slice(0, 8)}...`,
    )
    return result.keyId
  }

  /**
   * Encrypt a value
   */
  private async encrypt(plaintext: string): Promise<string> {
    // LOCAL/dstack mode - use simple XOR simulation (NOT secure, for testing only)
    if (
      this.config.provider === CacheTEEProvider.LOCAL ||
      this.config.provider === CacheTEEProvider.DSTACK
    ) {
      // In simulation mode, we just base64 encode to simulate encryption
      // Real implementation would use actual AES-GCM
      const encoded = Buffer.from(plaintext).toString('base64')
      const entry: EncryptedEntry = {
        ciphertext: encoded,
        nonce: keccak256(toBytes(`nonce:${Date.now()}`)).slice(2, 26),
        tag: keccak256(toBytes(`tag:${encoded}`)).slice(2, 34),
        keyId: this.encryptionKeyId ?? '',
      }
      return JSON.stringify(entry)
    }

    // Real TEE encryption
    const endpoint = this.config.endpoint
    if (!endpoint || !this.encryptionKeyId) {
      throw new CacheError(
        CacheErrorCode.ATTESTATION_FAILED,
        'TEE endpoint or key not configured',
      )
    }

    const response = await fetch(`${endpoint}/crypto/encrypt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { 'X-API-Key': this.config.apiKey } : {}),
      },
      body: JSON.stringify({
        keyId: this.encryptionKeyId,
        plaintext: Buffer.from(plaintext).toString('base64'),
      }),
    })

    if (!response.ok) {
      throw new CacheError(
        CacheErrorCode.ATTESTATION_FAILED,
        `Encryption failed: ${response.status}`,
      )
    }

    const data = TEEEncryptResponseSchema.parse(await response.json())
    const entry: EncryptedEntry = {
      ciphertext: data.ciphertext,
      nonce: data.nonce,
      tag: data.tag,
      keyId: this.encryptionKeyId,
    }
    return JSON.stringify(entry)
  }

  /**
   * Decrypt a value
   */
  private async decrypt(encrypted: string): Promise<string> {
    let entry: EncryptedEntry
    try {
      entry = JSON.parse(encrypted) as EncryptedEntry
    } catch {
      // Not encrypted, return as-is
      return encrypted
    }

    // Validate it's an encrypted entry
    if (!entry.ciphertext || !entry.nonce || !entry.tag) {
      return encrypted
    }

    // LOCAL/dstack mode - decode from base64
    if (
      this.config.provider === CacheTEEProvider.LOCAL ||
      this.config.provider === CacheTEEProvider.DSTACK
    ) {
      return Buffer.from(entry.ciphertext, 'base64').toString('utf-8')
    }

    // Real TEE decryption
    const endpoint = this.config.endpoint
    if (!endpoint) {
      throw new CacheError(
        CacheErrorCode.ATTESTATION_FAILED,
        'TEE endpoint not configured',
      )
    }

    const response = await fetch(`${endpoint}/crypto/decrypt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { 'X-API-Key': this.config.apiKey } : {}),
      },
      body: JSON.stringify({
        keyId: entry.keyId,
        ciphertext: entry.ciphertext,
        nonce: entry.nonce,
        tag: entry.tag,
      }),
    })

    if (!response.ok) {
      throw new CacheError(
        CacheErrorCode.ATTESTATION_FAILED,
        `Decryption failed: ${response.status}`,
      )
    }

    const data = TEEDecryptResponseSchema.parse(await response.json())
    return Buffer.from(data.plaintext, 'base64').toString('utf-8')
  }

  private requireInit(): void {
    if (!this.initialized) {
      throw new CacheError(
        CacheErrorCode.NODE_UNAVAILABLE,
        'TEE cache provider not initialized',
      )
    }
  }
}

// Factory

export interface CreateTEECacheProviderConfig {
  provider?: CacheTEEProvider
  endpoint?: string
  apiKey?: string
  encryptionEnabled?: boolean
  attestationIntervalMs?: number
  maxMemoryMb?: number
  nodeId?: string
}

/**
 * Create a TEE cache provider
 *
 * For production: Requires TEE endpoint and API key
 * For testing: Use provider: 'local' or 'dstack'
 */
export function createTEECacheProvider(
  config: CreateTEECacheProviderConfig = {},
): TEECacheProvider {
  const provider = config.provider ?? CacheTEEProvider.LOCAL
  const nodeId = config.nodeId ?? `tee-cache-${Date.now()}`

  // LOCAL/dstack mode doesn't require endpoint
  if (
    provider === CacheTEEProvider.LOCAL ||
    provider === CacheTEEProvider.DSTACK
  ) {
    console.log(
      `[TEE-Cache] Creating provider in ${provider.toUpperCase()} mode`,
    )
    return new TEECacheProvider(
      {
        provider,
        endpoint:
          config.endpoint ??
          (provider === CacheTEEProvider.DSTACK
            ? 'http://localhost:8090'
            : undefined),
        encryptionEnabled: config.encryptionEnabled ?? true,
        attestationIntervalMs: config.attestationIntervalMs ?? 300000, // 5 minutes
        maxMemoryMb: config.maxMemoryMb ?? 256,
      },
      nodeId,
    )
  }

  // Production mode requires TEE credentials
  const endpoint = config.endpoint ?? process.env.TEE_CACHE_ENDPOINT
  const apiKey = config.apiKey ?? process.env.TEE_CACHE_API_KEY

  if (!endpoint) {
    throw new CacheError(
      CacheErrorCode.ATTESTATION_FAILED,
      'TEE endpoint required: set TEE_CACHE_ENDPOINT or pass endpoint',
    )
  }

  return new TEECacheProvider(
    {
      provider,
      endpoint,
      apiKey,
      encryptionEnabled: config.encryptionEnabled ?? true,
      attestationIntervalMs: config.attestationIntervalMs ?? 300000,
      maxMemoryMb: config.maxMemoryMb ?? 256,
    },
    nodeId,
  )
}
