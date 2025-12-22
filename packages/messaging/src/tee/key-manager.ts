/**
 * TEE-Backed XMTP Key Manager
 * 
 * Manages XMTP identity keys within a TEE enclave.
 * Keys are generated and used inside the TEE, never exposed to application code.
 */

import type { Address, Hex } from 'viem';
import type {
  TEEKeyConfig,
  TEEIdentityKey,
  TEEPreKey,
  TEEInstallationKey,
  TEEAttestation,
  AttestationVerificationResult,
  SignRequest,
  SignResult,
  EncryptedBackup,
  GenerateKeyRequest,
  GenerateKeyResult,
  KeyPolicy,
} from './types';
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';

// ============ Types ============

interface MockKeyStore {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  type: 'ed25519' | 'x25519';
}

// ============ TEE Key Manager Class ============

/**
 * Manages XMTP keys in a Trusted Execution Environment
 */
export class TEEXMTPKeyManager {
  private config: TEEKeyConfig;
  private keys: Map<string, TEEIdentityKey> = new Map();
  private preKeys: Map<string, TEEPreKey> = new Map();
  private installationKeys: Map<string, TEEInstallationKey> = new Map();
  
  // In production, this would be a TEE-backed store
  // For now, use in-memory mock
  private mockKeyStore: Map<string, MockKeyStore> = new Map();
  
  constructor(config: TEEKeyConfig) {
    this.config = config;
  }
  
  // ============ Identity Key Management ============
  
  /**
   * Generate XMTP identity key inside TEE
   */
  async generateIdentityKey(address: Address): Promise<TEEIdentityKey> {
    const keyId = `xmtp-identity-${address.toLowerCase()}-${Date.now()}`;
    
    // Generate Ed25519 key pair inside TEE
    const keyPair = await this.generateKeyInTEE({
      keyId,
      type: 'ed25519',
      policy: {
        owner: address,
        operations: ['sign', 'derive'],
        attestation: this.config.attestationRequired,
      },
    });
    
    // Get attestation if required
    let attestation: TEEAttestation | undefined;
    if (this.config.attestationRequired) {
      attestation = await this.generateAttestation(keyId);
    }
    
    const identityKey: TEEIdentityKey = {
      keyId,
      address,
      publicKey: keyPair.publicKey,
      attestation,
      createdAt: Date.now(),
    };
    
    this.keys.set(keyId, identityKey);
    
    console.log(`[TEE] Generated identity key ${keyId} for ${address}`);
    
    return identityKey;
  }
  
  /**
   * Get identity key for address
   */
  async getIdentityKey(address: Address): Promise<TEEIdentityKey | null> {
    for (const key of this.keys.values()) {
      if (key.address.toLowerCase() === address.toLowerCase()) {
        return key;
      }
    }
    return null;
  }
  
  /**
   * Get identity key by ID
   */
  async getKey(keyId: string): Promise<TEEIdentityKey | null> {
    return this.keys.get(keyId) ?? null;
  }
  
  // ============ Pre-Key Management ============
  
  /**
   * Generate XMTP pre-key inside TEE
   */
  async generatePreKey(identityKeyId: string): Promise<TEEPreKey> {
    const identityKey = this.keys.get(identityKeyId);
    if (!identityKey) {
      throw new Error(`Identity key not found: ${identityKeyId}`);
    }
    
    const preKeyId = `${identityKeyId}-prekey-${Date.now()}`;
    
    // Generate X25519 pre-key
    const preKeyPair = await this.generateKeyInTEE({
      keyId: preKeyId,
      type: 'x25519',
      policy: { parentKey: identityKeyId },
    });
    
    // Sign pre-key with identity key
    const signature = await this.signInTEE({
      keyId: identityKeyId,
      message: Buffer.from(preKeyPair.publicKey.slice(2), 'hex'),
    });
    
    const preKey: TEEPreKey = {
      keyId: preKeyId,
      identityKeyId,
      publicKey: preKeyPair.publicKey,
      signature: signature.signature,
      createdAt: Date.now(),
      expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days
    };
    
    this.preKeys.set(preKeyId, preKey);
    
    console.log(`[TEE] Generated pre-key ${preKeyId}`);
    
    return preKey;
  }
  
  /**
   * Get pre-keys for identity key
   */
  async getPreKeys(identityKeyId: string): Promise<TEEPreKey[]> {
    return Array.from(this.preKeys.values())
      .filter(pk => pk.identityKeyId === identityKeyId);
  }
  
  // ============ Installation Key Management ============
  
  /**
   * Derive installation key from identity key
   */
  async deriveInstallationKey(
    identityKeyId: string,
    deviceId: string,
  ): Promise<TEEInstallationKey> {
    const identityKey = this.keys.get(identityKeyId);
    if (!identityKey) {
      throw new Error(`Identity key not found: ${identityKeyId}`);
    }
    
    const installationKeyId = `${identityKeyId}-installation-${deviceId}`;
    
    // Check if already exists
    const existing = this.installationKeys.get(installationKeyId);
    if (existing) return existing;
    
    // Derive key using HKDF inside TEE
    const derivedKey = await this.deriveKeyInTEE(
      identityKeyId,
      installationKeyId,
      `xmtp-installation-${deviceId}`,
    );
    
    const installationKey: TEEInstallationKey = {
      keyId: installationKeyId,
      identityKeyId,
      deviceId,
      publicKey: derivedKey.publicKey,
      createdAt: Date.now(),
    };
    
    this.installationKeys.set(installationKeyId, installationKey);
    
    console.log(`[TEE] Derived installation key for device ${deviceId}`);
    
    return installationKey;
  }
  
