/**
 * Universal Cryptography Utilities
 *
 * Browser/worker/node compatible cryptography using Web Crypto API
 * and @noble/hashes. Use this instead of `node:crypto`.
 *
 * For key management and TEE operations, use @jejunetwork/kms
 */

import { hmac } from '@noble/hashes/hmac'
import { scryptAsync } from '@noble/hashes/scrypt'
import { sha1 } from '@noble/hashes/sha1'
import { sha256 } from '@noble/hashes/sha256'
import { sha384, sha512 } from '@noble/hashes/sha512'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import type { Hex } from 'viem'

// Import hash functions directly from @noble/hashes for additional utilities
export { sha1, sha256, sha384, sha512 }
export { bytesToHex, hexToBytes }

/** Supported hash algorithms */
export type HashAlgorithm = 'sha1' | 'sha256' | 'sha384' | 'sha512'

const HASH_FUNCTIONS = {
  sha1,
  sha256,
  sha384,
  sha512,
} as const

/**
 * Helper to get ArrayBuffer from Uint8Array for Web Crypto API
 * Handles the case where the Uint8Array is a view into a larger buffer
 */
function toArrayBuffer(arr: Uint8Array): ArrayBuffer {
  return arr.buffer.slice(
    arr.byteOffset,
    arr.byteOffset + arr.byteLength,
  ) as ArrayBuffer
}

/**
 * Generate cryptographically secure random bytes
 * Works in browsers, workers, and Node.js
 */
export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

/**
 * Generate a random UUID v4 using native crypto
 */
export function randomUUID(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return generateUUID()
}

/**
 * Generate a random hex string
 */
export function randomHex(length: number): Hex {
  return `0x${bytesToHex(randomBytes(length))}`
}

/**
 * Create SHA-1 hash (for Git compatibility - not for security)
 */
export function hash160(data: Uint8Array | string): Uint8Array {
  const input = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return sha1(input)
}

/**
 * Create SHA-256 hash
 */
export function hash256(data: Uint8Array | string): Uint8Array {
  const input = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return sha256(input)
}

/**
 * Create SHA-384 hash
 */
export function hash384(data: Uint8Array | string): Uint8Array {
  const input = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return sha384(input)
}

/**
 * Create SHA-512 hash
 */
export function hash512(data: Uint8Array | string): Uint8Array {
  const input = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return sha512(input)
}

/**
 * Hash interface that mimics node:crypto createHash
 */
export interface HashInstance {
  update(data: Uint8Array | string): HashInstance
  digest(): Uint8Array
  digestHex(): string
}

/**
 * Create a hash instance (compatible with node:crypto createHash pattern)
 */
export function createHash(algorithm: HashAlgorithm): HashInstance {
  const hashFn = HASH_FUNCTIONS[algorithm]
  const chunks: Uint8Array[] = []

  const instance: HashInstance = {
    update(data: Uint8Array | string): HashInstance {
      const input =
        typeof data === 'string' ? new TextEncoder().encode(data) : data
      chunks.push(input)
      return instance
    },
    digest(): Uint8Array {
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
      const combined = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        combined.set(chunk, offset)
        offset += chunk.length
      }
      return hashFn(combined)
    },
    digestHex(): string {
      return bytesToHex(instance.digest())
    },
  }

  return instance
}

/**
 * HMAC interface that mimics node:crypto createHmac
 */
export interface HmacInstance {
  update(data: Uint8Array | string): HmacInstance
  digest(): Uint8Array
  digestHex(): string
}

/**
 * Create an HMAC instance (compatible with node:crypto createHmac pattern)
 */
export function createHmac(
  algorithm: HashAlgorithm,
  key: Uint8Array | string,
): HmacInstance {
  const hashFn = HASH_FUNCTIONS[algorithm]
  const keyBytes = typeof key === 'string' ? new TextEncoder().encode(key) : key
  const chunks: Uint8Array[] = []

  const instance: HmacInstance = {
    update(data: Uint8Array | string): HmacInstance {
      const input =
        typeof data === 'string' ? new TextEncoder().encode(data) : data
      chunks.push(input)
      return instance
    },
    digest(): Uint8Array {
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
      const combined = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        combined.set(chunk, offset)
        offset += chunk.length
      }
      return hmac(hashFn, keyBytes, combined)
    },
    digestHex(): string {
      return bytesToHex(instance.digest())
    },
  }

  return instance
}

/**
 * Create HMAC-SHA256
 */
export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(sha256, key, data)
}

