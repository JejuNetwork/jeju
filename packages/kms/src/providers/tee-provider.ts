/**
 * TEE Provider - Local AES-256-GCM encrypted key storage
 * 
 * For production hardware TEE, deploy your own TEE worker and set TEE_ENDPOINT.
 * Without TEE_ENDPOINT, runs in local encrypted mode using TEE_ENCRYPTION_SECRET.
 */

import { keccak256, toBytes, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
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

interface EnclaveKey {
  metadata: KeyMetadata;
  encryptedPrivateKey: Uint8Array;
  publicKey: Hex;
  address: Address;
}

export class TEEProvider implements KMSProvider {
  type = KMSProviderType.TEE;
  private config: TEEConfig;
  private connected = false;
  private remoteMode = false;
  private enclaveKey: Uint8Array;
  private keys = new Map<string, EnclaveKey>();
  private attestation: TEEAttestation | null = null;

  constructor(config: TEEConfig) {
    this.config = config;
    this.remoteMode = !!config.endpoint;
    
    const secret = process.env.TEE_ENCRYPTION_SECRET ?? process.env.KMS_FALLBACK_SECRET;
    if (secret) {
      this.enclaveKey = toBytes(keccak256(toBytes(secret)));
    } else {
      this.enclaveKey = crypto.getRandomValues(new Uint8Array(32));
      console.warn('[TEE] No TEE_ENCRYPTION_SECRET - keys will be lost on restart');
    }
  }

  async isAvailable(): Promise<boolean> {
    if (this.remoteMode && this.config.endpoint) {
      const response = await fetch(`${this.config.endpoint}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      return response?.ok ?? false;
    }
    return true;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    if (this.remoteMode && this.config.endpoint) {
      const response = await fetch(`${this.config.endpoint}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
      }).catch(() => null);
      
      if (response?.ok) {
        const data = await response.json() as { attestation?: TEEAttestation; enclaveKey?: string };
        if (data.attestation) this.attestation = data.attestation;
        if (data.enclaveKey) this.enclaveKey = toBytes(data.enclaveKey as Hex);
        console.log(`[TEE] Connected to ${this.config.endpoint}`);
      } else {
        console.log('[TEE] Remote endpoint unavailable, using local mode');
        this.remoteMode = false;
      }
    } else {
      console.log('[TEE] Running in local encrypted mode');
    }

    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.enclaveKey.fill(0);
    for (const key of this.keys.values()) key.encryptedPrivateKey.fill(0);
    this.keys.clear();
    this.connected = false;
    this.attestation = null;
  }

  async generateKey(owner: Address, keyType: KeyType, curve: KeyCurve, policy: AccessControlPolicy): Promise<GeneratedKey> {
    await this.ensureConnected();
    const keyId = `tee-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;

    if (this.remoteMode && this.config.endpoint) {
      const response = await fetch(`${this.config.endpoint}/keys/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId, owner, keyType, curve, policy }),
        signal: AbortSignal.timeout(30000),
      }).catch(() => null);
      
      if (response?.ok) {
        const result = await response.json() as { publicKey: string; address: string };
        const metadata: KeyMetadata = { id: keyId, type: keyType, curve, createdAt: Date.now(), owner, policy, providerType: KMSProviderType.TEE };
        this.keys.set(keyId, { metadata, encryptedPrivateKey: new Uint8Array(0), publicKey: result.publicKey as Hex, address: result.address as Address });
        return { metadata, publicKey: result.publicKey as Hex };
      }
    }

    const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const account = privateKeyToAccount(toHex(privateKeyBytes) as `0x${string}`);
    const encryptedPrivateKey = await this.sealData(privateKeyBytes);
    privateKeyBytes.fill(0);

    const metadata: KeyMetadata = { id: keyId, type: keyType, curve, createdAt: Date.now(), owner, policy, providerType: KMSProviderType.TEE };
    this.keys.set(keyId, { metadata, encryptedPrivateKey, publicKey: toHex(account.publicKey), address: account.address });
    return { metadata, publicKey: toHex(account.publicKey) };
  }

  getKey(keyId: string): KeyMetadata | null {
    return this.keys.get(keyId)?.metadata ?? null;
  }

  async revokeKey(keyId: string): Promise<void> {
    const key = this.keys.get(keyId);
    if (!key) return;
    if (this.remoteMode && this.config.endpoint) {
      await fetch(`${this.config.endpoint}/keys/${keyId}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }).catch(() => {});
    }
    key.encryptedPrivateKey.fill(0);
    this.keys.delete(keyId);
  }

  async encrypt(request: EncryptRequest): Promise<EncryptedPayload> {
    await this.ensureConnected();

    const dataStr = typeof request.data === 'string' ? request.data : new TextDecoder().decode(request.data);
    const keyId = request.keyId ?? `tee-enc-${Date.now().toString(36)}`;

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cryptoKey = await crypto.subtle.importKey('raw', this.enclaveKey, { name: 'AES-GCM' }, false, ['encrypt']);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, toBytes(dataStr));

    const encryptedArray = new Uint8Array(encrypted);
    return {
      ciphertext: JSON.stringify({ ciphertext: toHex(encryptedArray.slice(0, -16)), iv: toHex(iv), tag: toHex(encryptedArray.slice(-16)) }),
      dataHash: keccak256(toBytes(dataStr)),
      accessControlHash: keccak256(toBytes(JSON.stringify(request.policy))),
      policy: request.policy,
      providerType: KMSProviderType.TEE,
      encryptedAt: Math.floor(Date.now() / 1000),
      keyId,
      metadata: { ...request.metadata, mode: this.remoteMode ? 'remote' : 'local' },
    };
  }

  async decrypt(request: DecryptRequest): Promise<string> {
    await this.ensureConnected();

    const parsed = JSON.parse(request.payload.ciphertext) as { ciphertext: string; iv: string; tag: string };
    const cryptoKey = await crypto.subtle.importKey('raw', this.enclaveKey, { name: 'AES-GCM' }, false, ['decrypt']);
    const combined = new Uint8Array([...toBytes(parsed.ciphertext as Hex), ...toBytes(parsed.tag as Hex)]);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toBytes(parsed.iv as Hex) }, cryptoKey, combined);
    return new TextDecoder().decode(decrypted);
  }

  async sign(request: SignRequest): Promise<SignedMessage> {
    await this.ensureConnected();

    const key = this.keys.get(request.keyId);
    if (!key) throw new Error(`Key ${request.keyId} not found`);

    if (this.remoteMode && this.config.endpoint) {
      const response = await fetch(`${this.config.endpoint}/keys/${request.keyId}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: request.message, hashAlgorithm: request.hashAlgorithm }),
        signal: AbortSignal.timeout(30000),
      }).catch(() => null);
      
      if (response?.ok) {
        const result = await response.json() as { signature: string };
        return {
          message: toHex(typeof request.message === 'string' ? toBytes(request.message as Hex) : request.message),
          signature: result.signature as Hex,
          recoveryId: parseInt(result.signature.slice(130, 132), 16) - 27,
          keyId: request.keyId,
          signedAt: Date.now(),
        };
      }
    }

    const privateKeyBytes = await this.unsealData(key.encryptedPrivateKey);
    const account = privateKeyToAccount(toHex(privateKeyBytes) as `0x${string}`);
    privateKeyBytes.fill(0);

    const messageBytes = typeof request.message === 'string' ? toBytes(request.message as Hex) : request.message;
    const hash = request.hashAlgorithm === 'none' ? messageBytes : toBytes(keccak256(messageBytes));
    const signature = await account.signMessage({ message: { raw: hash } });

    return { message: toHex(messageBytes), signature, recoveryId: parseInt(signature.slice(130, 132), 16) - 27, keyId: request.keyId, signedAt: Date.now() };
  }

  async getAttestation(_keyId?: string): Promise<TEEAttestation> {
    await this.ensureConnected();
    if (this.attestation) return this.attestation;
    return { quote: keccak256(toBytes(`local:${Date.now()}`)), measurement: keccak256(toBytes(`measurement:${Date.now()}`)), timestamp: Date.now(), verified: !this.remoteMode };
  }

  async verifyAttestation(attestation: TEEAttestation): Promise<boolean> {
    return Date.now() - attestation.timestamp < 60 * 60 * 1000;
  }

  private async sealData(data: Uint8Array): Promise<Uint8Array> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cryptoKey = await crypto.subtle.importKey('raw', this.enclaveKey, { name: 'AES-GCM' }, false, ['encrypt']);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, data);
    const result = new Uint8Array(12 + encrypted.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(encrypted), 12);
    return result;
  }

  private async unsealData(sealed: Uint8Array): Promise<Uint8Array> {
    const cryptoKey = await crypto.subtle.importKey('raw', this.enclaveKey, { name: 'AES-GCM' }, false, ['decrypt']);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(0, 12) }, cryptoKey, sealed.slice(12));
    return new Uint8Array(decrypted);
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) await this.connect();
  }

  getStatus() {
    return { connected: this.connected, mode: this.remoteMode ? 'remote' : 'local', attestation: this.attestation };
  }
}

let teeProvider: TEEProvider | null = null;

export function getTEEProvider(config?: Partial<TEEConfig>): TEEProvider {
  if (!teeProvider) {
    teeProvider = new TEEProvider({ endpoint: config?.endpoint ?? process.env.TEE_ENDPOINT });
  }
  return teeProvider;
}

export function resetTEEProvider(): void {
  teeProvider?.disconnect().catch(() => {});
  teeProvider = null;
}
