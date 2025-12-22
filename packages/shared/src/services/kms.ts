/**
 * KMS Service - Key Management Integration
 * 
 * Provides encryption/decryption via the network KMS with MPC.
 */

import type { Address } from 'viem';
import { z } from 'zod';

const KMSConfigSchema = z.object({
  endpoint: z.string().url(),
  provider: z.enum(['mpc', 'tee']).default('mpc'),
});

export type KMSConfig = z.infer<typeof KMSConfigSchema>;

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
    const validated = KMSConfigSchema.parse(config);
    this.endpoint = validated.endpoint;
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
    const recovered = await recoverAddress({
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
    }).catch((err: Error) => {
      console.error('[KMS] Encrypt request failed:', err.message);
      this.available = false;
      return null;
    });

    if (!response) return null;
    if (!response.ok) {
      console.error(`[KMS] Encrypt failed: ${response.status}`);
      return null;
    }
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
    }).catch((err: Error) => {
      console.error('[KMS] Decrypt request failed:', err.message);
      this.available = false;
      return null;
    });

    if (!response) return null;
    if (!response.ok) {
      console.error(`[KMS] Decrypt failed: ${response.status}`);
      return null;
    }
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
    });

    if (!response.ok) {
      console.error(`[KMS] Sign failed: ${response.status}`);
      return null;
    }
    const result = await response.json() as { signature: string };
    return result.signature;
  }

  private async checkHealth(): Promise<boolean> {
    const response = await fetch(`${this.endpoint}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  }
}

let instance: KMSServiceClient | null = null;

export function createKMSService(config: KMSConfig): KMSServiceClient {
  if (!instance) {
    instance = new KMSServiceImpl(config);
  }
  return instance;
}

export function getKMSServiceFromEnv(): KMSServiceClient {
  const endpoint = process.env.KMS_ENDPOINT;
  if (!endpoint) {
    throw new Error('KMS_ENDPOINT environment variable is required');
  }
  return createKMSService({ endpoint, provider: 'mpc' });
}

export function resetKMSService(): void {
  instance = null;
}
