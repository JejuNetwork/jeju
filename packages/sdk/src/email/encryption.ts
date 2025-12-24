/**
 * Email Encryption Utilities
 *
 * E2E encryption for email content using:
 * - secp256k1 ECDH for key exchange
 * - AES-256-GCM for content encryption
 * - Compatible with MPC key management
 *
 * Uses Web Crypto API for browser/Node.js compatibility
 */

import { secp256k1 } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import type { Hex } from 'viem'

export interface EncryptedEmail {
  ciphertext: Hex
  nonce: Hex
  ephemeralPublicKey: Hex
  tag: Hex
}

export interface KeyPair {
  publicKey: Uint8Array
  privateKey: Uint8Array
}

/**
 * Get random bytes using Web Crypto API (works in browser and Node.js)
 */
function getRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length))
}

/**
 * Convert Uint8Array to hex string
 */
function toHex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}` as Hex
}

/**
 * Convert hex string to Uint8Array
 */
function fromHex(hex: Hex): Uint8Array {
  const str = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(str.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(str.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Generate ephemeral key pair for encryption using secp256k1
 */
export function generateKeyPair(): KeyPair {
  const privateKey = getRandomBytes(32)
  const publicKey = secp256k1.getPublicKey(privateKey, false) // uncompressed

  return {
    publicKey: new Uint8Array(publicKey),
    privateKey: new Uint8Array(privateKey),
  }
}

/**
 * Derive shared secret from ECDH using secp256k1
 */
export function deriveSharedSecret(
  privateKey: Uint8Array,
  publicKey: Uint8Array,
): Uint8Array {
  // Perform proper ECDH using secp256k1
  const sharedPoint = secp256k1.getSharedSecret(privateKey, publicKey)

  // Hash the shared point to derive the symmetric key
  // Take the x-coordinate (first 32 bytes after the 0x04 prefix for uncompressed keys)
  const xCoord = sharedPoint.slice(1, 33)

  // Use @noble/hashes for SHA-256 (works in browser and Node.js)
  return sha256(xCoord)
}

/**
 * Encrypt email content for a recipient using Web Crypto API
 */
export async function encryptEmail(
  content: string,
  recipientPublicKey: Uint8Array,
): Promise<EncryptedEmail> {
  // Generate ephemeral key pair
  const ephemeral = generateKeyPair()

  // Derive shared secret
  const sharedSecret = deriveSharedSecret(
    ephemeral.privateKey,
    recipientPublicKey,
  )

  // Import key for AES-GCM
  const key = await crypto.subtle.importKey(
    'raw',
    sharedSecret as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  )

  // Encrypt with AES-256-GCM
  const nonce = getRandomBytes(12)
  const encoder = new TextEncoder()
  const plaintext = encoder.encode(content)

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource },
    key,
    plaintext as BufferSource,
  )

  // AES-GCM appends the 16-byte tag to the ciphertext
  const encryptedBytes = new Uint8Array(encrypted)
  const ciphertext = encryptedBytes.slice(0, -16)
  const tag = encryptedBytes.slice(-16)

  return {
    ciphertext: toHex(ciphertext),
    nonce: toHex(nonce),
    ephemeralPublicKey: toHex(ephemeral.publicKey),
    tag: toHex(tag),
  }
}

/**
 * Decrypt email content using Web Crypto API
 */
export async function decryptEmail(
  encrypted: EncryptedEmail,
  privateKey: Uint8Array,
): Promise<string> {
  // Parse hex values
  const ciphertext = fromHex(encrypted.ciphertext)
  const nonce = fromHex(encrypted.nonce)
  const ephemeralPublicKey = fromHex(encrypted.ephemeralPublicKey)
  const tag = fromHex(encrypted.tag)

  // Derive shared secret
  const sharedSecret = deriveSharedSecret(privateKey, ephemeralPublicKey)

  // Import key for AES-GCM
  const key = await crypto.subtle.importKey(
    'raw',
    sharedSecret as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  )

  // Reconstruct the full ciphertext with tag (AES-GCM expects tag appended)
  const fullCiphertext = new Uint8Array(ciphertext.length + tag.length)
  fullCiphertext.set(ciphertext)
  fullCiphertext.set(tag, ciphertext.length)

  // Decrypt with AES-256-GCM
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource },
    key,
    fullCiphertext as BufferSource,
  )

  const decoder = new TextDecoder()
  return decoder.decode(decrypted)
}

/**
 * Encrypt email for multiple recipients using Web Crypto API
 */
export async function encryptForMultipleRecipients(
  content: string,
  recipientPublicKeys: Map<string, Uint8Array>,
): Promise<{
  encryptedContent: EncryptedEmail
  recipientKeys: Map<string, Hex>
}> {
  // Generate random symmetric key
  const symmetricKey = getRandomBytes(32)

  // Import key for AES-GCM
  const key = await crypto.subtle.importKey(
    'raw',
    symmetricKey as BufferSource,
    { name: 'AES-GCM' },
    true,
    ['encrypt'],
  )

  // Encrypt content with symmetric key
  const nonce = getRandomBytes(12)
  const encoder = new TextEncoder()
  const plaintext = encoder.encode(content)

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource },
    key,
    plaintext as BufferSource,
  )

  const encryptedBytes = new Uint8Array(encrypted)
  const ciphertext = encryptedBytes.slice(0, -16)
  const tag = encryptedBytes.slice(-16)

  // Encrypt symmetric key for each recipient
  const recipientKeys = new Map<string, Hex>()

  for (const [address, publicKey] of recipientPublicKeys) {
    const ephemeral = generateKeyPair()
    const sharedSecret = deriveSharedSecret(ephemeral.privateKey, publicKey)

    // Import shared secret as key
    const recipientKeyObj = await crypto.subtle.importKey(
      'raw',
      sharedSecret as BufferSource,
      { name: 'AES-GCM' },
      false,
      ['encrypt'],
    )

    // Encrypt symmetric key
    const keyNonce = getRandomBytes(12)
    const encryptedKey = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: keyNonce as BufferSource },
      recipientKeyObj,
      symmetricKey as BufferSource,
    )

    const encryptedKeyBytes = new Uint8Array(encryptedKey)

    // Pack: nonce (12) + encrypted key with tag (32 + 16) + ephemeral public key (65)
    const keyPackage = new Uint8Array(12 + encryptedKeyBytes.length + 65)
    keyPackage.set(keyNonce)
    keyPackage.set(encryptedKeyBytes, 12)
    keyPackage.set(ephemeral.publicKey, 12 + encryptedKeyBytes.length)

    recipientKeys.set(address, toHex(keyPackage))
  }

  return {
    encryptedContent: {
      ciphertext: toHex(ciphertext),
      nonce: toHex(nonce),
      ephemeralPublicKey: '0x' as Hex, // Stored per-recipient
      tag: toHex(tag),
    },
    recipientKeys,
  }
}

/**
 * Decrypt email encrypted for multiple recipients using Web Crypto API
 */
export async function decryptFromMultipleRecipients(
  encryptedContent: EncryptedEmail,
  recipientKey: Hex,
  privateKey: Uint8Array,
): Promise<string> {
  // Parse recipient key package
  const keyPackage = fromHex(recipientKey)

  const keyNonce = keyPackage.slice(0, 12)
  const encryptedSymKey = keyPackage.slice(12, 12 + 48) // 32 bytes key + 16 bytes tag
  const ephemeralPublicKey = keyPackage.slice(12 + 48)

  // Derive shared secret
  const sharedSecret = deriveSharedSecret(privateKey, ephemeralPublicKey)

  // Import shared secret as key
  const keyDecryptKey = await crypto.subtle.importKey(
    'raw',
    sharedSecret as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  )

  // Decrypt symmetric key
  const symmetricKey = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: keyNonce as BufferSource },
    keyDecryptKey,
    encryptedSymKey as BufferSource,
  )

  // Import symmetric key
  const contentKey = await crypto.subtle.importKey(
    'raw',
    symmetricKey as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  )

  // Parse content
  const ciphertext = fromHex(encryptedContent.ciphertext)
  const nonce = fromHex(encryptedContent.nonce)
  const tag = fromHex(encryptedContent.tag)

  // Reconstruct full ciphertext with tag
  const fullCiphertext = new Uint8Array(ciphertext.length + tag.length)
  fullCiphertext.set(ciphertext)
  fullCiphertext.set(tag, ciphertext.length)

  // Decrypt content
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource },
    contentKey,
    fullCiphertext as BufferSource,
  )

  const decoder = new TextDecoder()
  return decoder.decode(decrypted)
}
