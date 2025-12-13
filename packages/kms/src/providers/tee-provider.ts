/**
 * TEE Provider - NOT IMPLEMENTED
 *
 * This provider is a placeholder for future TEE (Trusted Execution Environment) integration.
 * It requires deploying actual TEE infrastructure (Phala CVMs, Marlin enclaves, etc.)
 *
 * Current status: STUB - All methods throw NotImplementedError
 * To implement: Deploy TEE infrastructure and update endpoints
 */

import type { Address, Hex } from 'viem';
import {
  type AccessControlPolicy,
  type DecryptRequest,
  type EncryptedPayload,
  type EncryptRequest,
  type GeneratedKey,
  type KeyCurve,
  type KeyMetadata,
  type KeyType,
  type KMSProvider,
  KMSProviderType,
  type SignedMessage,
  type SignRequest,
  type TEEAttestation,
  type TEEConfig,
} from '../types.js';

class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`TEE Provider not implemented: ${feature}. Deploy TEE infrastructure first.`);
    this.name = 'NotImplementedError';
  }
}

export class TEEProvider implements KMSProvider {
  type = KMSProviderType.TEE;
  private config: TEEConfig;

  constructor(config: TEEConfig) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    // TEE is only available if endpoint is configured and reachable
    if (!this.config.endpoint) return false;
    
    try {
      const response = await fetch(`${this.config.endpoint}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async connect(): Promise<void> {
    if (!this.config.endpoint) {
      throw new NotImplementedError('connect - no endpoint configured');
    }
    // Would connect to TEE service here
    console.warn('[TEEProvider] TEE service integration not implemented');
  }

  async disconnect(): Promise<void> {
    // No-op
  }

  async generateKey(
    _owner: Address,
    _keyType: KeyType,
    _curve: KeyCurve,
    _policy: AccessControlPolicy
  ): Promise<GeneratedKey> {
    throw new NotImplementedError('generateKey');
  }

  getKey(_keyId: string): KeyMetadata | null {
    return null; // No keys stored locally
  }

  async revokeKey(_keyId: string): Promise<void> {
    throw new NotImplementedError('revokeKey');
  }

  async encrypt(_request: EncryptRequest): Promise<EncryptedPayload> {
    throw new NotImplementedError('encrypt');
  }

  async decrypt(_request: DecryptRequest): Promise<string> {
    throw new NotImplementedError('decrypt');
  }

  async sign(_request: SignRequest): Promise<SignedMessage> {
    throw new NotImplementedError('sign');
  }

  async getAttestation(_keyId?: string): Promise<TEEAttestation> {
    throw new NotImplementedError('getAttestation');
  }

  async verifyAttestation(_attestation: TEEAttestation): Promise<boolean> {
    throw new NotImplementedError('verifyAttestation');
  }

  getStatus(): { connected: boolean; provider: string; implemented: boolean } {
    return {
      connected: false,
      provider: this.config.provider,
      implemented: false,
    };
  }
}

let teeProvider: TEEProvider | null = null;

export function getTEEProvider(config?: Partial<TEEConfig>): TEEProvider {
  if (!teeProvider) {
    teeProvider = new TEEProvider({
      provider: config?.provider ?? (process.env.TEE_PROVIDER as TEEConfig['provider']) ?? 'phala',
      endpoint: config?.endpoint ?? process.env.TEE_ENDPOINT,
      apiKey: config?.apiKey ?? process.env.TEE_API_KEY,
      clusterId: config?.clusterId ?? process.env.TEE_CLUSTER_ID,
    });
  }
  return teeProvider;
}

export function resetTEEProvider(): void {
  teeProvider = null;
}
