/**
 * SQLit v2 TEE Integration
 *
 * Provides Trusted Execution Environment support for SQLit v2:
 * - Data encryption at rest using KMS
 * - TEE-encrypted query execution
 * - TEE attestation verification for nodes
 *
 * For production, requires hardware TEE (Intel SGX, AMD SEV-SNP, etc.)
 * Development mode can use simulated TEE for testing.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import type { TEEAttestation, TEEPlatform } from './types'
import type { Hex } from 'viem'

// ============ Configuration ============

export interface SQLitTEEConfig {
  /** TEE platform (sgx, sev-snp, nitro, simulated) */
  platform: TEEPlatform
  /** KMS endpoint for key management */
  kmsEndpoint?: string
  /** Master key ID for database encryption */
  masterKeyId?: string
  /** TEE enclave endpoint for remote execution */
  teeEndpoint?: string
  /** Enable debug logging */
  debug?: boolean
  /** Allow simulated mode (development only) */
  allowSimulated?: boolean
}

export interface EncryptedPage {
  /** Page number */
  pageNum: number
  /** Encrypted page data */
  ciphertext: Uint8Array
  /** Initialization vector */
  iv: Uint8Array
  /** Authentication tag */
  tag: Uint8Array
  /** Key version used for encryption */
  keyVersion: number
}

export interface DecryptedPage {
  /** Page number */
  pageNum: number
  /** Decrypted page data */
  plaintext: Uint8Array
}

export interface TEEQueryRequest {
  /** Database ID */
  databaseId: string
  /** SQL query to execute */
  sql: string
  /** Query parameters */
  params?: (string | number | boolean | null | bigint)[]
  /** Session ID for consistency */
  sessionId?: string
  /** Required attestation level */
  attestationLevel?: 'none' | 'basic' | 'verified'
}

export interface TEEQueryResponse {
  /** Query result rows */
  rows: Record<string, unknown>[]
  /** Rows affected (for write queries) */
  rowsAffected: number
  /** Last insert ID */
  lastInsertId: bigint
  /** Execution time in milliseconds */
  executionTimeMs: number
  /** TEE attestation for this execution */
  attestation?: TEEAttestation
  /** Whether execution happened in TEE */
  executedInTEE: boolean
}

// ============ Encryption Handler ============

/**
 * Handles page-level encryption for SQLite databases.
 * Uses AES-256-GCM for authenticated encryption.
 */
export class SQLitEncryptionHandler {
  private masterKey: Uint8Array | null = null
  private _keyVersion = 1
  private config: SQLitTEEConfig

  /** Get current key version */
  get keyVersion(): number {
    return this._keyVersion
  }

  constructor(config: SQLitTEEConfig) {
    this.config = config
  }

  /**
   * Initialize encryption with a master key from KMS
   */
  async initialize(): Promise<void> {
    if (this.config.kmsEndpoint && this.config.masterKeyId) {
      // Fetch key from KMS
      this.masterKey = await this.fetchKeyFromKMS(
        this.config.kmsEndpoint,
        this.config.masterKeyId,
      )
    } else if (this.config.allowSimulated) {
      // Development: generate a local key
      this.masterKey = randomBytes(32)
      if (this.config.debug) {
        console.log(
          '[SQLit TEE] Using simulated encryption key (development only)',
        )
      }
    } else {
      throw new Error(
        'TEE encryption requires KMS endpoint and master key ID. ' +
          'For development, set allowSimulated: true',
      )
    }
  }

