/**
 * Lit Protocol Provider
 * 
 * Uses local AES-256-GCM fallback when Lit network unavailable (default).
 * Lit Protocol mode requires network connectivity (not tested).
 */

import { keccak256, toBytes } from 'viem';
import type { Address, Hex } from 'viem';
import {
  type AccessCondition,
  type AccessControlPolicy,
  type AuthSignature,
  type DecryptRequest,
  type EncryptedPayload,
  type EncryptRequest,
  type GeneratedKey,
  type KeyCurve,
  type KeyMetadata,
  type KeyType,
  type KMSProvider,
  KMSProviderType,
  type LitConfig,
  type SessionKey,
  type SignedMessage,
  type SignRequest,
  ConditionOperator,
} from '../types.js';

interface LitNodeClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  ready: boolean;
}

interface LitSDK {
  LitNodeClient: new (config: { litNetwork: string; debug?: boolean }) => LitNodeClient;
  encryptString: (params: { accessControlConditions: LitAccessCondition[]; chain: string; dataToEncrypt: string }, client: LitNodeClient) => Promise<{ ciphertext: string; dataToEncryptHash: string }>;
  decryptString: (params: { ciphertext: string; dataToEncryptHash: string; accessControlConditions: LitAccessCondition[]; chain: string }, client: LitNodeClient, authSig: LitAuthSig) => Promise<string>;
}

interface LitAccessCondition {
  contractAddress: string;
  standardContractType: string;
  chain: string;
  method: string;
  parameters: string[];
  returnValueTest: { comparator: string; value: string };
}

interface LitAuthSig {
  sig: string;
  derivedVia: string;
  signedMessage: string;
  address: string;
}

export class LitProvider implements KMSProvider {
  type = KMSProviderType.LIT;
  private config: LitConfig;
  private client: LitNodeClient | null = null;
  private sdk: LitSDK | null = null;
  private keys = new Map<string, KeyMetadata>();
  private fallbackKey: Uint8Array;

  constructor(config: LitConfig) {
    this.config = config;
    const secret = process.env.KMS_FALLBACK_SECRET ?? process.env.TEE_ENCRYPTION_SECRET;
    if (!secret) throw new Error('KMS_FALLBACK_SECRET or TEE_ENCRYPTION_SECRET environment variable required');
    this.fallbackKey = toBytes(keccak256(toBytes(secret)));
  }

  async isAvailable(): Promise<boolean> {
    if (this.client?.ready) return true;
    try { await this.connect(); return this.client?.ready ?? true; }
    catch { return true; } // Fallback always available
  }

  async connect(): Promise<void> {
    if (this.client?.ready) return;
    try {
      const module = await import('@lit-protocol/lit-node-client');
      this.sdk = module as unknown as LitSDK;
      this.client = new this.sdk.LitNodeClient({ litNetwork: this.config.network, debug: this.config.debug ?? false });
      await this.client.connect();
      console.log('[LitProvider] Connected to network:', this.config.network);
    } catch (error) {
      console.warn('[LitProvider] Connection failed, fallback mode enabled:', (error as Error).message);
      this.client = null;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) { await this.client.disconnect(); this.client = null; }
  }

  async generateKey(owner: Address, keyType: KeyType, curve: KeyCurve, policy: AccessControlPolicy): Promise<GeneratedKey> {
    const keyId = `lit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const metadata: KeyMetadata = { id: keyId, type: keyType, curve, createdAt: Date.now(), owner, policy, providerType: KMSProviderType.LIT };
    this.keys.set(keyId, metadata);
    return { metadata, publicKey: keccak256(toBytes(`${keyId}:${owner}:${metadata.createdAt}`)) as Hex };
  }

  getKey(keyId: string): KeyMetadata | null { return this.keys.get(keyId) ?? null; }

  async revokeKey(keyId: string): Promise<void> { this.keys.delete(keyId); }

  async encrypt(request: EncryptRequest): Promise<EncryptedPayload> {
    const dataStr = typeof request.data === 'string' ? request.data : new TextDecoder().decode(request.data);
    const encryptedAt = Math.floor(Date.now() / 1000);
    const keyId = request.keyId ?? `lit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const accessControlConditions = this.policyToLitConditions(request.policy);
    const accessControlHash = keccak256(toBytes(JSON.stringify(accessControlConditions)));
    const dataHash = keccak256(toBytes(dataStr));

    if (this.client && this.sdk) {
      const { ciphertext, dataToEncryptHash } = await this.sdk.encryptString(
        { accessControlConditions, chain: this.getChainFromPolicy(request.policy), dataToEncrypt: dataStr },
        this.client
      );
      return { ciphertext, dataHash: dataToEncryptHash as Hex, accessControlHash, policy: request.policy, providerType: KMSProviderType.LIT, encryptedAt, keyId, metadata: request.metadata };
    }

    const { ciphertext, iv, tag } = await this.fallbackEncrypt(dataStr);
    return {
      ciphertext: JSON.stringify({ ciphertext, iv, tag, fallback: true }),
      dataHash, accessControlHash, policy: request.policy, providerType: KMSProviderType.LIT, encryptedAt, keyId,
      metadata: { ...request.metadata, fallback: 'true' },
    };
  }

