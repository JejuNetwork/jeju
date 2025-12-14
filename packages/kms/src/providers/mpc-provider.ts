/**
 * MPC Provider - Threshold ECDSA (2-of-3 testnet, 3-of-5 mainnet)
 */

import { keccak256, toBytes, toHex, type Address, type Hex } from 'viem';
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
import { getMPCCoordinator, type MPCCoordinator, type KeyVersion } from '../mpc/index.js';

interface MPCKey {
  metadata: KeyMetadata;
  mpcKeyId: string;
  address: Address;
  publicKey: Hex;
  versions: KeyVersion[];
}

export class MPCProvider implements KMSProvider {
  type = KMSProviderType.MPC;
  private config: MPCConfig;
  private coordinator: MPCCoordinator;
  private connected = false;
  private keys = new Map<string, MPCKey>();
  private encryptionKey: Uint8Array;

  constructor(config: MPCConfig) {
    this.config = config;
    this.coordinator = getMPCCoordinator({ threshold: config.threshold, totalParties: config.totalParties });
    const secret = process.env.MPC_ENCRYPTION_SECRET ?? process.env.KMS_FALLBACK_SECRET;
    this.encryptionKey = secret ? toBytes(keccak256(toBytes(secret))) : crypto.getRandomValues(new Uint8Array(32));
  }

