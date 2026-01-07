/**
 * OAuth3 KMS Service - Secure key management for authentication
 *
 * SECURITY: NO FALLBACK MODE. This service requires a running KMS service.
 * In development, run `jeju dev` which starts KMS in simulated TEE mode.
 *
 * All signing and encryption operations go through the proper KMS infrastructure:
 * - FROST MPC threshold signing (production)
 * - TEE hardware isolation (production)
 * - Simulated TEE (development only, via jeju dev)
 */

import { isProductionEnv } from '@jejunetwork/config'
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  deriveKeyFromSecretAsync,
  getKMS,
  type KMSService,
} from '@jejunetwork/kms'
import type { Address, Hex } from 'viem'
import { toHex } from 'viem'

interface OAuth3KMSConfig {
  jwtSigningKeyId: string
  jwtSignerAddress: Address
  serviceAgentId: string
  chainId: string
}

let kmsInstance: KMSService | null = null
let kmsConfig: OAuth3KMSConfig | null = null

/**
 * Initialize KMS for OAuth3 service.
 * REQUIRES KMS to be running - no fallback mode.
 */
export async function initializeKMS(config: OAuth3KMSConfig): Promise<void> {
  kmsConfig = config

  // Get KMS instance - will throw if not available
  kmsInstance = getKMS()
  await kmsInstance.initialize()

  console.log('[OAuth3/KMS] Initialized with service:', config.serviceAgentId)
}

function getKMSInstance(): KMSService {
  if (!kmsInstance) {
    throw new Error(
      'KMS not initialized. Ensure KMS service is running (use `jeju dev`).',
    )
  }
  return kmsInstance
}

function getConfig(): OAuth3KMSConfig {
  if (!kmsConfig) {
    throw new Error('KMS not configured')
  }
  return kmsConfig
}

// ============ JWT Token Operations ============

export interface JWTPayload {
  sub: string
  iat: number
  exp: number
  jti: string
  iss?: string
  aud?: string
}

/**
 * Generate a secure JWT token signed by KMS.
 */
export async function generateSecureToken(
  userId: string,
  options?: {
    expiresInSeconds?: number
    issuer?: string
    audience?: string
    scopes?: string[]
  },
): Promise<string> {
  const kms = getKMSInstance()
  const config = getConfig()

  const signedToken = await kms.issueToken(
    {
      sub: userId,
      iss: options?.issuer ?? 'jeju:oauth3',
      aud: options?.audience ?? 'gateway',
      scopes: options?.scopes,
    },
    {
      keyId: config.jwtSigningKeyId,
      expiresInSeconds: options?.expiresInSeconds ?? 3600,
    },
  )

  return signedToken.token
}

/**
 * Verify a JWT token signed by KMS.
 * Returns the user ID (sub claim) if valid, null otherwise.
 */
export async function verifySecureToken(token: string): Promise<string | null> {
  const kms = getKMSInstance()
  const config = getConfig()

  const result = await kms.verifyToken(token, {
    issuer: 'jeju:oauth3',
    expectedSigner: config.jwtSignerAddress,
  })

  if (!result.valid || !result.claims?.sub) {
    return null
  }

  return result.claims.sub
}

// ============ Secret Sealing ============

interface SealedSecret {
  ciphertext: string
  iv: string
  tag: string
  sealedAt: number
}

/**
 * Seal a secret using KMS-derived key.
 * Secrets are bound to the service agent ID for access control.
 */
export async function sealSecret(
  secret: string,
  attestationBinding?: string,
): Promise<SealedSecret> {
  const config = getConfig()
  const binding = attestationBinding ?? config.serviceAgentId

  // Derive encryption key from binding
  const key = await deriveKeyFromSecretAsync(binding, 'oauth3-seal')
  const iv = crypto.getRandomValues(new Uint8Array(12))

  const encrypted = await aesGcmEncrypt(
    new TextEncoder().encode(secret),
    key,
    iv,
  )

  return {
    ciphertext: toHex(new Uint8Array(encrypted.ciphertext)),
    iv: toHex(iv),
    tag: toHex(encrypted.tag),
    sealedAt: Date.now(),
  }
}

/**
 * Unseal a secret using KMS-derived key.
 */
export async function unsealSecret(
  sealed: SealedSecret,
  attestationBinding?: string,
): Promise<string> {
  const config = getConfig()
  const binding = attestationBinding ?? config.serviceAgentId

  const iv = hexToBytes(sealed.iv)
  const ciphertext = hexToBytes(sealed.ciphertext)
  const tag = hexToBytes(sealed.tag)

  const key = await deriveKeyFromSecretAsync(binding, 'oauth3-seal')
  const decrypted = await aesGcmDecrypt(ciphertext, key, iv, tag)

  return new TextDecoder().decode(decrypted)
}

// ============ Client Secret Hashing ============

export interface HashedClientSecret {
  hash: string
  salt: string
  algorithm: 'argon2id' | 'pbkdf2'
  version: number
}

/**
 * Hash a client secret using PBKDF2.
 * The plaintext secret is returned only once at registration.
 */
export async function hashClientSecret(
  secret: string,
): Promise<HashedClientSecret> {
  const salt = crypto.getRandomValues(new Uint8Array(16))

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveBits'],
  )

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  )

  return {
    hash: toHex(new Uint8Array(hashBuffer)),
    salt: toHex(salt),
    algorithm: 'pbkdf2',
    version: 1,
  }
}

/**
 * Verify a client secret against stored hash using constant-time comparison.
 */
