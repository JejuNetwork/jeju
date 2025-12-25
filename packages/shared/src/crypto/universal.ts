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
import { sha256 } from '@noble/hashes/sha256'
import { sha512 } from '@noble/hashes/sha512'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import type { Hex } from 'viem'

// Import hash functions directly from @noble/hashes for additional utilities
export { sha256, sha512 }
export { bytesToHex, hexToBytes }

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
 * Generate a random hex string
 */
export function randomHex(length: number): Hex {
  return `0x${bytesToHex(randomBytes(length))}`
}

/**
 * Create SHA-256 hash
 */
export function hash256(data: Uint8Array | string): Uint8Array {
  const input = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return sha256(input)
}

/**
 * Create SHA-512 hash
 */
export function hash512(data: Uint8Array | string): Uint8Array {
  const input = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return sha512(input)
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
