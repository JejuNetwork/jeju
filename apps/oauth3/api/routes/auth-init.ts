/**
 * Auth initialization routes for programmatic auth flow initiation
 * This allows clients to initialize auth flows via API calls
 */

import {
  getCurrentNetwork,
  getLocalhostHost,
  getOAuth3Url,
  isProductionEnv,
} from '@jejunetwork/config'
import { Elysia, t } from 'elysia'
import type { Address, Hex } from 'viem'
import { isAddress, isHex, verifyMessage } from 'viem'
import { z } from 'zod'
import type { AuthConfig } from '../../lib/types'
import { getEphemeralKey, initializeKMS } from '../services/kms'
import {
  clientState,
  initializeState,
  passkeyState,
  sessionState,
} from '../services/state'

const InitBodySchema = t.Object({
  provider: t.String(),
  redirectUri: t.String(),
  appId: t.Optional(t.String()),
  state: t.Optional(t.String()),
})

const WalletAuthBodySchema = t.Object({
  address: t.String({ pattern: '^0x[a-fA-F0-9]{40}$' }),
  signature: t.String({ pattern: '^0x[a-fA-F0-9]+$' }),
  message: t.String(),
  appId: t.Optional(t.String()),
})

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' satisfies Address
const EMPTY_HEX = '0x' satisfies Hex

const PasskeyOptionsBodySchema = t.Object({
  appId: t.Optional(t.String()),
  origin: t.String(),
})

const PasskeyVerifyBodySchema = t.Object({
  appId: t.Optional(t.String()),
  mode: t.Union([t.Literal('registration'), t.Literal('authentication')]),
  deviceName: t.Optional(t.String()),
  challengeId: t.String(),
  credential: t.Object({
    id: t.String(),
    rawId: t.String(),
    type: t.String(),
    response: t.Object({
      clientDataJSON: t.String(),
      attestationObject: t.Optional(t.String()),
      authenticatorData: t.Optional(t.String()),
      signature: t.Optional(t.String()),
      userHandle: t.Optional(t.String()),
    }),
  }),
})

/**
 * SECURITY: Validate redirect URI against client's registered patterns.
 * Prevents open redirect attacks by:
 * 1. Only allowing http/https schemes
 * 2. Strict pattern matching with proper escaping
 * 3. Not allowing data:, javascript:, or other dangerous schemes
 */
function validateRedirectUri(
  redirectUri: string,
  allowedPatterns: string[],
): boolean {
  // Parse the redirect URI to validate its structure
  let parsed: URL
  try {
    parsed = new URL(redirectUri)
  } catch {
    return false // Invalid URL format
  }

  // SECURITY: Only allow http/https schemes
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return false
  }

  // SECURITY: Block localhost in production patterns (but allow explicit localhost patterns)
  const hasLocalhostPattern = allowedPatterns.some(
    (p) =>
      p.includes('localhost') || p.includes('127.0.0.1') || p.includes('[::1]'),
  )

  if (
    !hasLocalhostPattern &&
    (parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]')
  ) {
    return false
  }

  for (const pattern of allowedPatterns) {
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
    const regex = new RegExp(`^${regexPattern}$`)
    if (regex.test(redirectUri)) {
      return true
    }
  }
  return false
}

const ClientDataSchema = z.object({
  type: z.string(),
  challenge: z.string(),
  origin: z.string(),
})

const PASSKEY_CHALLENGE_EXPIRY_MS = 5 * 60 * 1000

function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padLen = (4 - (base64.length % 4)) % 4
  const padded = base64 + '='.repeat(padLen)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

