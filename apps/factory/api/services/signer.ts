import { getFarcasterHubUrl, isProductionEnv } from '@jejunetwork/config'
import { FarcasterPoster } from '@jejunetwork/messaging'
import { createLogger } from '@jejunetwork/shared'
import { ed25519 } from '@noble/curves/ed25519'
import { hkdfSync, randomBytes } from 'node:crypto'
import type { Address, Hex } from 'viem'
import { getFactoryConfig } from '../config'
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

/**
 * Get encryption key from config.
 * SECURITY: Fails in production if no key is configured.
 * Development uses a derived key for convenience only.
 */
function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.startsWith('0x') ? hex.slice(2) : hex
  return new Uint8Array(Buffer.from(normalized, 'hex'))
}

function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Uint8Array {
  return new Uint8Array(
    hkdfSync(
      'sha256',
      Buffer.from(ikm),
      Buffer.from(salt),
      Buffer.from(info),
      length,
    ),
  )
}

function getEncryptionKey(): Uint8Array {
  const config = getFactoryConfig()

  if (config.signerEncryptionKey) {
    return hexToBytes(config.signerEncryptionKey.replace('0x', ''))
  }

  // Production MUST have encryption key configured
  if (isProductionEnv()) {
    throw new Error(
      'SIGNER_ENCRYPTION_KEY is required in production. ' +
        'Set this secret via KMS or environment variable.',
    )
  }

  // Development-only fallback with clear warning
  log.warn(
    'Using derived encryption key for development. ' +
      'Set SIGNER_ENCRYPTION_KEY for proper security.',
  )

  const seed = `factory-signer-dev-${Date.now()}-${bytesToHex(randomBytes(8))}`
  const seedBytes = new TextEncoder().encode(seed)
  const salt = randomBytes(32)
  const info = new TextEncoder().encode('aes-key')
  return hkdfSha256(seedBytes, salt, info, 32)
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
  const derivedKey = hkdfSha256(
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
  const derivedKey = hkdfSha256(
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
  const success = await activateSigner(signerPublicKey, signature)
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
export async function getActiveSigner(
  address: Address,
): Promise<FarcasterSignerRow | null> {
  return await getFarcasterSigner(address)
}

/**
 * Get all signers for a user
 */
export async function getUserSigners(
  address: Address,
): Promise<FarcasterSignerRow[]> {
  return await listFarcasterSigners(address)
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
export async function getActiveSignerWithPoster(
  address: Address,
): Promise<ActiveSigner | null> {
  const signer = await getActiveSigner(address)
  if (!signer) return null

  const poster = createPosterFromSigner(signer)
  return { signer, poster }
}

/**
 * Revoke a signer
 */
export async function revokeSigner(signerId: string): Promise<boolean> {
  const success = await updateSignerState(signerId, 'revoked')
  if (success) {
    log.info('Revoked signer', { signerId })
  }
  return success
}

/**
 * Check if a user has an active signer
 */
export async function hasActiveSigner(address: Address): Promise<boolean> {
  const signer = await getActiveSigner(address)
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

export async function getSignerStatus(address: Address): Promise<SignerStatus> {
  const signer = await getActiveSigner(address)

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
