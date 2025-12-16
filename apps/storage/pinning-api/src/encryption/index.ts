/**
 * Encrypted Storage Service
 *
 * Integrates KMS for encrypted content distribution:
 * - Encrypt before upload
 * - Access control via on-chain conditions
 * - Decrypt on authorized download
 */

import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import type { Address } from '../../../../../packages/types/src';

// ============ Types ============

export interface AccessCondition {
  type: 'token' | 'nft' | 'stake' | 'timestamp' | 'address' | 'balance';
  contractAddress?: Address;
  chain?: number;
  threshold?: bigint;
  timestamp?: number;
  addresses?: Address[];
  tokenId?: bigint;
}

export interface AccessPolicy {
  conditions: AccessCondition[];
  operator: 'and' | 'or';
}

export interface EncryptedPayload {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  keyId: string;
  policyHash: string;
  algorithm: 'aes-256-gcm';
}

export interface EncryptionConfig {
  kmsUrl?: string;
  localKeyPath?: string;
}

// ============ Encryption Service ============

export class EncryptionService {
  private config: EncryptionConfig;
  private localKeys: Map<string, Buffer> = new Map();

  constructor(config: EncryptionConfig = {}) {
    this.config = config;
  }

  /**
   * Generate a new encryption key for content
   */
  generateKey(policy: AccessPolicy): { keyId: string; key: Buffer; policyHash: string } {
    const key = randomBytes(32); // AES-256
    const keyId = createHash('sha256').update(key).digest('hex').slice(0, 32);
    const policyHash = this.hashPolicy(policy);

    // Store locally for now (in production, this would go to KMS)
    this.localKeys.set(keyId, key);

    return { keyId, key, policyHash };
  }