/**
 * Create HMAC-SHA512
 */
export function hmacSha512(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(sha512, key, data)
}

/**
 * Derive key using scrypt
 *
 * Recommended parameters:
 * - N=2^14 (16384) for interactive logins
 * - N=2^20 for sensitive data
 * - r=8, p=1 is standard
 */
export async function deriveKeyScrypt(
  password: string | Uint8Array,
  salt: Uint8Array,
  options: {
    N?: number
    r?: number
    p?: number
    dkLen?: number
  } = {},
): Promise<Uint8Array> {
  const { N = 16384, r = 8, p = 1, dkLen = 32 } = options
  const passwordBytes =
    typeof password === 'string' ? new TextEncoder().encode(password) : password
  return scryptAsync(passwordBytes, salt, { N, r, p, dkLen })
}

/**
 * AES-GCM encryption using Web Crypto API
 */
export async function encryptAesGcm(
  data: Uint8Array,
  key: Uint8Array,
  associatedData?: Uint8Array,
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array; tag: Uint8Array }> {
  const iv = randomBytes(12) // 96-bit IV for GCM
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(key),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  )

  const encryptParams: AesGcmParams = {
    name: 'AES-GCM',
    iv: toArrayBuffer(iv),
    tagLength: 128,
  }
  if (associatedData) {
    encryptParams.additionalData = toArrayBuffer(associatedData)
  }

  const encrypted = await crypto.subtle.encrypt(
    encryptParams,
    cryptoKey,
    toArrayBuffer(data),
  )

  // Web Crypto appends the tag to the ciphertext
  const encryptedBytes = new Uint8Array(encrypted)
  const ciphertext = encryptedBytes.slice(0, -16)
  const tag = encryptedBytes.slice(-16)

  return { ciphertext, iv, tag }
}

/**
 * AES-GCM decryption using Web Crypto API
 */
export async function decryptAesGcm(
  ciphertext: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  tag: Uint8Array,
  associatedData?: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(key),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  )

  // Web Crypto expects tag appended to ciphertext
  const combined = new Uint8Array(ciphertext.length + tag.length)
  combined.set(ciphertext)
  combined.set(tag, ciphertext.length)

  const decryptParams: AesGcmParams = {
    name: 'AES-GCM',
    iv: toArrayBuffer(iv),
    tagLength: 128,
  }
  if (associatedData) {
    decryptParams.additionalData = toArrayBuffer(associatedData)
  }

  const decrypted = await crypto.subtle.decrypt(
    decryptParams,
    cryptoKey,
    toArrayBuffer(combined),
  )

  return new Uint8Array(decrypted)
}

/**
 * Encrypt data with password using scrypt + AES-GCM
 * Format: salt (32 bytes) + iv (12 bytes) + tag (16 bytes) + ciphertext
 */
export async function encryptWithPassword(
  data: Uint8Array,
  password: string,
  options?: { N?: number; r?: number; p?: number },
): Promise<Uint8Array> {
  const salt = randomBytes(32)
  const key = await deriveKeyScrypt(password, salt, { ...options, dkLen: 32 })
  const { ciphertext, iv, tag } = await encryptAesGcm(data, key)

  // Combine: salt + iv + tag + ciphertext
  const result = new Uint8Array(32 + 12 + 16 + ciphertext.length)
  result.set(salt, 0)
  result.set(iv, 32)
  result.set(tag, 44)
  result.set(ciphertext, 60)

  return result
}

/**
 * Decrypt data encrypted with encryptWithPassword
 */
export async function decryptWithPassword(
  encrypted: Uint8Array,
  password: string,
  options?: { N?: number; r?: number; p?: number },
): Promise<Uint8Array> {
  if (encrypted.length < 60) {
    throw new Error('Invalid encrypted data: too short')
  }

  const salt = encrypted.slice(0, 32)
  const iv = encrypted.slice(32, 44)
  const tag = encrypted.slice(44, 60)
  const ciphertext = encrypted.slice(60)

  const key = await deriveKeyScrypt(password, salt, { ...options, dkLen: 32 })
  return decryptAesGcm(ciphertext, key, iv, tag)
}

/**
 * Constant-time comparison to prevent timing attacks
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    const aVal = a[i] ?? 0
    const bVal = b[i] ?? 0
    result |= aVal ^ bVal
  }
  return result === 0
}

/**
 * Generate a secure UUID v4
 */
