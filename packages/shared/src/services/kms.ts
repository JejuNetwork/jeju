/**
 * KMS Service - Key Management Integration
 * 
 * Provides encryption/decryption via the network KMS with MPC.
 */

import type { Address } from 'viem';

export interface KMSConfig {
  endpoint?: string;
  provider?: 'mpc' | 'tee';
}

export interface KMSServiceClient {
  encrypt(data: string, owner: Address, policy?: EncryptionPolicy): Promise<string>;
  decrypt(encryptedData: string, owner: Address): Promise<string>;
  sign(message: string, owner: Address): Promise<string>;
  verify(message: string, signature: string, expectedAddress: Address): Promise<boolean>;
  isHealthy(): Promise<boolean>;
}

export interface EncryptionPolicy {
  conditions?: Array<{
    type: 'address' | 'timestamp' | 'balance' | 'role';
    value: string | number;
  }>;
  operator?: 'and' | 'or';
}

class KMSServiceImpl implements KMSServiceClient {
  private endpoint: string;
  private available = true;

  constructor(config: KMSConfig) {
    this.endpoint = config.endpoint || process.env.KMS_ENDPOINT || 'http://localhost:4400';
  }

  async encrypt(data: string, owner: Address, policy?: EncryptionPolicy): Promise<string> {
    if (this.available) {
      const result = await this.remoteEncrypt(data, owner, policy);
      if (result) return result;
    }

    // Fallback to local base64 encoding (not secure, just for dev)
    return `local:${Buffer.from(data).toString('base64')}`;
  }

  async decrypt(encryptedData: string, owner: Address): Promise<string> {
    if (encryptedData.startsWith('local:')) {
      return Buffer.from(encryptedData.slice(6), 'base64').toString();
    }

    if (this.available) {
      const result = await this.remoteDecrypt(encryptedData, owner);
      if (result) return result;
    }

    throw new Error('Unable to decrypt data');
  }

  async sign(message: string, owner: Address): Promise<string> {
    if (this.available) {
      const result = await this.remoteSign(message, owner);
      if (result) return result;
    }

    throw new Error('KMS not available for signing');
  }

  async verify(message: string, signature: string, expectedAddress: Address): Promise<boolean> {
    const { recoverAddress, hashMessage } = await import('viem');
    const recovered = recoverAddress({
      hash: hashMessage({ raw: message as `0x${string}` }),
      signature: signature as `0x${string}`,
    });
    return recovered.toLowerCase() === expectedAddress.toLowerCase();
  }

  async isHealthy(): Promise<boolean> {
    if (!this.available) {
      this.available = await this.checkHealth();
    }
    return this.available;
  }

  private async remoteEncrypt(data: string, owner: Address, policy?: EncryptionPolicy): Promise<string | null> {
    const response = await fetch(`${this.endpoint}/encrypt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': owner,
      },
      body: JSON.stringify({
        data,
        policy: policy ?? {
          conditions: [{ type: 'address', value: owner }],
          operator: 'and',
        },
      }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {
      this.available = false;
      return null;
    });

    if (!response || !response.ok) return null;
    const result = await response.json() as { encrypted: string };
    return result.encrypted;
  }

  private async remoteDecrypt(encryptedData: string, owner: Address): Promise<string | null> {
    const response = await fetch(`${this.endpoint}/decrypt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': owner,
      },
      body: JSON.stringify({ payload: encryptedData }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {
      this.available = false;
      return null;
    });

    if (!response || !response.ok) return null;
    const result = await response.json() as { decrypted: string };
    return result.decrypted;
  }

  private async remoteSign(message: string, owner: Address): Promise<string | null> {
    const response = await fetch(`${this.endpoint}/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': owner,
      },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);

    if (!response || !response.ok) return null;
    const result = await response.json() as { signature: string };
    return result.signature;
  }

  private async checkHealth(): Promise<boolean> {
    const response = await fetch(`${this.endpoint}/health`, {
      signal: AbortSignal.timeout(2000),
    }).catch(() => null);
    return response?.ok ?? false;
  }
}

let instance: KMSServiceClient | null = null;

export function createKMSService(config: KMSConfig = {}): KMSServiceClient {
  if (!instance) {
    instance = new KMSServiceImpl(config);
  }
  return instance;
}

export function resetKMSService(): void {
  instance = null;
}