  // ============ Signing Operations ============
  
  /**
   * Sign message with identity key
   */
  async sign(keyId: string, message: Uint8Array): Promise<Hex> {
    const result = await this.signInTEE({
      keyId,
      message,
    });
    
    // Update last used timestamp
    const key = this.keys.get(keyId);
    if (key) {
      key.lastUsedAt = Date.now();
    }
    
    return result.signature;
  }
  
  // ============ ECDH Operations ============
  
  /**
   * Perform ECDH key exchange inside TEE
   */
  async sharedSecret(
    privateKeyId: string,
    theirPublicKey: Hex,
  ): Promise<Uint8Array> {
    // In production, this happens entirely inside TEE
    const keyStore = this.mockKeyStore.get(privateKeyId);
    if (!keyStore || keyStore.type !== 'x25519') {
      throw new Error(`X25519 key not found: ${privateKeyId}`);
    }
    
    // Mock ECDH - in production, use TEE-backed X25519
    const theirPub = Buffer.from(theirPublicKey.slice(2), 'hex');
    
    // For mock, just hash the concatenation
    const { createHash } = await import('node:crypto');
    const shared = createHash('sha256')
      .update(keyStore.privateKey)
      .update(theirPub)
      .digest();
    
    return shared;
  }
  
  // ============ Key Export/Import ============
  
