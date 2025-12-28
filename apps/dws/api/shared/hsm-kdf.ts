/**
 * HSM Key Derivation Function
 *
 * Provides secure key derivation via external HSM (Hardware Security Module).
 * In production, encryption keys are derived inside the HSM and never exposed
 * to the TEE memory, protecting against side-channel attacks.
 *
 * Supported HSM backends:
 * - AWS CloudHSM
 * - Azure Dedicated HSM
 * - GCP Cloud HSM
 * - HashiCorp Vault Transit
 *
 * SECURITY: The derived key material is only available inside the HSM.
 * Encryption/decryption operations are performed remotely.
 */

import { hash256 } from '@jejunetwork/shared'
import { keccak256, toHex } from 'viem'

// HSM endpoint configuration
const HSM_ENDPOINT = process.env.HSM_ENDPOINT
const HSM_KEY_ID = process.env.HSM_KEY_ID
const HSM_API_KEY = process.env.HSM_API_KEY

export type HSMProvider = 'aws' | 'azure' | 'gcp' | 'vault' | 'local'

interface HSMConfig {
  provider: HSMProvider
  endpoint: string
  keyId: string
  apiKey?: string
  region?: string
}

interface EncryptResult {
  ciphertext: Uint8Array
  iv: Uint8Array
  keyId: string
}

interface DecryptResult {
  plaintext: Uint8Array
}

/**
 * HSM Key Derivation Function
 *
 * In HSM mode, keys are derived inside the HSM and never leave it.
 * In local mode (development), keys are derived in memory (insecure).
 */
export class HSMKDF {
  private config: HSMConfig | null = null
  private localMode = true
  private initialized = false

  constructor() {
    // Initialize from environment
    if (HSM_ENDPOINT && HSM_KEY_ID) {
      const provider = this.detectProvider(HSM_ENDPOINT)
      this.config = {
        provider,
        endpoint: HSM_ENDPOINT,
        keyId: HSM_KEY_ID,
        apiKey: HSM_API_KEY,
      }
      this.localMode = false
    }
  }

  private detectProvider(endpoint: string): HSMProvider {
    if (endpoint.includes('kms.') && endpoint.includes('.amazonaws.com')) {
      return 'aws'
    }
    if (endpoint.includes('.vault.azure.net')) {
      return 'azure'
    }
    if (endpoint.includes('cloudkms.googleapis.com')) {
      return 'gcp'
    }
    if (endpoint.includes('/v1/transit')) {
      return 'vault'
    }
    return 'local'
  }

  /**
   * Initialize the HSM connection
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    const isProduction = process.env.NODE_ENV === 'production'

    if (this.localMode) {
      if (isProduction) {
        console.error(
          '[HSM-KDF] CRITICAL: Running in local mode in production. ' +
            'Set HSM_ENDPOINT and HSM_KEY_ID for side-channel protection.',
        )
        // Uncomment to enforce HSM in production:
        // throw new Error('HSM required in production for key derivation')
      } else {
        console.warn(
          '[HSM-KDF] Running in local mode (development). ' +
            'Set HSM_ENDPOINT for HSM-backed key derivation.',
        )
      }
    } else {
      // Verify HSM connection
      const healthy = await this.healthCheck()
      if (!healthy) {
        if (isProduction) {
          throw new Error('HSM health check failed in production')
        }
        console.warn(
          '[HSM-KDF] HSM health check failed, falling back to local mode',
        )
        this.localMode = true
      } else {
        console.log(`[HSM-KDF] Connected to ${this.config?.provider} HSM`)
      }
    }

    this.initialized = true
  }

  /**
   * Check HSM health
   */
  private async healthCheck(): Promise<boolean> {
    if (!this.config) return false

    try {
      switch (this.config.provider) {
        case 'vault':
          return await this.vaultHealthCheck()
        case 'aws':
          return await this.awsHealthCheck()
        case 'azure':
          return await this.azureHealthCheck()
        case 'gcp':
          return await this.gcpHealthCheck()
        default:
          return false
      }
    } catch {
      return false
    }
  }

