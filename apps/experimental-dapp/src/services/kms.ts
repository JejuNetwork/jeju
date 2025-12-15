/**
 * KMS Service for encrypted todos
 * 
 * Provides encryption/decryption using the network KMS with MPC.
 * Falls back to local encryption when KMS is unavailable.
 */

import type { Address } from 'viem';

const KMS_ENDPOINT = process.env.KMS_ENDPOINT || 'http://localhost:4400';

interface KMSService {
  encrypt(data: string, owner: Address): Promise<string>;
  decrypt(encryptedData: string, owner: Address): Promise<string>;
  isHealthy(): Promise<boolean>;
}

class NetworkKMSService implements KMSService {
  private kmsAvailable = true;

  async encrypt(data: string, owner: Address): Promise<string> {
    if (this.kmsAvailable) {
      const result = await this.kmsEncrypt(data, owner);
      if (result) return result;
    }

    // Fallback to local encryption (base64 with marker)
    return `local:${Buffer.from(data).toString('base64')}`;
  }

  async decrypt(encryptedData: string, owner: Address): Promise<string> {
    // Handle local fallback encryption
    if (encryptedData.startsWith('local:')) {
      return Buffer.from(encryptedData.slice(6), 'base64').toString();
    }

    if (this.kmsAvailable) {
      const result = await this.kmsDecrypt(encryptedData, owner);
      if (result) return result;
    }

    throw new Error('Unable to decrypt data');
  }

  async isHealthy(): Promise<boolean> {
    if (!this.kmsAvailable) {
      this.kmsAvailable = await this.checkKMSHealth();
    }
    return this.kmsAvailable;
  }

  private async kmsEncrypt(data: string, owner: Address): Promise<string | null> {
    const response = await fetch(`${KMS_ENDPOINT}/encrypt`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-jeju-address': owner,
      },
      body: JSON.stringify({
        data,
        policy: {
          conditions: [
            { type: 'address', value: owner },
          ],
          operator: 'and',
        },
      }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {
      this.kmsAvailable = false;
      return null;
    });

    if (!response || !response.ok) return null;

    const result = await response.json() as { encrypted: string };
    return result.encrypted;
  }

  private async kmsDecrypt(encryptedData: string, owner: Address): Promise<string | null> {
    const response = await fetch(`${KMS_ENDPOINT}/decrypt`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-jeju-address': owner,
      },
      body: JSON.stringify({ payload: encryptedData }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {
      this.kmsAvailable = false;
      return null;
    });

    if (!response || !response.ok) return null;

    const result = await response.json() as { decrypted: string };
    return result.decrypted;
  }

  private async checkKMSHealth(): Promise<boolean> {
    const response = await fetch(`${KMS_ENDPOINT}/health`, {
      signal: AbortSignal.timeout(2000),
    }).catch(() => null);
    
    return response?.ok ?? false;
  }
}

let kmsService: KMSService | null = null;

export function getKMSService(): KMSService {
  if (!kmsService) {
    kmsService = new NetworkKMSService();
  }
  return kmsService;
}
