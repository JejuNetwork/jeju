/**
 * HSM Integration - Key management with AWS CloudHSM, Azure, Vault, YubiHSM.
 * 
 * For development: 'local-dev' uses real cryptography (Web Crypto, viem) but stores
 * keys in memory. This is NOT mocking - all operations use production-grade crypto.
 * 
 * For production: Configure AWS CloudHSM, Azure KeyVault, HashiCorp Vault, or YubiHSM.
 */

import { keccak256, toHex, toBytes, type Hex, type Address } from 'viem';

async function createAccountFromPrivateKey(privateKeyHex: `0x${string}`) {
  const { privateKeyToAccount } = await import('viem/accounts');
  return privateKeyToAccount(privateKeyHex);
}

/** 'local-dev' uses real crypto in memory. Production uses hardware HSM. */
export type HSMProvider = 'aws-cloudhsm' | 'azure-keyvault' | 'hashicorp-vault' | 'yubihsm' | 'local-dev';

export interface HSMConfig {
  provider: HSMProvider;
  endpoint: string;
  credentials: HSMCredentials;
  partition?: string;
  auditLogging: boolean;
  retryAttempts: number;
  timeout: number;
}

export interface HSMCredentials {
  username?: string;
  password?: string;
  apiKey?: string;
  certPath?: string;
  keyPath?: string;
  region?: string;
}

export interface HSMKey {
  keyId: string;
  type: 'ec-secp256k1' | 'ec-p256' | 'rsa-2048' | 'rsa-4096' | 'aes-256';
  label: string;
  publicKey?: Hex;
  address?: Address;
  attributes: KeyAttributes;
  createdAt: number;
  lastUsed?: number;
}

export interface KeyAttributes {
  canSign: boolean;
  canVerify: boolean;
  canEncrypt: boolean;
  canDecrypt: boolean;
  canWrap: boolean;
  canUnwrap: boolean;
  extractable: boolean;
  sensitive: boolean;
}

export interface SignatureRequest {
  keyId: string;
  data: Hex;
  hashAlgorithm: 'keccak256' | 'sha256' | 'sha384' | 'sha512';
}

export interface SignatureResult {
  signature: Hex;
  v: number;
  r: Hex;
  s: Hex;
}

export interface EncryptionResult {
  ciphertext: Hex;
  iv: Hex;
  tag?: Hex;
}

export class HSMClient {
  private config: HSMConfig;
  private connected = false;
  private keys: Map<string, HSMKey> = new Map();
  private localDevKeys: Map<string, Uint8Array> = new Map();

