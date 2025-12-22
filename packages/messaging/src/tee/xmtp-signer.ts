/**
 * XMTP Signer that uses TEE for all crypto operations
 *
 * Implements the XMTP Signer interface with TEE-backed key operations.
 * Private keys never leave the secure enclave.
 */

import type { Address, Hex } from 'viem'
import { EncryptedBackupSchema } from '../schemas'
import type { TEEXMTPKeyManager } from './key-manager'
import type {
  EncryptedBackup,
  TEEAttestation,
  TEEIdentityKey,
  TEEPreKey,
} from './types'

/**
 * Signed public key bundle for XMTP registration
 */
export interface SignedPublicKeyBundle {
  identityKey: {
    /** Public key bytes */
    publicKey: Uint8Array
    /** Signature over the public key */
    signature: Uint8Array
  }
  preKey: {
    /** Pre-key public key bytes */
    publicKey: Uint8Array
    /** Signature from identity key */
    signature: Uint8Array
  }
}

/**
 * XMTP Signer interface
 */
export interface XMTPSigner {
  getAddress(): Promise<string>
  signMessage(message: string | Uint8Array): Promise<Uint8Array>
}

/**
 * XMTP Signer implementation backed by TEE
 */
export class TEEXMTPSigner implements XMTPSigner {
  private keyManager: TEEXMTPKeyManager
  private identityKey: TEEIdentityKey

  constructor(keyManager: TEEXMTPKeyManager, identityKey: TEEIdentityKey) {
    this.keyManager = keyManager
    this.identityKey = identityKey
  }

  /**
   * Get the address associated with this signer
   */
  async getAddress(): Promise<string> {
    return this.identityKey.address
  }

  /**
   * Get the identity key
   */
  getIdentityKey(): TEEIdentityKey {
    return this.identityKey
  }

  /**
   * Sign a message using the TEE-backed key
   */
  async signMessage(message: string | Uint8Array): Promise<Uint8Array> {
    const messageBytes =
      typeof message === 'string' ? new TextEncoder().encode(message) : message

    const signature = await this.keyManager.sign(
      this.identityKey.keyId,
      messageBytes,
    )

    return hexToBytes(signature)
  }

  /**
   * Create signed public key bundle for XMTP registration
   */
  async createSignedPublicKeyBundle(): Promise<SignedPublicKeyBundle> {
    // Generate pre-key
    const preKey = await this.keyManager.generatePreKey(this.identityKey.keyId)

    // Sign identity public key
    const identityPubBytes = hexToBytes(this.identityKey.publicKey)
    const identitySignature = await this.signMessage(identityPubBytes)

    return {
      identityKey: {
        publicKey: identityPubBytes,
        signature: identitySignature,
      },
      preKey: {
        publicKey: hexToBytes(preKey.publicKey),
        signature: hexToBytes(preKey.signature),
      },
    }
  }

  /**
   * Rotate pre-key (generates new pre-key, old one expires)
   */
  async rotatePreKey(): Promise<TEEPreKey> {
    return this.keyManager.generatePreKey(this.identityKey.keyId)
  }

  /**
   * Perform ECDH with another party's public key
   */
  async sharedSecret(
    _theirPreKeyId: string,
    theirPublicKey: Hex,
  ): Promise<Uint8Array> {
    // Get our pre-key for this exchange
    const preKeys = await this.keyManager.getPreKeys(this.identityKey.keyId)
    const ourPreKey = preKeys[preKeys.length - 1]
    if (!ourPreKey) {
      throw new Error('No pre-keys available')
    }

    return this.keyManager.sharedSecret(ourPreKey.keyId, theirPublicKey)
  }

  /**
   * Export encrypted backup
   */
  async exportBackup(password: string): Promise<string> {
    const backup = await this.keyManager.exportEncrypted(
      this.identityKey.keyId,
      password,
    )
    return JSON.stringify(backup)
  }

  /**
   * Get TEE attestation for this signer
   */
  async getAttestation(): Promise<{
    valid: boolean
    attestation: TEEAttestation
  }> {
    const attestation = await this.keyManager.getAttestation(
      this.identityKey.keyId,
    )
    const verification = await this.keyManager.verifyAttestation(attestation)

    return {
      valid: verification.valid,
      attestation,
    }
  }
}

/**
 * Create XMTP signer with TEE backing
 */
export async function createTEEXMTPSigner(
  keyManager: TEEXMTPKeyManager,
  address: Address,
): Promise<TEEXMTPSigner> {
  // Get or create identity key
  let identityKey = await keyManager.getIdentityKey(address)

  if (!identityKey) {
    identityKey = await keyManager.generateIdentityKey(address)
  }

  return new TEEXMTPSigner(keyManager, identityKey)
}

/**
 * Import signer from backup
 */
export async function importTEEXMTPSigner(
  keyManager: TEEXMTPKeyManager,
  encryptedBackup: string,
  password: string,
  newKeyId?: string,
): Promise<TEEXMTPSigner> {
  // Validate backup string length to prevent DoS
  if (encryptedBackup.length > 1024 * 1024) {
    throw new Error('Backup data too large')
  }

  // Parse and validate with Zod schema
  const parseResult = EncryptedBackupSchema.safeParse(
    JSON.parse(encryptedBackup),
  )
  if (!parseResult.success) {
    throw new Error(`Invalid backup format: ${parseResult.error.message}`)
  }

  const validatedBackup: EncryptedBackup = parseResult.data

  const keyId = newKeyId ?? `imported-${Date.now()}`

  const identityKey = await keyManager.importFromBackup(
    validatedBackup,
    password,
    keyId,
  )

  return new TEEXMTPSigner(keyManager, identityKey)
}

/**
 * Convert hex string to bytes
 */
function hexToBytes(hex: Hex): Uint8Array {
  return Buffer.from(hex.slice(2), 'hex')
}

/**
 * Derive address from public key (simplified)
 */
export function deriveAddressFromPublicKey(publicKey: Hex): Address {
  const { keccak256 } = require('viem') as { keccak256: (input: Hex) => Hex }

  // For Ed25519, we use a simplified derivation
  // In production, would handle this properly per XMTP spec
  const hash = keccak256(publicKey)
  return `0x${hash.slice(-40)}` as Address
}
