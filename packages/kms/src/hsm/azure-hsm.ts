/**
 * Azure Dedicated HSM / Azure Key Vault Managed HSM Provider
 *
 * Provides HSM-backed key operations using Azure's HSM services.
 * Supports both:
 * - Azure Dedicated HSM (Thales Luna Network HSM)
 * - Azure Key Vault Managed HSM (FIPS 140-2 Level 3)
 *
 * Prerequisites:
 * - Azure subscription with HSM resource provisioned
 * - Service principal or managed identity with HSM access
 * - Azure SDK credentials configured
 *
 * Environment Variables:
 * - AZURE_HSM_VAULT_URL: HSM vault URL (e.g., https://myhsm.managedhsm.azure.net/)
 * - AZURE_TENANT_ID: Azure AD tenant ID
 * - AZURE_CLIENT_ID: Service principal client ID
 * - AZURE_CLIENT_SECRET: Service principal client secret
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

// Azure Key Vault / Managed HSM API version
const API_VERSION = '7.4'

interface AzureKeyVaultKey {
  key: {
    kid: string
    kty: string
    key_ops: string[]
    n?: string
    e?: string
    crv?: string
    x?: string
    y?: string
  }
  attributes: {
    enabled: boolean
    created: number
    updated: number
    recoveryLevel: string
    exportable?: boolean
  }
  tags?: Record<string, string>
}

interface AzureKeyVaultOperation {
  kid: string
  value: string
}

/**
 * Azure Managed HSM Provider
 */
export class AzureHSMProvider implements HSMProvider {
  private config: HSMConfig
  private vaultUrl: string
  private accessToken: string | null = null
  private tokenExpiry: number = 0
  private keyCache = new Map<string, HSMKeyRef>()
  private connected = false

  // Azure AD authentication
  private tenantId: string
  private clientId: string
  private clientSecret: string

  constructor(config: HSMConfig) {
    this.config = config

    this.vaultUrl = config.endpoint ?? process.env.AZURE_HSM_VAULT_URL ?? ''
    this.tenantId = process.env.AZURE_TENANT_ID ?? ''
    this.clientId = process.env.AZURE_CLIENT_ID ?? ''
    this.clientSecret = process.env.AZURE_CLIENT_SECRET ?? ''

    if (!this.vaultUrl) {
      throw new Error(
        'Azure HSM vault URL is required. Set AZURE_HSM_VAULT_URL',
      )
    }

    if (!this.tenantId || !this.clientId || !this.clientSecret) {
      throw new Error(
        'Azure credentials required. Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET',
      )
    }

    // Normalize vault URL
    if (!this.vaultUrl.endsWith('/')) {
      this.vaultUrl += '/'
    }
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return
    }

    try {
      await this.getAccessToken()
      this.connected = true
      log.info('Azure Managed HSM connected', { vaultUrl: this.vaultUrl })
    } catch (error) {
      log.error('Azure HSM connection failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      throw new Error(
        `Azure HSM connection failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async disconnect(): Promise<void> {
    this.accessToken = null
    this.tokenExpiry = 0
    this.keyCache.clear()
    this.connected = false
    log.info('Azure Managed HSM disconnected')
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

    const keyName = `jeju-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    let kty: string
    let keySize: number | undefined
    let crv: string | undefined
    let keyOps: string[]

    switch (type) {
      case 'aes-256':
        kty = 'oct-HSM'
        keySize = 256
        keyOps = ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
        break
      case 'ec-secp256k1':
        kty = 'EC-HSM'
        crv = 'SECP256K1'
        keyOps = ['sign', 'verify']
        break
      case 'ec-ed25519':
        kty = 'OKP-HSM'
        crv = 'Ed25519'
        keyOps = ['sign', 'verify']
        break
      case 'rsa-2048':
        kty = 'RSA-HSM'
        keySize = 2048
        keyOps = ['sign', 'verify', 'encrypt', 'decrypt']
        break
      default:
        throw new Error(`Unknown key type: ${type}`)
    }

    const body: Record<
      string,
      string | number | string[] | Record<string, boolean | string>
    > = {
      kty,
      key_ops: keyOps,
      attributes: {
        enabled: true,
        exportable: extractable,
      },
      tags: {
        label,
        type,
        createdBy: 'jeju-kms',
      },
    }

    if (keySize) {
      body.key_size = keySize
    }
    if (crv) {
      body.crv = crv
    }

    const response = await fetch(
      `${this.vaultUrl}keys/${keyName}/create?api-version=${API_VERSION}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to create key: ${error}`)
    }

    const keyData = (await response.json()) as AzureKeyVaultKey

    const ref: HSMKeyRef = {
      keyId: keyName,
      label,
      type,
      extractable,
      usage:
        type === 'aes-256'
          ? ['encrypt', 'decrypt', 'derive']
          : ['sign', 'verify'],
      createdAt: keyData.attributes.created * 1000,
    }

    this.keyCache.set(keyName, ref)
    log.info('Azure HSM key generated', { keyId: keyName, label, type })

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
      const response = await fetch(
        `${this.vaultUrl}keys/${keyId}?api-version=${API_VERSION}`,
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
        },
      )

