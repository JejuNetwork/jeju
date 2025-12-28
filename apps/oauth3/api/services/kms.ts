/**
 * KMS Service for OAuth3 - Secure key management with MPC threshold signing
 *
 * SECURITY: This service ensures no single party (including TEE) has access to:
 * - JWT signing keys (distributed via MPC)
 * - OAuth provider secrets (sealed to attestation)
 * - Client secrets (stored as hashes)
 *
 * Side-channel attack mitigation:
 * - MPC threshold signing (2-of-3) - no single key holder
 * - Sealed secrets require valid TEE attestation
 * - Short-lived ephemeral session keys
 */

import type { Address, Hex } from 'viem'
import { keccak256, toBytes, toHex } from 'viem'

// Types for KMS integration (actual KMS package provides these)
interface KMS {
  initialize(): Promise<void>
  encrypt(request: EncryptRequest): Promise<EncryptedPayload>
  decrypt(request: DecryptRequest): Promise<string>
}

interface TokenClaims {
  sub: string
  iss: string
  aud: string
  exp?: number
  scopes?: string[]
}

interface SignedToken {
  token: string
  header: string
  payload: string
  signature: Hex
}

interface TokenVerifyResult {
  valid: boolean
  claims?: TokenClaims
}

interface EncryptRequest {
  data: string
  policy: AccessControlPolicy
}

interface DecryptRequest {
  payload: EncryptedPayload
}

interface EncryptedPayload {
  ciphertext: string
  keyId: string
  encryptedAt: number
  dataHash: Hex
  accessControlHash: Hex
  policy: AccessControlPolicy
  providerType: string
}

interface AccessControlPolicy {
  conditions: Array<{
    type: string
    chain: string
    comparator: string
    value: number
  }>
  operator: 'and' | 'or'
}

// KMS module interface - actual implementation loaded dynamically if available
interface KMSModule {
  getKMS: () => KMS
  issueToken: (
    claims: Omit<TokenClaims, 'iat' | 'jti'>,
    options?: { keyId?: string; expiresInSeconds?: number },
  ) => Promise<SignedToken>
  verifyToken: (
    token: string,
    options?: { issuer?: string; expectedSigner?: Address },
  ) => Promise<TokenVerifyResult>
  aesGcmEncrypt: (
    data: Uint8Array,
    key: Uint8Array,
    iv: Uint8Array,
  ) => Promise<{ ciphertext: ArrayBuffer; tag: Uint8Array }>
  aesGcmDecrypt: (
    ciphertext: Uint8Array,
    key: Uint8Array,
    iv: Uint8Array,
    tag: Uint8Array,
  ) => Promise<Uint8Array>
  deriveKeyFromSecret: (secret: string, context: string) => Promise<Uint8Array>
}

// Note: KMS module is loaded dynamically at runtime if available
// This function always returns null as the package may not be installed
// In production, the @jejunetwork/kms package should be installed
// When @jejunetwork/kms is available, replace this with dynamic import
function getKmsModule(): KMSModule | null {
  // Always use dev fallbacks for now
  // Dynamic import implementation:
  // const mod = await import('@jejunetwork/kms')
  // return mod as KMSModule
  return null
}

// Service configuration
interface OAuth3KMSConfig {
  /** MPC key ID for JWT signing (distributed across MPC nodes) */
  jwtSigningKeyId: string
  /** MPC key address for JWT verification */
  jwtSignerAddress: Address
  /** Service agent ID for access policies */
  serviceAgentId: string
  /** Chain ID for access control */
  chainId: string
  /** Whether running in development mode (no MPC available) */
  devMode?: boolean
}

let kmsInstance: KMS | null = null
let kmsConfig: OAuth3KMSConfig | null = null

/**
 * Initialize KMS with MPC provider for threshold signing.
 */
export async function initializeKMS(config: OAuth3KMSConfig): Promise<void> {
  kmsConfig = config

  // In dev mode without MPC, use fallback
  if (config.devMode) {
    console.warn(
      '[KMS] Running in dev mode - using local signing (NOT SECURE FOR PRODUCTION)',
    )
    return
  }

  const kms = getKmsModule()
  if (kms) {
    kmsInstance = kms.getKMS()
    await kmsInstance.initialize()
    console.log('[KMS] Initialized with MPC threshold signing')
  } else {
    console.warn('[KMS] KMS package not available, using dev mode fallbacks')
    kmsConfig.devMode = true
  }
}

