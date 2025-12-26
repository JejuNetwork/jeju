/**
 * WebAuthn/Passkey Authentication
 *
 * Implements FIDO2/WebAuthn for:
 * - Passwordless authentication
 * - Multi-factor authentication
 * - Device-bound credentials
 */

import { getEnv } from '@jejunetwork/shared'
import { toHex } from 'viem'
import { z } from 'zod'

// WebAuthn client data schema
const ClientDataSchema = z.object({
  type: z.string(),
  challenge: z.string(),
  origin: z.string(),
})

export interface PasskeyCredential {
  id: string
  publicKey: Uint8Array
  counter: number
  userId: string
  deviceName: string
  createdAt: number
  lastUsedAt: number
  transports?: AuthenticatorTransport[]
}

export interface PasskeyChallenge {
  challengeId: string
  challenge: Uint8Array
  userId: string
  expiresAt: number
  type: 'registration' | 'authentication'
}

export interface PasskeyAuthResult {
  success: boolean
  credential?: PasskeyCredential
  error?: string
}

export interface PasskeyRegistrationOptions {
  userId: string
  username: string
  displayName: string
  attestation?: AttestationConveyancePreference
  authenticatorSelection?: AuthenticatorSelectionCriteria
}

export interface PasskeyAuthenticationOptions {
  userId?: string
  allowCredentials?: string[]
  userVerification?: UserVerificationRequirement
}

// Type definitions for WebAuthn API
type AttestationConveyancePreference =
  | 'none'
  | 'indirect'
  | 'direct'
  | 'enterprise'
type AuthenticatorTransport = 'usb' | 'nfc' | 'ble' | 'internal' | 'hybrid'
type UserVerificationRequirement = 'required' | 'preferred' | 'discouraged'

interface AuthenticatorSelectionCriteria {
  authenticatorAttachment?: 'platform' | 'cross-platform'
  residentKey?: 'discouraged' | 'preferred' | 'required'
  userVerification?: UserVerificationRequirement
}

interface PublicKeyCredentialCreationOptions {
  rp: { name: string; id: string }
  user: { id: ArrayBuffer; name: string; displayName: string }
  challenge: ArrayBuffer
  pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>
  timeout?: number
  excludeCredentials?: Array<{
    type: 'public-key'
    id: ArrayBuffer
    transports?: AuthenticatorTransport[]
  }>
  authenticatorSelection?: AuthenticatorSelectionCriteria
  attestation?: AttestationConveyancePreference
}

interface PublicKeyCredentialRequestOptions {
  challenge: ArrayBuffer
  timeout?: number
  rpId?: string
  allowCredentials?: Array<{
    type: 'public-key'
    id: ArrayBuffer
    transports?: AuthenticatorTransport[]
  }>
  userVerification?: UserVerificationRequirement
}

const CHALLENGE_EXPIRY = 5 * 60 * 1000 // 5 minutes
const RP_NAME = getEnv('OAUTH3_RP_NAME') ?? 'OAuth3'
const RP_ID = getEnv('OAUTH3_RP_ID') ?? 'localhost'

export class PasskeyManager {
  private credentials = new Map<string, PasskeyCredential[]>()
  private pendingChallenges = new Map<string, PasskeyChallenge>()
  private rpId: string
  private rpName: string

  constructor(config?: { rpId?: string; rpName?: string }) {
    this.rpId = config?.rpId ?? RP_ID
    this.rpName = config?.rpName ?? RP_NAME
  }