  /**
   * Export encrypted backup of keys
   */
  async exportEncrypted(
    keyId: string,
    backupPassword: string,
  ): Promise<EncryptedBackup> {
    const keyStore = this.mockKeyStore.get(keyId);
    if (!keyStore) {
      throw new Error(`Key not found: ${keyId}`);
    }
    
    // Derive encryption key from password
    const salt = randomBytes(32);
    const encryptionKey = scryptSync(backupPassword, salt, 32);
    
    // Encrypt private key
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
    
    const encrypted = Buffer.concat([
      cipher.update(keyStore.privateKey),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    
    // Combine: iv + authTag + ciphertext
    const ciphertext = Buffer.concat([iv, authTag, encrypted]);
    
    return {
      ciphertext: `0x${ciphertext.toString('hex')}` as Hex,
      metadata: {
        keyId,
        algorithm: 'aes-256-gcm',
        kdfParams: {
          salt: `0x${salt.toString('hex')}` as Hex,
          iterations: 100000,
        },
      },
      createdAt: Date.now(),
    };
  }
  
  /**
   * Import key from encrypted backup
   */
  async importFromBackup(
    encryptedBackup: EncryptedBackup,
    password: string,
    newKeyId: string,
  ): Promise<TEEIdentityKey> {
    const { ciphertext, metadata } = encryptedBackup;
    
    // Derive decryption key
    const salt = Buffer.from(metadata.kdfParams.salt.slice(2), 'hex');
    const decryptionKey = scryptSync(password, salt, 32);
    
    // Parse ciphertext
    const data = Buffer.from(ciphertext.slice(2), 'hex');
    const iv = data.subarray(0, 16);
    const authTag = data.subarray(16, 32);
    const encrypted = data.subarray(32);
    
    // Decrypt
    const decipher = createDecipheriv('aes-256-gcm', decryptionKey, iv);
    decipher.setAuthTag(authTag);
    
    const privateKey = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    
    // Generate public key from private key
    const { ed25519 } = await import('@noble/curves/ed25519');
    const publicKey = ed25519.getPublicKey(privateKey);
    
    // Store in mock key store
    this.mockKeyStore.set(newKeyId, {
      privateKey: new Uint8Array(privateKey),
      publicKey,
      type: 'ed25519',
    });
    
    const identityKey: TEEIdentityKey = {
      keyId: newKeyId,
      address: '0x0000000000000000000000000000000000000000' as Address, // Would derive from key
      publicKey: `0x${Buffer.from(publicKey).toString('hex')}` as Hex,
      createdAt: Date.now(),
    };
    
    this.keys.set(newKeyId, identityKey);
    
    return identityKey;
  }
  
  // ============ Attestation ============
  
  /**
   * Get TEE attestation for key
   */
  async getAttestation(keyId: string): Promise<TEEAttestation> {
    const key = this.keys.get(keyId);
    if (!key) {
      throw new Error(`Key not found: ${keyId}`);
    }
    
    if (key.attestation) {
      return key.attestation;
    }
    
    return this.generateAttestation(keyId);
  }
  
  /**
   * Verify TEE attestation
   */
  async verifyAttestation(attestation: TEEAttestation): Promise<AttestationVerificationResult> {
    // In production, verify against TEE attestation service
    const enclaveIdMatch = attestation.enclaveId === this.config.enclaveId;
    
    // Mock verification
    return {
      valid: enclaveIdMatch,
      enclaveIdMatch,
      measurementMatch: true, // Would verify against expected measurement
      signatureValid: true, // Would verify attestation signature
      chainValid: true, // Would verify certificate chain
      errors: enclaveIdMatch ? [] : ['Enclave ID mismatch'],
    };
  }
  
  // ============ Private TEE Operations ============
  
  /**
   * Generate key inside TEE
   */
  private async generateKeyInTEE(request: GenerateKeyRequest): Promise<GenerateKeyResult> {
    const { ed25519 } = await import('@noble/curves/ed25519');
    const { x25519 } = await import('@noble/curves/ed25519');
    
    let privateKey: Uint8Array;
    let publicKey: Uint8Array;
    
    if (request.type === 'ed25519') {
      privateKey = randomBytes(32);
      publicKey = ed25519.getPublicKey(privateKey);
    } else if (request.type === 'x25519') {
      privateKey = randomBytes(32);
      publicKey = x25519.getPublicKey(privateKey);
    } else {
      throw new Error(`Unsupported key type: ${request.type}`);
    }
    
    // Store in mock TEE store
    this.mockKeyStore.set(request.keyId, {
      privateKey,
      publicKey,
      type: request.type,
    });
    
    return {
      keyId: request.keyId,
      publicKey: `0x${Buffer.from(publicKey).toString('hex')}` as Hex,
      type: request.type,
    };
  }
  
  /**
   * Sign inside TEE
   */
  private async signInTEE(request: SignRequest): Promise<SignResult> {
    const keyStore = this.mockKeyStore.get(request.keyId);
    if (!keyStore || keyStore.type !== 'ed25519') {
      throw new Error(`Ed25519 key not found: ${request.keyId}`);
    }
    
    const { ed25519 } = await import('@noble/curves/ed25519');
    const signature = ed25519.sign(request.message, keyStore.privateKey);
    
    return {
      signature: `0x${Buffer.from(signature).toString('hex')}` as Hex,
      keyId: request.keyId,
      timestamp: Date.now(),
    };
  }
  
  /**
   * Derive key inside TEE using HKDF
   */
  private async deriveKeyInTEE(
    parentKeyId: string,
    newKeyId: string,
    info: string,
  ): Promise<GenerateKeyResult> {
    const parentKey = this.mockKeyStore.get(parentKeyId);
    if (!parentKey) {
      throw new Error(`Parent key not found: ${parentKeyId}`);
    }
    
    // HKDF derivation
    const { hkdf } = await import('@noble/hashes/hkdf');
    const { sha256 } = await import('@noble/hashes/sha256');
    
    const derived = hkdf(
      sha256,
      parentKey.privateKey,
      new Uint8Array(0), // salt
      new TextEncoder().encode(info),
      32,
    );
    
    // Generate public key
    const { x25519 } = await import('@noble/curves/ed25519');
    const publicKey = x25519.getPublicKey(derived);
    
    this.mockKeyStore.set(newKeyId, {
      privateKey: derived,
      publicKey,
      type: 'x25519',
    });
    
    return {
      keyId: newKeyId,
      publicKey: `0x${Buffer.from(publicKey).toString('hex')}` as Hex,
      type: 'x25519',
    };
  }
  
  /**
   * Generate attestation for key
   */
  private async generateAttestation(keyId: string): Promise<TEEAttestation> {
    const nonce = randomBytes(32);
    const timestamp = Date.now();
    
    // Mock attestation - in production, this comes from TEE
    const measurement = randomBytes(32);
    
    // Sign attestation
    const attestationData = Buffer.concat([
      Buffer.from(this.config.enclaveId),
      measurement,
      nonce,
      Buffer.from(timestamp.toString()),
    ]);
    
    const { createHash, createHmac } = await import('node:crypto');
    const signature = createHmac('sha256', 'tee-attestation-key')
      .update(attestationData)
      .digest();
    
    return {
      version: 1,
      enclaveId: this.config.enclaveId,
      measurement: `0x${measurement.toString('hex')}` as Hex,
      pcrs: {
        0: `0x${randomBytes(32).toString('hex')}` as Hex,
        1: `0x${randomBytes(32).toString('hex')}` as Hex,
        2: `0x${randomBytes(32).toString('hex')}` as Hex,
      },
      nonce: `0x${nonce.toString('hex')}` as Hex,
      timestamp,
      signature: `0x${signature.toString('hex')}` as Hex,
    };
  }
  
  // ============ Stats ============
  
  /**
   * Get manager stats
   */
  getStats(): {
    identityKeys: number;
    preKeys: number;
    installationKeys: number;
  } {
    return {
      identityKeys: this.keys.size,
      preKeys: this.preKeys.size,
      installationKeys: this.installationKeys.size,
    };
  }
}

// ============ Factory Function ============

/**
 * Create TEE key manager
 */
export function createTEEKeyManager(config: TEEKeyConfig): TEEXMTPKeyManager {
  return new TEEXMTPKeyManager(config);
}

