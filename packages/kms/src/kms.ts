/**
 * Jeju KMS - Unified Key Management Service
 * 
 * Unified interface for decentralized key management via Lit Protocol,
 * TEE enclaves, and MPC networks. Auto-fallback between providers.
 */

import type { Address } from 'viem';
import { kmsLogger as log } from './logger.js';
import {
  type AccessControlPolicy,
  type AuthSignature,
  type DecryptRequest,
  type EncryptedPayload,
  type EncryptRequest,
  type GeneratedKey,
  type KeyCurve,
  type KeyMetadata,
  type KeyType,
  type KMSConfig,
  type KMSProvider,
  KMSProviderType,
  type SessionKey,
  type SignedMessage,
  type SignRequest,
  type ThresholdSignature,
  type ThresholdSignRequest,
} from './types.js';
import { LitProvider, getLitProvider } from './providers/lit-provider.js';
import { TEEProvider, getTEEProvider } from './providers/tee-provider.js';
import { MPCProvider, getMPCProvider } from './providers/mpc-provider.js';

type ConcreteProvider = LitProvider | TEEProvider | MPCProvider;

export class KMSService {
  private config: KMSConfig;
  private providers: Map<KMSProviderType, KMSProvider> = new Map();
  private initialized = false;

  constructor(config: KMSConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const providerConfigs: [KMSProviderType, (() => KMSProvider) | undefined][] = [
      [KMSProviderType.LIT, this.config.providers.lit ? () => getLitProvider(this.config.providers.lit) : undefined],
      [KMSProviderType.TEE, this.config.providers.tee ? () => getTEEProvider(this.config.providers.tee) : undefined],
      [KMSProviderType.MPC, this.config.providers.mpc ? () => getMPCProvider(this.config.providers.mpc) : undefined],
    ];

    for (const [type, factory] of providerConfigs) {
      if (factory) this.providers.set(type, factory());
    }

    const defaultProvider = this.providers.get(this.config.defaultProvider);
    if (defaultProvider) await defaultProvider.connect();

    this.initialized = true;
    log.info('Initialized', { providers: Array.from(this.providers.keys()) });
  }

  async shutdown(): Promise<void> {
    await Promise.all(Array.from(this.providers.values()).map(p => p.disconnect()));
    this.providers.clear();
    this.initialized = false;
  }

  private async getAvailableProvider(preferred?: KMSProviderType): Promise<ConcreteProvider> {
    const candidates = preferred 
      ? [preferred, this.config.defaultProvider]
      : [this.config.defaultProvider];
    
    if (this.config.fallbackEnabled) {
      candidates.push(KMSProviderType.TEE, KMSProviderType.MPC, KMSProviderType.LIT);
    }

    for (const type of candidates) {
      const provider = this.providers.get(type) as ConcreteProvider | undefined;
      if (provider && await provider.isAvailable()) {
        if (type !== candidates[0]) log.warn('Using fallback provider', { type });
        return provider;
      }
    }
    throw new Error('No KMS provider available');
  }

  async generateKey(
    owner: Address,
    options: { type?: KeyType; curve?: KeyCurve; policy: AccessControlPolicy; provider?: KMSProviderType }
  ): Promise<GeneratedKey> {
    await this.ensureInitialized();
    if (!options.policy.conditions?.length) {
      throw new Error('Access control policy must have at least one condition');
    }
    const provider = await this.getAvailableProvider(options.provider);
    return provider.generateKey(owner, options.type ?? 'encryption', options.curve ?? 'secp256k1', options.policy);
  }

  getKey(keyId: string): KeyMetadata | null {
    for (const provider of this.providers.values()) {
      const key = (provider as ConcreteProvider).getKey(keyId);
      if (key) return key;
    }
    return null;
  }

  async revokeKey(keyId: string): Promise<void> {
    await this.ensureInitialized();
    for (const provider of this.providers.values()) {
      const p = provider as ConcreteProvider;
      if (p.getKey(keyId)) {
        await p.revokeKey(keyId);
        return;
      }
    }
    throw new Error(`Key not found: ${keyId}`);
  }

  async encrypt(request: EncryptRequest, provider?: KMSProviderType): Promise<EncryptedPayload> {
    await this.ensureInitialized();
    return (await this.getAvailableProvider(provider)).encrypt(request);
  }