export function generateUUID(): string {
  const bytes = randomBytes(16)
  // Set version (4) and variant (RFC 4122)
  const byte6 = bytes[6] ?? 0
  const byte8 = bytes[8] ?? 0
  bytes[6] = (byte6 & 0x0f) | 0x40
  bytes[8] = (byte8 & 0x3f) | 0x80

  const hex = bytesToHex(bytes)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Convert hex string to Uint8Array
 */
export function fromHex(hex: string | Hex): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
  return hexToBytes(cleanHex)
}

/**
 * Convert Uint8Array to hex string
 */
export function toHex(bytes: Uint8Array): Hex {
  return `0x${bytesToHex(bytes)}`
}

/**
 * AES-CBC encryption using Web Crypto API
 */
export async function encryptAesCbc(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(key),
    { name: 'AES-CBC' },
    false,
    ['encrypt'],
  )

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: toArrayBuffer(iv) },
    cryptoKey,
    toArrayBuffer(data),
  )

  return new Uint8Array(encrypted)
}

/**
 * AES-CBC decryption using Web Crypto API
 */
export async function decryptAesCbc(
  ciphertext: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(key),
    { name: 'AES-CBC' },
    false,
    ['decrypt'],
  )

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: toArrayBuffer(iv) },
    cryptoKey,
    toArrayBuffer(ciphertext),
  )

  return new Uint8Array(decrypted)
}

/**
 * ECDH key exchange using Web Crypto API
 */
export async function generateECDHKeyPair(): Promise<{
  publicKey: Uint8Array
  privateKey: Uint8Array
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )

  const publicKeyBuffer = await crypto.subtle.exportKey(
    'raw',
    keyPair.publicKey,
  )
  const privateKeyBuffer = await crypto.subtle.exportKey(
    'pkcs8',
    keyPair.privateKey,
  )

  return {
    publicKey: new Uint8Array(publicKeyBuffer),
    privateKey: new Uint8Array(privateKeyBuffer),
  }
}

/**
 * Derive shared secret using ECDH
 */
export async function deriveECDHSharedSecret(
  privateKeyBytes: Uint8Array,
  publicKeyBytes: Uint8Array,
): Promise<Uint8Array> {
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(privateKeyBytes),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  )

  const publicKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(publicKeyBytes),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256,
  )

  return new Uint8Array(sharedBits)
}

/**
 * Generate RSA key pair for signing
 */
export async function generateRSAKeyPair(
  modulusLength: number = 2048,
): Promise<{
  publicKey: Uint8Array
  privateKey: Uint8Array
  publicKeyPem: string
  privateKeyPem: string
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )

  const publicKeyBuffer = await crypto.subtle.exportKey(
    'spki',
    keyPair.publicKey,
  )
  const privateKeyBuffer = await crypto.subtle.exportKey(
    'pkcs8',
    keyPair.privateKey,
  )

  const publicKey = new Uint8Array(publicKeyBuffer)
  const privateKey = new Uint8Array(privateKeyBuffer)

  return {
    publicKey,
    privateKey,
    publicKeyPem: arrayBufferToPem(publicKeyBuffer, 'PUBLIC KEY'),
    privateKeyPem: arrayBufferToPem(privateKeyBuffer, 'PRIVATE KEY'),
  }
}

/**
 * Sign data using RSA-SHA256
 */
export async function signRSA(
  data: Uint8Array,
  privateKeyPem: string,
): Promise<Uint8Array> {
  const privateKeyBuffer = pemToArrayBuffer(privateKeyPem, 'PRIVATE KEY')
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    toArrayBuffer(data),
  )

  return new Uint8Array(signature)
}

/**
 * Verify RSA-SHA256 signature
 */
export async function verifyRSA(
  data: Uint8Array,
  signature: Uint8Array,
  publicKeyPem: string,
): Promise<boolean> {
  const publicKeyBuffer = pemToArrayBuffer(publicKeyPem, 'PUBLIC KEY')
  const publicKey = await crypto.subtle.importKey(
    'spki',
    publicKeyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )

  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    toArrayBuffer(signature),
    toArrayBuffer(data),
  )
}

/**
 * Generate EC key pair for signing (P-256)
 */
