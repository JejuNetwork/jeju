/**
 * Threshold Key Manager
 *
 * Manages threshold key shares for MPC signing.
 * Uses TEE keystore for secure key storage.
 */

import type { Address, Hex } from 'viem';
import { keccak256, toBytes, toHex } from 'viem';
import { TEEKeystore } from '../tee/keystore.js';
import type { StoredKeyShare } from './types.js';

export interface KeyShare {
  index: number;
  value: Uint8Array;
}

export interface ThresholdConfig {
  /** Threshold required for signing (t) */
  threshold: number;
  /** Total number of shares (n) */
  totalShares: number;
}

export interface GeneratedKey {
  publicKey: Hex;
  walletAddress: Address;
  shares: KeyShare[];
}

/**
 * Manages threshold key generation and storage
 */
export class ThresholdKeyManager {
  private keystore: TEEKeystore;
  private storedShares: Map<string, StoredKeyShare> = new Map();

  constructor(keystore: TEEKeystore) {
    this.keystore = keystore;
  }

  /**
   * Generate a new threshold key pair
   *
   * In production, this would use proper threshold ECDSA (e.g., GG20 or FROST).
   * This implementation uses Shamir's Secret Sharing as a simplified model.
   */
  async generateKey(
    userId: string,
    config: ThresholdConfig
  ): Promise<GeneratedKey> {
    const { threshold, totalShares } = config;

    if (threshold > totalShares) {
      throw new Error('Threshold cannot exceed total shares');
    }
    if (threshold < 1) {
      throw new Error('Threshold must be at least 1');
    }

    // Generate master private key in TEE
    const masterKeyBytes = await this.keystore.getRawKeyBytes(
      `user:${userId}:master`,
      1
    );

    // Derive public key (simplified - in production would use secp256k1)
    const publicKeyHash = keccak256(masterKeyBytes);
    const publicKey = publicKeyHash as Hex;

    // Derive wallet address from public key
    const addressHash = keccak256(toBytes(publicKey));
    const walletAddress = `0x${addressHash.slice(-40)}` as Address;

    // Generate shares using Shamir's Secret Sharing
    const shares = this.splitSecret(masterKeyBytes, threshold, totalShares);

    return {
      publicKey,
      walletAddress,
      shares,
    };
  }

  /**
   * Store a key share for a user
   */
  async storeShare(
    userId: string,
    share: KeyShare,
    publicKey: Hex,
    walletAddress: Address,
    config: ThresholdConfig
  ): Promise<void> {
    // Encrypt share using TEE keystore
    const sealed = await this.keystore.seal(
      share.value,
      `user:${userId}:share:${share.index}`
    );

    // Store the sealed data as JSON string in the hex field
    const sealedJson = JSON.stringify(sealed);
    const sealedBytes = new TextEncoder().encode(sealedJson);

    const storedShare: StoredKeyShare = {
      userId,
      shareIndex: share.index,
      encryptedShare: toHex(sealedBytes),
      publicKey,
      walletAddress,
      threshold: config.threshold,
      totalShares: config.totalShares,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };

    this.storedShares.set(userId, storedShare);
  }

  /**
   * Retrieve a key share for signing
   */
  async getShare(userId: string): Promise<KeyShare | null> {
    const stored = this.storedShares.get(userId);
    if (!stored) {
      return null;
    }

    // Decrypt share from TEE keystore
    const encryptedBytes = toBytes(stored.encryptedShare);
    const sealedJson = new TextDecoder().decode(encryptedBytes);
    const sealed = JSON.parse(sealedJson) as {
      payload: { ciphertext: string; iv: string; alg: 'AES-256-GCM' };
      version: number;
      label: string;
    };

    const shareBytes = await this.keystore.unseal(sealed, sealed.version);

    // Update last used time
    stored.lastUsedAt = Date.now();

    return {
      index: stored.shareIndex,
      value: shareBytes,
    };
  }

  /**
   * Get stored share metadata (without decrypting)
   */
  getShareMetadata(userId: string): StoredKeyShare | null {
    return this.storedShares.get(userId) ?? null;
  }

  /**
   * Check if we have a share for a user
   */
  hasShare(userId: string): boolean {
    return this.storedShares.has(userId);
  }

  /**
   * Delete a user's key share
   */
  async deleteShare(userId: string): Promise<boolean> {
    return this.storedShares.delete(userId);
  }

  /**
   * Split a secret into shares using Shamir's Secret Sharing
   * Simplified implementation - production would use proper polynomial evaluation
   */
  private splitSecret(
    secret: Uint8Array,
    threshold: number,
    totalShares: number
  ): KeyShare[] {
    const shares: KeyShare[] = [];

    // Generate random coefficients for the polynomial
    const coefficients: Uint8Array[] = [secret];
    for (let i = 1; i < threshold; i++) {
      coefficients.push(crypto.getRandomValues(new Uint8Array(32)));
    }

    // Evaluate polynomial at points 1, 2, ..., n
    for (let x = 1; x <= totalShares; x++) {
      const share = this.evaluatePolynomial(coefficients, x);
      shares.push({ index: x, value: share });
    }

    return shares;
  }

  /**
   * Evaluate polynomial at a point
   */
  private evaluatePolynomial(
    coefficients: Uint8Array[],
    x: number
  ): Uint8Array {
    const result = new Uint8Array(32);

    // For each coefficient, add coefficient * x^i (mod field)
    for (let i = 0; i < coefficients.length; i++) {
      const term = this.multiplyByScalar(coefficients[i], Math.pow(x, i));
      for (let j = 0; j < 32; j++) {
        result[j] = (result[j] + term[j]) % 256;
      }
    }

    return result;
  }

  /**
   * Multiply a byte array by a scalar
   */
  private multiplyByScalar(bytes: Uint8Array, scalar: number): Uint8Array {
    const result = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      result[i] = (bytes[i] * scalar) % 256;
    }
    return result;
  }

  /**
   * Combine shares to reconstruct the secret
   * Uses Lagrange interpolation
   */
  combineShares(shares: KeyShare[]): Uint8Array {
    if (shares.length < 2) {
      throw new Error('Need at least 2 shares to reconstruct');
    }

    const result = new Uint8Array(32);
    const indices = shares.map((s) => s.index);

    for (const share of shares) {
      const lagrange = this.lagrangeCoefficient(share.index, indices);
      const term = this.multiplyByScalar(share.value, Math.abs(lagrange));

      for (let i = 0; i < 32; i++) {
        if (lagrange >= 0) {
          result[i] = (result[i] + term[i]) % 256;
        } else {
          result[i] = (result[i] - term[i] + 256) % 256;
        }
      }
    }

    return result;
  }

  /**
   * Calculate Lagrange coefficient for a share
   */
  private lagrangeCoefficient(index: number, allIndices: number[]): number {
    let numerator = 1;
    let denominator = 1;

    for (const j of allIndices) {
      if (j !== index) {
        numerator *= -j;
        denominator *= index - j;
      }
    }

    return Math.round(numerator / denominator);
  }
}