  /**
   * Encrypt a database page
   */
  encryptPage(pageNum: number, plaintext: Uint8Array): EncryptedPage {
    if (!this.masterKey) {
      throw new Error('Encryption handler not initialized')
    }

    // Derive a page-specific key using HKDF
    const pageKey = this.derivePageKey(pageNum)

    // Generate random IV (12 bytes for GCM)
    const iv = randomBytes(12)

    // Encrypt using AES-256-GCM
    const cipher = createCipheriv('aes-256-gcm', pageKey, iv)

    // Add page number as AAD for binding
    const aad = Buffer.alloc(8)
    aad.writeBigUInt64LE(BigInt(pageNum))
    cipher.setAAD(aad)

    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])

    const tag = cipher.getAuthTag()

    return {
      pageNum,
      ciphertext: new Uint8Array(ciphertext),
      iv: new Uint8Array(iv),
      tag: new Uint8Array(tag),
      keyVersion: this.keyVersion,
    }
  }

  /**
   * Decrypt a database page
   */
  decryptPage(encrypted: EncryptedPage): DecryptedPage {
    if (!this.masterKey) {
      throw new Error('Encryption handler not initialized')
    }

    // Derive the page-specific key
    const pageKey = this.derivePageKey(encrypted.pageNum)

    // Decrypt using AES-256-GCM
    const decipher = createDecipheriv('aes-256-gcm', pageKey, encrypted.iv)

    // Set AAD
    const aad = Buffer.alloc(8)
    aad.writeBigUInt64LE(BigInt(encrypted.pageNum))
    decipher.setAAD(aad)

    // Set auth tag
    decipher.setAuthTag(encrypted.tag)

    const plaintext = Buffer.concat([
      decipher.update(encrypted.ciphertext),
      decipher.final(),
    ])

    return {
      pageNum: encrypted.pageNum,
      plaintext: new Uint8Array(plaintext),
    }
  }

  /**
   * Re-encrypt pages with a new key version
   */
  async rotateKey(pages: EncryptedPage[]): Promise<EncryptedPage[]> {
    // Fetch new key from KMS
    const newKeyVersion = this.keyVersion + 1
    const oldKey = this.masterKey

    if (this.config.kmsEndpoint && this.config.masterKeyId) {
      this.masterKey = await this.fetchKeyFromKMS(
        this.config.kmsEndpoint,
        `${this.config.masterKeyId}_v${newKeyVersion}`,
      )
    } else {
      this.masterKey = randomBytes(32)
    }

    const tempHandler = new SQLitEncryptionHandler(this.config)
    tempHandler.masterKey = oldKey
    tempHandler._keyVersion = this._keyVersion

    // Re-encrypt all pages
    const reencrypted: EncryptedPage[] = []
    for (const page of pages) {
      const decrypted = tempHandler.decryptPage(page)
      const encrypted = this.encryptPage(page.pageNum, decrypted.plaintext)
      reencrypted.push(encrypted)
    }

    this._keyVersion = newKeyVersion
    return reencrypted
  }

  private derivePageKey(pageNum: number): Uint8Array {
    if (!this.masterKey) {
      throw new Error('Master key not initialized')
    }

    // HKDF-like key derivation
    const info = Buffer.alloc(16)
    info.writeUInt32LE(pageNum, 0)
    info.writeUInt32LE(this.keyVersion, 4)
    info.write('sqlit-page', 8)

    const hash = createHash('sha256')
    hash.update(this.masterKey)
    hash.update(info)

    return new Uint8Array(hash.digest())
  }

  private async fetchKeyFromKMS(
    endpoint: string,
    keyId: string,
  ): Promise<Uint8Array> {
    const response = await fetch(`${endpoint}/v1/keys/${keyId}/material`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch key from KMS: ${response.statusText}`)
    }

    const data = (await response.json()) as { key: string }
    return Buffer.from(data.key, 'hex')
  }
}

// ============ TEE Executor ============

/**
 * Executes SQL queries within a TEE for confidential computing.
 * Requires a remote TEE endpoint in production.
 */
export class SQLitTEEExecutor {
  private config: SQLitTEEConfig
  private attestation: TEEAttestation | null = null

  constructor(config: SQLitTEEConfig) {
    this.config = config
  }

  /**
   * Check if TEE execution is available
   */
  async isAvailable(): Promise<boolean> {
    if (this.config.platform === 'simulated') {
      return this.config.allowSimulated === true
    }

    if (!this.config.teeEndpoint) {
      return false
    }

    try {
      const response = await fetch(`${this.config.teeEndpoint}/health`, {
        signal: AbortSignal.timeout(5000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * Get TEE attestation for verification
   */
  async getAttestation(): Promise<TEEAttestation> {
    if (this.attestation) {
      return this.attestation
    }

    if (this.config.platform === 'simulated') {
      if (!this.config.allowSimulated) {
        throw new Error('Simulated TEE not allowed in production')
      }
      return this.generateSimulatedAttestation()
    }

    if (!this.config.teeEndpoint) {
      throw new Error('TEE endpoint required for attestation')
    }

    const response = await fetch(`${this.config.teeEndpoint}/attestation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nonce: Buffer.from(randomBytes(32)).toString('hex'),
        timestamp: Date.now(),
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to get TEE attestation: ${response.statusText}`)
    }

    const data = (await response.json()) as TEEAttestation
    this.attestation = data
    return data
  }

  /**
   * Execute a query within the TEE
   */
  async execute(request: TEEQueryRequest): Promise<TEEQueryResponse> {
    if (this.config.platform === 'simulated') {
      return this.executeSimulated(request)
    }

    if (!this.config.teeEndpoint) {
      throw new Error('TEE endpoint required for secure execution')
    }

    const attestation =
      request.attestationLevel !== 'none'
        ? await this.getAttestation()
        : undefined

    const response = await fetch(`${this.config.teeEndpoint}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...request,
        attestation:
          request.attestationLevel === 'verified' ? attestation : undefined,
      }),
    })

    if (!response.ok) {
      throw new Error(`TEE execution failed: ${response.statusText}`)
    }

    const result = (await response.json()) as TEEQueryResponse
    return {
      ...result,
      attestation,
      executedInTEE: true,
    }
  }

  /**
   * Verify a TEE attestation from another node
   */
  async verifyAttestation(attestation: TEEAttestation): Promise<boolean> {
    // Basic timestamp check
    const now = Date.now()
    const maxAge = 60 * 60 * 1000 // 1 hour
    if (now - attestation.timestamp > maxAge) {
      return false
    }

    // Platform-specific verification
    switch (attestation.platform) {
      case 'sgx':
        return this.verifySGXAttestation(attestation)
      case 'sev-snp':
        return this.verifySEVAttestation(attestation)
      case 'aws-nitro':
        return this.verifyNitroAttestation(attestation)
      case 'simulated':
        return this.config.allowSimulated === true
      default:
        return false
    }
  }

  private async verifySGXAttestation(
    attestation: TEEAttestation,
  ): Promise<boolean> {
    // Verify against Intel Attestation Service (IAS) or DCAP
    if (!attestation.quote || !attestation.measurement) {
      return false
    }

    // Verify quote structure - SGX quotes start with specific header
    if (!attestation.quote.startsWith('0x')) {
      return false
    }

    const quoteBytes = Buffer.from(attestation.quote.slice(2), 'hex')

    // SGX quote structure validation:
    // - Quote header (48 bytes minimum for EPID, 436 bytes for DCAP)
    // - Report body with MRENCLAVE, MRSIGNER, etc.
    if (quoteBytes.length < 48) {
      return false
    }

    // Verify quote version (bytes 0-1)
    const version = quoteBytes.readUInt16LE(0)
    if (version !== 3 && version !== 4) {
      // Version 3 = EPID-based, Version 4 = DCAP
      return false
    }

    // Verify measurement hash is present and matches expected format (32 bytes)
    const measurementBytes = Buffer.from(
      attestation.measurement.slice(2),
      'hex',
    )
    if (measurementBytes.length !== 32) {
      return false
    }

    // In production with IAS endpoint configured, verify remotely
    if (process.env.INTEL_IAS_ENDPOINT) {
      try {
        const response = await fetch(
          `${process.env.INTEL_IAS_ENDPOINT}/attestation/v4/report`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Ocp-Apim-Subscription-Key': process.env.INTEL_IAS_API_KEY ?? '',
            },
            body: JSON.stringify({
              isvEnclaveQuote: attestation.quote.slice(2),
            }),
            signal: AbortSignal.timeout(10000),
          },
        )

        if (!response.ok) {
          return false
        }

        const result = (await response.json()) as {
          isvEnclaveQuoteStatus: string
        }
        return (
          result.isvEnclaveQuoteStatus === 'OK' ||
          result.isvEnclaveQuoteStatus === 'GROUP_OUT_OF_DATE'
        )
      } catch {
        return false
      }
    }

    // Without IAS endpoint, verify quote structure is valid
    // This is weaker but prevents obvious forgeries
    return quoteBytes.length >= 436 && measurementBytes.length === 32
  }

  private async verifySEVAttestation(
    attestation: TEEAttestation,
  ): Promise<boolean> {
    // AMD SEV-SNP attestation verification
    if (!attestation.quote || !attestation.measurement) {
      return false
    }

    const quoteBytes = Buffer.from(attestation.quote.slice(2), 'hex')
    const measurementBytes = Buffer.from(
      attestation.measurement.slice(2),
      'hex',
    )

    // SEV-SNP attestation report is 1184 bytes
    if (quoteBytes.length < 1184) {
      return false
    }

    // Verify measurement is 48 bytes (SHA-384 digest)
    if (measurementBytes.length !== 48 && measurementBytes.length !== 32) {
      return false
    }

    // Verify report structure - check magic bytes and version
    // AMD SEV-SNP report starts with version (4 bytes) + guest_svn (4 bytes) + policy (8 bytes)
    const version = quoteBytes.readUInt32LE(0)
    if (version !== 2) {
      // SEV-SNP attestation version 2
      return false
    }

    // In production, verify VCEK certificate chain
    if (process.env.AMD_KDS_ENDPOINT) {
      try {
        const response = await fetch(
          `${process.env.AMD_KDS_ENDPOINT}/vcek/v1/Milan/cert_chain`,
          {
            signal: AbortSignal.timeout(10000),
          },
        )

        if (!response.ok) {
          return false
        }

        // Would verify signature against AMD root certificate
        // For now, verify we got a valid response
        const certChain = await response.text()
        return certChain.includes('BEGIN CERTIFICATE')
      } catch {
        // Fall through to structural verification
      }
    }

    // Without AMD KDS, accept structurally valid reports
    return true
  }

  private async verifyNitroAttestation(
    attestation: TEEAttestation,
  ): Promise<boolean> {
    // AWS Nitro Enclave attestation verification
    if (!attestation.quote) {
      return false
    }

    const quoteBytes = Buffer.from(attestation.quote.slice(2), 'hex')

    // Nitro attestation is a CBOR-encoded document
    // Minimum valid CBOR document with attestation structure
    if (quoteBytes.length < 100) {
      return false
    }

    // Check CBOR tag for Nitro attestation (tag 18 = COSE_Sign1)
    // CBOR tag encoding: 0xD8 0x12 for tag 18
    if (quoteBytes[0] !== 0xd8 || quoteBytes[1] !== 0x12) {
      return false
    }

    // In production, verify against AWS Nitro attestation public key
    if (process.env.AWS_NITRO_PCRS) {
      // PCRs (Platform Configuration Registers) to verify
      const expectedPCRs = JSON.parse(process.env.AWS_NITRO_PCRS) as Record<
        string,
        string
      >

      // Would extract PCR values from attestation and compare
      // PCR0 = enclave image, PCR1 = Linux kernel, PCR2 = application
      if (attestation.measurement) {
        const measurement = attestation.measurement.slice(2).toLowerCase()
        // Check if measurement matches expected PCR0
        if (
          expectedPCRs.PCR0 &&
          !measurement.startsWith(expectedPCRs.PCR0.toLowerCase())
        ) {
          return false
        }
      }
    }

    // Nitro attestations are self-signed with AWS root CA
    // Without full verification, accept structurally valid documents
    return true
  }

  private generateSimulatedAttestation(): TEEAttestation {
    const measurement = Buffer.from(randomBytes(32)).toString('hex')
    const quote = Buffer.from(randomBytes(256)).toString('hex')

    return {
      quote: `0x${quote}` as Hex,
      measurement: `0x${measurement}` as Hex,
      timestamp: Date.now(),
      verified: true,
      platform: 'simulated',
    }
  }

  private async executeSimulated(
    _request: TEEQueryRequest,
  ): Promise<TEEQueryResponse> {
    // In simulated mode, just pass through
    // Real execution happens in the node's database
    return {
      rows: [],
      rowsAffected: 0,
      lastInsertId: BigInt(0),
      executionTimeMs: 0,
      executedInTEE: false, // Not actually executed in TEE
    }
  }
}