function bufferToBase64url(buffer: Uint8Array): string {
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function getSignCount(authenticatorData: Uint8Array): number {
  const view = new DataView(
    authenticatorData.buffer,
    authenticatorData.byteOffset + 33,
    4,
  )
  return view.getUint32(0, false)
}

function normalizeInteger(bytes: Uint8Array, targetLen: number): Uint8Array {
  let start = 0
  while (start < bytes.length - 1 && bytes[start] === 0) {
    start++
  }
  const result = new Uint8Array(targetLen)
  if (bytes.length - start >= targetLen) {
    for (let i = 0; i < targetLen; i++) {
      result[i] = bytes[bytes.length - targetLen + i] ?? 0
    }
  } else {
    const sourceLen = bytes.length - start
    for (let i = 0; i < sourceLen; i++) {
      result[targetLen - sourceLen + i] = bytes[start + i] ?? 0
    }
  }
  return result
}

function derToRaw(derSig: Uint8Array): Uint8Array | null {
  if (derSig[0] !== 0x30) {
    if (derSig.length === 64) {
      const copy = new Uint8Array(64)
      copy.set(derSig)
      return copy
    }
    return null
  }

  let offset = 2
  if (derSig[offset] !== 0x02) return null
  offset++
  const rLen = derSig[offset]
  if (rLen === undefined) return null
  offset++
  const rSlice = derSig.slice(offset, offset + rLen)
  offset += rLen

  if (derSig[offset] !== 0x02) return null
  offset++
  const sLen = derSig[offset]
  if (sLen === undefined) return null
  offset++
  const sSlice = derSig.slice(offset, offset + sLen)

  const r = normalizeInteger(rSlice, 32)
  const s = normalizeInteger(sSlice, 32)

  const rawSig = new Uint8Array(64)
  rawSig.set(r, 0)
  rawSig.set(s, 32)

  return rawSig
}

function skipCborValue(data: Uint8Array, offset: number): number {
  if (offset >= data.length) return offset
  const firstByte = data[offset]
  if (firstByte === undefined) return offset

  const majorType = firstByte >> 5
  const additionalInfo = firstByte & 0x1f
  let nextOffset = offset + 1

  let length = 0
  if (additionalInfo < 24) {
    length = additionalInfo
  } else if (additionalInfo === 24) {
    const nextByte = data[nextOffset++]
    length = nextByte ?? 0
  } else if (additionalInfo === 25) {
    const byte0 = data[nextOffset]
    const byte1 = data[nextOffset + 1]
    if (byte0 === undefined || byte1 === undefined) {
      throw new Error('Malformed CBOR: insufficient data for 2-byte length')
    }
    length = (byte0 << 8) | byte1
    nextOffset += 2
  } else if (additionalInfo === 26) {
    const byte0 = data[nextOffset]
    const byte1 = data[nextOffset + 1]
    const byte2 = data[nextOffset + 2]
    const byte3 = data[nextOffset + 3]
    if (
      byte0 === undefined ||
      byte1 === undefined ||
      byte2 === undefined ||
      byte3 === undefined
    ) {
      throw new Error('Malformed CBOR: insufficient data for 4-byte length')
    }
    length = (byte0 << 24) | (byte1 << 16) | (byte2 << 8) | byte3
    nextOffset += 4
  }

  if (majorType === 2 || majorType === 3) {
    nextOffset += length
  } else if (majorType === 4) {
    for (let i = 0; i < length; i++) {
      nextOffset = skipCborValue(data, nextOffset)
    }
  } else if (majorType === 5) {
    for (let i = 0; i < length; i++) {
      nextOffset = skipCborValue(data, nextOffset)
      nextOffset = skipCborValue(data, nextOffset)
    }
  }

  return nextOffset
}

function parseCoseEc2Key(coseKey: Uint8Array): Uint8Array | null {
  let x: Uint8Array | null = null
  let y: Uint8Array | null = null
  let offset = 1

  const firstByte = coseKey[0]
  if (firstByte === undefined) {
    throw new Error('Empty COSE key')
  }
  const mapSize = firstByte & 0x1f

  for (let item = 0; item < mapSize; item++) {
    if (offset >= coseKey.length - 1) break

    let label: number
    const labelByte = coseKey[offset]
    if (labelByte === undefined) break

    if ((labelByte & 0xe0) === 0x00) {
      label = labelByte
      offset++
    } else if ((labelByte & 0xe0) === 0x20) {
      label = -1 - (labelByte & 0x1f)
      offset++
    } else {
      offset++
      continue
    }

    if (label === -2 || label === -3) {
      const valueByte = coseKey[offset]
      if (valueByte === undefined) break

      if ((valueByte & 0xe0) === 0x40) {
        const byteLen = valueByte & 0x1f
        offset++
        if (offset + byteLen > coseKey.length) break
        const bytes = coseKey.slice(offset, offset + byteLen)
        offset += byteLen
        if (label === -2) {
          x = bytes
        } else {
          y = bytes
        }
      } else if (valueByte === 0x58) {
        const byteLenValue = coseKey[offset + 1]
        if (byteLenValue === undefined) break
        const byteLen = byteLenValue
        offset += 2
        if (offset + byteLen > coseKey.length) break
        const bytes = coseKey.slice(offset, offset + byteLen)
        offset += byteLen
        if (label === -2) {
          x = bytes
        } else {
          y = bytes
        }
      } else {
        offset = skipCborValue(coseKey, offset)
      }
    } else {
      offset = skipCborValue(coseKey, offset)
    }
  }

  if (!x || !y || x.length !== 32 || y.length !== 32) {
    return null
  }

  const publicKey = new Uint8Array(65)
  publicKey[0] = 0x04
  publicKey.set(x, 1)
  publicKey.set(y, 33)

  return publicKey
}

function extractPublicKey(attestationObject: Uint8Array): Uint8Array | null {
  for (let i = 0; i < attestationObject.length - 67; i++) {
    if (
      attestationObject[i] === 0xa5 &&
      attestationObject[i + 1] === 0x01 &&
      attestationObject[i + 2] === 0x02
    ) {
      return parseCoseEc2Key(attestationObject.slice(i))
    }
  }

  for (let i = 0; i < attestationObject.length - 65; i++) {
    if (attestationObject[i] === 0x04) {
      const potentialKey = attestationObject.slice(i, i + 65)
      const nonZeroBytes = potentialKey.filter((b) => b !== 0).length
      if (nonZeroBytes > 32) {
        return potentialKey
      }
    }
  }

  return null
}

async function verifyPasskeySignature(params: {
  publicKey: Uint8Array
  authenticatorData: Uint8Array
  clientDataJSON: Uint8Array
  signature: Uint8Array
}): Promise<boolean> {
  const clientDataBuffer = new ArrayBuffer(params.clientDataJSON.length)
  new Uint8Array(clientDataBuffer).set(params.clientDataJSON)
  const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataBuffer)

  const signedData = new Uint8Array(
    params.authenticatorData.length + clientDataHash.byteLength,
  )
  signedData.set(params.authenticatorData, 0)
  signedData.set(new Uint8Array(clientDataHash), params.authenticatorData.length)

  if (params.publicKey.length !== 65 || params.publicKey[0] !== 0x04) {
    return false
  }

  const rawSignature = derToRaw(params.signature)
  if (!rawSignature) {
    return false
  }

  const publicKeyBuffer = new ArrayBuffer(params.publicKey.length)
  new Uint8Array(publicKeyBuffer).set(params.publicKey)

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    publicKeyBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )

  const rawSigBuffer = new ArrayBuffer(rawSignature.length)
  new Uint8Array(rawSigBuffer).set(rawSignature)

  const signedDataBuffer = new ArrayBuffer(signedData.length)
  new Uint8Array(signedDataBuffer).set(signedData)

  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    rawSigBuffer,
    signedDataBuffer,
  )
}