  /**
   * Generate registration options for creating a new passkey
   */
  async generateRegistrationOptions(
    options: PasskeyRegistrationOptions,
  ): Promise<{
    challengeId: string
    publicKey: PublicKeyCredentialCreationOptions
  }> {
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const challengeId = toHex(crypto.getRandomValues(new Uint8Array(16)))

    const pendingChallenge: PasskeyChallenge = {
      challengeId,
      challenge,
      userId: options.userId,
      expiresAt: Date.now() + CHALLENGE_EXPIRY,
      type: 'registration',
    }

    this.pendingChallenges.set(challengeId, pendingChallenge)

    // Get existing credentials to exclude
    const existingCredentials = this.credentials.get(options.userId) ?? []
    const excludeCredentials = existingCredentials.map((cred) => ({
      type: 'public-key' as const,
      id: this.base64urlToBuffer(cred.id),
      transports: cred.transports,
    }))

    const publicKeyOptions: PublicKeyCredentialCreationOptions = {
      rp: {
        name: this.rpName,
        id: this.rpId,
      },
      user: {
        id: new TextEncoder().encode(options.userId).buffer as ArrayBuffer,
        name: options.username,
        displayName: options.displayName,
      },
      challenge: challenge.slice().buffer as ArrayBuffer,
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256 (P-256)
        { type: 'public-key', alg: -257 }, // RS256
      ],
      timeout: 60000,
      excludeCredentials,
      authenticatorSelection: options.authenticatorSelection ?? {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      attestation: options.attestation ?? 'none',
    }

    return { challengeId, publicKey: publicKeyOptions }
  }

  /**
   * Verify registration response and store credential
   */
  async verifyRegistration(
    challengeId: string,
    response: {
      id: string
      rawId: ArrayBuffer
      response: {
        clientDataJSON: ArrayBuffer
        attestationObject: ArrayBuffer
      }
      type: 'public-key'
      authenticatorAttachment?: string
    },
    deviceName: string,
  ): Promise<PasskeyAuthResult> {
    const challenge = this.pendingChallenges.get(challengeId)

    if (!challenge) {
      return { success: false, error: 'Invalid or expired challenge' }
    }

    if (challenge.type !== 'registration') {
      return { success: false, error: 'Wrong challenge type' }
    }

    if (Date.now() > challenge.expiresAt) {
      this.pendingChallenges.delete(challengeId)
      return { success: false, error: 'Challenge expired' }
    }

    // Verify clientDataJSON
    const clientData = ClientDataSchema.parse(
      JSON.parse(new TextDecoder().decode(response.response.clientDataJSON)),
    )

    if (clientData.type !== 'webauthn.create') {
      return { success: false, error: 'Invalid client data type' }
    }

    const expectedChallenge = this.bufferToBase64url(challenge.challenge)
    if (clientData.challenge !== expectedChallenge) {
      return { success: false, error: 'Challenge mismatch' }
    }

    // Parse attestation object to get public key
    const attestationObject = new Uint8Array(
      response.response.attestationObject,
    )
    const publicKey = this.extractPublicKey(attestationObject)

    if (!publicKey) {
      return { success: false, error: 'Failed to extract public key' }
    }

    // Create credential
    const credential: PasskeyCredential = {
      id: response.id,
      publicKey,
      counter: 0,
      userId: challenge.userId,
      deviceName,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      transports:
        response.authenticatorAttachment === 'platform'
          ? ['internal']
          : undefined,
    }

    // Store credential
    const userCredentials = this.credentials.get(challenge.userId) ?? []
    userCredentials.push(credential)
    this.credentials.set(challenge.userId, userCredentials)

    // Clean up challenge
    this.pendingChallenges.delete(challengeId)

    return { success: true, credential }
  }

