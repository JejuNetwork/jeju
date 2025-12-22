/**
 * Passkeys (WebAuthn) - Passwordless Authentication
 *
 * Provides secure, phishing-resistant authentication using
 * platform authenticators (Touch ID, Face ID, Windows Hello)
 * or security keys (YubiKey, etc).
 */

import { type Address, keccak256, toBytes, toHex } from 'viem'
import type { PasskeyCredential } from './types'

export interface PasskeyConfig {
  rpId: string
  rpName: string
  origin: string
  userVerification?: UserVerificationRequirement
  attestation?: AttestationConveyancePreference
  timeout?: number
}

export interface PasskeyRegistrationResult {
  credential: PasskeyCredential
  rawId: Uint8Array
  attestationObject: Uint8Array
  clientDataJSON: Uint8Array
}

export interface PasskeyAuthenticationResult {
  credentialId: string
  signature: Uint8Array
  authenticatorData: Uint8Array
  clientDataJSON: Uint8Array
  userHandle?: Uint8Array
}

/**
 * Check if WebAuthn is supported
 */
export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.PublicKeyCredential &&
    typeof window.PublicKeyCredential === 'function'
  )
}

/**
 * Check if platform authenticator is available (Touch ID, Face ID, etc)
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false
  return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
}

/**
 * Generate a challenge for WebAuthn operations
 */
export function generateChallenge(): Uint8Array {
  const challenge = new Uint8Array(32)
  crypto.getRandomValues(challenge)
  return challenge
}

/**
 * Create credential options for registration
 */
export function createRegistrationOptions(params: {
  config: PasskeyConfig
  userId: string
  userName: string
  userDisplayName: string
  challenge?: Uint8Array
  excludeCredentials?: PasskeyCredential[]
}): PublicKeyCredentialCreationOptions {
  const challenge = params.challenge || generateChallenge()

  return {
    challenge: challenge.buffer as ArrayBuffer,
    rp: {
      name: params.config.rpName,
      id: params.config.rpId,
    },
    user: {
      id: new TextEncoder().encode(params.userId),
      name: params.userName,
      displayName: params.userDisplayName,
    },
    pubKeyCredParams: [
      { alg: -7, type: 'public-key' }, // ES256 (P-256)
      { alg: -257, type: 'public-key' }, // RS256
    ],
    timeout: params.config.timeout || 60000,
    attestation: params.config.attestation || 'none',
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: params.config.userVerification || 'preferred',
      residentKey: 'preferred',
      requireResidentKey: false,
    },
    excludeCredentials: params.excludeCredentials?.map((c) => ({
      type: 'public-key' as const,
      id: base64UrlToBuffer(c.id).buffer as ArrayBuffer,
      transports: c.transports,
    })),
  }
}

/**
 * Register a new passkey
 */
export async function registerPasskey(params: {
  config: PasskeyConfig
  userId: string
  userName: string
  userDisplayName: string
  excludeCredentials?: PasskeyCredential[]
  name?: string
}): Promise<PasskeyRegistrationResult> {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn is not supported in this browser')
  }

  const options = createRegistrationOptions({
    config: params.config,
    userId: params.userId,
    userName: params.userName,
    userDisplayName: params.userDisplayName,
    excludeCredentials: params.excludeCredentials,
  })

  const credential = (await navigator.credentials.create({
    publicKey: options,
  })) as PublicKeyCredential

  if (!credential) {
    throw new Error('Passkey registration was cancelled')
  }

  const response = credential.response as AuthenticatorAttestationResponse
  const publicKey = response.getPublicKey()

  if (!publicKey) {
    throw new Error('Failed to extract public key from credential')
  }

  return {
    credential: {
      id: bufferToBase64Url(new Uint8Array(credential.rawId)),
      publicKey: new Uint8Array(publicKey),
      counter: 0,
      transports: response.getTransports?.() as
        | AuthenticatorTransport[]
        | undefined,
      createdAt: Date.now(),
      name: params.name,
    },
    rawId: new Uint8Array(credential.rawId),
    attestationObject: new Uint8Array(response.attestationObject),
    clientDataJSON: new Uint8Array(response.clientDataJSON),
  }
}

/**
 * Create authentication options
 */
export function createAuthenticationOptions(params: {
  config: PasskeyConfig
  challenge?: Uint8Array
  allowCredentials?: PasskeyCredential[]
}): PublicKeyCredentialRequestOptions {
  const challenge = params.challenge || generateChallenge()

  return {
    challenge: challenge.buffer as ArrayBuffer,
    rpId: params.config.rpId,
    timeout: params.config.timeout || 60000,
    userVerification: params.config.userVerification || 'preferred',
    allowCredentials: params.allowCredentials?.map((c) => ({
      type: 'public-key' as const,
      id: base64UrlToBuffer(c.id).buffer as ArrayBuffer,
      transports: c.transports,
    })),
  }
}

/**
 * Authenticate with a passkey
 */
export async function authenticateWithPasskey(params: {
  config: PasskeyConfig
  allowCredentials?: PasskeyCredential[]
}): Promise<PasskeyAuthenticationResult> {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn is not supported in this browser')
  }

  const options = createAuthenticationOptions({
    config: params.config,
    allowCredentials: params.allowCredentials,
  })

  const credential = (await navigator.credentials.get({
    publicKey: options,
  })) as PublicKeyCredential

  if (!credential) {
    throw new Error('Passkey authentication was cancelled')
  }

  const response = credential.response as AuthenticatorAssertionResponse

  return {
    credentialId: bufferToBase64Url(new Uint8Array(credential.rawId)),
    signature: new Uint8Array(response.signature),
    authenticatorData: new Uint8Array(response.authenticatorData),
    clientDataJSON: new Uint8Array(response.clientDataJSON),
    userHandle: response.userHandle
      ? new Uint8Array(response.userHandle)
      : undefined,
  }
}

/**
 * Derive an Ethereum address from a passkey public key
 * Uses keccak256 hash of the public key (excluding prefix byte)
 */
export function deriveAddressFromPasskey(publicKey: Uint8Array): Address {
  // For P-256 keys, the public key is in uncompressed form (65 bytes: 0x04 + x + y)
  // We take the last 20 bytes of keccak256(x || y)
  if (publicKey.length === 65 && publicKey[0] === 0x04) {
    const keyBytes = publicKey.slice(1)
    const hash = keccak256(toHex(keyBytes))
    return `0x${hash.slice(-40)}` as Address
  }

  // For other formats, hash the entire key
  const hash = keccak256(toHex(publicKey))
  return `0x${hash.slice(-40)}` as Address
}

/**
 * Create a deterministic user ID from an identifier
 */
export function createUserId(identifier: string): string {
  return toHex(keccak256(toBytes(identifier))).slice(0, 34)
}

// Utility functions for base64url encoding/decoding

function bufferToBase64Url(buffer: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...buffer))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBuffer(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padding = (4 - (base64.length % 4)) % 4
  const padded = base64 + '='.repeat(padding)
  const binary = atob(padded)
  return new Uint8Array([...binary].map((c) => c.charCodeAt(0)))
}