// Lazy initialization for auth-init routes
let authInitInitialized = false
let authInitPromise: Promise<void> | null = null

async function ensureAuthInitInitialized(config: AuthConfig): Promise<void> {
  if (authInitInitialized) return
  if (authInitPromise) {
    await authInitPromise
    return
  }

  authInitPromise = (async () => {
    await initializeState()
    await initializeKMS({
      jwtSigningKeyId: config.jwtSigningKeyId ?? 'oauth3-jwt-signing',
      jwtSignerAddress: config.jwtSignerAddress ?? ZERO_ADDRESS,
      serviceAgentId: config.serviceAgentId,
      chainId: config.chainId ?? 'eip155:420691',
    })
    authInitInitialized = true
  })()

  await authInitPromise
}

export function createAuthInitRouter(config: AuthConfig) {
  const network = getCurrentNetwork()
  const host = getLocalhostHost()
  const baseUrl =
    (typeof process !== 'undefined' ? process.env.BASE_URL : undefined) ??
    (network === 'localnet' ? `http://${host}:4200` : getOAuth3Url(network))

  return (
    new Elysia({ name: 'auth-init', prefix: '/auth' })
      .post(
        '/init',
        async ({ body, set }) => {
          await ensureAuthInitInitialized(config)

          const { provider, redirectUri, appId = 'jeju-default', state } = body

          // Find or use default client
          let client = await clientState.get(appId)
          if (!client) {
            // Try default client
            client = await clientState.get('jeju-default')
          }

          // For development, create a permissive client if none exists
          if (!client) {
            // Auto-register the client for dev (in production this should fail)
            const isDev = !isProductionEnv()
            if (isDev) {
              console.log(
                `[OAuth3] Auto-registering development client: ${appId}`,
              )
              await clientState.save({
                clientId: appId,
                clientSecretHash: {
                  hash: '',
                  salt: '',
                  algorithm: 'pbkdf2',
                  version: 1,
                },
                name: appId,
                redirectUris: [
                  `http://localhost:*`,
                  `http://${getLocalhostHost()}:*`,
                  'https://*.jejunetwork.org/*',
                ],
                allowedProviders: [
                  'wallet',
                  'passkey',
                  'farcaster',
                  'github',
                  'google',
                ],
                owner: ZERO_ADDRESS,
                active: true,
                createdAt: Date.now(),
              })
              client = await clientState.get(appId)
            }
          }

          if (!client || !client.active) {
            set.status = 400
            return {
              error: 'invalid_client',
              message: 'Unknown or inactive client',
            }
          }

          // Validate redirect URI (relaxed for development)
          const isDev = !isProductionEnv()
          if (
            !isDev &&
            !validateRedirectUri(redirectUri, client.redirectUris)
          ) {
            set.status = 400
            return {
              error: 'invalid_redirect_uri',
              message: 'Redirect URI not allowed',
            }
          }

          const authState = state ?? crypto.randomUUID()
          const encodedRedirectUri = encodeURIComponent(redirectUri)

          // Build the appropriate auth URL based on provider
          let authUrl: string

          switch (provider.toLowerCase()) {
            case 'wallet':
              authUrl = `${baseUrl}/wallet/challenge?client_id=${appId}&redirect_uri=${encodedRedirectUri}&state=${authState}`
              break

            case 'passkey':
              set.status = 400
              return {
                error: 'unsupported_provider',
                message:
                  'Passkey login uses the direct /auth/passkey endpoints.',
              }

            case 'farcaster':
              authUrl = `${baseUrl}/farcaster/init?client_id=${appId}&redirect_uri=${encodedRedirectUri}&state=${authState}`
              break

            case 'github':
            case 'google':
            case 'twitter':
            case 'discord':
              authUrl = `${baseUrl}/oauth/social/${provider.toLowerCase()}?client_id=${appId}&redirect_uri=${encodedRedirectUri}&state=${authState}`
              break

            case 'email':
              // Email provider - for now redirect to authorize page
              authUrl = `${baseUrl}/oauth/authorize?client_id=${appId}&redirect_uri=${encodedRedirectUri}&state=${authState}&provider=email`
              break

            default:
              set.status = 400
              return {
                error: 'unsupported_provider',
                message: `Provider "${provider}" is not supported. Use: wallet, passkey, farcaster, github, google, twitter, discord`,
              }
          }

          return {
            authUrl,
            state: authState,
            provider: provider.toLowerCase(),
          }
        },
        { body: InitBodySchema },
      )

      .get('/providers', () => {
        // Return available providers and their status
        return {
          providers: [
            { id: 'wallet', name: 'Wallet', enabled: true, icon: '🔐' },
            { id: 'passkey', name: 'Passkey', enabled: true, icon: '🔑' },
            { id: 'farcaster', name: 'Farcaster', enabled: true, icon: '🟣' },
            {
              id: 'github',
              name: 'GitHub',
              enabled: Boolean(process.env.GITHUB_CLIENT_ID),
              icon: '🐙',
            },
            {
              id: 'google',
              name: 'Google',
              enabled: Boolean(process.env.GOOGLE_CLIENT_ID),
              icon: '🔵',
            },
            {
              id: 'twitter',
              name: 'Twitter',
              enabled: Boolean(process.env.TWITTER_CLIENT_ID),
              icon: '🐦',
            },
            {
              id: 'discord',
              name: 'Discord',
              enabled: Boolean(process.env.DISCORD_CLIENT_ID),
              icon: '💬',
            },
          ],
        }
      })

      // Direct wallet authentication endpoint for SDK usage
      // This is a single-request auth flow used by the OAuth3 client SDK
      .post(
        '/wallet',
        async ({ body, set }) => {
          if (!isAddress(body.address)) {
            set.status = 400
            return { error: 'invalid_address' }
          }
          if (!isHex(body.signature)) {
            set.status = 400
            return { error: 'invalid_signature_format' }
          }

          const address: Address = body.address
          const signature: Hex = body.signature
          const appId = body.appId ?? 'jeju-default'

          // Verify the message is a valid sign-in message
          // Accept any SIWE-style message from known domains
          const validDomains = [
            'auth.jejunetwork.org',
            'auth.testnet.jejunetwork.org',
            'oauth3.jejunetwork.org',
            'oauth3.testnet.jejunetwork.org',
            'crucible.testnet.jejunetwork.org',
            'crucible.jejunetwork.org',
            'localhost',
            getLocalhostHost(),
          ]
          const messageHasDomain = validDomains.some(
            (d) =>
              body.message.includes(d) ||
              body.message.includes('wants you to sign in'),
          )
          if (!messageHasDomain) {
            set.status = 400
            return {
              error: 'invalid_message',
              message: 'Message must be a valid sign-in request',
            }
          }

          // Verify signature
          const valid = await verifyMessage({
            address,
            message: body.message,
            signature,
          })

          if (!valid) {
            set.status = 401
            return { error: 'invalid_signature' }
          }

          // Create session
          const sessionId = `0x${crypto.randomUUID().replace(/-/g, '')}`
          const userId = `wallet:${address.toLowerCase()}`

          const ephemeralKey = await getEphemeralKey(sessionId)

          const expiresAt = Date.now() + 24 * 60 * 60 * 1000 // 24 hours

          await sessionState.save({
            sessionId,
            userId,
            provider: 'wallet',
            address,
            createdAt: Date.now(),
            expiresAt,
            metadata: { appId },
            ephemeralKeyId: ephemeralKey.keyId,
          })

          console.log('[OAuth3] Direct wallet auth session created:', {
            sessionId: `${sessionId.substring(0, 10)}...`,
            address: `${address.substring(0, 6)}...${address.slice(-4)}`,
            appId,
          })

          // Return session in OAuth3Session format expected by the SDK
          return {
            sessionId,
            identityId: sessionId, // Use session as identity for wallet auth
            smartAccount: address,
            expiresAt,
            capabilities: ['sign_message', 'sign_transaction'],
            signingPublicKey: ephemeralKey.publicKey,
            attestation: {
              quote: EMPTY_HEX,
              measurement: EMPTY_HEX,
              reportData: EMPTY_HEX,
              timestamp: Date.now(),
              platform: 'simulated',
              verified: false,
            },
          }
        },
        { body: WalletAuthBodySchema },
      )

      .post(
        '/passkey/options',
        async ({ body, set }) => {
          await ensureAuthInitInitialized(config)

          let origin: URL
          try {
            origin = new URL(body.origin)
          } catch {
            set.status = 400
            return { error: 'invalid_origin' }
          }

          const appId = body.appId ?? 'jeju-default'
          const rpId = origin.hostname

          const existingCredentials = await passkeyState.listCredentialsByRpId(
            rpId,
          )
          const mode =
            existingCredentials.length > 0
              ? 'authentication'
              : 'registration'

          const challenge = crypto.getRandomValues(new Uint8Array(32))
          const challengeId = crypto.randomUUID()
          const now = Date.now()
          const userId =
            mode === 'registration' ? `passkey:${crypto.randomUUID()}` : null

          await passkeyState.saveChallenge({
            challengeId,
            userId,
            challenge: bufferToBase64url(challenge),
            origin: origin.origin,
            type: mode,
            createdAt: now,
            expiresAt: now + PASSKEY_CHALLENGE_EXPIRY_MS,
          })

          if (mode === 'registration') {
            const userIdBytes = new TextEncoder().encode(userId ?? '')
            return {
              challengeId,
              mode,
              publicKey: {
                rp: { name: 'Jeju Network', id: rpId },
                user: {
                  id: bufferToBase64url(userIdBytes),
                  name: userId,
                  displayName: 'Jeju Passkey',
                },
                challenge: bufferToBase64url(challenge),
                pubKeyCredParams: [
                  { type: 'public-key', alg: -7 },
                  { type: 'public-key', alg: -257 },
                ],
                timeout: 60000,
                authenticatorSelection: {
                  residentKey: 'preferred',
                  userVerification: 'preferred',
                },
                attestation: 'none',
              },
            }
          }

          return {
            challengeId,
            mode,
            publicKey: {
              challenge: bufferToBase64url(challenge),
              rpId,
              timeout: 60000,
              allowCredentials: existingCredentials.map((cred) => ({
                type: 'public-key',
                id: cred.credentialId,
                transports: cred.transports.length > 0 ? cred.transports : undefined,
              })),
              userVerification: 'preferred',
            },
          }
        },
        { body: PasskeyOptionsBodySchema },
      )

      .post(
        '/passkey/verify',
        async ({ body, set }) => {
          await ensureAuthInitInitialized(config)

          const challenge = await passkeyState.getChallenge(body.challengeId)
          if (!challenge) {
            set.status = 400
            return { error: 'invalid_challenge' }
          }

          if (challenge.type !== body.mode) {
            set.status = 400
            return { error: 'challenge_type_mismatch' }
          }

          const clientDataJson = new TextDecoder().decode(
            new Uint8Array(base64urlToBuffer(body.credential.response.clientDataJSON)),
          )
          const clientData = ClientDataSchema.parse(JSON.parse(clientDataJson))
          if (clientData.challenge !== challenge.challenge) {
            set.status = 400
            return { error: 'challenge_mismatch' }
          }
          if (clientData.origin !== challenge.origin) {
            set.status = 400
            return { error: 'origin_mismatch' }
          }

          if (body.mode === 'registration') {
            const attestationObject =
              body.credential.response.attestationObject
            if (!attestationObject) {
              set.status = 400
              return { error: 'missing_attestation' }
            }

            const attestationBytes = new Uint8Array(
              base64urlToBuffer(attestationObject),
            )
            const publicKey = extractPublicKey(attestationBytes)
            if (!publicKey) {
              set.status = 400
              return { error: 'invalid_public_key' }
            }

            const userId = challenge.userId ?? `passkey:${crypto.randomUUID()}`
            const rpId = new URL(challenge.origin).hostname
            const now = Date.now()

            await passkeyState.saveCredential({
              credentialId: body.credential.id,
              userId,
              rpId,
              publicKey: bufferToBase64url(publicKey),
              counter: 0,
              deviceName: body.deviceName ?? 'Passkey',
              transports: [],
              createdAt: now,
              lastUsedAt: now,
            })

            await passkeyState.deleteChallenge(body.challengeId)

            const sessionId = `0x${crypto.randomUUID().replace(/-/g, '')}`
            const expiresAt = Date.now() + config.sessionDuration
            const ephemeralKey = await getEphemeralKey(sessionId)

            await sessionState.save({
              sessionId,
              userId,
              provider: 'passkey',
              createdAt: Date.now(),
              expiresAt,
              metadata: { appId: body.appId ?? 'jeju-default' },
              ephemeralKeyId: ephemeralKey.keyId,
            })

            return {
              sessionId,
              identityId: sessionId,
              smartAccount: ZERO_ADDRESS,
              expiresAt,
              capabilities: ['sign_message', 'sign_transaction'],
              signingPublicKey: ephemeralKey.publicKey,
              attestation: {
                quote: EMPTY_HEX,
                measurement: EMPTY_HEX,
                reportData: EMPTY_HEX,
                timestamp: Date.now(),
                platform: 'simulated',
                verified: false,
              },
            }
          }

          const authenticatorData =
            body.credential.response.authenticatorData
          const signature = body.credential.response.signature
          if (!authenticatorData || !signature) {
            set.status = 400
            return { error: 'missing_assertion' }
          }

          const storedCredential = await passkeyState.getCredential(
            body.credential.id,
          )
          if (!storedCredential) {
            set.status = 400
            return { error: 'credential_not_found' }
          }

          const publicKeyBytes = new Uint8Array(
            base64urlToBuffer(storedCredential.publicKey),
          )
          const authenticatorBytes = new Uint8Array(
            base64urlToBuffer(authenticatorData),
          )
          const signatureBytes = new Uint8Array(base64urlToBuffer(signature))
          const clientDataBytes = new Uint8Array(
            base64urlToBuffer(body.credential.response.clientDataJSON),
          )

          const isValid = await verifyPasskeySignature({
            publicKey: publicKeyBytes,
            authenticatorData: authenticatorBytes,
            clientDataJSON: clientDataBytes,
            signature: signatureBytes,
          })

          if (!isValid) {
            set.status = 401
            return { error: 'invalid_signature' }
          }

          const signCount = getSignCount(authenticatorBytes)
          if (signCount !== 0 && signCount <= storedCredential.counter) {
            set.status = 409
            return { error: 'credential_clone_detected' }
          }

          await passkeyState.updateCredentialCounter(
            storedCredential.credentialId,
            signCount,
          )
          await passkeyState.deleteChallenge(body.challengeId)

          const sessionId = `0x${crypto.randomUUID().replace(/-/g, '')}`
          const expiresAt = Date.now() + config.sessionDuration
          const ephemeralKey = await getEphemeralKey(sessionId)

          await sessionState.save({
            sessionId,
            userId: storedCredential.userId,
            provider: 'passkey',
            createdAt: Date.now(),
            expiresAt,
            metadata: { appId: body.appId ?? 'jeju-default' },
            ephemeralKeyId: ephemeralKey.keyId,
          })

          return {
            sessionId,
            identityId: sessionId,
            smartAccount: ZERO_ADDRESS,
            expiresAt,
            capabilities: ['sign_message', 'sign_transaction'],
            signingPublicKey: ephemeralKey.publicKey,
            attestation: {
              quote: EMPTY_HEX,
              measurement: EMPTY_HEX,
              reportData: EMPTY_HEX,
              timestamp: Date.now(),
              platform: 'simulated',
              verified: false,
            },
          }
        },
        { body: PasskeyVerifyBodySchema },
      )
  )
}
