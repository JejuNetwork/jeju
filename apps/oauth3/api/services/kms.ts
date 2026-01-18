/**
 * OAuth3 KMS Service - Secure key management for authentication
 *
 * Uses DWS KMS for signing and encryption.
 */

import { getKMSServiceFromEnv, type KMSServiceClient } from '@jejunetwork/shared'
import type { Address, Hex } from 'viem'
import { isHex, keccak256, toBytes, toHex, verifyMessage } from 'viem'
import { z } from 'zod'

interface OAuth3KMSConfig {
  jwtSigningKeyId: string
  jwtSignerAddress: Address
  serviceAgentId: string
  chainId: string
}

let kmsConfig: OAuth3KMSConfig | null = null
let kmsInitialized = false
let kmsService: KMSServiceClient | null = null

function getKmsService(): KMSServiceClient {
  if (!kmsService) {
    kmsService = getKMSServiceFromEnv()
  }
  return kmsService
}

function getConfig(): OAuth3KMSConfig {
  if (!kmsConfig) {
    throw new Error('KMS not configured')
  }
  return kmsConfig
}

/**
 * Initialize KMS for OAuth3 service.
 */
export async function initializeKMS(config: OAuth3KMSConfig): Promise<void> {
  if (kmsInitialized) return

  kmsConfig = config
  const healthy = await getKmsService().isHealthy()
  if (!healthy) {
    throw new Error('KMS is not healthy')
  }
  console.log('[OAuth3/KMS] Connected to DWS KMS')
  kmsInitialized = true
}

// ============ JWT Token Operations ============

export interface JWTPayload {
  sub: string
  iat: number
  exp: number
  iss?: string
  aud?: string
  scopes?: string[]
  jti?: string
}

function base64urlEncode(str: string): string {
  const base64 = Buffer.from(str).toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64urlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) {
    base64 += '='
  }
  return Buffer.from(base64, 'base64').toString()
}

/**
 * Generate a secure JWT token signed with DWS KMS.
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
  const now = Math.floor(Date.now() / 1000)
  const jti = crypto.randomUUID()
  const expiresInSeconds = options?.expiresInSeconds ?? 3600
  const expiration = now + expiresInSeconds

  const claims = {
    sub: userId,
    iss: options?.issuer ?? 'jeju:oauth3',
    aud: options?.audience ?? 'gateway',
    scopes: options?.scopes,
    iat: now,
    jti,
    exp: expiration,
  }

  const config = getConfig()
  const header = { alg: 'ES256K', typ: 'JWT', kid: config.jwtSigningKeyId }
  const headerB64 = base64urlEncode(JSON.stringify(header))
  const payloadB64 = base64urlEncode(JSON.stringify(claims))
  const signingInput = `${headerB64}.${payloadB64}`
  const messageHash = keccak256(toBytes(signingInput))

  const signature = await getKmsService().sign(
    messageHash,
    config.jwtSignerAddress,
  )
  if (!isHex(signature)) {
    throw new Error('KMS returned non-hex signature')
  }
  const signatureB64 = base64urlEncode(signature)

  return `${headerB64}.${payloadB64}.${signatureB64}`
}

/**
 * Verify a JWT token signed with DWS KMS.
 * Returns the user ID (sub claim) if valid, null otherwise.
 */
export async function verifySecureToken(token: string): Promise<string | null> {
  const parts = token.split('.')
  if (parts.length !== 3) {
    return null
  }

  const [headerB64, payloadB64, signatureB64] = parts

  let header: { alg?: string; kid?: string }
  let claims: { sub?: string; iss?: string; exp?: number }
  try {
    header = JSON.parse(base64urlDecode(headerB64))
    claims = JSON.parse(base64urlDecode(payloadB64))
  } catch {
    return null
  }

  if (claims.iss !== 'jeju:oauth3') {
    return null
  }

  if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) {
    return null
  }

  const signingInput = `${headerB64}.${payloadB64}`

  if (!kmsConfig) {
    return null
  }

  const messageHash = keccak256(toBytes(signingInput))
  const signature = base64urlDecode(signatureB64)
  if (!isHex(signature)) {
    return null
  }

  const isValid = await verifyMessage({
    address: kmsConfig.jwtSignerAddress,
    message: { raw: toBytes(messageHash) },
    signature,
  })

  if (!isValid || !claims.sub) {
    return null
  }

  return claims.sub
}

// ============ Secret Sealing ============

interface SealedSecret {
  encrypted: string
  sealedAt: number
}

/**
 * Seal (encrypt) a secret using DWS KMS.
 */
export async function sealSecret(plaintext: string): Promise<SealedSecret> {
  const config = getConfig()
  const encrypted = await getKmsService().encrypt(
    plaintext,
    config.jwtSignerAddress,
  )

  return {
    encrypted,
    sealedAt: Date.now(),
  }
}

/**
 * Unseal (decrypt) a previously sealed secret.
 */
export async function unsealSecret(sealed: SealedSecret): Promise<string> {
  const config = getConfig()
  return getKmsService().decrypt(sealed.encrypted, config.jwtSignerAddress)
}

// ============ Session Data Encryption ============

interface EncryptedSessionData {
  encrypted: string
}

/**
 * Encrypt session data using DWS KMS.
 */
