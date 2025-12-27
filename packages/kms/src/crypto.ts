/**
 * KMS Crypto Utilities - Shared AES-256-GCM encryption primitives
 *
 * Centralizes all AES-GCM operations to ensure consistent implementation
 * across providers and eliminate code duplication.
 */

import type { Hex } from 'viem'
import { keccak256, toBytes, toHex } from 'viem'
import { ciphertextPayloadSchema } from './schemas.js'

/** Maximum allowed data size for encryption (100MB) to prevent DoS */
const MAX_ENCRYPTION_SIZE = 100 * 1024 * 1024

/** Helper to ensure ArrayBuffer compatibility for Web Crypto API */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer
}

/** AES-GCM encrypted payload with IV and auth tag */
export interface AESGCMPayload {
  ciphertext: Hex
  iv: Hex
  tag: Hex
  version?: number
  mpc?: boolean
}

/** Marker byte for empty data - allows round-tripping empty strings */
const EMPTY_DATA_MARKER = new Uint8Array([0x00])
/** Marker byte prefix for non-empty data */
const NON_EMPTY_DATA_PREFIX = 0x01

/** Encrypt data using AES-256-GCM */
export async function aesGcmEncrypt(
  data: Uint8Array,
  key: Uint8Array,
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  // Validate input size to prevent DoS
  if (data.byteLength > MAX_ENCRYPTION_SIZE) {
    throw new Error(
      `Data exceeds maximum allowed size of ${MAX_ENCRYPTION_SIZE} bytes`,
    )
  }
  // Validate key size (must be 256 bits for AES-256)
  if (key.byteLength !== 32) {
    throw new Error('AES-256 requires a 32-byte (256-bit) key')
  }

  // Handle empty data specially - Web Crypto throws on empty input
  // We use a marker byte scheme: 0x00 = empty, 0x01 + data = non-empty
  const dataToEncrypt =
    data.byteLength === 0
      ? EMPTY_DATA_MARKER
      : new Uint8Array([NON_EMPTY_DATA_PREFIX, ...data])

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(key),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  )
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    toArrayBuffer(dataToEncrypt),
  )
  return { ciphertext: new Uint8Array(encrypted), iv }
}

/** Decrypt data using AES-256-GCM */
export async function aesGcmDecrypt(
  ciphertext: Uint8Array,
  iv: Uint8Array,
  key: Uint8Array,
): Promise<Uint8Array> {
  // Validate input sizes
  if (ciphertext.byteLength > MAX_ENCRYPTION_SIZE + 16) {
    // +16 for auth tag
    throw new Error(`Ciphertext exceeds maximum allowed size`)
  }
  if (iv.byteLength !== 12) {
    throw new Error('AES-GCM IV must be 12 bytes')
  }
  if (key.byteLength !== 32) {
    throw new Error('AES-256 requires a 32-byte (256-bit) key')
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(key),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  )
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    cryptoKey,
    toArrayBuffer(ciphertext),
  )
  const decryptedBytes = new Uint8Array(decrypted)

  // Handle marker byte scheme for empty data support
  if (decryptedBytes.length === 1 && decryptedBytes[0] === 0x00) {
    // Empty data marker
    return new Uint8Array(0)
  }
  if (
    decryptedBytes.length > 0 &&
    decryptedBytes[0] === NON_EMPTY_DATA_PREFIX
  ) {
    // Remove the non-empty marker prefix
    return decryptedBytes.slice(1)
  }

  // Legacy data without marker (for backwards compatibility)
  return decryptedBytes
}

/** Seal (encrypt) a key with a master key - prepends IV to output */
export async function sealWithMasterKey(
  data: Uint8Array,
  masterKey: Uint8Array,
): Promise<Uint8Array> {
  const { ciphertext, iv } = await aesGcmEncrypt(data, masterKey)
  const result = new Uint8Array(12 + ciphertext.byteLength)
  result.set(iv, 0)
  result.set(ciphertext, 12)
  return result
}

/** Unseal (decrypt) data sealed with sealWithMasterKey */
export async function unsealWithMasterKey(
  sealed: Uint8Array,
  masterKey: Uint8Array,
): Promise<Uint8Array> {
  const iv = sealed.slice(0, 12)
  const ciphertext = sealed.slice(12)
  return aesGcmDecrypt(ciphertext, iv, masterKey)
}

/** Derive an encryption key using HKDF */
export async function deriveEncryptionKey(
  masterKey: Uint8Array,
  salt: Uint8Array,
  info: string,
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(masterKey),
    { name: 'HKDF' },
    false,
    ['deriveBits'],
  )
  const infoBytes = toBytes(info)
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(infoBytes),
      hash: 'SHA-256',
    },
    baseKey,
    256,
  )
  return new Uint8Array(derivedBits)
}

/** Encrypt data and return JSON-serializable payload */
export async function encryptToPayload(
  data: string,
  key: Uint8Array,
  options?: { version?: number; mpc?: boolean },
): Promise<string> {
  const { ciphertext, iv } = await aesGcmEncrypt(toBytes(data), key)
  const payload: AESGCMPayload = {
    ciphertext: toHex(ciphertext.slice(0, -16)),
    iv: toHex(iv),
    tag: toHex(ciphertext.slice(-16)),
  }
  if (options?.version !== undefined) payload.version = options.version
  if (options?.mpc !== undefined) payload.mpc = options.mpc
  return JSON.stringify(payload)
}