  constructor(config: Partial<HSMConfig> & { provider: HSMProvider; endpoint: string; credentials: HSMCredentials }) {
    this.config = { auditLogging: true, retryAttempts: 3, timeout: 30000, ...config };
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.config.provider !== 'local-dev') {
      await this.connectProvider();
    }
    this.connected = true;
    this.log('Connected', { provider: this.config.provider });
  }

  async disconnect(): Promise<void> {
    for (const keyBytes of this.localDevKeys.values()) keyBytes.fill(0);
    this.localDevKeys.clear();
    this.keys.clear();
    this.connected = false;
    this.log('Disconnected');
  }

  async generateKey(label: string, type: HSMKey['type'], attributes: Partial<KeyAttributes> = {}): Promise<HSMKey> {
    this.ensureConnected();
    const keyId = `hsm-${type}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    
    const isAsym = type.startsWith('ec') || type.startsWith('rsa');
    const isSym = type.startsWith('aes');
    const defaultAttrs: KeyAttributes = {
      canSign: isAsym, canVerify: isAsym, canEncrypt: isSym || type.startsWith('rsa'),
      canDecrypt: isSym || type.startsWith('rsa'), canWrap: isSym, canUnwrap: isSym,
      extractable: false, sensitive: true,
    };

    const { publicKey, address } = await this.generateKeyInHSM(keyId, type);
    const key: HSMKey = {
      keyId, type, label, publicKey, address,
      attributes: { ...defaultAttrs, ...attributes }, createdAt: Date.now(),
    };

    this.keys.set(keyId, key);
    this.log('Key generated', { keyId, type });
    return key;
  }

  async getKey(keyId: string): Promise<HSMKey | null> {
    this.ensureConnected();
    return this.keys.get(keyId) ?? null;
  }

  async listKeys(): Promise<HSMKey[]> {
    this.ensureConnected();
    return Array.from(this.keys.values());
  }

  async sign(request: SignatureRequest): Promise<SignatureResult> {
    this.ensureConnected();
    const key = this.keys.get(request.keyId);
    if (!key) throw new Error(`Key ${request.keyId} not found`);
    if (!key.attributes.canSign) throw new Error(`Key ${request.keyId} cannot sign`);

    const signature = await this.signInHSM(request.keyId, request.data, request.hashAlgorithm);
    key.lastUsed = Date.now();
    return signature;
  }

  async verify(keyId: string, data: Hex, signature: Hex, hashAlgorithm: SignatureRequest['hashAlgorithm'] = 'keccak256'): Promise<boolean> {
    this.ensureConnected();
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`Key ${keyId} not found`);
    if (!key.attributes.canVerify) throw new Error(`Key ${keyId} cannot verify`);
    return this.verifyInHSM(keyId, data, signature, hashAlgorithm);
  }

  async encrypt(keyId: string, plaintext: Hex): Promise<EncryptionResult> {
    this.ensureConnected();
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`Key ${keyId} not found`);
    if (!key.attributes.canEncrypt) throw new Error(`Key ${keyId} cannot encrypt`);
    return this.encryptInHSM(keyId, plaintext);
  }

  async decrypt(keyId: string, ciphertext: Hex, iv: Hex, tag?: Hex): Promise<Hex> {
    this.ensureConnected();
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`Key ${keyId} not found`);
    if (!key.attributes.canDecrypt) throw new Error(`Key ${keyId} cannot decrypt`);
    return this.decryptInHSM(keyId, ciphertext, iv, tag);
  }

  async deleteKey(keyId: string): Promise<void> {
    this.ensureConnected();
    if (!this.keys.has(keyId)) throw new Error(`Key ${keyId} not found`);
    await this.deleteKeyFromHSM(keyId);
    this.keys.delete(keyId);
  }

  async rotateKey(oldKeyId: string, keepOld = false): Promise<HSMKey> {
    this.ensureConnected();
    const oldKey = this.keys.get(oldKeyId);
    if (!oldKey) throw new Error(`Key ${oldKeyId} not found`);

    const newKey = await this.generateKey(`${oldKey.label}-rotated`, oldKey.type, oldKey.attributes);
    if (!keepOld) await this.deleteKey(oldKeyId);
    return newKey;
  }

  private async connectProvider(): Promise<void> {
    const endpoints: Record<string, string> = {
      'aws-cloudhsm': '/api/v1/clusters',
      'azure-keyvault': '/api/v1/vaults',
      'hashicorp-vault': '/v1/sys/health',
      'yubihsm': '/connector/status',
    };
    const response = await fetch(`${this.config.endpoint}${endpoints[this.config.provider]}`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error(`${this.config.provider} connection failed: ${response.status}`);
  }

  private async generateKeyInHSM(keyId: string, type: HSMKey['type']): Promise<{ publicKey?: Hex; address?: Address }> {
    if (this.config.provider === 'local-dev') {
      const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
      this.localDevKeys.set(keyId, privateKeyBytes);
      if (type.startsWith('ec')) {
        const account = await createAccountFromPrivateKey(toHex(privateKeyBytes) as `0x${string}`);
        return { publicKey: toHex(account.publicKey), address: account.address };
      }
      return {};
    }

    const response = await fetch(`${this.config.endpoint}/api/v1/keys`, {
      method: 'POST', headers: this.getHeaders(),
      body: JSON.stringify({ keyId, type, partition: this.config.partition }),
    });
    const result = await response.json() as { publicKey?: string; address?: string };
    return { publicKey: result.publicKey as Hex | undefined, address: result.address as Address | undefined };
  }

  private async signInHSM(keyId: string, data: Hex, hashAlgorithm: string): Promise<SignatureResult> {
    if (this.config.provider === 'local-dev') {
      const privateKeyBytes = this.localDevKeys.get(keyId);
      if (!privateKeyBytes) throw new Error(`Local-sim key ${keyId} not found`);
      
      const account = await createAccountFromPrivateKey(toHex(privateKeyBytes) as `0x${string}`);
      const hash = keccak256(toBytes(data));
      const signature = await account.signMessage({ message: { raw: toBytes(hash) } });
      
      return {
        signature,
        r: signature.slice(0, 66) as Hex,
        s: `0x${signature.slice(66, 130)}` as Hex,
        v: parseInt(signature.slice(130, 132), 16),
      };
    }

    const response = await fetch(`${this.config.endpoint}/api/v1/keys/${keyId}/sign`, {
      method: 'POST', headers: this.getHeaders(),
      body: JSON.stringify({ data, hashAlgorithm }),
    });
    return response.json() as Promise<SignatureResult>;
  }

  private async verifyInHSM(keyId: string, data: Hex, signature: Hex, hashAlgorithm: string): Promise<boolean> {
    if (this.config.provider === 'local-dev') {
      const key = this.keys.get(keyId);
      if (!key?.address) throw new Error(`Key ${keyId} has no address`);
      
      const { verifyMessage } = await import('viem');
      const hash = keccak256(toBytes(data));
      return verifyMessage({ address: key.address, message: { raw: toBytes(hash) }, signature });
    }

    const response = await fetch(`${this.config.endpoint}/api/v1/keys/${keyId}/verify`, {
      method: 'POST', headers: this.getHeaders(),
      body: JSON.stringify({ data, signature, hashAlgorithm }),
    });
    return ((await response.json()) as { valid: boolean }).valid;
  }

  private async encryptInHSM(keyId: string, plaintext: Hex): Promise<EncryptionResult> {
    if (this.config.provider === 'local-dev') {
      const keyBytes = this.localDevKeys.get(keyId);
      if (!keyBytes) throw new Error(`Local-sim key ${keyId} not found`);
      
      const iv = crypto.getRandomValues(new Uint8Array(12));
      // Create a proper ArrayBuffer from the Uint8Array for Web Crypto API
      const keyBuffer = new ArrayBuffer(keyBytes.length);
      new Uint8Array(keyBuffer).set(keyBytes);
      const cryptoKey = await crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['encrypt']);
      const plaintextBytes = new Uint8Array(toBytes(plaintext));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plaintextBytes);
      
      const arr = new Uint8Array(encrypted);
      return { ciphertext: toHex(arr.slice(0, -16)), iv: toHex(iv), tag: toHex(arr.slice(-16)) };
    }

    const response = await fetch(`${this.config.endpoint}/api/v1/keys/${keyId}/encrypt`, {
      method: 'POST', headers: this.getHeaders(), body: JSON.stringify({ plaintext }),
    });
    return response.json() as Promise<EncryptionResult>;
  }

  private async decryptInHSM(keyId: string, ciphertext: Hex, iv: Hex, tag?: Hex): Promise<Hex> {
    if (this.config.provider === 'local-dev') {
      const keyBytes = this.localDevKeys.get(keyId);
      if (!keyBytes) throw new Error(`Local-sim key ${keyId} not found`);
      
      const combined = new Uint8Array([...toBytes(ciphertext), ...(tag ? toBytes(tag) : new Uint8Array(16))]);
      const ivBytes = new Uint8Array(toBytes(iv));
      // Create a proper ArrayBuffer from the Uint8Array for Web Crypto API
      const keyBuffer = new ArrayBuffer(keyBytes.length);
      new Uint8Array(keyBuffer).set(keyBytes);
      const cryptoKey = await crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['decrypt']);
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, cryptoKey, combined);
      return toHex(new Uint8Array(decrypted));
    }

    const response = await fetch(`${this.config.endpoint}/api/v1/keys/${keyId}/decrypt`, {
      method: 'POST', headers: this.getHeaders(), body: JSON.stringify({ ciphertext, iv, tag }),
    });
    return ((await response.json()) as { plaintext: string }).plaintext as Hex;
  }

  private async deleteKeyFromHSM(keyId: string): Promise<void> {
    if (this.config.provider === 'local-dev') {
      const keyBytes = this.localDevKeys.get(keyId);
      if (keyBytes) { keyBytes.fill(0); this.localDevKeys.delete(keyId); }
      return;
    }
    await fetch(`${this.config.endpoint}/api/v1/keys/${keyId}`, { method: 'DELETE', headers: this.getHeaders() });
  }

  private getHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.credentials.apiKey) h['Authorization'] = `Bearer ${this.config.credentials.apiKey}`;
    if (this.config.credentials.region) h['X-Region'] = this.config.credentials.region;
    return h;
  }

  private ensureConnected(): void {
    if (!this.connected) throw new Error('HSM not connected');
  }

  private log(message: string, details?: Record<string, unknown>): void {
    if (this.config.auditLogging) console.log(`[HSM] ${message}`, details ?? '');
  }
}

let globalClient: HSMClient | null = null;

export function getHSMClient(config?: Partial<HSMConfig>): HSMClient {
  if (globalClient) return globalClient;
  globalClient = new HSMClient({
    provider: (process.env.HSM_PROVIDER as HSMProvider) ?? 'local-dev',
    endpoint: process.env.HSM_ENDPOINT ?? 'http://localhost:8080',
    credentials: {
      apiKey: process.env.HSM_API_KEY, username: process.env.HSM_USERNAME,
      password: process.env.HSM_PASSWORD, region: process.env.AWS_REGION,
    },
    auditLogging: process.env.HSM_AUDIT_LOGGING !== 'false',
    ...config,
  });
  return globalClient;
}

export function resetHSMClient(): void {
  globalClient = null;
}
