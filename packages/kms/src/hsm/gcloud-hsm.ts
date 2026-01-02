/**
 * Google Cloud HSM Provider
 *
 * Provides HSM-backed key operations using Google Cloud Key Management Service
 * with HSM protection level (FIPS 140-2 Level 3).
 *
 * Prerequisites:
 * - GCP project with Cloud KMS enabled
 * - Service account with Cloud KMS Admin/Crypto roles
 * - Key ring and keys created with HSM protection level
 *
 * Environment Variables:
 * - GOOGLE_CLOUD_PROJECT: GCP project ID
 * - GOOGLE_CLOUD_KEYRING: KMS key ring name
 * - GOOGLE_CLOUD_LOCATION: Region (e.g., us-east1)
 * - GOOGLE_APPLICATION_CREDENTIALS: Path to service account JSON
 */

import type { Hex } from 'viem'
import { toHex } from 'viem'
import { kmsLogger as log } from '../logger.js'
import type {
  HSMConfig,
  HSMEncryptResult,
  HSMKeyRef,
  HSMProvider,
  HSMSignResult,
} from './index.js'

// GCloud KMS API
const KMS_API_BASE = 'https://cloudkms.googleapis.com/v1'

interface GCloudCryptoKey {
  name: string
  purpose: string
  versionTemplate: {
    protectionLevel: string
    algorithm: string
  }
  createTime: string
  labels?: Record<string, string>
  primary?: {
    name: string
    state: string
    createTime: string
    protectionLevel: string
    algorithm: string
  }
}

interface GCloudCryptoKeyVersion {
  name: string
  state: string
  createTime: string
  protectionLevel: string
  algorithm: string
}

/**
 * Google Cloud HSM Provider
 */
export class GCloudHSMProvider implements HSMProvider {
  private readonly config: HSMConfig
  private projectId: string
  private location: string
  private keyRing: string
  private accessToken: string | null = null
  private tokenExpiry: number = 0
  private keyCache = new Map<string, HSMKeyRef>()
  private connected = false

  constructor(config: HSMConfig) {
    this.config = config

    this.projectId = process.env.GOOGLE_CLOUD_PROJECT ?? ''
    this.location = process.env.GOOGLE_CLOUD_LOCATION ?? 'us-east1'
    this.keyRing = process.env.GOOGLE_CLOUD_KEYRING ?? 'jeju-keyring'

    if (!this.projectId) {
      throw new Error('GCP project ID is required. Set GOOGLE_CLOUD_PROJECT')
    }
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return
    }