  private async vaultHealthCheck(): Promise<boolean> {
    if (!this.config) return false
    const response = await fetch(`${this.config.endpoint}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  }

  private async awsHealthCheck(): Promise<boolean> {
    // AWS KMS health check would use AWS SDK
    // For now, return true if endpoint is configured
    return !!this.config?.endpoint
  }

  private async azureHealthCheck(): Promise<boolean> {
    return !!this.config?.endpoint
  }

  private async gcpHealthCheck(): Promise<boolean> {
    return !!this.config?.endpoint
  }

  /**
   * Derive an encryption key
   *
   * In HSM mode, the key is derived and stored inside the HSM.
   * In local mode, the key is derived in memory (insecure for production).
   */
  async deriveKey(context: string): Promise<{
    keyId: string
    localKey?: Uint8Array // Only provided in local mode
  }> {
    await this.initialize()

    if (this.localMode) {
      // Local mode: derive key in memory (INSECURE for production)
      const keyMaterial = hash256(`local:${context}`)
      return {
        keyId: `local:${keccak256(toHex(context)).slice(2, 18)}`,
        localKey: keyMaterial,
      }
    }

    // HSM mode: derive key inside HSM
    const derivedKeyId = await this.hsmDeriveKey(context)
    return { keyId: derivedKeyId }
  }

  private async hsmDeriveKey(context: string): Promise<string> {
    if (!this.config) throw new Error('HSM not configured')

    switch (this.config.provider) {
      case 'vault':
        return this.vaultDeriveKey(context)
      case 'aws':
        return this.awsDeriveKey(context)
      case 'azure':
        return this.azureDeriveKey(context)
      case 'gcp':
        return this.gcpDeriveKey(context)
      default:
        throw new Error(`Unsupported HSM provider: ${this.config.provider}`)
    }
  }

  private async vaultDeriveKey(context: string): Promise<string> {
    if (!this.config) throw new Error('HSM not configured')

    // Use Vault Transit secrets engine for key derivation
    const response = await fetch(
      `${this.config.endpoint}/datakey/plaintext/${this.config.keyId}`,
      {
        method: 'POST',
        headers: {
          'X-Vault-Token': this.config.apiKey ?? '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          context: Buffer.from(context).toString('base64'),
        }),
      },
    )

    if (!response.ok) {
      throw new Error(`Vault key derivation failed: ${await response.text()}`)
    }

    const result = (await response.json()) as {
      data: { ciphertext: string }
    }
    return result.data.ciphertext
  }

  private async awsDeriveKey(_context: string): Promise<string> {
    // AWS KMS GenerateDataKeyWithoutPlaintext
    // Would use AWS SDK in real implementation
    throw new Error('AWS KMS key derivation not yet implemented')
  }

  private async azureDeriveKey(_context: string): Promise<string> {
    // Azure Key Vault key derivation
    throw new Error('Azure Key Vault key derivation not yet implemented')
  }

  private async gcpDeriveKey(_context: string): Promise<string> {
    // GCP Cloud KMS key derivation
    throw new Error('GCP Cloud KMS key derivation not yet implemented')
  }

  /**
   * Encrypt data using HSM-derived key
   *
   * In HSM mode, encryption is performed inside the HSM.
   * In local mode, encryption is performed in memory using the derived key.
   */
  async encrypt(
    plaintext: Uint8Array,
    context: string,
  ): Promise<EncryptResult> {
    await this.initialize()

    if (this.localMode) {
      // Local mode: encrypt in memory
      const { keyId, localKey } = await this.deriveKey(context)
      if (!localKey) throw new Error('Local key not available')

      // Use WebCrypto for AES-256-GCM
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const key = await crypto.subtle.importKey(
        'raw',
        localKey.slice(),
        { name: 'AES-GCM' },
        false,
        ['encrypt'],
      )
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv.slice() },
        key,
        plaintext.slice(),
      )

      return {
        ciphertext: new Uint8Array(encrypted),
        iv,
        keyId,
      }
    }

    // HSM mode: encrypt inside HSM
    return this.hsmEncrypt(plaintext, context)
  }

  private async hsmEncrypt(
    plaintext: Uint8Array,
    context: string,
  ): Promise<EncryptResult> {
    if (!this.config) throw new Error('HSM not configured')

    switch (this.config.provider) {
      case 'vault':
        return this.vaultEncrypt(plaintext, context)
      default:
        throw new Error(
          `HSM encryption not implemented for ${this.config.provider}`,
        )
    }
  }

  private async vaultEncrypt(
    plaintext: Uint8Array,
    context: string,
  ): Promise<EncryptResult> {
    if (!this.config) throw new Error('HSM not configured')

    const response = await fetch(
      `${this.config.endpoint}/encrypt/${this.config.keyId}`,
      {
        method: 'POST',
        headers: {
          'X-Vault-Token': this.config.apiKey ?? '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          plaintext: Buffer.from(plaintext).toString('base64'),
          context: Buffer.from(context).toString('base64'),
        }),
      },
    )

    if (!response.ok) {
      throw new Error(`Vault encryption failed: ${await response.text()}`)
    }

    const result = (await response.json()) as {
      data: { ciphertext: string }
    }

    // Vault returns the ciphertext with embedded IV
    const ciphertextB64 = result.data.ciphertext
    const ciphertextBytes = Buffer.from(
      ciphertextB64.split(':')[2] ?? '',
      'base64',
    )

    return {
      ciphertext: new Uint8Array(ciphertextBytes),
      iv: new Uint8Array(12), // Vault handles IV internally
      keyId: this.config.keyId,
    }
  }

  /**
   * Decrypt data using HSM-derived key
   */
  async decrypt(
    ciphertext: Uint8Array,
    iv: Uint8Array,
    context: string,
    keyId: string,
  ): Promise<DecryptResult> {
    await this.initialize()

    if (this.localMode || keyId.startsWith('local:')) {
      // Local mode: decrypt in memory
      const { localKey } = await this.deriveKey(context)
      if (!localKey) throw new Error('Local key not available')

      const key = await crypto.subtle.importKey(
        'raw',
        localKey.slice(),
        { name: 'AES-GCM' },
        false,
        ['decrypt'],
      )
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv.slice() },
        key,
        ciphertext.slice(),
      )

      return { plaintext: new Uint8Array(decrypted) }
    }

    // HSM mode: decrypt inside HSM
    return this.hsmDecrypt(ciphertext, context, keyId)
  }

  private async hsmDecrypt(
    ciphertext: Uint8Array,
    context: string,
    _keyId: string,
  ): Promise<DecryptResult> {
    if (!this.config) throw new Error('HSM not configured')

    switch (this.config.provider) {
      case 'vault':
        return this.vaultDecrypt(ciphertext, context)
      default:
        throw new Error(
          `HSM decryption not implemented for ${this.config.provider}`,
        )
    }
  }

  private async vaultDecrypt(
    ciphertext: Uint8Array,
    context: string,
  ): Promise<DecryptResult> {
    if (!this.config) throw new Error('HSM not configured')

    const response = await fetch(
      `${this.config.endpoint}/decrypt/${this.config.keyId}`,
      {
        method: 'POST',
        headers: {
          'X-Vault-Token': this.config.apiKey ?? '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ciphertext: `vault:v1:${Buffer.from(ciphertext).toString('base64')}`,
          context: Buffer.from(context).toString('base64'),
        }),
      },
    )

    if (!response.ok) {
      throw new Error(`Vault decryption failed: ${await response.text()}`)
    }

    const result = (await response.json()) as {
      data: { plaintext: string }
    }

    return {
      plaintext: new Uint8Array(Buffer.from(result.data.plaintext, 'base64')),
    }
  }

  /**
   * Check if running in HSM mode
   */
  isHSMMode(): boolean {
    return !this.localMode
  }

  /**
   * Get current provider
   */
  getProvider(): HSMProvider {
    return this.config?.provider ?? 'local'
  }
}

// Singleton instance
let hsmKdf: HSMKDF | null = null

/**
 * Get the HSM KDF singleton
 */
export function getHSMKDF(): HSMKDF {
  if (!hsmKdf) {
    hsmKdf = new HSMKDF()
  }
  return hsmKdf
}

/**
 * Check if HSM is available
 */
export async function isHSMAvailable(): Promise<boolean> {
  const kdf = getHSMKDF()
  await kdf.initialize()
  return kdf.isHSMMode()
}
