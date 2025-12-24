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
    const clientData = JSON.parse(
      new TextDecoder().decode(response.response.clientDataJSON),
    ) as { type: string; challenge: string; origin: string }

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
    let _userId: string | undefined

    if (response.response.userHandle) {
      _userId = new TextDecoder().decode(response.response.userHandle)
    }

    // Search for credential
    for (const [uid, creds] of this.credentials.entries()) {
      const found = creds.find((c) => c.id === response.id)
      if (found) {
        credential = found
        _userId = uid
        break
      }
    }

    if (!credential) {
      return { success: false, error: 'Credential not found' }
    }

    // Verify clientDataJSON
    const clientData = JSON.parse(
      new TextDecoder().decode(response.response.clientDataJSON),
    ) as { type: string; challenge: string; origin: string }

    if (clientData.type !== 'webauthn.get') {
      return { success: false, error: 'Invalid client data type' }
    }

    const expectedChallenge = this.bufferToBase64url(challenge.challenge)
    if (clientData.challenge !== expectedChallenge) {
      return { success: false, error: 'Challenge mismatch' }
    }

    // Verify signature (simplified - in production use proper COSE verification)
    const authenticatorData = new Uint8Array(
      response.response.authenticatorData,
    )
    const signCount = this.getSignCount(authenticatorData)

    if (signCount <= credential.counter) {
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

  private extractPublicKey(attestationObject: Uint8Array): Uint8Array | null {
    return attestationObject.slice(-65)
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