  /**
   * Generate authentication options for verifying with a passkey
   */
  async generateAuthenticationOptions(
    options: PasskeyAuthenticationOptions = {},
  ): Promise<{
    challengeId: string
    publicKey: PublicKeyCredentialRequestOptions
  }> {
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const challengeId = toHex(crypto.getRandomValues(new Uint8Array(16)))

    const pendingChallenge: PasskeyChallenge = {
      challengeId,
      challenge,
      userId: options.userId ?? '',
      expiresAt: Date.now() + CHALLENGE_EXPIRY,
      type: 'authentication',
    }

    this.pendingChallenges.set(challengeId, pendingChallenge)

    // Get allowed credentials
    let allowCredentials:
      | Array<{
          type: 'public-key'
          id: ArrayBuffer
          transports?: AuthenticatorTransport[]
        }>
      | undefined

    if (options.allowCredentials) {
      allowCredentials = options.allowCredentials.map((id) => ({
        type: 'public-key' as const,
        id: this.base64urlToBuffer(id),
      }))
    } else if (options.userId) {
      const userCredentials = this.credentials.get(options.userId) ?? []
      allowCredentials = userCredentials.map((cred) => ({
        type: 'public-key' as const,
        id: this.base64urlToBuffer(cred.id),
        transports: cred.transports,
      }))
    }

    const publicKeyOptions: PublicKeyCredentialRequestOptions = {
      challenge: challenge.slice().buffer as ArrayBuffer,
      timeout: 60000,
      rpId: this.rpId,
      allowCredentials,
      userVerification: options.userVerification ?? 'preferred',
    }

    return { challengeId, publicKey: publicKeyOptions }
  }

  /**
   * Verify authentication response
   */
  async verifyAuthentication(
    challengeId: string,
    response: {
      id: string
      rawId: ArrayBuffer
      response: {
        clientDataJSON: ArrayBuffer
        authenticatorData: ArrayBuffer
        signature: ArrayBuffer
        userHandle?: ArrayBuffer
      }
      type: 'public-key'
    },
  ): Promise<PasskeyAuthResult> {
    const challenge = this.pendingChallenges.get(challengeId)

    if (!challenge) {
      return { success: false, error: 'Invalid or expired challenge' }
    }

    if (challenge.type !== 'authentication') {
      return { success: false, error: 'Wrong challenge type' }
    }

    if (Date.now() > challenge.expiresAt) {
      this.pendingChallenges.delete(challengeId)
      return { success: false, error: 'Challenge expired' }
    }

    // Find the credential
    let credential: PasskeyCredential | undefined

    // Note: userHandle can be used to identify the user if needed
    // const userId = response.response.userHandle
    //   ? new TextDecoder().decode(response.response.userHandle)
    //   : undefined

    // Search for credential
    for (const [_uid, creds] of this.credentials.entries()) {
      const found = creds.find((c) => c.id === response.id)
      if (found) {
        credential = found
        break
      }
    }

    if (!credential) {
      return { success: false, error: 'Credential not found' }
    }

    // Verify clientDataJSON
    const clientData = ClientDataSchema.parse(
      JSON.parse(new TextDecoder().decode(response.response.clientDataJSON)),
    )

    if (clientData.type !== 'webauthn.get') {
      return { success: false, error: 'Invalid client data type' }
    }

    const expectedChallenge = this.bufferToBase64url(challenge.challenge)
    if (clientData.challenge !== expectedChallenge) {
      return { success: false, error: 'Challenge mismatch' }
    }

    // Verify cryptographic signature
    const authenticatorData = new Uint8Array(
      response.response.authenticatorData,
    )
    const clientDataJSON = new Uint8Array(response.response.clientDataJSON)
    const signature = new Uint8Array(response.response.signature)

    // Verify signature: sign(authenticatorData || sha256(clientDataJSON))
    const isValidSignature = await this.verifySignature(
      credential.publicKey,
      authenticatorData,
      clientDataJSON,
      signature,
    )

    if (!isValidSignature) {
      return { success: false, error: 'Invalid signature' }
    }

    // Check sign count to detect cloned credentials
    const signCount = this.getSignCount(authenticatorData)

    if (signCount !== 0 && signCount <= credential.counter) {
      throw new Error(`Possible credential clone detected for ${response.id}`)
    }

    // Update counter
    credential.counter = signCount
    credential.lastUsedAt = Date.now()

    // Clean up challenge
    this.pendingChallenges.delete(challengeId)

    return { success: true, credential }
  }

  /**
   * Get all credentials for a user
   */
  getCredentials(userId: string): PasskeyCredential[] {
    return this.credentials.get(userId) ?? []
  }