    try {
      await this.getAccessToken()

      // Ensure key ring exists
      await this.ensureKeyRing()

      this.connected = true
      log.info('Google Cloud HSM connected', {
        project: this.projectId,
        location: this.location,
        keyRing: this.keyRing,
      })
    } catch (error) {
      log.error('GCloud HSM connection failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      throw new Error(
        `GCloud HSM connection failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async disconnect(): Promise<void> {
    this.accessToken = null
    this.tokenExpiry = 0
    this.keyCache.clear()
    this.connected = false
    log.info('Google Cloud HSM disconnected')
  }

  async isAvailable(): Promise<boolean> {
    return this.connected
  }

  async generateKey(
    label: string,
    type: HSMKeyRef['type'],
    extractable = false,
  ): Promise<HSMKeyRef> {
    this.ensureConnected()
    await this.ensureValidToken()

    const keyId = `jeju-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    let purpose: string
    let algorithm: string

    switch (type) {
      case 'aes-256':
        purpose = 'ENCRYPT_DECRYPT'
        algorithm = 'GOOGLE_SYMMETRIC_ENCRYPTION'
        break
      case 'ec-secp256k1':
        purpose = 'ASYMMETRIC_SIGN'
        algorithm = 'EC_SIGN_SECP256K1_SHA256'
        break
      case 'ec-ed25519':
        // GCloud doesn't support Ed25519 directly, use P-256 as fallback
        purpose = 'ASYMMETRIC_SIGN'
        algorithm = 'EC_SIGN_P256_SHA256'
        log.warn('Ed25519 not supported in GCloud KMS, using P-256')
        break
      case 'rsa-2048':
        purpose = 'ASYMMETRIC_SIGN'
        algorithm = 'RSA_SIGN_PSS_2048_SHA256'
        break
      default:
        throw new Error(`Unknown key type: ${type}`)
    }

    const keyRingPath = this.getKeyRingPath()
    const url = `${KMS_API_BASE}/${keyRingPath}/cryptoKeys?cryptoKeyId=${keyId}`

    const body = {
      purpose,
      versionTemplate: {
        protectionLevel: 'HSM',
        algorithm,
      },
      labels: {
        label: label.replace(/[^a-z0-9_-]/gi, '_').toLowerCase(),
        type,
        created_by: 'jeju-kms',
        extractable: String(extractable),
      },
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to create key: ${error}`)
    }

    const keyData = (await response.json()) as GCloudCryptoKey

    const ref: HSMKeyRef = {
      keyId,
      label,
      type,
      extractable,
      usage:
        type === 'aes-256'
          ? ['encrypt', 'decrypt', 'derive']
          : ['sign', 'verify'],
      createdAt: new Date(keyData.createTime).getTime(),
    }

    this.keyCache.set(keyId, ref)
    log.info('GCloud HSM key generated', { keyId, label, type })

    return ref
  }

  async getKey(keyId: string): Promise<HSMKeyRef | null> {
    this.ensureConnected()
    await this.ensureValidToken()

    // Check cache first
    const cached = this.keyCache.get(keyId)
    if (cached) {
      return cached
    }

    try {
      const keyPath = `${this.getKeyRingPath()}/cryptoKeys/${keyId}`
      const response = await fetch(`${KMS_API_BASE}/${keyPath}`, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      })

      if (!response.ok) {
        if (response.status === 404) {
          return null
        }
        throw new Error(`Failed to get key: ${await response.text()}`)
      }

      const keyData = (await response.json()) as GCloudCryptoKey
      const labels = keyData.labels ?? {}

      const ref: HSMKeyRef = {
        keyId,
        label: labels.label ?? keyId,
        type: this.mapGCloudKeyType(keyData.versionTemplate.algorithm),
        extractable: labels.extractable === 'true',
        usage: this.mapKeyPurpose(keyData.purpose),
        createdAt: new Date(keyData.createTime).getTime(),
      }

      this.keyCache.set(keyId, ref)
      return ref
    } catch (error) {
      log.error('Failed to get GCloud HSM key', {
        keyId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  async listKeys(): Promise<HSMKeyRef[]> {
    this.ensureConnected()
    await this.ensureValidToken()

    const keys: HSMKeyRef[] = []
    let pageToken: string | null = null

    do {
      const keyRingPath = this.getKeyRingPath()
      let url = `${KMS_API_BASE}/${keyRingPath}/cryptoKeys`
      if (pageToken) {
        url += `?pageToken=${pageToken}`
      }

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to list keys: ${await response.text()}`)
      }

      const data = (await response.json()) as {
        cryptoKeys?: GCloudCryptoKey[]
        nextPageToken?: string
      }

      for (const keyData of data.cryptoKeys ?? []) {
        const keyId = keyData.name.split('/').pop()
        if (keyId?.startsWith('jeju-')) {
          const labels = keyData.labels ?? {}
          keys.push({
            keyId,
            label: labels.label ?? keyId,
            type: this.mapGCloudKeyType(keyData.versionTemplate.algorithm),
            extractable: labels.extractable === 'true',
            usage: this.mapKeyPurpose(keyData.purpose),
            createdAt: new Date(keyData.createTime).getTime(),
          })
        }
      }

      pageToken = data.nextPageToken ?? null
    } while (pageToken)

