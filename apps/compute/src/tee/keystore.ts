/**
 * TEE Keystore
 *
 * Simulates hardware-protected key management in a TEE.
 * Uses production-quality cryptography (AES-GCM, HKDF).
 *
 * In a real hardware TEE, keys are derived from hardware-protected seeds
 * and never leave the enclave. This simulation uses proper crypto
 * but cannot provide the hardware isolation guarantees.
 */

import { keccak256, toBytes } from 'viem';
import {
  decrypt,
  deriveKeyWithLabel,
  type EncryptedPayload,
  encrypt,
  importKey,
} from '../crypto/index.js';

export interface SealedData {
  /** Encrypted payload */
  payload: EncryptedPayload;
  /** Key version used for encryption */
  version: number;
  /** Label identifying the key used */
  label: string;
}

export interface KeystoreConfig {
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
}

/**
 * TEE Keystore with production-quality cryptography
 */
export class TEEKeystore {
  private masterSeed: Uint8Array;
  private derivedKeys: Map<string, CryptoKey> = new Map();
  private keyVersions: Map<string, number> = new Map();
  private config: KeystoreConfig;

  private constructor(masterSeed: Uint8Array, config: KeystoreConfig = {}) {
    this.masterSeed = masterSeed;
    this.config = config;
  }

  /**
   * Create a keystore from an enclave measurement
   * In real TEE: this would be derived from CPU fuses + enclave code hash
   */
  static async create(
    enclaveMeasurement: string,
    config: KeystoreConfig = {}
  ): Promise<TEEKeystore> {
    if (!enclaveMeasurement || enclaveMeasurement.length < 10) {
      throw new Error('Invalid enclave measurement');
    }

    // Derive master seed from measurement using keccak256
    const measurementBytes = toBytes(enclaveMeasurement as `0x${string}`);
    const seedHash = keccak256(measurementBytes);
    const masterSeed = toBytes(seedHash);

    const keystore = new TEEKeystore(masterSeed, config);

    if (config.verbose) {
      console.log(
        `[TEE Keystore] Initialized with measurement: ${enclaveMeasurement.slice(0, 16)}...`
      );
    }

    return keystore;
  }

  /**
   * Derive a key for a specific purpose using the label
   * Uses proper HKDF for key derivation
   */
  async deriveKey(label: string, version = 1): Promise<CryptoKey> {
    if (!label || label.length === 0) {
      throw new Error('Key label cannot be empty');
    }
    if (version < 1) {
      throw new Error('Key version must be >= 1');
    }

    const keyId = `${label}:v${version}`;

    const cached = this.derivedKeys.get(keyId);
    if (cached) {
      return cached;
    }

    // Derive key bytes using proper HKDF
    const keyBytes = await deriveKeyWithLabel(this.masterSeed, keyId, 32);

    // Import as AES-GCM key
    const cryptoKey = await importKey(keyBytes);

    this.derivedKeys.set(keyId, cryptoKey);
    this.keyVersions.set(label, version);

    if (this.config.verbose) {
      console.log(`[TEE Keystore] Derived key: ${label} (version ${version})`);
    }

    return cryptoKey;
  }

  /**
   * Get current version for a key label
   */
  getKeyVersion(label: string): number {
    return this.keyVersions.get(label) ?? 1;
  }

  /**
   * Rotate a key to a new version
   * Old key is removed from memory
   */
  async rotateKey(
    label: string
  ): Promise<{ oldVersion: number; newVersion: number }> {
    const oldVersion = this.keyVersions.get(label) ?? 1;
    const newVersion = oldVersion + 1;

    // Derive new key
    await this.deriveKey(label, newVersion);

    // Remove old key from memory
    const oldKeyId = `${label}:v${oldVersion}`;
    this.derivedKeys.delete(oldKeyId);

    if (this.config.verbose) {
      console.log(
        `[TEE Keystore] Rotated key ${label}: v${oldVersion} -> v${newVersion}`
      );
    }

    return { oldVersion, newVersion };
  }

  /**
   * Seal data (encrypt with enclave-specific key)
   * Uses AES-256-GCM for authenticated encryption
   */
  async seal(data: Uint8Array, label: string): Promise<SealedData> {
    if (data.length === 0) {
      throw new Error('Cannot seal empty data');
    }

    const version = this.getKeyVersion(label);
    const key = await this.deriveKey(label, version);

    const payload = await encrypt(data, key);

    return { payload, version, label };
  }

  /**
   * Unseal data (decrypt with enclave-specific key)
   * Verifies authenticity via GCM tag
   */
  async unseal(sealed: SealedData, version?: number): Promise<Uint8Array> {
    const v = version ?? sealed.version;
    const key = await this.deriveKey(sealed.label, v);

    return decrypt(sealed.payload, key);
  }

  /**
   * Seal a JSON object
   */
  async sealJSON<T>(data: T, label: string): Promise<SealedData> {
    const json = JSON.stringify(data);
    const encoder = new TextEncoder();
    return this.seal(encoder.encode(json), label);
  }

  /**
   * Unseal a JSON object
   */
  async unsealJSON<T>(sealed: SealedData, version?: number): Promise<T> {
    const bytes = await this.unseal(sealed, version);
    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(bytes)) as T;
  }

  /**
   * Get the raw key bytes for a derived key (for external use like wallet derivation)
   * Returns a copy to prevent modification
   */
  async getRawKeyBytes(label: string, version?: number): Promise<Uint8Array> {
    const v = version ?? this.getKeyVersion(label);
    const keyId = `${label}:v${v}`;

    // Derive fresh bytes (don't use cached CryptoKey)
    const keyBytes = await deriveKeyWithLabel(this.masterSeed, keyId, 32);
    return keyBytes;
  }

  /**
   * Check if a key exists for a label
   */
  hasKey(label: string): boolean {
    return this.keyVersions.has(label);
  }

  /**
   * Clear all derived keys from memory
   * Call this on shutdown
   */
  clear(): void {
    this.derivedKeys.clear();
    this.keyVersions.clear();
  }
}