  async decrypt(request: DecryptRequest): Promise<string> {
    await this.ensureInitialized();
    const provider = this.providers.get(request.payload.providerType) as ConcreteProvider | undefined;
    if (!provider) throw new Error(`Provider not available: ${request.payload.providerType}`);
    return provider.decrypt(request);
  }

  async sign(request: SignRequest, provider?: KMSProviderType): Promise<SignedMessage> {
    await this.ensureInitialized();
    const signingTypes = [KMSProviderType.TEE, KMSProviderType.MPC];
    const preferredType = provider ?? signingTypes.find(t => this.providers.has(t));
    if (!preferredType) throw new Error('No signing-capable provider available (TEE or MPC required)');
    
    const p = await this.getAvailableProvider(preferredType);
    if (!(p instanceof TEEProvider) && !(p instanceof MPCProvider)) {
      throw new Error('Provider does not support signing');
    }
    return p.sign(request);
  }

  async thresholdSign(request: ThresholdSignRequest): Promise<ThresholdSignature> {
    await this.ensureInitialized();
    const mpc = this.providers.get(KMSProviderType.MPC) as MPCProvider | undefined;
    if (!mpc) throw new Error('MPC provider required for threshold signing');
    return mpc.thresholdSign(request);
  }

  async createSession(authSig: AuthSignature, capabilities: string[], expirationHours = 24): Promise<SessionKey> {
    await this.ensureInitialized();
    const lit = this.providers.get(KMSProviderType.LIT) as LitProvider | undefined;
    if (!lit) throw new Error('Lit provider required for session management');
    return lit.createSession(authSig, capabilities, expirationHours);
  }

  validateSession(session: SessionKey): boolean {
    const lit = this.providers.get(KMSProviderType.LIT) as LitProvider | undefined;
    return lit?.validateSession(session) ?? false;
  }

  getStatus(): { initialized: boolean; providers: Record<string, { available: boolean; status: Record<string, unknown> }>; defaultProvider: KMSProviderType } {
    const providers: Record<string, { available: boolean; status: Record<string, unknown> }> = {};
    for (const [type, provider] of this.providers.entries()) {
      const p = provider as ConcreteProvider;
      const status = p.getStatus();
      const available = 'connected' in status ? status.connected : ('fallbackMode' in status ? status.fallbackMode : false);
      providers[type] = { available, status };
    }
    return { initialized: this.initialized, providers, defaultProvider: this.config.defaultProvider };
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) await this.initialize();
  }
}

let kmsService: KMSService | null = null;

export function getKMS(config?: Partial<KMSConfig>): KMSService {
  if (!kmsService) {
    kmsService = new KMSService({
      providers: {
        lit: config?.providers?.lit ?? { network: (process.env.LIT_NETWORK as 'cayenne') ?? 'cayenne', debug: process.env.LIT_DEBUG === 'true' },
        tee: config?.providers?.tee ?? (process.env.TEE_ENDPOINT ? { provider: (process.env.TEE_PROVIDER as 'phala') ?? 'phala', endpoint: process.env.TEE_ENDPOINT, apiKey: process.env.TEE_API_KEY } : undefined),
        mpc: config?.providers?.mpc ?? (process.env.MPC_COORDINATOR_ENDPOINT ? { threshold: parseInt(process.env.MPC_THRESHOLD ?? '2'), totalParties: parseInt(process.env.MPC_TOTAL_PARTIES ?? '3'), coordinatorEndpoint: process.env.MPC_COORDINATOR_ENDPOINT } : undefined),
      },
      defaultProvider: (config?.defaultProvider ?? process.env.KMS_DEFAULT_PROVIDER as KMSProviderType) ?? KMSProviderType.LIT,
      defaultChain: config?.defaultChain ?? process.env.KMS_DEFAULT_CHAIN ?? 'base-sepolia',
      registryAddress: config?.registryAddress,
      fallbackEnabled: config?.fallbackEnabled ?? true,
    });
  }
  return kmsService;
}

export function resetKMS(): void {
  kmsService?.shutdown().catch(e => log.error('Shutdown failed', { error: String(e) }));
  kmsService = null;
}
