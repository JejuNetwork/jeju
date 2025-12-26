/**
 * Farcaster Signer Service
 *
 * Manages Ed25519 signers for Farcaster posting.
 * Handles key generation, encryption, storage, and on-chain registration.
 */

import { getFarcasterHubUrl } from '@jejunetwork/config'
import { FarcasterPoster } from '@jejunetwork/messaging'
import { createLogger } from '@jejunetwork/shared'
import { ed25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils'
import type { Address, Hex } from 'viem'
import {
  activateSigner,
  createFarcasterSigner,
  type FarcasterSignerRow,
  getFarcasterSigner,
  listFarcasterSigners,
  updateSignerState,
} from '../db/client'

const log = createLogger('signer-service')

const HUB_URL = getFarcasterHubUrl()
const ENCRYPTION_KEY = process.env.SIGNER_ENCRYPTION_KEY

if (!ENCRYPTION_KEY) {
  log.warn('SIGNER_ENCRYPTION_KEY not set - using derived key from NODE_ENV')
}

/**
 * Derive encryption key from environment or fallback
 */
function getEncryptionKey(): Uint8Array {
  if (ENCRYPTION_KEY) {
    return hexToBytes(ENCRYPTION_KEY.replace('0x', ''))
  }
  // Fallback: derive from environment identifier (not secure for production)
  const seed = `factory-signer-${process.env.NODE_ENV ?? 'development'}`
  return hkdf(
    sha256,
    new TextEncoder().encode(seed),
    new Uint8Array(0),
    new TextEncoder().encode('aes-key'),
    32,
  )
}

/**
 * Encrypt signer private key using key derivation
 */
function encryptPrivateKey(privateKey: Uint8Array): {
  encrypted: string
  iv: string
} {
  const key = getEncryptionKey()
  const iv = randomBytes(12)

  // Simple XOR encryption with key derivation for storage
  // In production, use proper AES-GCM via Web Crypto
  const derivedKey = hkdf(
    sha256,
    key,
    iv,
    new TextEncoder().encode('encrypt'),
    privateKey.length,
  )
  const encrypted = new Uint8Array(privateKey.length)
  for (let i = 0; i < privateKey.length; i++) {
    encrypted[i] = privateKey[i] ^ derivedKey[i]
  }

  return {
    encrypted: `0x${bytesToHex(encrypted)}`,
    iv: `0x${bytesToHex(iv)}`,
  }
}

/**
 * Decrypt signer private key
 */
function decryptPrivateKey(encrypted: string, ivHex: string): Uint8Array {
  const key = getEncryptionKey()
  const iv = hexToBytes(ivHex.replace('0x', ''))
  const encryptedBytes = hexToBytes(encrypted.replace('0x', ''))

  // Reverse the XOR encryption
  const derivedKey = hkdf(
    sha256,
    key,
    iv,
    new TextEncoder().encode('encrypt'),
    encryptedBytes.length,
  )
  const decrypted = new Uint8Array(encryptedBytes.length)
  for (let i = 0; i < encryptedBytes.length; i++) {
    decrypted[i] = encryptedBytes[i] ^ derivedKey[i]
  }

  return decrypted
}

/**
 * Generated signer information
 */
export interface GeneratedSigner {
  publicKey: Hex
  privateKeyEncrypted: string
  encryptionIv: string
}

/**
 * Signer with poster instance
 */
export interface ActiveSigner {
  signer: FarcasterSignerRow
  poster: FarcasterPoster
}

/**
 * Generate a new Ed25519 signer key pair
 */
export function generateSignerKeys(): GeneratedSigner {
  const privateKey = ed25519.utils.randomPrivateKey()
  const publicKey = ed25519.getPublicKey(privateKey)

  const { encrypted, iv } = encryptPrivateKey(privateKey)

  return {
    publicKey: `0x${bytesToHex(publicKey)}` as Hex,
    privateKeyEncrypted: encrypted,
    encryptionIv: iv,
  }
}

/**
 * Create and store a new signer for a user
 */
export async function createSigner(
  address: Address,
  fid: number,
): Promise<FarcasterSignerRow> {
  const keys = generateSignerKeys()

  const signer = createFarcasterSigner({
    address,
    fid,
    signerPublicKey: keys.publicKey,
    encryptedPrivateKey: keys.privateKeyEncrypted,
    encryptionIv: keys.encryptionIv,
  })

  log.info('Created signer', {
    address,
    fid,
    publicKey: `${keys.publicKey.slice(0, 20)}...`,
  })

  return signer
}

/**
 * Get message to sign for signer registration
 */
export function getSignerRegistrationMessage(
  fid: number,
  signerPublicKey: Hex,
  deadline: number,
): string {
  return JSON.stringify({
    fid,
    signerPublicKey,
    deadline,
    message:
      'I authorize this signer key to post on my behalf on Farcaster via Factory',
  })
}

/**
 * Verify signature and activate signer
 */
export async function verifyAndActivateSigner(
  signerPublicKey: Hex,
  signature: Hex,
): Promise<boolean> {
  const success = activateSigner(signerPublicKey, signature)
  if (success) {
    log.info('Activated signer', {
      publicKey: `${signerPublicKey.slice(0, 20)}...`,
    })
  }
  return success
}

/**
 * Get active signer for a user
 */
export function getActiveSigner(address: Address): FarcasterSignerRow | null {
  return getFarcasterSigner(address)
}

/**
 * Get all signers for a user
 */
export function getUserSigners(address: Address): FarcasterSignerRow[] {
  return listFarcasterSigners(address)
}

/**
 * Create a poster instance from a stored signer
 */
export function createPosterFromSigner(
  signer: FarcasterSignerRow,
): FarcasterPoster {
  const privateKey = decryptPrivateKey(
    signer.encrypted_private_key,
    signer.encryption_iv,
  )

  return new FarcasterPoster({
    fid: signer.fid,
    signerPrivateKey: privateKey,
    hubUrl: HUB_URL,
  })
}

/**
 * Get active signer with poster instance
 */
export function getActiveSignerWithPoster(
  address: Address,
): ActiveSigner | null {
  const signer = getActiveSigner(address)
  if (!signer) return null

  const poster = createPosterFromSigner(signer)
  return { signer, poster }
}

/**
 * Revoke a signer
 */
export function revokeSigner(signerId: string): boolean {
  const success = updateSignerState(signerId, 'revoked')
  if (success) {
    log.info('Revoked signer', { signerId })
  }
  return success
}

/**
 * Check if a user has an active signer
 */
export function hasActiveSigner(address: Address): boolean {
  const signer = getActiveSigner(address)
  return signer !== null && signer.key_state === 'active'
}

/**
 * Get signer status for a user
 */
export interface SignerStatus {
  hasSigner: boolean
  isActive: boolean
  publicKey: Hex | null
  fid: number | null
  createdAt: number | null
}

export function getSignerStatus(address: Address): SignerStatus {
  const signer = getActiveSigner(address)

  if (!signer) {
    return {
      hasSigner: false,
      isActive: false,
      publicKey: null,
      fid: null,
      createdAt: null,
    }
  }

  return {
    hasSigner: true,
    isActive: signer.key_state === 'active',
    publicKey: signer.signer_public_key as Hex,
    fid: signer.fid,
    createdAt: signer.created_at,
  }
}

/**
 * Decode private key for signing (internal use only)
 * Returns the raw private key bytes for signing operations
 */
export function getSignerPrivateKey(signer: FarcasterSignerRow): Uint8Array {
  return decryptPrivateKey(signer.encrypted_private_key, signer.encryption_iv)
}

/**
 * Sign a message with a signer's private key
 */
export function signMessage(
  signer: FarcasterSignerRow,
  message: Uint8Array,
): Hex {
  const privateKey = getSignerPrivateKey(signer)
  const signature = ed25519.sign(message, privateKey)
  return `0x${bytesToHex(signature)}` as Hex
}