/** Decrypt payload created by encryptToPayload */
export async function decryptFromPayload(
  payloadJson: string,
  key: Uint8Array,
): Promise<string> {
  const parseResult = ciphertextPayloadSchema.safeParse(JSON.parse(payloadJson))
  if (!parseResult.success) {
    throw new Error(`Invalid ciphertext format: ${parseResult.error.message}`)
  }
  const payload = parseResult.data
  const combined = new Uint8Array([
    ...toBytes(payload.ciphertext as Hex),
    ...toBytes(payload.tag as Hex),
  ])
  const decrypted = await aesGcmDecrypt(
    combined,
    toBytes(payload.iv as Hex),
    key,
  )
  return new TextDecoder().decode(decrypted)
}

/** Parse and validate ciphertext payload JSON */
export function parseCiphertextPayload(payloadJson: string): AESGCMPayload {
  const parseResult = ciphertextPayloadSchema.safeParse(JSON.parse(payloadJson))
  if (!parseResult.success) {
    throw new Error(`Invalid ciphertext format: ${parseResult.error.message}`)
  }
  return parseResult.data as AESGCMPayload
}

/** Generate a unique key ID with given prefix */
export function generateKeyId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
}

/**
 * Constant-time comparison of two hex strings to prevent timing attacks.
 * Both strings must be valid hex (with 0x prefix).
 * Compares in constant time regardless of where differences occur.
 * For different lengths, pads shorter string and always returns false.
 */
export function constantTimeCompare(a: Hex, b: Hex): boolean {
  // Use the longer length to ensure constant-time comparison
  // regardless of input lengths
  const maxLen = Math.max(a.length, b.length)

  // Track both XOR result and length mismatch
  let result = a.length ^ b.length // Non-zero if lengths differ

  for (let i = 0; i < maxLen; i++) {
    // Use 0 for out-of-bounds access to maintain constant time
    const charA = i < a.length ? a.charCodeAt(i) : 0
    const charB = i < b.length ? b.charCodeAt(i) : 0
    result |= charA ^ charB
  }

  return result === 0
}

/**
 * Derive a master key from a secret string.
 *
 * ⚠️ SECURITY NOTE: This uses a single keccak256 hash which is fast but
 * provides minimal protection against brute-force if the key is observed.
 * For side-channel resistant scenarios, use deriveKeyFromSecretAsync()
 * which uses PBKDF2 with 100,000 iterations.
 *
 * @deprecated Use deriveKeyFromSecretAsync for new code
 */
export function deriveKeyFromSecret(secret: string): Uint8Array {
  return toBytes(keccak256(toBytes(secret)))
}

/**
 * Derive a master key from a secret string using PBKDF2.
 *
 * SECURITY: Uses 100,000 iterations of PBKDF2-SHA256 to provide resistance
 * against brute-force attacks if the derived key material is observed through
 * side-channel attacks. This is the recommended method for key derivation.
 *
 * @param secret - The secret string to derive from
 * @param salt - Optional salt for domain separation (defaults to 'jeju:kms:master:v1')
 * @returns Promise resolving to 32-byte derived key
 */
export async function deriveKeyFromSecretAsync(
  secret: string,
  salt: string = 'jeju:kms:master:v1',
): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const secretBytes = encoder.encode(secret)
  const saltBytes = encoder.encode(salt)

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    'PBKDF2',
    false,
    ['deriveBits'],
  )

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  )

  return new Uint8Array(derivedBits)
}

/** Derive a key for a specific keyId and policy */
export async function deriveKeyForEncryption(
  masterKey: Uint8Array,
  keyId: string,
  policyJson: string,
): Promise<Uint8Array> {
  const salt = toBytes(keccak256(toBytes(`${keyId}:${policyJson}`)))
  return deriveEncryptionKey(masterKey, salt, 'encryption')
}

/** Safe recovery ID extraction from signature with bounds validation */
export function extractRecoveryId(signature: string): number {
  if (signature.length < 132) return 0
  const vHex = signature.slice(130, 132)
  const v = parseInt(vHex, 16)
  if (v >= 27 && v <= 28) return v - 27
  if (v === 0 || v === 1) return v
  return 0
}

/**
 * Securely zero a Uint8Array in memory.
 *
 * ⚠️ SECURITY NOTE:
 * This is a best-effort zeroing. JavaScript/Node.js does not guarantee:
 * 1. That the memory won't be copied before zeroing
 * 2. That GC won't have already moved the data
 * 3. That JIT optimizations won't skip the zeroing
 *
 * For true side-channel resistance, use:
 * - Hardware security modules (HSM)
 * - Separate physical TEE hardware per secret
 * - FROST-based threshold signing (secrets never combined)
 */
export function secureZero(buffer: Uint8Array): void {
  // Fill with zeros
  buffer.fill(0)
  // Fill with random to prevent optimization from skipping
  crypto.getRandomValues(buffer)
  // Fill with zeros again
  buffer.fill(0)
}

/**
 * ⚠️ SECURITY WARNING ⚠️
 *
 * Bigint values CANNOT be securely zeroed in JavaScript:
 * - Bigint is immutable - you can only create new values
 * - The original bytes remain in heap memory until GC
 * - GC timing is non-deterministic
 * - Memory may have been copied by V8 optimizations
 *
 * FOR SIDE-CHANNEL RESISTANT OPERATIONS:
 * - NEVER reconstruct full private keys from shares
 * - Use true threshold signing (FROST) where secrets never combine
 * - Deploy secret shares on physically separate hardware
 *
 * This function exists only to document the limitation.
 */
export function bigintSecurityWarning(): string {
  return (
    'Bigint values cannot be securely zeroed. ' +
    'Use Uint8Array for sensitive data or avoid aggregating secrets.'
  )
}