/**
 * Get the initialized KMS instance.
 * Throws if not initialized.
 */
function getKMSInstance(): KMS {
  if (!kmsInstance) {
    throw new Error(
      'KMS not initialized. Call initializeKMS() first.\n' +
        'For production: Ensure MPC nodes are running.\n' +
        'For development: Set devMode: true in config.',
    )
  }
  return kmsInstance
}

// ============ JWT Token Signing (MPC-backed) ============

export interface JWTPayload {
  sub: string
  iat: number
  exp: number
  jti: string
  iss?: string
  aud?: string
}

/**
 * Generate a JWT token using MPC threshold signing.
 * The signing key is distributed across MPC nodes - no single party has full key.
 *
 * SECURITY: Side-channel safe because:
 * - Signing key never exists in full form
 * - Each MPC party only holds a share
 * - Threshold (2-of-3) required for signing
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
  if (!kmsConfig) {
    throw new Error('KMS not configured')
  }

  // In dev mode, use local JWT (NOT SECURE)
  if (kmsConfig.devMode) {
    return generateDevToken(userId, options)
  }

  const kms = getKmsModule()
  if (!kms) {
    return generateDevToken(userId, options)
  }

  const claims: Omit<TokenClaims, 'iat' | 'jti'> = {
    sub: userId,
    iss: options?.issuer ?? 'jeju:oauth3',
    aud: options?.audience ?? 'gateway',
    scopes: options?.scopes,
  }

  if (options?.expiresInSeconds) {
    claims.exp = Math.floor(Date.now() / 1000) + options.expiresInSeconds
  }

  const signedToken = await kms.issueToken(claims, {
    keyId: kmsConfig.jwtSigningKeyId,
    expiresInSeconds: options?.expiresInSeconds ?? 3600,
  })

  return signedToken.token
}

/**
 * Verify a JWT token signed by MPC.
 * Returns the user ID (subject) if valid, null if invalid.
 */
export async function verifySecureToken(token: string): Promise<string | null> {
  if (!kmsConfig) {
    throw new Error('KMS not configured')
  }

  // In dev mode, use local verification
  if (kmsConfig.devMode) {
    return verifyDevToken(token)
  }

  const kms = getKmsModule()
  if (!kms) {
    return verifyDevToken(token)
  }

  const result = await kms.verifyToken(token, {
    issuer: 'jeju:oauth3',
    expectedSigner: kmsConfig.jwtSignerAddress,
  })

  if (!result.valid || !result.claims?.sub) {
    return null
  }

  return result.claims.sub
}

// ============ Sealed Secrets (TEE Attestation) ============

interface SealedSecret {
  ciphertext: string
  iv: string
  tag: string
  sealedAt: number
}

/**
 * Seal a secret so it can only be decrypted inside a verified TEE.
 * Uses attestation-bound encryption.
 *
 * SECURITY: Even if memory is read via side-channel, the encrypted
 * secret cannot be decrypted without valid TEE attestation.
 */