      if (!response.ok) {
        if (response.status === 404) {
          return null
        }
        throw new Error(`Failed to get key: ${await response.text()}`)
      }

      const keyData = (await response.json()) as AzureKeyVaultKey
      const tags = keyData.tags ?? {}

      const ref: HSMKeyRef = {
        keyId,
        label: tags.label ?? keyId,
        type: this.mapAzureKeyType(keyData.key.kty, keyData.key.crv),
        extractable: keyData.attributes.exportable ?? false,
        usage: this.mapKeyOps(keyData.key.key_ops),
        createdAt: keyData.attributes.created * 1000,
      }

      this.keyCache.set(keyId, ref)
      return ref
    } catch (error) {
      log.error('Failed to get Azure HSM key', {
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
    let nextLink: string | null =
      `${this.vaultUrl}keys?api-version=${API_VERSION}`

    while (nextLink) {
      const response = await fetch(nextLink, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to list keys: ${await response.text()}`)
      }

      const data = (await response.json()) as {
        value: Array<{
          kid: string
          attributes: { enabled: boolean; created: number }
        }>
        nextLink?: string
      }

      for (const item of data.value) {
        // Extract key name from kid (URL)
        const keyName = item.kid.split('/').pop()
        if (keyName) {
          const key = await this.getKey(keyName)
          if (key) {
            keys.push(key)
          }
        }
      }

      nextLink = data.nextLink ?? null
    }

    return keys
  }

  async deleteKey(keyId: string): Promise<void> {
    this.ensureConnected()
    await this.ensureValidToken()

    const response = await fetch(
      `${this.vaultUrl}keys/${keyId}?api-version=${API_VERSION}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      },
    )

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete key: ${await response.text()}`)
    }

    this.keyCache.delete(keyId)
    log.info('Azure HSM key deleted', { keyId })
  }

  async encrypt(
    keyId: string,
    plaintext: Uint8Array,
  ): Promise<HSMEncryptResult> {
    this.ensureConnected()
    await this.ensureValidToken()

    // Azure Key Vault uses RSA-OAEP or AES key wrap for encryption
    // For symmetric encryption, we use wrap operation
    const response = await fetch(
      `${this.vaultUrl}keys/${keyId}/wrapkey?api-version=${API_VERSION}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          alg: 'A256GCM',
          value: this.arrayToBase64Url(plaintext),
        }),
      },
    )

    if (!response.ok) {
      throw new Error(`Encryption failed: ${await response.text()}`)
    }

    const result = (await response.json()) as { value: string; iv?: string }

    // Generate IV if not returned (some operations include it)
    const iv = result.iv
      ? this.base64UrlToArray(result.iv)
      : crypto.getRandomValues(new Uint8Array(12))

    return {
      ciphertext: this.base64UrlToArray(result.value),
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

    const response = await fetch(
      `${this.vaultUrl}keys/${keyId}/unwrapkey?api-version=${API_VERSION}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          alg: 'A256GCM',
          value: this.arrayToBase64Url(ciphertext),
          iv: this.arrayToBase64Url(iv),
        }),
      },
    )

    if (!response.ok) {
      throw new Error(`Decryption failed: ${await response.text()}`)
    }

    const result = (await response.json()) as { value: string }
    return this.base64UrlToArray(result.value)
  }

  async sign(keyId: string, data: Uint8Array): Promise<HSMSignResult> {
    this.ensureConnected()
    await this.ensureValidToken()

    // Hash the data first
    const hash = await crypto.subtle.digest(
      'SHA-256',
      data.buffer as ArrayBuffer,
    )
    const hashBytes = new Uint8Array(hash)

    const response = await fetch(
      `${this.vaultUrl}keys/${keyId}/sign?api-version=${API_VERSION}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          alg: 'ES256K', // For secp256k1
          value: this.arrayToBase64Url(hashBytes),
        }),
      },
    )

    if (!response.ok) {
      throw new Error(`Signing failed: ${await response.text()}`)
    }

    const result = (await response.json()) as AzureKeyVaultOperation
    const signatureBytes = this.base64UrlToArray(result.value)

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

    const response = await fetch(
      `${this.vaultUrl}keys/${keyId}/verify?api-version=${API_VERSION}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          alg: 'ES256K',
          digest: this.arrayToBase64Url(hashBytes),
          value: this.arrayToBase64Url(signatureBytes),
        }),
      },
    )

    if (!response.ok) {
      const errorText = await response.text()
      log.error('Verification request failed', { error: errorText })
      return false
    }

    const result = (await response.json()) as { value: boolean }
    return result.value
  }

  async deriveKey(
    masterKeyId: string,
    salt: Uint8Array,
    info: string,
    outputLength: number,
  ): Promise<Uint8Array> {
    this.ensureConnected()
    await this.ensureValidToken()

    // Azure Key Vault doesn't natively support HKDF
    // We implement a workaround using encryption-based KDF
    // Sign the salt+info to derive deterministic bytes
    const infoBytes = new TextEncoder().encode(info)
    const input = new Uint8Array([...salt, ...infoBytes])

    const signResult = await this.sign(masterKeyId, input)

    // Hash the signature to get desired output length
    const signatureBytes = this.hexToBytes(signResult.signature)
    const hash = await crypto.subtle.digest(
      'SHA-256',
      signatureBytes.buffer as ArrayBuffer,
    )

    // If we need more bytes, chain hashes
    if (outputLength <= 32) {
      return new Uint8Array(hash).slice(0, outputLength)
    }

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
      throw new Error('Azure HSM not connected')
    }
  }

  private async getAccessToken(): Promise<void> {
    const tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: 'https://managedhsm.azure.net/.default',
      grant_type: 'client_credentials',
    })

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })

    if (!response.ok) {
      throw new Error(`Token acquisition failed: ${await response.text()}`)
    }

    const data = (await response.json()) as {
      access_token: string
      expires_in: number
    }

    this.accessToken = data.access_token
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000 // Refresh 60s early
  }

  private async ensureValidToken(): Promise<void> {
    if (!this.accessToken || Date.now() >= this.tokenExpiry) {
      await this.getAccessToken()
    }
  }

  private mapAzureKeyType(kty: string, crv?: string): HSMKeyRef['type'] {
    if (kty === 'oct-HSM' || kty === 'oct') {
      return 'aes-256'
    }
    if (kty === 'EC-HSM' || kty === 'EC') {
      return crv === 'SECP256K1' ? 'ec-secp256k1' : 'ec-secp256k1'
    }
    if (kty === 'OKP-HSM' || kty === 'OKP') {
      return 'ec-ed25519'
    }
    if (kty === 'RSA-HSM' || kty === 'RSA') {
      return 'rsa-2048'
    }
    return 'aes-256'
  }

  private mapKeyOps(ops: string[]): HSMKeyRef['usage'] {
    const usage: HSMKeyRef['usage'] = []
    if (ops.includes('encrypt')) usage.push('encrypt')
    if (ops.includes('decrypt')) usage.push('decrypt')
    if (ops.includes('sign')) usage.push('sign')
    if (ops.includes('verify')) usage.push('verify')
    if (ops.includes('wrapKey') || ops.includes('unwrapKey'))
      usage.push('derive')
    return usage
  }

  private arrayToBase64Url(data: Uint8Array): string {
    const base64 = btoa(String.fromCharCode(...data))
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  }

  private base64UrlToArray(base64url: string): Uint8Array {
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const binary = atob(padded)
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