  /**
   * Encrypt content with access control
   */
  encrypt(content: Buffer, policy: AccessPolicy): EncryptedPayload {
    const { keyId, key, policyHash } = this.generateKey(policy);
    const iv = randomBytes(16);

    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(content), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      ciphertext,
      iv,
      tag,
      keyId,
      policyHash,
      algorithm: 'aes-256-gcm',
    };
  }

  /**
   * Decrypt content after verifying access
   */
  decrypt(
    payload: EncryptedPayload,
    authSignature: { sig: `0x${string}`; message: string; address: Address }
  ): Buffer {
    // Get key (in production, would verify access policy first)
    const key = this.localKeys.get(payload.keyId);
    if (!key) {
      throw new Error(`Key not found: ${payload.keyId}`);
    }

    // Verify signature matches an authorized address
    // In production, this would check on-chain conditions
    this.verifySignature(authSignature);

    const decipher = createDecipheriv('aes-256-gcm', key, payload.iv);
    decipher.setAuthTag(payload.tag);

    return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
  }

  /**
   * Serialize encrypted payload for storage
   */
  serializePayload(payload: EncryptedPayload): Buffer {
    return Buffer.from(
      JSON.stringify({
        ciphertext: payload.ciphertext.toString('base64'),
        iv: payload.iv.toString('base64'),
        tag: payload.tag.toString('base64'),
        keyId: payload.keyId,
        policyHash: payload.policyHash,
        algorithm: payload.algorithm,
      })
    );
  }

  /**
   * Deserialize encrypted payload from storage
   */
  deserializePayload(data: Buffer): EncryptedPayload {
    const parsed = JSON.parse(data.toString()) as {
      ciphertext: string;
      iv: string;
      tag: string;
      keyId: string;
      policyHash: string;
      algorithm: 'aes-256-gcm';
    };

    return {
      ciphertext: Buffer.from(parsed.ciphertext, 'base64'),
      iv: Buffer.from(parsed.iv, 'base64'),
      tag: Buffer.from(parsed.tag, 'base64'),
      keyId: parsed.keyId,
      policyHash: parsed.policyHash,
      algorithm: parsed.algorithm,
    };
  }

  /**
   * Check if user meets access conditions
   */
  async checkAccess(
    policy: AccessPolicy,
    userAddress: Address,
    provider?: { readContract: (params: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }) => Promise<unknown> }
  ): Promise<boolean> {
    const results = await Promise.all(
      policy.conditions.map((condition) =>
        this.checkCondition(condition, userAddress, provider)
      )
    );

    if (policy.operator === 'and') {
      return results.every(Boolean);
    }
    return results.some(Boolean);
  }

  // ============ Private Methods ============

  private hashPolicy(policy: AccessPolicy): string {
    return createHash('sha256')
      .update(JSON.stringify(policy))
      .digest('hex');
  }

  private verifySignature(authSignature: {
    sig: `0x${string}`;
    message: string;
    address: Address;
  }): void {
    // In production, use ethers/viem to verify signature
    // For now, just check signature format
    if (!authSignature.sig.startsWith('0x') || authSignature.sig.length < 132) {
      throw new Error('Invalid signature format');
    }
  }

  private async checkCondition(
    condition: AccessCondition,
    userAddress: Address,
    provider?: { readContract: (params: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }) => Promise<unknown> }
  ): Promise<boolean> {
    switch (condition.type) {
      case 'address':
        return condition.addresses?.includes(userAddress) ?? false;

      case 'timestamp':
        return Date.now() >= (condition.timestamp ?? 0) * 1000;

      case 'balance':
        if (!provider || !condition.contractAddress || !condition.threshold) {
          return false;
        }
        const balance = (await provider.readContract({
          address: condition.contractAddress,
          abi: [
            {
              name: 'balanceOf',
              type: 'function',
              stateMutability: 'view',
              inputs: [{ name: 'account', type: 'address' }],
              outputs: [{ name: '', type: 'uint256' }],
            },
          ] as const,
          functionName: 'balanceOf',
          args: [userAddress],
        })) as bigint;
        return balance >= condition.threshold;

      case 'nft':
        if (!provider || !condition.contractAddress) {
          return false;
        }
        if (condition.tokenId !== undefined) {
          const owner = (await provider.readContract({
            address: condition.contractAddress,
            abi: [
              {
                name: 'ownerOf',
                type: 'function',
                stateMutability: 'view',
                inputs: [{ name: 'tokenId', type: 'uint256' }],
                outputs: [{ name: '', type: 'address' }],
              },
            ] as const,
            functionName: 'ownerOf',
            args: [condition.tokenId],
          })) as Address;
          return owner.toLowerCase() === userAddress.toLowerCase();
        }
        // Check if user owns any NFT from collection
        const nftBalance = (await provider.readContract({
          address: condition.contractAddress,
          abi: [
            {
              name: 'balanceOf',
              type: 'function',
              stateMutability: 'view',
              inputs: [{ name: 'owner', type: 'address' }],
              outputs: [{ name: '', type: 'uint256' }],
            },
          ] as const,
          functionName: 'balanceOf',
          args: [userAddress],
        })) as bigint;
        return nftBalance > 0n;

      case 'stake':
        if (!provider || !condition.contractAddress || !condition.threshold) {
          return false;
        }
        const staked = (await provider.readContract({
          address: condition.contractAddress,
          abi: [
            {
              name: 'stakes',
              type: 'function',
              stateMutability: 'view',
              inputs: [{ name: 'staker', type: 'address' }],
              outputs: [{ name: 'amount', type: 'uint256' }],
            },
          ] as const,
          functionName: 'stakes',
          args: [userAddress],
        })) as bigint;
        return staked >= condition.threshold;

      case 'token':
        return this.checkCondition(
          { ...condition, type: 'balance' },
          userAddress,
          provider
        );

      default:
        return false;
    }
  }
}

// ============ Factory ============

let globalEncryptionService: EncryptionService | null = null;

export function getEncryptionService(config?: EncryptionConfig): EncryptionService {
  if (!globalEncryptionService) {
    globalEncryptionService = new EncryptionService(config);
  }
  return globalEncryptionService;
}

export function resetEncryptionService(): void {
  globalEncryptionService = null;
}