  async decrypt(request: DecryptRequest): Promise<string> {
    const { payload, authSig } = request;

    if (payload.metadata?.fallback === 'true') {
      const { ciphertext, iv, tag } = JSON.parse(payload.ciphertext) as { ciphertext: string; iv: string; tag: string };
      return this.fallbackDecrypt(ciphertext, iv, tag);
    }

    if (!this.client || !this.sdk) throw new Error('Lit Protocol not available and data is not fallback-encrypted');
    if (!authSig) throw new Error('Auth signature required for Lit Protocol decryption');

    return this.sdk.decryptString(
      { ciphertext: payload.ciphertext, dataToEncryptHash: payload.dataHash, accessControlConditions: this.policyToLitConditions(payload.policy), chain: this.getChainFromPolicy(payload.policy) },
      this.client,
      { sig: authSig.sig, derivedVia: authSig.derivedVia, signedMessage: authSig.signedMessage, address: authSig.address }
    );
  }

  async sign(_request: SignRequest): Promise<SignedMessage> {
    throw new Error('Signing via Lit Protocol requires PKP setup - use TEE or MPC provider');
  }

  async createSession(authSig: AuthSignature, capabilities: string[], expirationHours = 24): Promise<SessionKey> {
    const expiration = Date.now() + expirationHours * 60 * 60 * 1000;
    const sessionId = `lit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return { publicKey: keccak256(toBytes(`session:${sessionId}:${authSig.address}:${expiration}`)) as Hex, expiration, capabilities, authSig };
  }

  validateSession(session: SessionKey): boolean { return session.expiration > Date.now(); }

  private policyToLitConditions(policy: AccessControlPolicy): LitAccessCondition[] {
    return policy.conditions.map(c => this.conditionToLit(c));
  }

  private conditionToLit(c: AccessCondition): LitAccessCondition {
    switch (c.type) {
      case 'contract':
        return { contractAddress: c.contractAddress, standardContractType: 'Custom', chain: c.chain, method: c.method, parameters: c.parameters.map(String), returnValueTest: { comparator: c.returnValueTest.comparator, value: c.returnValueTest.value } };
      case 'timestamp':
        return { contractAddress: '', standardContractType: 'timestamp', chain: c.chain, method: 'eth_getBlockByNumber', parameters: ['latest'], returnValueTest: { comparator: c.comparator, value: c.value.toString() } };
      case 'balance':
        return { contractAddress: c.tokenAddress ?? '', standardContractType: c.tokenAddress ? 'ERC20' : '', chain: c.chain, method: 'balanceOf', parameters: [':userAddress'], returnValueTest: { comparator: c.comparator, value: c.value } };
      case 'stake':
        return { contractAddress: c.registryAddress, standardContractType: 'Custom', chain: c.chain, method: 'getStakeUSD', parameters: [':userAddress'], returnValueTest: { comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: (c.minStakeUSD * 1e18).toString() } };
      case 'role':
        return { contractAddress: c.registryAddress, standardContractType: 'Custom', chain: c.chain, method: 'hasRole', parameters: [c.role, ':userAddress'], returnValueTest: { comparator: ConditionOperator.EQUALS, value: 'true' } };
      case 'agent':
        return { contractAddress: c.registryAddress, standardContractType: 'Custom', chain: c.chain, method: 'getAgentOwner', parameters: [c.agentId.toString()], returnValueTest: { comparator: ConditionOperator.EQUALS, value: ':userAddress' } };
    }
  }

  private getChainFromPolicy(policy: AccessControlPolicy): string {
    const c = policy.conditions[0];
    return 'chain' in c ? c.chain : 'base-sepolia';
  }

  private async fallbackEncrypt(data: string): Promise<{ ciphertext: string; iv: string; tag: string }> {
    const crypto = await import('crypto');
    const key = this.fallbackKey.slice(0, 32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key), iv);
    const encrypted = cipher.update(data, 'utf8', 'hex') + cipher.final('hex');
    return { ciphertext: encrypted, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
  }

  private async fallbackDecrypt(ciphertext: string, iv: string, tag: string): Promise<string> {
    const crypto = await import('crypto');
    const key = this.fallbackKey.slice(0, 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key), Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return decipher.update(ciphertext, 'hex', 'utf8') + decipher.final('utf8');
  }

  getStatus() {
    return { connected: this.client?.ready ?? false, network: this.config.network, fallbackMode: !this.client?.ready };
  }
}

let litProvider: LitProvider | null = null;

export function getLitProvider(config?: Partial<LitConfig>): LitProvider {
  if (!litProvider) {
    litProvider = new LitProvider({
      network: config?.network ?? (process.env.LIT_NETWORK as LitConfig['network']) ?? 'cayenne',
      debug: config?.debug ?? process.env.LIT_DEBUG === 'true',
    });
  }
  return litProvider;
}