export async function verifyClientSecretHash(
  secret: string,
  hashed: HashedClientSecret,
): Promise<boolean> {
  const saltBytes = hexToBytes(hashed.salt)

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveBits'],
  )

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes.buffer as ArrayBuffer,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  )

  const computedHash = toHex(new Uint8Array(hashBuffer))

  // Constant-time comparison to prevent timing attacks
  if (computedHash.length !== hashed.hash.length) {
    return false
  }

  let result = 0
  for (let i = 0; i < computedHash.length; i++) {
    result |= computedHash.charCodeAt(i) ^ hashed.hash.charCodeAt(i)
  }

  return result === 0
}

// ============ PKCE Code Verifier Encryption ============

/**
 * Encrypt a PKCE code verifier before storing in database.
 * Uses a short-lived encryption key derived from the state parameter.
 */
export async function encryptCodeVerifier(
  codeVerifier: string,
  state: string,
): Promise<string> {
  const key = await deriveKeyFromSecretAsync(state, 'oauth3-pkce')
  const iv = crypto.getRandomValues(new Uint8Array(12))

  const encrypted = await aesGcmEncrypt(
    new TextEncoder().encode(codeVerifier),
    key,
    iv,
  )

  // Combine iv + ciphertext + tag for storage
  const combined = new Uint8Array(12 + encrypted.ciphertext.byteLength + 16)
  combined.set(iv)
  combined.set(new Uint8Array(encrypted.ciphertext), 12)
  combined.set(encrypted.tag, 12 + encrypted.ciphertext.byteLength)

  return toHex(combined)
}

/**
 * Decrypt a PKCE code verifier using the state parameter.
 */
export async function decryptCodeVerifier(
  encryptedVerifier: string,
  state: string,
): Promise<string> {
  const combined = hexToBytes(encryptedVerifier)

  const iv = combined.slice(0, 12)
  const tag = combined.slice(-16)
  const ciphertext = combined.slice(12, -16)

  const key = await deriveKeyFromSecretAsync(state, 'oauth3-pkce')
  const decrypted = await aesGcmDecrypt(ciphertext, key, iv, tag)

  return new TextDecoder().decode(decrypted)
}

// ============ Session Data Encryption ============

export interface EncryptedSessionData {
  ciphertext: string
  iv: string
  keyId: string
  encryptedAt: number
}

/**
 * Encrypt session PII data using KMS.
 */
export async function encryptSessionData(
  data: Record<string, string | number | undefined>,
): Promise<EncryptedSessionData> {
  const kms = getKMSInstance()
  const config = getConfig()

  const plaintext = JSON.stringify(data)

  const encrypted = await kms.encrypt({
    data: plaintext,
    policy: {
      conditions: [
        {
          type: 'timestamp',
          chain: config.chainId,
          comparator: '>=',
          value: 0,
        },
      ],
      operator: 'and',
    },
  })

  return {
    ciphertext: encrypted.ciphertext,
    iv: '',
    keyId: encrypted.keyId,
    encryptedAt: encrypted.encryptedAt,
  }
}

/**
 * Decrypt session PII data using KMS.
 */
export async function decryptSessionData(
  encrypted: EncryptedSessionData,
): Promise<Record<string, string | number | undefined>> {
  const kms = getKMSInstance()
  const config = getConfig()

  const decrypted = await kms.decrypt({
    payload: {
      ciphertext: encrypted.ciphertext,
      dataHash: '0x' as Hex,
      accessControlHash: '0x' as Hex,
      policy: {
        conditions: [
          {
            type: 'timestamp',
            chain: config.chainId,
            comparator: '>=',
            value: 0,
          },
        ],
        operator: 'and',
      },
      providerType: 'encryption',
      encryptedAt: encrypted.encryptedAt,
      keyId: encrypted.keyId,
    },
  })

  return JSON.parse(decrypted) as Record<string, string | number | undefined>
}

// ============ Ephemeral Keys ============

export interface EphemeralKey {
  keyId: string
  publicKey: Hex
  createdAt: number
  expiresAt: number
  rotationCount: number
}

const ephemeralKeys = new Map<string, EphemeralKey>()
const KEY_ROTATION_INTERVAL = 15 * 60 * 1000
const KEY_EXPIRY = 60 * 60 * 1000

/**
 * Get or create an ephemeral key for a session.
 * Keys are rotated every 15 minutes and expire after 1 hour.
 */
export async function getEphemeralKey(sessionId: string): Promise<EphemeralKey> {
  const existing = ephemeralKeys.get(sessionId)
  const now = Date.now()

  if (existing && now - existing.createdAt < KEY_ROTATION_INTERVAL) {
    return existing
  }

  const keyId = `ephemeral:${sessionId}:${now}`
  const keyBytes = crypto.getRandomValues(new Uint8Array(32))

  const newKey: EphemeralKey = {
    keyId,
    publicKey: toHex(keyBytes),
    createdAt: now,
    expiresAt: now + KEY_EXPIRY,
    rotationCount: (existing?.rotationCount ?? 0) + 1,
  }

  ephemeralKeys.set(sessionId, newKey)
  cleanupExpiredKeys()

  return newKey
}

/**
 * Invalidate an ephemeral key (e.g., on logout).
 */
export function invalidateEphemeralKey(sessionId: string): void {
  ephemeralKeys.delete(sessionId)
}

function cleanupExpiredKeys(): void {
  const now = Date.now()
  for (const [id, key] of ephemeralKeys) {
    if (key.expiresAt < now) {
      ephemeralKeys.delete(id)
    }
  }
}

// ============ Utilities ============

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(cleanHex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

export type { OAuth3KMSConfig }