    return keys
  }

  async deleteKey(keyId: string): Promise<void> {
    this.ensureConnected()
    await this.ensureValidToken()

    // GCloud KMS doesn't delete keys, it destroys versions
    // First, list all versions and schedule them for destruction
    const keyPath = `${this.getKeyRingPath()}/cryptoKeys/${keyId}`

    const versionsResponse = await fetch(
      `${KMS_API_BASE}/${keyPath}/cryptoKeyVersions`,
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      },
    )

    if (!versionsResponse.ok) {
      if (versionsResponse.status === 404) {
        this.keyCache.delete(keyId)
        return
      }
      throw new Error(
        `Failed to list key versions: ${await versionsResponse.text()}`,
      )
    }

    const versionsData = (await versionsResponse.json()) as {
      cryptoKeyVersions?: GCloudCryptoKeyVersion[]
    }

    for (const version of versionsData.cryptoKeyVersions ?? []) {
      if (version.state === 'ENABLED' || version.state === 'DISABLED') {
        await fetch(`${KMS_API_BASE}/${version.name}:destroy`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
        })
      }
    }

    this.keyCache.delete(keyId)
    log.info('GCloud HSM key scheduled for destruction', { keyId })
  }

  async encrypt(
    keyId: string,
    plaintext: Uint8Array,
  ): Promise<HSMEncryptResult> {
    this.ensureConnected()
    await this.ensureValidToken()

    const keyPath = `${this.getKeyRingPath()}/cryptoKeys/${keyId}`
    const url = `${KMS_API_BASE}/${keyPath}:encrypt`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plaintext: this.arrayToBase64(plaintext),
      }),
    })

    if (!response.ok) {
      throw new Error(`Encryption failed: ${await response.text()}`)
    }

    const result = (await response.json()) as { ciphertext: string }

    // GCloud symmetric encryption includes the IV in the ciphertext
    // We extract first 12 bytes as IV convention
    const ciphertextFull = this.base64ToArray(result.ciphertext)
    const iv = ciphertextFull.slice(0, 12)
    const ciphertext = ciphertextFull.slice(12)

    return {
      ciphertext,
      iv,
      keyId,
    }
  }

  async decrypt(
    keyId: string,
    ciphertext: Uint8Array,
    iv: Uint8Array,
  ): Promise<Uint8Array> {
    this.ensureConnected()
    await this.ensureValidToken()

    // Reconstruct the full ciphertext with IV
    const fullCiphertext = new Uint8Array([...iv, ...ciphertext])

    const keyPath = `${this.getKeyRingPath()}/cryptoKeys/${keyId}`
    const url = `${KMS_API_BASE}/${keyPath}:decrypt`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ciphertext: this.arrayToBase64(fullCiphertext),
      }),
    })

    if (!response.ok) {
      throw new Error(`Decryption failed: ${await response.text()}`)
    }

    const result = (await response.json()) as { plaintext: string }
    return this.base64ToArray(result.plaintext)
  }

  async sign(keyId: string, data: Uint8Array): Promise<HSMSignResult> {
    this.ensureConnected()
    await this.ensureValidToken()

    // GCloud KMS expects the digest, not raw data
    const hash = await crypto.subtle.digest(
      'SHA-256',
      data.buffer as ArrayBuffer,
    )
    const hashBytes = new Uint8Array(hash)

    // Get the primary version
    const keyPath = `${this.getKeyRingPath()}/cryptoKeys/${keyId}/cryptoKeyVersions/1`
    const url = `${KMS_API_BASE}/${keyPath}:asymmetricSign`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        digest: {
          sha256: this.arrayToBase64(hashBytes),
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`Signing failed: ${await response.text()}`)
    }

    const result = (await response.json()) as { signature: string }
    const signatureBytes = this.base64ToArray(result.signature)

    return {
      signature: toHex(signatureBytes),
      keyId,
    }
  }

  async verify(
    keyId: string,
    data: Uint8Array,
    signature: Hex,
  ): Promise<boolean> {
    this.ensureConnected()
    await this.ensureValidToken()

    const hash = await crypto.subtle.digest(
      'SHA-256',
      data.buffer as ArrayBuffer,
    )
    const hashBytes = new Uint8Array(hash)
    const signatureBytes = this.hexToBytes(signature)

    const keyPath = `${this.getKeyRingPath()}/cryptoKeys/${keyId}/cryptoKeyVersions/1`
    const url = `${KMS_API_BASE}/${keyPath}:asymmetricVerify`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        digest: {
          sha256: this.arrayToBase64(hashBytes),
        },
        signature: this.arrayToBase64(signatureBytes),
      }),
    })

    if (!response.ok) {
      log.error('Verification request failed', { error: await response.text() })
      return false
    }

    const result = (await response.json()) as { success: boolean }
    return result.success
  }

  async deriveKey(
    masterKeyId: string,
    salt: Uint8Array,
    info: string,
    outputLength: number,
  ): Promise<Uint8Array> {
    this.ensureConnected()
    await this.ensureValidToken()

    // GCloud KMS doesn't support HKDF directly
    // We use encryption as a PRF-based KDF
    const infoBytes = new TextEncoder().encode(info)
    const input = new Uint8Array([...salt, ...infoBytes])

    // Encrypt the input to get deterministic derived material
    const encrypted = await this.encrypt(masterKeyId, input)

    // Hash the ciphertext to get desired output length
    const ciphertextBytes =
      typeof encrypted.ciphertext === 'string'
        ? new TextEncoder().encode(encrypted.ciphertext)
        : encrypted.ciphertext
    const hash = await crypto.subtle.digest(
      'SHA-256',
      ciphertextBytes.buffer as ArrayBuffer,
    )

    if (outputLength <= 32) {
      return new Uint8Array(hash).slice(0, outputLength)
    }

    // Chain hashes for longer output
    const output = new Uint8Array(outputLength)
    let offset = 0
    let counter = 0

    while (offset < outputLength) {
      const counterBytes = new Uint8Array(4)
      new DataView(counterBytes.buffer).setUint32(0, counter, false)

      const combined = new Uint8Array([
        ...new Uint8Array(hash),
        ...counterBytes,
      ])
      const block = await crypto.subtle.digest(
        'SHA-256',
        combined.buffer as ArrayBuffer,
      )

      const blockArray = new Uint8Array(block)
      const remaining = outputLength - offset
      const toCopy = Math.min(32, remaining)
      output.set(blockArray.slice(0, toCopy), offset)

      offset += toCopy
      counter++
    }

    return output
  }

  // ============ Private Methods ============

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('GCloud HSM not connected')
    }
  }

  private getKeyRingPath(): string {
    return `projects/${this.projectId}/locations/${this.location}/keyRings/${this.keyRing}`
  }

  private async getAccessToken(): Promise<void> {
    // Try to get token from metadata server (for GCE/Cloud Run)
    try {
      const metadataResponse = await fetch(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        {
          headers: {
            'Metadata-Flavor': 'Google',
          },
        },
      )

      if (metadataResponse.ok) {
        const data = (await metadataResponse.json()) as {
          access_token: string
          expires_in: number
        }
        this.accessToken = data.access_token
        this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
        return
      }
    } catch {
      // Not on GCP, try service account
    }

    // Try service account credentials
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    if (!credentialsPath) {
      throw new Error(
        'GCP credentials required. Set GOOGLE_APPLICATION_CREDENTIALS or run on GCP',
      )
    }

    // Load service account and generate JWT
    const credentials = await this.loadServiceAccount(credentialsPath)
    const token = await this.getServiceAccountToken(credentials)

    this.accessToken = token.access_token
    this.tokenExpiry = Date.now() + (token.expires_in - 60) * 1000
  }

  private async loadServiceAccount(path: string): Promise<{
    client_email: string
    private_key: string
  }> {
    const file = Bun.file(path)
    const content = await file.text()
    return JSON.parse(content) as { client_email: string; private_key: string }
  }

  private async getServiceAccountToken(credentials: {
    client_email: string
    private_key: string
  }): Promise<{ access_token: string; expires_in: number }> {
    const now = Math.floor(Date.now() / 1000)
    const header = { alg: 'RS256', typ: 'JWT' }
    const payload = {
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/cloudkms',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }

    const headerB64 = this.arrayToBase64Url(
      new TextEncoder().encode(JSON.stringify(header)),
    )
    const payloadB64 = this.arrayToBase64Url(
      new TextEncoder().encode(JSON.stringify(payload)),
    )
    const toSign = `${headerB64}.${payloadB64}`

    // Sign with service account private key
    const keyData = credentials.private_key
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace(/\n/g, '')

    const keyBytes = this.base64ToArray(keyData)
    const key = await crypto.subtle.importKey(
      'pkcs8',
      keyBytes.buffer as ArrayBuffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    )

    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      new TextEncoder().encode(toSign),
    )

    const signatureB64 = this.arrayToBase64Url(new Uint8Array(signature))
    const jwt = `${toSign}.${signatureB64}`

    // Exchange JWT for access token
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    })

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${await response.text()}`)
    }

    return response.json() as Promise<{
      access_token: string
      expires_in: number
    }>
  }

  private async ensureValidToken(): Promise<void> {
    if (!this.accessToken || Date.now() >= this.tokenExpiry) {
      await this.getAccessToken()
    }
  }

  private async ensureKeyRing(): Promise<void> {
    const keyRingPath = this.getKeyRingPath()

    // Check if key ring exists
    const checkResponse = await fetch(`${KMS_API_BASE}/${keyRingPath}`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    })

    if (checkResponse.ok) {
      return // Key ring exists
    }

    if (checkResponse.status !== 404) {
      throw new Error(`Failed to check key ring: ${await checkResponse.text()}`)
    }

    // Create key ring
    const parentPath = `projects/${this.projectId}/locations/${this.location}`
    const createResponse = await fetch(
      `${KMS_API_BASE}/${parentPath}/keyRings?keyRingId=${this.keyRing}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    )

    if (!createResponse.ok) {
      throw new Error(
        `Failed to create key ring: ${await createResponse.text()}`,
      )
    }

    log.info('Created GCloud KMS key ring', { keyRing: this.keyRing })
  }

  private mapGCloudKeyType(algorithm: string): HSMKeyRef['type'] {
    if (algorithm.includes('SYMMETRIC')) {
      return 'aes-256'
    }
    if (algorithm.includes('SECP256K1')) {
      return 'ec-secp256k1'
    }
    if (algorithm.includes('P256') || algorithm.includes('P384')) {
      return 'ec-secp256k1' // Map to closest
    }
    if (algorithm.includes('RSA')) {
      return 'rsa-2048'
    }
    return 'aes-256'
  }

  private mapKeyPurpose(purpose: string): HSMKeyRef['usage'] {
    switch (purpose) {
      case 'ENCRYPT_DECRYPT':
        return ['encrypt', 'decrypt', 'derive']
      case 'ASYMMETRIC_SIGN':
        return ['sign', 'verify']
      case 'ASYMMETRIC_DECRYPT':
        return ['decrypt']
      default:
        return ['encrypt', 'decrypt']
    }
  }

  private arrayToBase64(data: Uint8Array): string {
    return btoa(String.fromCharCode(...data))
  }

  private arrayToBase64Url(data: Uint8Array): string {
    return this.arrayToBase64(data)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
  }

  private base64ToArray(base64: string): Uint8Array {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }

  private hexToBytes(hex: Hex): Uint8Array {
    const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
    const bytes = new Uint8Array(cleanHex.length / 2)
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16)
    }
    return bytes
  }
}