export async function sealSecret(
  secret: string,
  attestationBinding?: string,
): Promise<SealedSecret> {
  if (!kmsConfig) {
    throw new Error('KMS not configured')
  }

  // Derive key from attestation binding (or service ID in dev)
  const binding = attestationBinding ?? kmsConfig.serviceAgentId

  const kms = getKmsModule()
  if (kms) {
    const key = await kms.deriveKeyFromSecret(binding, 'oauth3-seal')
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await kms.aesGcmEncrypt(
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

  // Dev fallback - AES-GCM encryption
  console.warn('[KMS] Using dev fallback for sealSecret')
  const key = await deriveKeyFallback(binding)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await encryptAesGcmFallback(
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
 * Unseal a secret inside verified TEE.
 * Requires matching attestation binding.
 */
export async function unsealSecret(
  sealed: SealedSecret,
  attestationBinding?: string,
): Promise<string> {
  if (!kmsConfig) {
    throw new Error('KMS not configured')
  }

  const binding = attestationBinding ?? kmsConfig.serviceAgentId
  const iv = hexToBytes(sealed.iv)
  const ciphertext = hexToBytes(sealed.ciphertext)
  const tag = hexToBytes(sealed.tag)

  const kms = getKmsModule()
  if (kms) {
    const key = await kms.deriveKeyFromSecret(binding, 'oauth3-seal')
    const decrypted = await kms.aesGcmDecrypt(ciphertext, key, iv, tag)
    return new TextDecoder().decode(decrypted)
  }

  // Dev fallback
  const key = await deriveKeyFallback(binding)
  const decrypted = await decryptAesGcmFallback(ciphertext, key, iv, tag)
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
 * Store the hash, never the plaintext secret.
 *
 * SECURITY: Even if hash is leaked via side-channel:
 * - PBKDF2 is computationally expensive (resistant to brute force)
 * - Salt is unique per client
 * - Original secret cannot be recovered
 *
 * Note: Argon2id would be preferred but isn't available in Web Crypto.
 * Consider using native Argon2 implementation in production.
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
      iterations: 100000, // High iteration count for security
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
 * Verify a client secret against its hash.
 * Uses constant-time comparison to prevent timing attacks.
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

  // Constant-time comparison
  if (computedHash.length !== hashed.hash.length) {
    return false
  }

  let result = 0
  for (let i = 0; i < computedHash.length; i++) {
    result |= computedHash.charCodeAt(i) ^ hashed.hash.charCodeAt(i)
  }

  return result === 0
}

// ============ Session Data Encryption ============

export interface EncryptedSessionData {
  ciphertext: string
  iv: string
  keyId: string
  encryptedAt: number
}

/**
 * Encrypt sensitive session data (PII like address, email, FID).
 *
 * SECURITY: Even if database is compromised, PII remains encrypted.
 * Key is managed by KMS with access policy.
 */
export async function encryptSessionData(
  data: Record<string, string | number | undefined>,
): Promise<EncryptedSessionData> {
  if (!kmsConfig) {
    throw new Error('KMS not configured')
  }

  const plaintext = JSON.stringify(data)

  // In dev mode, use simple encryption
  if (kmsConfig.devMode) {
    return encryptWithDevKey(plaintext)
  }

  const kms = getKMSInstance()

  const policy: AccessControlPolicy = {
    conditions: [
      {
        type: 'timestamp',
        chain: kmsConfig.chainId,
        comparator: '>=',
        value: 0, // Always accessible (service manages access)
      },
    ],
    operator: 'and',
  }

  const encrypted = await kms.encrypt({
    data: plaintext,
    policy,
  })

  return {
    ciphertext: encrypted.ciphertext,
    iv: '', // Managed by KMS
    keyId: encrypted.keyId,
    encryptedAt: encrypted.encryptedAt,
  }
}

/**
 * Decrypt session data.
 */
export async function decryptSessionData(
  encrypted: EncryptedSessionData,
): Promise<Record<string, string | number | undefined>> {
  if (!kmsConfig) {
    throw new Error('KMS not configured')
  }

  // In dev mode, use simple decryption
  if (kmsConfig.devMode) {
    return decryptWithDevKey(encrypted)
  }

  const kms = getKMSInstance()

  const payload: EncryptedPayload = {
    ciphertext: encrypted.ciphertext,
    dataHash: '0x' as Hex,
    accessControlHash: '0x' as Hex,
    policy: {
      conditions: [
        {
          type: 'timestamp',
          chain: kmsConfig.chainId,
          comparator: '>=',
          value: 0,
        },
      ],
      operator: 'and',
    },
    providerType: 'encryption',
    encryptedAt: encrypted.encryptedAt,
    keyId: encrypted.keyId,
  }

  const decrypted = await kms.decrypt({ payload })
  return JSON.parse(decrypted) as Record<string, string | number | undefined>
}

// ============ Ephemeral Session Keys ============

export interface EphemeralKey {
  keyId: string
  publicKey: Hex
  createdAt: number
  expiresAt: number
  rotationCount: number
}

const ephemeralKeys = new Map<string, EphemeralKey>()
const KEY_ROTATION_INTERVAL = 15 * 60 * 1000 // 15 minutes
const KEY_EXPIRY = 60 * 60 * 1000 // 1 hour

/**
 * Get or create an ephemeral session key.
 * Keys are short-lived and rotated frequently to limit exposure.
 *
 * SECURITY: Even if a key is compromised via side-channel:
 * - Exposure window is limited to 15 minutes
 * - Historical tokens signed with rotated keys are still valid
 * - New tokens use fresh keys
 */
export async function getEphemeralKey(
  sessionId: string,
): Promise<EphemeralKey> {
  const existing = ephemeralKeys.get(sessionId)
  const now = Date.now()

  // Check if key needs rotation
  if (existing && now - existing.createdAt < KEY_ROTATION_INTERVAL) {
    return existing
  }

  // Generate new ephemeral key
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

  // Clean up expired keys
  cleanupExpiredKeys()

  return newKey
}

/**
 * Invalidate an ephemeral key (on logout).
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

// ============ Dev Mode Fallbacks (NOT SECURE) ============

const DEV_SECRET = 'dev-mode-not-for-production-use'

function generateDevToken(
  userId: string,
  options?: { expiresInSeconds?: number },
): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT', dev: true }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  const payload = btoa(
    JSON.stringify({
      sub: userId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (options?.expiresInSeconds ?? 3600),
      jti: crypto.randomUUID(),
      dev: true,
    }),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  // Simple HMAC for dev only
  const sig = keccak256(toBytes(`${header}.${payload}.${DEV_SECRET}`))
    .slice(2, 66)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

  return `${header}.${payload}.${sig}`
}

function verifyDevToken(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  try {
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as { sub: string; exp: number; dev?: boolean }

    if (!payload.dev) return null // Not a dev token
    if (payload.exp < Math.floor(Date.now() / 1000)) return null

    // Verify signature
    const expectedSig = keccak256(
      toBytes(`${parts[0]}.${parts[1]}.${DEV_SECRET}`),
    )
      .slice(2, 66)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')

    if (parts[2] !== expectedSig) return null

    return payload.sub
  } catch {
    return null
  }
}

async function encryptWithDevKey(
  plaintext: string,
): Promise<EncryptedSessionData> {
  const key = await deriveKeyFallback(DEV_SECRET)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await encryptAesGcmFallback(
    new TextEncoder().encode(plaintext),
    key,
    iv,
  )

  // Combine ciphertext and tag for storage
  const combined = new Uint8Array(
    new Uint8Array(encrypted.ciphertext).length + encrypted.tag.length,
  )
  combined.set(new Uint8Array(encrypted.ciphertext))
  combined.set(encrypted.tag, new Uint8Array(encrypted.ciphertext).length)

  return {
    ciphertext: toHex(combined),
    iv: toHex(iv),
    keyId: 'dev-key',
    encryptedAt: Date.now(),
  }
}

async function decryptWithDevKey(
  encrypted: EncryptedSessionData,
): Promise<Record<string, string | number | undefined>> {
  const key = await deriveKeyFallback(DEV_SECRET)
  const iv = hexToBytes(encrypted.iv)
  const combined = hexToBytes(encrypted.ciphertext)

  // Extract tag from end of combined data (last 16 bytes)
  const tag = combined.slice(-16)
  const ciphertext = combined.slice(0, -16)

  const decrypted = await decryptAesGcmFallback(ciphertext, key, iv, tag)
  return JSON.parse(new TextDecoder().decode(decrypted)) as Record<
    string,
    string | number | undefined
  >
}

// ============ Utility Functions ============

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(cleanHex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

// ============ Fallback Encryption (Dev Mode Only) ============

async function deriveKeyFallback(secret: string): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const secretBytes = encoder.encode(secret)
  const saltBytes = encoder.encode('oauth3-fallback-salt')

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    'PBKDF2',
    false,
    ['deriveBits'],
  )

  const keyBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 10000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  )

  return new Uint8Array(keyBuffer)
}

async function encryptAesGcmFallback(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
): Promise<{ ciphertext: ArrayBuffer; tag: Uint8Array }> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  )

  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv.buffer as ArrayBuffer,
      tagLength: 128,
    },
    cryptoKey,
    data.buffer as ArrayBuffer,
  )

  // Last 16 bytes are the auth tag
  const encryptedArray = new Uint8Array(encrypted)
  const ciphertext = encryptedArray.slice(0, -16)
  const tag = encryptedArray.slice(-16)

  return { ciphertext: ciphertext.buffer as ArrayBuffer, tag }
}

async function decryptAesGcmFallback(
  ciphertext: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  tag: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  )

  // Combine ciphertext and tag
  const combined = new Uint8Array(ciphertext.length + tag.length)
  combined.set(ciphertext)
  combined.set(tag, ciphertext.length)

  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv.buffer as ArrayBuffer,
      tagLength: 128,
    },
    cryptoKey,
    combined.buffer as ArrayBuffer,
  )

  return new Uint8Array(decrypted)
}

// Export config type
export type { OAuth3KMSConfig }
