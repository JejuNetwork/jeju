/**
 * MPC Provider - NOT IMPLEMENTED
 *
 * This provider is a placeholder for future MPC (Multi-Party Computation) integration.
 * It requires deploying an MPC coordinator and threshold signing infrastructure.
 *
 * Current status: STUB - All methods throw NotImplementedError
 * To implement: Deploy MPC coordinator service
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
  type MPCConfig,
  type MPCSigningSession,
  type SignedMessage,
  type SignRequest,
  type ThresholdSignature,
  type ThresholdSignRequest,
} from '../types.js';

class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`MPC Provider not implemented: ${feature}. Deploy MPC coordinator first.`);
    this.name = 'NotImplementedError';
  }
}

export class MPCProvider implements KMSProvider {
  type = KMSProviderType.MPC;
  private config: MPCConfig;

  constructor(config: MPCConfig) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.config.coordinatorEndpoint) return false;
    
    try {
      const response = await fetch(`${this.config.coordinatorEndpoint}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async connect(): Promise<void> {
    if (!this.config.coordinatorEndpoint) {
      throw new NotImplementedError('connect - no coordinator endpoint configured');
    }
    console.warn('[MPCProvider] MPC coordinator integration not implemented');
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
    throw new NotImplementedError('generateKey (DKG)');
  }

  getKey(_keyId: string): KeyMetadata | null {
    return null;
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

  async thresholdSign(_request: ThresholdSignRequest): Promise<ThresholdSignature> {
    throw new NotImplementedError('thresholdSign');
  }

  async getSigningSession(_sessionId: string): Promise<MPCSigningSession | null> {
    return null;
  }

  async refreshShares(_keyId: string): Promise<void> {
    throw new NotImplementedError('refreshShares');
  }

  getStatus(): { 
    connected: boolean; 
    threshold: number; 
    totalParties: number;
    implemented: boolean;
  } {
    return {
      connected: false,
      threshold: this.config.threshold,
      totalParties: this.config.totalParties,
      implemented: false,
    };
  }
}

let mpcProvider: MPCProvider | null = null;

export function getMPCProvider(config?: Partial<MPCConfig>): MPCProvider {
  if (!mpcProvider) {
    mpcProvider = new MPCProvider({
      threshold: config?.threshold ?? parseInt(process.env.MPC_THRESHOLD ?? '2'),
      totalParties: config?.totalParties ?? parseInt(process.env.MPC_TOTAL_PARTIES ?? '3'),
      coordinatorEndpoint: config?.coordinatorEndpoint ?? process.env.MPC_COORDINATOR_ENDPOINT,
    });
  }
  return mpcProvider;
}

export function resetMPCProvider(): void {
  mpcProvider = null;
}
