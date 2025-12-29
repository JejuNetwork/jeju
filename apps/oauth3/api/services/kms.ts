import type { Address, Hex } from 'viem'
import { keccak256, toBytes, toHex } from 'viem'

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

function getKmsModule(): KMSModule | null {
  return null
}

interface OAuth3KMSConfig {
  jwtSigningKeyId: string
  jwtSignerAddress: Address
  serviceAgentId: string
  chainId: string
  devMode?: boolean
}

let kmsInstance: KMS | null = null
let kmsConfig: OAuth3KMSConfig | null = null

export async function initializeKMS(config: OAuth3KMSConfig): Promise<void> {
  kmsConfig = config

  if (config.devMode) {
    console.log('[KMS] Dev mode')
    return
  }

  const kms = getKmsModule()
  if (kms) {
    kmsInstance = kms.getKMS()
    await kmsInstance.initialize()
    console.log('[KMS] Initialized')
  } else {
    kmsConfig.devMode = true
  }
}

function getKMSInstance(): KMS {
  if (!kmsInstance) {
    throw new Error('KMS not initialized')
  }
  return kmsInstance
}

export interface JWTPayload {
  sub: string
  iat: number
  exp: number
  jti: string
  iss?: string
  aud?: string
}

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

export async function verifySecureToken(token: string): Promise<string | null> {
  if (!kmsConfig) {
    throw new Error('KMS not configured')
  }

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

interface SealedSecret {
  ciphertext: string
  iv: string
  tag: string
  sealedAt: number
}

export async function sealSecret(
  secret: string,
  attestationBinding?: string,
): Promise<SealedSecret> {
  if (!kmsConfig) {
    throw new Error('KMS not configured')
  }

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

  const key = await deriveKeyFallback(binding)
  const decrypted = await decryptAesGcmFallback(ciphertext, key, iv, tag)
  return new TextDecoder().decode(decrypted)
}

export interface HashedClientSecret {
  hash: string
  salt: string
  algorithm: 'argon2id' | 'pbkdf2'
  version: number
}

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

  if (computedHash.length !== hashed.hash.length) {
    return false
  }

  let result = 0
  for (let i = 0; i < computedHash.length; i++) {
    result |= computedHash.charCodeAt(i) ^ hashed.hash.charCodeAt(i)
  }

  return result === 0
}

export interface EncryptedSessionData {
  ciphertext: string
  iv: string
  keyId: string
  encryptedAt: number
}

export async function encryptSessionData(
  data: Record<string, string | number | undefined>,
): Promise<EncryptedSessionData> {
  if (!kmsConfig) {
    throw new Error('KMS not configured')
  }

  const plaintext = JSON.stringify(data)

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
        value: 0,
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
    iv: '',
    keyId: encrypted.keyId,
    encryptedAt: encrypted.encryptedAt,
  }
}

export async function decryptSessionData(
  encrypted: EncryptedSessionData,
): Promise<Record<string, string | number | undefined>> {
  if (!kmsConfig) {
    throw new Error('KMS not configured')
  }

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

export async function getEphemeralKey(
  sessionId: string,
): Promise<EphemeralKey> {
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

    if (!payload.dev) return null
    if (payload.exp < Math.floor(Date.now() / 1000)) return null

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

  const tag = combined.slice(-16)
  const ciphertext = combined.slice(0, -16)

  const decrypted = await decryptAesGcmFallback(ciphertext, key, iv, tag)
  return JSON.parse(new TextDecoder().decode(decrypted)) as Record<
    string,
    string | number | undefined
  >
}

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(cleanHex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

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

export type { OAuth3KMSConfig }