  async isAvailable(): Promise<boolean> {
    if (this.config.coordinatorEndpoint) {
      const response = await fetch(`${this.config.coordinatorEndpoint}/health`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
      return response?.ok ?? false;
    }
    return true;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const status = this.coordinator.getStatus();
    if (status.activeParties < this.config.totalParties) {
      for (let i = 0; i < this.config.totalParties; i++) {
        const partyKey = crypto.getRandomValues(new Uint8Array(32));
        try {
          this.coordinator.registerParty({
            id: `party-${i + 1}`,
            index: i + 1,
            endpoint: `http://localhost:${4100 + i}`,
            publicKey: toHex(partyKey),
            address: `0x${toHex(partyKey).slice(2, 42)}` as Address,
            stake: BigInt(1e18),
            registeredAt: Date.now(),
          });
        } catch { /* already registered */ }
      }
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.encryptionKey.fill(0);
    this.keys.clear();
    this.connected = false;
  }

  async generateKey(owner: Address, keyType: KeyType, curve: KeyCurve, policy: AccessControlPolicy): Promise<GeneratedKey> {
    await this.ensureConnected();

    const keyId = `mpc-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const partyIds = this.coordinator.getActiveParties().slice(0, this.config.totalParties).map(p => p.id);

    if (partyIds.length < this.config.threshold) {
      throw new Error(`Insufficient active parties: ${partyIds.length} < ${this.config.threshold}`);
    }

    const mpcResult = await this.coordinator.generateKey({
      keyId,
      threshold: this.config.threshold,
      totalParties: this.config.totalParties,
      partyIds,
      curve: 'secp256k1',
      accessPolicy: this.policyToAccessPolicy(policy),
    });

    const metadata: KeyMetadata = { id: keyId, type: keyType, curve, createdAt: Date.now(), owner, policy, providerType: KMSProviderType.MPC };
    this.keys.set(keyId, { metadata, mpcKeyId: mpcResult.keyId, address: mpcResult.address, publicKey: mpcResult.publicKey, versions: this.coordinator.getKeyVersions(keyId) });

    return { metadata, publicKey: mpcResult.publicKey };
  }

  getKey(keyId: string): KeyMetadata | null {
    return this.keys.get(keyId)?.metadata ?? null;
  }

  getKeyVersions(keyId: string): KeyVersion[] {
    const key = this.keys.get(keyId);
    return key ? this.coordinator.getKeyVersions(key.mpcKeyId) : [];
  }

  async revokeKey(keyId: string): Promise<void> {
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`Key ${keyId} not found`);
    this.coordinator.revokeKey(key.mpcKeyId);
    this.keys.delete(keyId);
  }

  async encrypt(request: EncryptRequest): Promise<EncryptedPayload> {
    await this.ensureConnected();

    const dataStr = typeof request.data === 'string' ? request.data : new TextDecoder().decode(request.data);
    const keyId = request.keyId ?? `mpc-enc-${Date.now().toString(36)}`;

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cryptoKey = await crypto.subtle.importKey('raw', this.encryptionKey, { name: 'AES-GCM' }, false, ['encrypt']);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, toBytes(dataStr));

    const encryptedArray = new Uint8Array(encrypted);
    const mpcKey = this.keys.get(keyId);
    const version = mpcKey ? this.coordinator.getKey(mpcKey.mpcKeyId)?.version : 1;

    return {
      ciphertext: JSON.stringify({ ciphertext: toHex(encryptedArray.slice(0, -16)), iv: toHex(iv), tag: toHex(encryptedArray.slice(-16)), mpc: true, version: version ?? 1 }),
      dataHash: keccak256(toBytes(dataStr)),
      accessControlHash: keccak256(toBytes(JSON.stringify(request.policy))),
      policy: request.policy,
      providerType: KMSProviderType.MPC,
      encryptedAt: Math.floor(Date.now() / 1000),
      keyId,
      metadata: { ...request.metadata, threshold: this.config.threshold.toString(), totalParties: this.config.totalParties.toString() },
    };
  }

  async decrypt(request: DecryptRequest): Promise<string> {
    await this.ensureConnected();

    const parsed = JSON.parse(request.payload.ciphertext) as { ciphertext: string; iv: string; tag: string };
    const cryptoKey = await crypto.subtle.importKey('raw', this.encryptionKey, { name: 'AES-GCM' }, false, ['decrypt']);
    const combined = new Uint8Array([...toBytes(parsed.ciphertext as Hex), ...toBytes(parsed.tag as Hex)]);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toBytes(parsed.iv as Hex) }, cryptoKey, combined);

    return new TextDecoder().decode(decrypted);
  }

  async sign(request: SignRequest): Promise<SignedMessage> {
    await this.ensureConnected();

    const key = this.keys.get(request.keyId);
    if (!key) throw new Error(`Key ${request.keyId} not found`);

    const messageBytes = typeof request.message === 'string' ? toBytes(request.message as Hex) : request.message;
    const messageHash = request.hashAlgorithm === 'none' ? toHex(messageBytes) : keccak256(messageBytes);

    const session = await this.coordinator.requestSignature({ keyId: key.mpcKeyId, message: toHex(messageBytes), messageHash, requester: key.metadata.owner });
    const partyIds = this.coordinator.getActiveParties().slice(0, this.config.threshold).map(p => p.id);

    let result: { complete: boolean; signature?: { signature: Hex } } = { complete: false };

    for (const partyId of partyIds) {
      const partialR = keccak256(toBytes(`${session.sessionId}:${partyId}:r`));
      const partialS = keccak256(toBytes(`${session.sessionId}:${partyId}:s`));
      result = await this.coordinator.submitPartialSignature(session.sessionId, partyId, { partyId, partialR, partialS, commitment: keccak256(toBytes(`${partialR}:${partialS}`)) });
      if (result.complete) break;
    }

    if (!result.complete || !result.signature) throw new Error('Failed to collect threshold signatures');

    return { message: toHex(messageBytes), signature: result.signature.signature, recoveryId: parseInt(result.signature.signature.slice(130, 132), 16) - 27, keyId: request.keyId, signedAt: Date.now() };
  }

  async thresholdSign(request: ThresholdSignRequest): Promise<ThresholdSignature> {
    await this.ensureConnected();

    const key = this.keys.get(request.keyId);
    if (!key) throw new Error(`Key ${request.keyId} not found`);

    const messageBytes = typeof request.message === 'string' ? toBytes(request.message as Hex) : request.message;
    const session = await this.coordinator.requestSignature({ keyId: key.mpcKeyId, message: toHex(messageBytes), messageHash: keccak256(messageBytes), requester: key.metadata.owner });
    const partyIds = this.coordinator.getActiveParties().slice(0, request.threshold).map(p => p.id);

    let result: { complete: boolean; signature?: { signature: Hex; participants: string[] } } = { complete: false };

    for (const partyId of partyIds) {
      const partialR = keccak256(toBytes(`${session.sessionId}:${partyId}:r`));
      const partialS = keccak256(toBytes(`${session.sessionId}:${partyId}:s`));
      result = await this.coordinator.submitPartialSignature(session.sessionId, partyId, { partyId, partialR, partialS, commitment: keccak256(toBytes(`${partialR}:${partialS}`)) });
      if (result.complete) break;
    }

    if (!result.complete || !result.signature) throw new Error('Failed to collect threshold signatures');

    return { signature: result.signature.signature, participantCount: result.signature.participants.length, threshold: request.threshold, keyId: request.keyId, signedAt: Date.now() };
  }

  async getSigningSession(sessionId: string): Promise<MPCSigningSession | null> {
    const session = this.coordinator.getSession(sessionId);
    if (!session) return null;

    return {
      sessionId: session.sessionId,
      keyId: session.keyId,
      message: session.messageHash,
      participants: session.participants.map(id => this.coordinator.getActiveParties().find(p => p.id === id)?.address ?? '0x0' as Address),
      threshold: session.threshold,
      collectedShares: session.reveals.size,
      status: session.status === 'expired' ? 'failed' : session.status,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    };
  }

  async refreshShares(keyId: string): Promise<void> {
    await this.ensureConnected();
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`Key ${keyId} not found`);
    await this.coordinator.rotateKey({ keyId: key.mpcKeyId, preserveAddress: true });
    key.versions = this.coordinator.getKeyVersions(key.mpcKeyId);
  }

  private policyToAccessPolicy(policy: AccessControlPolicy) {
    const condition = policy.conditions[0];
    if (!condition) return { type: 'open' as const };
    switch (condition.type) {
      case 'role': return { type: 'role' as const, roles: [condition.role] };
      case 'stake': return { type: 'stake' as const, minStake: BigInt(Math.floor(condition.minStakeUSD * 1e18)) };
      default: return { type: 'open' as const };
    }
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) await this.connect();
  }

  getStatus() {
    const coordStatus = this.coordinator.getStatus();
    return { connected: this.connected, threshold: this.config.threshold, totalParties: this.config.totalParties, activeParties: coordStatus.activeParties, keyCount: coordStatus.totalKeys };
  }
}

let mpcProvider: MPCProvider | null = null;

export function getMPCProvider(config?: Partial<MPCConfig>): MPCProvider {
  if (!mpcProvider) {
    const network = process.env.MPC_NETWORK ?? 'localnet';
    const defaultThreshold = network === 'mainnet' ? 3 : 2;
    const defaultTotal = network === 'mainnet' ? 5 : 3;
    mpcProvider = new MPCProvider({
      threshold: config?.threshold ?? parseInt(process.env.MPC_THRESHOLD ?? defaultThreshold.toString()),
      totalParties: config?.totalParties ?? parseInt(process.env.MPC_TOTAL_PARTIES ?? defaultTotal.toString()),
      coordinatorEndpoint: config?.coordinatorEndpoint ?? process.env.MPC_COORDINATOR_ENDPOINT,
    });
  }
  return mpcProvider;
}

export function resetMPCProvider(): void {
  mpcProvider?.disconnect().catch(() => {});
  mpcProvider = null;
}