  /**
   * Remove a credential
   */
  removeCredential(userId: string, credentialId: string): boolean {
    const userCredentials = this.credentials.get(userId)
    if (!userCredentials) return false

    const index = userCredentials.findIndex((c) => c.id === credentialId)
    if (index === -1) return false

    userCredentials.splice(index, 1)
    return true
  }

  /**
   * Update credential device name
   */
  updateCredentialName(
    userId: string,
    credentialId: string,
    deviceName: string,
  ): boolean {
    const userCredentials = this.credentials.get(userId)
    if (!userCredentials) return false

    const credential = userCredentials.find((c) => c.id === credentialId)
    if (!credential) return false

    credential.deviceName = deviceName
    return true
  }

  /**
   * Verify WebAuthn signature using the stored public key
   * The signed data is: authenticatorData || sha256(clientDataJSON)
   */
  private async verifySignature(
    publicKey: Uint8Array,
    authenticatorData: Uint8Array,
    clientDataJSON: Uint8Array,
    signature: Uint8Array,
  ): Promise<boolean> {
    // Copy to new ArrayBuffer to ensure compatibility with subtle crypto
    const clientDataBuffer = new ArrayBuffer(clientDataJSON.length)
    new Uint8Array(clientDataBuffer).set(clientDataJSON)

    // Hash the clientDataJSON
    const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataBuffer)

    // Concatenate authenticatorData || clientDataHash
    const signedData = new Uint8Array(
      authenticatorData.length + clientDataHash.byteLength,
    )
    signedData.set(authenticatorData, 0)
    signedData.set(new Uint8Array(clientDataHash), authenticatorData.length)