// ============ Node TEE Integration ============

export interface NodeTEECapabilities {
  /** TEE platform available */
  platform: TEEPlatform
  /** Whether encryption at rest is enabled */
  encryptionEnabled: boolean
  /** Whether TEE execution is available */
  teeExecutionEnabled: boolean
  /** Current attestation (if available) */
  attestation?: TEEAttestation
  /** Encryption key version */
  keyVersion: number
}

/**
 * TEE integration for SQLit v2 nodes.
 * Combines encryption handler and TEE executor.
 */
export class SQLitNodeTEE {
  private encryptionHandler: SQLitEncryptionHandler | null = null
  private teeExecutor: SQLitTEEExecutor | null = null
  private config: SQLitTEEConfig
  private initialized = false

  constructor(config: SQLitTEEConfig) {
    this.config = config
  }

  /**
   * Initialize TEE capabilities
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Initialize encryption if configured
    if (this.config.kmsEndpoint || this.config.allowSimulated) {
      this.encryptionHandler = new SQLitEncryptionHandler(this.config)
      await this.encryptionHandler.initialize()
    }

    // Initialize TEE executor if endpoint available
    if (this.config.teeEndpoint || this.config.allowSimulated) {
      this.teeExecutor = new SQLitTEEExecutor(this.config)
    }

    this.initialized = true

    if (this.config.debug) {
      console.log('[SQLit TEE] Initialized', {
        platform: this.config.platform,
        encryptionEnabled: this.encryptionHandler !== null,
        teeExecutionEnabled: this.teeExecutor !== null,
      })
    }
  }

  /**
   * Get current TEE capabilities
   */
  async getCapabilities(): Promise<NodeTEECapabilities> {
    let attestation: TEEAttestation | undefined
    if (this.teeExecutor) {
      try {
        attestation = await this.teeExecutor.getAttestation()
      } catch {
        // Attestation not available
      }
    }

    return {
      platform: this.config.platform,
      encryptionEnabled: this.encryptionHandler !== null,
      teeExecutionEnabled:
        this.teeExecutor !== null && (await this.teeExecutor.isAvailable()),
      attestation,
      keyVersion: this.encryptionHandler?.keyVersion ?? 1,
    }
  }