export async function encryptSessionData(
  plaintext: string,
): Promise<EncryptedSessionData> {
  const config = getConfig()
  const encrypted = await getKmsService().encrypt(
    plaintext,
    config.jwtSignerAddress,
  )
  return { encrypted }
}

/**
 * Decrypt session data.
 */
export async function decryptSessionData(
  encrypted: EncryptedSessionData,
): Promise<string> {
  const config = getConfig()
  return getKmsService().decrypt(encrypted.encrypted, config.jwtSignerAddress)
}

// ============ Challenge Generation ============

/**
 * Generate a cryptographic challenge for wallet authentication.
 */
export async function generateChallenge(
  address: Address,
  clientId: string,
): Promise<{
  challenge: string
  expiresAt: number
}> {
  const nonce = crypto.randomUUID()
  const timestamp = Date.now()
  const expiresAt = timestamp + 5 * 60 * 1000 // 5 minutes

  // Create challenge message that user will sign
  const challenge = [
    `Sign this message to authenticate with ${clientId}`,
    '',
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${timestamp}`,
    `Expires: ${new Date(expiresAt).toISOString()}`,
  ].join('\n')

  return { challenge, expiresAt }
}

/**
 * Verify a signed challenge.
 */
export async function verifyChallenge(
  address: Address,
  challenge: string,
  signature: Hex,
): Promise<boolean> {
  // Verify the signature matches the address
  const isValid = await verifyMessage({
    address,
    message: challenge,
    signature,
  })

  if (!isValid) {
    return false
  }

  // Extract and verify expiration from challenge
  const expiresMatch = challenge.match(/Expires: (.+)/)
  if (expiresMatch) {
    const expiresAt = new Date(expiresMatch[1]).getTime()
    if (Date.now() > expiresAt) {
      return false
    }
  }

  return true
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
 */
export async function hashClientSecret(
  secret: string,
): Promise<HashedClientSecret> {
  const salt = crypto.randomUUID()
  const encoder = new TextEncoder()

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'PBKDF2',
    false,
    ['deriveBits'],
  )

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  )

  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

  return {
    hash,
    salt,
    algorithm: 'pbkdf2' as const,
    version: 1,
  }
}

/**
 * Verify a client secret against its hash.
 */
export async function verifyClientSecret(
  secret: string,
  storedHash: { hash: string; salt: string },
): Promise<boolean> {
  const encoder = new TextEncoder()

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'PBKDF2',
    false,
    ['deriveBits'],
  )

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(storedHash.salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  )

  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const computedHash = hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return computedHash === storedHash.hash
}

/**
 * Alias for verifyClientSecret for backward compatibility.
 */
export const verifyClientSecretHash = verifyClientSecret

// ============ PKCE Code Verifier Encryption ============

const EncryptedVerifierSchema = z.object({
  state: z.string(),
  codeVerifier: z.string(),
})

/**
 * Encrypt a PKCE code verifier before storing in database.
 * Uses DWS KMS.
 */
export async function encryptCodeVerifier(
  codeVerifier: string,
  state: string,
): Promise<string> {
  const config = getConfig()
  const payload = JSON.stringify({ state, codeVerifier })
  return getKmsService().encrypt(payload, config.jwtSignerAddress)
}

/**
 * Decrypt a PKCE code verifier using the state parameter.
 */
export async function decryptCodeVerifier(
  encryptedVerifier: string,
  state: string,
): Promise<string> {
  const config = getConfig()
  const decrypted = await getKmsService().decrypt(
    encryptedVerifier,
    config.jwtSignerAddress,
  )
  const parsed = EncryptedVerifierSchema.parse(JSON.parse(decrypted))
  if (parsed.state !== state) {
    throw new Error('PKCE state mismatch')
  }
  return parsed.codeVerifier
}

// ============ Ephemeral Keys ============

interface EphemeralKey {
  keyId: string
  publicKey: Hex
  createdAt: number
  expiresAt: number
}

// Ephemeral key storage (per-session keys)
const ephemeralKeys = new Map<string, EphemeralKey>()

/**
 * Get or create an ephemeral key for a session.
 */
export async function getEphemeralKey(
  sessionId: string,
): Promise<EphemeralKey> {
  // Check if we already have a key for this session
  const existing = ephemeralKeys.get(sessionId)
  if (existing && existing.expiresAt > Date.now()) {
    return existing
  }

  // Create new ephemeral key with random public key
  const keyId = `ephemeral-${sessionId}-${Date.now()}`
  const now = Date.now()
  const keyBytes = crypto.getRandomValues(new Uint8Array(32))
  const ephemeralKey: EphemeralKey = {
    keyId,
    publicKey: toHex(keyBytes),
    createdAt: now,
    expiresAt: now + 24 * 60 * 60 * 1000, // 24 hours
  }

  ephemeralKeys.set(sessionId, ephemeralKey)
  return ephemeralKey
}

/**
 * Invalidate an ephemeral key.
 */
export function invalidateEphemeralKey(sessionId: string): void {
  ephemeralKeys.delete(sessionId)
}

// ============ KMS Health ============

/**
 * Get KMS health status.
 */
export function getKMSStatus(): {
  healthy: boolean
  mode: string
  network: string
  keys: number
  initialized: boolean
} {
  const config = kmsConfig
  return {
    healthy: kmsInitialized,
    mode: 'dws',
    network: config?.chainId ?? 'unknown',
    keys: 0,
    initialized: kmsInitialized,
  }
}