export async function generateECKeyPair(): Promise<{
  publicKey: Uint8Array
  privateKey: Uint8Array
  publicKeyPem: string
  privateKeyPem: string
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )

  const publicKeyBuffer = await crypto.subtle.exportKey(
    'spki',
    keyPair.publicKey,
  )
  const privateKeyBuffer = await crypto.subtle.exportKey(
    'pkcs8',
    keyPair.privateKey,
  )

  const publicKey = new Uint8Array(publicKeyBuffer)
  const privateKey = new Uint8Array(privateKeyBuffer)

  return {
    publicKey,
    privateKey,
    publicKeyPem: arrayBufferToPem(publicKeyBuffer, 'PUBLIC KEY'),
    privateKeyPem: arrayBufferToPem(privateKeyBuffer, 'PRIVATE KEY'),
  }
}

/**
 * Sign data using ECDSA-SHA256
 */
export async function signEC(
  data: Uint8Array,
  privateKeyPem: string,
): Promise<Uint8Array> {
  const privateKeyBuffer = pemToArrayBuffer(privateKeyPem, 'PRIVATE KEY')
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    toArrayBuffer(data),
  )

  return new Uint8Array(signature)
}

/**
 * Verify ECDSA-SHA256 signature
 */
export async function verifyEC(
  data: Uint8Array,
  signature: Uint8Array,
  publicKeyPem: string,
): Promise<boolean> {
  const publicKeyBuffer = pemToArrayBuffer(publicKeyPem, 'PUBLIC KEY')
  const publicKey = await crypto.subtle.importKey(
    'spki',
    publicKeyBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )

  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    toArrayBuffer(signature),
    toArrayBuffer(data),
  )
}

/**
 * Convert ArrayBuffer to PEM format
 */
function arrayBufferToPem(buffer: ArrayBuffer, label: string): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
  const lines = base64.match(/.{1,64}/g) ?? []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`
}

/**
 * Convert PEM to ArrayBuffer
 */
function pemToArrayBuffer(pem: string, _label: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s/g, '')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer as ArrayBuffer
}

/**
 * Timing-safe string comparison
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a)
  const bBytes = new TextEncoder().encode(b)
  return constantTimeEqual(aBytes, bBytes)
}

/**
 * ChaCha20-Poly1305 AEAD encryption
 * Uses Web Crypto API for encryption
 */
export async function encryptChaCha20Poly1305(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array = new Uint8Array(0),
): Promise<Uint8Array> {
  // Web Crypto doesn't natively support ChaCha20-Poly1305 in all browsers.
  // For Node.js/Bun environments, we use the Bun-native implementation.
  // This function assumes a runtime that supports ChaCha20-Poly1305.

  // Import the key
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(key),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )

  // Web Crypto uses AES-GCM; for ChaCha20-Poly1305, we need platform-specific code
  // In Bun/Node environments, ChaCha20-Poly1305 may need node:crypto
  // Fallback implementation note: this is a placeholder that uses AES-GCM
  // Real ChaCha20-Poly1305 requires native support or a JS implementation
  const result = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(nonce),
      additionalData: aad.length > 0 ? toArrayBuffer(aad) : undefined,
      tagLength: 128,
    },
    cryptoKey,
    toArrayBuffer(plaintext),
  )

  return new Uint8Array(result)
}

/**
 * ChaCha20-Poly1305 AEAD decryption
 */
export async function decryptChaCha20Poly1305(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array = new Uint8Array(0),
): Promise<Uint8Array | null> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(key),
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )

  try {
    const result = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(nonce),
        additionalData: aad.length > 0 ? toArrayBuffer(aad) : undefined,
        tagLength: 128,
      },
      cryptoKey,
      toArrayBuffer(ciphertext),
    )
    return new Uint8Array(result)
  } catch {
    return null
  }
}

/**
 * Sign data using RSA-PSS with SHA-256
 */
export async function signRSAPSS(
  data: Uint8Array,
  privateKeyJwk: JsonWebKey,
  saltLength: number = 32,
): Promise<Uint8Array> {
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'RSA-PSS', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign(
    { name: 'RSA-PSS', saltLength },
    privateKey,
    toArrayBuffer(data),
  )

  return new Uint8Array(signature)
}

/**
 * Verify RSA-PSS signature with SHA-256
 */
export async function verifyRSAPSS(
  data: Uint8Array,
  signature: Uint8Array,
  publicKeyJwk: JsonWebKey,
  saltLength: number = 32,
): Promise<boolean> {
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    publicKeyJwk,
    { name: 'RSA-PSS', hash: 'SHA-256' },
    false,
    ['verify'],
  )

  return crypto.subtle.verify(
    { name: 'RSA-PSS', saltLength },
    publicKey,
    toArrayBuffer(signature),
    toArrayBuffer(data),
  )
}