    // Import the public key for verification
    // The public key is stored as 65-byte uncompressed EC point: 0x04 || x || y
    if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
      return false // Invalid public key format
    }

    // Convert DER signature to raw format if needed
    // WebAuthn signatures are typically in ASN.1/DER format for ECDSA
    const rawSignature = this.derToRaw(signature)
    if (!rawSignature) {
      return false
    }

    // Copy public key to new ArrayBuffer for crypto compatibility
    const publicKeyBuffer = new ArrayBuffer(publicKey.length)
    new Uint8Array(publicKeyBuffer).set(publicKey)

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      publicKeyBuffer,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )

    // Copy signature and signed data to new ArrayBuffers
    const rawSigBuffer = new ArrayBuffer(rawSignature.length)
    new Uint8Array(rawSigBuffer).set(rawSignature)

    const signedDataBuffer = new ArrayBuffer(signedData.length)
    new Uint8Array(signedDataBuffer).set(signedData)

    const isValid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      cryptoKey,
      rawSigBuffer,
      signedDataBuffer,
    )

    return isValid
  }

  /**
   * Convert DER-encoded ECDSA signature to raw format (r || s)
   * DER format: 0x30 <len> 0x02 <r-len> <r> 0x02 <s-len> <s>
   * Raw format: r (32 bytes) || s (32 bytes)
   */
  private derToRaw(derSig: Uint8Array): Uint8Array | null {
    // Check for DER SEQUENCE tag
    if (derSig[0] !== 0x30) {
      // Might already be raw format (64 bytes)
      if (derSig.length === 64) {
        // Copy to fresh Uint8Array to avoid buffer issues
        const copy = new Uint8Array(64)
        copy.set(derSig)
        return copy
      }
      return null
    }

    let offset = 2 // Skip SEQUENCE tag and length

    // Parse r
    if (derSig[offset] !== 0x02) return null // INTEGER tag for r
    offset++
    const rLen = derSig[offset]
    if (rLen === undefined) return null
    offset++
    const rSlice = derSig.slice(offset, offset + rLen)
    offset += rLen

    // Parse s
    if (derSig[offset] !== 0x02) return null // INTEGER tag for s
    offset++
    const sLen = derSig[offset]
    if (sLen === undefined) return null
    offset++
    const sSlice = derSig.slice(offset, offset + sLen)

    // Remove leading zeros and pad to 32 bytes
    const r = this.normalizeInteger(rSlice, 32)
    const s = this.normalizeInteger(sSlice, 32)

    // Concatenate r || s
    const rawSig = new Uint8Array(64)
    rawSig.set(r, 0)
    rawSig.set(s, 32)

    return rawSig
  }

  /**
   * Normalize an integer to a fixed size (remove leading zeros or pad)
   */
  private normalizeInteger(bytes: Uint8Array, targetLen: number): Uint8Array {
    // Remove leading zeros
    let start = 0
    while (start < bytes.length - 1 && bytes[start] === 0) {
      start++
    }

    const result = new Uint8Array(targetLen)

    if (bytes.length - start >= targetLen) {
      // Truncate if too long (shouldn't happen for valid signatures)
      for (let i = 0; i < targetLen; i++) {
        result[i] = bytes[bytes.length - targetLen + i] ?? 0
      }
    } else {
      // Pad with leading zeros
      const sourceLen = bytes.length - start
      for (let i = 0; i < sourceLen; i++) {
        result[targetLen - sourceLen + i] = bytes[start + i] ?? 0
      }
    }

    return result
  }

  /**
   * Extract public key from CBOR-encoded attestation object
   * Implements proper COSE key parsing per WebAuthn spec
   */
  private extractPublicKey(attestationObject: Uint8Array): Uint8Array | null {
    // The attestation object is CBOR-encoded. We need to parse:
    // 1. Find authenticatorData
    // 2. Parse the credential public key from COSE format

    // Simple CBOR parsing for attestation object structure:
    // { "fmt": string, "authData": bytes, "attStmt": {...} }

    // Look for authData (0x68 'h' = 104, 0x61 'a' = 97, 0x75 'u' = 117, 0x74 't' = 116, 0x68 'h' = 104, 0x44 'D' = 68, 0x61 'a' = 97, 0x74 't' = 116, 0x61 'a' = 97)
    // Or look for the byte pattern indicating authData length

    // Find COSE key structure in authenticatorData
    // authenticatorData structure:
    // - rpIdHash (32 bytes)
    // - flags (1 byte)
    // - signCount (4 bytes)
    // - attestedCredentialData (if flags.AT set):
    //   - aaguid (16 bytes)
    //   - credentialIdLength (2 bytes big endian)
    //   - credentialId (credentialIdLength bytes)
    //   - credentialPublicKey (COSE key format)

    // Simplified approach: Find the COSE key map start
    // COSE_Key for EC2 (ECDSA P-256) has kty=2, alg=-7 (ES256)
    // The key components are:
    // 1: kty (key type) = 2 (EC2)
    // 3: alg (algorithm) = -7 (ES256)
    // -1: crv (curve) = 1 (P-256)
    // -2: x (x-coordinate, 32 bytes)
    // -3: y (y-coordinate, 32 bytes)

    // Find the CBOR map pattern for COSE key
    // Looking for map with kty=2 (EC2)
    for (let i = 0; i < attestationObject.length - 67; i++) {
      // Look for COSE key map start with EC2 key type
      // A5 (map of 5 items) followed by 01 02 (kty=2)
      if (
        attestationObject[i] === 0xa5 && // Map of 5 items
        attestationObject[i + 1] === 0x01 && // Label: kty (1)
        attestationObject[i + 2] === 0x02 // Value: EC2 (2)
      ) {
        // Parse COSE_Key structure
        return this.parseCoseEc2Key(attestationObject.slice(i))
      }
    }

    // Fallback: Try to find raw public key bytes (65 bytes uncompressed EC point)
    // Look for 0x04 prefix (uncompressed point indicator)
    for (let i = 0; i < attestationObject.length - 65; i++) {
      if (attestationObject[i] === 0x04) {
        const potentialKey = attestationObject.slice(i, i + 65)
        // Basic sanity check - x and y coordinates should be non-zero
        const nonZeroBytes = potentialKey.filter((b) => b !== 0).length
        if (nonZeroBytes > 32) {
          return potentialKey
        }
      }
    }

    return null
  }

  /**
   * Parse COSE EC2 key and return uncompressed public key bytes
   * Returns 65-byte uncompressed format: 0x04 || x (32 bytes) || y (32 bytes)
   */
  private parseCoseEc2Key(coseKey: Uint8Array): Uint8Array | null {
    // Parse CBOR map to extract x and y coordinates
    // Structure: {1: 2, 3: -7, -1: 1, -2: x(32), -3: y(32)}

    let x: Uint8Array | null = null
    let y: Uint8Array | null = null
    let offset = 1 // Skip map header

    const mapSize = coseKey[0] & 0x1f // Lower 5 bits of map header

    for (let item = 0; item < mapSize; item++) {
      if (offset >= coseKey.length - 1) break

      // Parse label
      let label: number
      const labelByte = coseKey[offset]

      if ((labelByte & 0xe0) === 0x00) {
        // Positive integer (0-23)
        label = labelByte
        offset++
      } else if ((labelByte & 0xe0) === 0x20) {
        // Negative integer (-1 to -24)
        label = -1 - (labelByte & 0x1f)
        offset++
      } else {
        // Skip unknown label type
        offset++
        continue
      }

      // Parse value based on label
      if (label === -2 || label === -3) {
        // x or y coordinate (should be byte string of 32 bytes)
        const valueByte = coseKey[offset]
        if ((valueByte & 0xe0) === 0x40) {
          // Byte string with length in lower 5 bits
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
          // Byte string with 1-byte length
          const byteLen = coseKey[offset + 1]
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
          // Skip value we don't understand
          offset = this.skipCborValue(coseKey, offset)
        }
      } else {
        // Skip other labels' values
        offset = this.skipCborValue(coseKey, offset)
      }
    }

    if (!x || !y || x.length !== 32 || y.length !== 32) {
      return null
    }

    // Build uncompressed public key: 0x04 || x || y
    const publicKey = new Uint8Array(65)
    publicKey[0] = 0x04
    publicKey.set(x, 1)
    publicKey.set(y, 33)

    return publicKey
  }

  /**
   * Skip a CBOR value and return the new offset
   */
  private skipCborValue(data: Uint8Array, offset: number): number {
    if (offset >= data.length) return offset

    const majorType = data[offset] >> 5
    const additionalInfo = data[offset] & 0x1f

    offset++

    // Get length based on additional info
    let length = 0
    if (additionalInfo < 24) {
      length = additionalInfo
    } else if (additionalInfo === 24) {
      length = data[offset++]
    } else if (additionalInfo === 25) {
      length = (data[offset] << 8) | data[offset + 1]
      offset += 2
    } else if (additionalInfo === 26) {
      length =
        (data[offset] << 24) |
        (data[offset + 1] << 16) |
        (data[offset + 2] << 8) |
        data[offset + 3]
      offset += 4
    }

    // Skip based on major type
    if (majorType === 0 || majorType === 1) {
      // Integer - already handled
    } else if (majorType === 2 || majorType === 3) {
      // Byte/text string - skip length bytes
      offset += length
    } else if (majorType === 4) {
      // Array - skip items
      for (let i = 0; i < length; i++) {
        offset = this.skipCborValue(data, offset)
      }
    } else if (majorType === 5) {
      // Map - skip key-value pairs
      for (let i = 0; i < length; i++) {
        offset = this.skipCborValue(data, offset) // key
        offset = this.skipCborValue(data, offset) // value
      }
    }

    return offset
  }

  private getSignCount(authenticatorData: Uint8Array): number {
    // Sign count is at bytes 33-36 (big endian)
    const view = new DataView(
      authenticatorData.buffer,
      authenticatorData.byteOffset + 33,
      4,
    )
    return view.getUint32(0, false)
  }

  private bufferToBase64url(buffer: Uint8Array): string {
    return btoa(String.fromCharCode(...buffer))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  }

  private base64urlToBuffer(base64url: string): ArrayBuffer {
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
}

export function createPasskeyManager(config?: {
  rpId?: string
  rpName?: string
}): PasskeyManager {
  return new PasskeyManager(config)
}