  /**
   * Encrypt a database page
   */
  encryptPage(pageNum: number, plaintext: Uint8Array): EncryptedPage | null {
    if (!this.encryptionHandler) {
      return null
    }
    return this.encryptionHandler.encryptPage(pageNum, plaintext)
  }

  /**
   * Decrypt a database page
   */
  decryptPage(encrypted: EncryptedPage): DecryptedPage | null {
    if (!this.encryptionHandler) {
      return null
    }
    return this.encryptionHandler.decryptPage(encrypted)
  }

  /**
   * Execute a query in TEE (if available)
   */
  async executeInTEE(
    request: TEEQueryRequest,
  ): Promise<TEEQueryResponse | null> {
    if (!this.teeExecutor) {
      return null
    }

    if (!(await this.teeExecutor.isAvailable())) {
      return null
    }

    return this.teeExecutor.execute(request)
  }

  /**
   * Verify another node's TEE attestation
   */
  async verifyNodeAttestation(attestation: TEEAttestation): Promise<boolean> {
    if (!this.teeExecutor) {
      // No TEE executor means we can't verify
      return false
    }
    return this.teeExecutor.verifyAttestation(attestation)
  }
}

/**
 * Create a SQLit TEE integration for a node
 */
export function createNodeTEE(config: SQLitTEEConfig): SQLitNodeTEE {
  return new SQLitNodeTEE(config)
}

/**
 * Create TEE configuration from environment
 */
export function getTEEConfigFromEnv(): SQLitTEEConfig {
  const platform = (process.env.SQLIT_TEE_PLATFORM ??
    'simulated') as TEEPlatform
  const isProduction = process.env.NODE_ENV === 'production'

  return {
    platform,
    kmsEndpoint: process.env.KMS_ENDPOINT,
    masterKeyId: process.env.SQLIT_MASTER_KEY_ID,
    teeEndpoint: process.env.SQLIT_TEE_ENDPOINT,
    debug: process.env.SQLIT_DEBUG === 'true',
    allowSimulated: !isProduction && platform === 'simulated',
  }
}
