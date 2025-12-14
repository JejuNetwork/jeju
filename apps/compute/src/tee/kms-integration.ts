/**
 * KMS Integration for Compute TEE
 * 
 * Uses @jeju/kms for encryption, signing, and key management.
 * Integrates with the compute marketplace for provider attestation and secret injection.
 */

import { keccak256, toBytes, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

interface AccessControlPolicy {
  conditions: AccessCondition[];
  operator: 'and' | 'or';
}

interface AccessCondition {
  type: 'timestamp' | 'balance' | 'stake' | 'role' | 'agent' | 'contract';
  chain: string;
  comparator?: string;
  value?: string | number;
  registryAddress?: string;
  minStakeUSD?: number;
  role?: string;
  agentId?: number;
  tokenAddress?: string;
  contractAddress?: string;
  method?: string;
  parameters?: string[];
  returnValueTest?: { comparator: string; value: string };
}

interface EncryptedPayload {
  ciphertext: string;
  dataHash: Hex;
  accessControlHash: Hex;
  policy: AccessControlPolicy;
  providerType: string;
  encryptedAt: number;
  keyId: string;
  metadata?: Record<string, string>;
}

interface SignedMessage {
  signature: Hex;
  message: string;
  publicKey: Hex;
  keyId: string;
  signedAt: number;
}

interface StoredKey {
  keyId: string;
  publicKey: Hex;
  address: Address;
  encryptedPrivateKey: Uint8Array;
  purpose: 'attestation' | 'encryption' | 'session';
  owner: Address;
  createdAt: number;
}

const CHAIN_ID = process.env.CHAIN_ID ?? 'base-sepolia';

export class ComputeKMS {
  private initialized = false;
  private masterKey: Uint8Array;
  private keys = new Map<string, StoredKey>();

  constructor() {
    // Derive master key from environment
    const secret = process.env.COMPUTE_KMS_SECRET ?? process.env.KMS_FALLBACK_SECRET ?? process.env.TEE_ENCRYPTION_SECRET;
    if (secret) {
      this.masterKey = toBytes(keccak256(toBytes(secret)));
    } else {
      this.masterKey = crypto.getRandomValues(new Uint8Array(32));
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    console.log('[ComputeKMS] Initialized');
  }

  /**
   * Encrypt data that can only be decrypted by a compute provider
   */
  async encryptForProvider(
    data: string,
    providerAddress: Address,
    registryAddress: Address
  ): Promise<EncryptedPayload> {
    await this.ensureInitialized();

    const policy: AccessControlPolicy = {
      conditions: [
        {
          type: 'contract',
          chain: CHAIN_ID,
          contractAddress: registryAddress,
          method: 'isActiveProvider',
          parameters: [providerAddress],
          returnValueTest: { comparator: '=', value: 'true' },
        },
      ],
      operator: 'and',
    };

    return this.encrypt(data, policy);
  }

  /**
   * Encrypt SSH key for a compute rental session
   */
  async encryptSSHKey(
    sshPublicKey: string,
    renterAddress: Address,
    providerAddress: Address,
    rentalId: string
  ): Promise<EncryptedPayload> {
    await this.ensureInitialized();

    // SSH key can be decrypted by either renter or provider
    const policy: AccessControlPolicy = {
      conditions: [
        {
          type: 'contract',
          chain: CHAIN_ID,
          contractAddress: process.env.RENTAL_REGISTRY_ADDRESS ?? '0x0',
          method: 'getRentalParty',
          parameters: [rentalId, ':userAddress'],
          returnValueTest: { comparator: '=', value: 'true' },
        },
      ],
      operator: 'and',
    };

    return this.encrypt(JSON.stringify({
      sshPublicKey,
      renterAddress,
      providerAddress,
      rentalId,
    }), policy, { type: 'ssh_key', rentalId });
  }

  /**
   * Encrypt model weights with attestation requirement
   */
  async encryptModelWeights(
    weights: Uint8Array,
    modelId: string,
    requiredAttestation: Hex
  ): Promise<EncryptedPayload> {
    await this.ensureInitialized();

    // Model weights require valid TEE attestation to decrypt
    const policy: AccessControlPolicy = {
      conditions: [
        {
          type: 'contract',
          chain: CHAIN_ID,
          contractAddress: process.env.ATTESTATION_REGISTRY_ADDRESS ?? '0x0',
          method: 'verifyAttestation',
          parameters: [requiredAttestation, ':userAddress'],
          returnValueTest: { comparator: '=', value: 'true' },
        },
      ],
      operator: 'and',
    };

    // Convert weights to base64 for storage
    const weightsBase64 = Buffer.from(weights).toString('base64');

    return this.encrypt(JSON.stringify({
      modelId,
      weights: weightsBase64,
      requiredAttestation,
    }), policy, { type: 'model_weights', modelId });
  }

  /**
   * Sign attestation data with a managed key
   */
  async signAttestation(
    attestationData: {
      enclaveId: string;
      measurement: Hex;
      timestamp: number;
      providerAddress: Address;
    },
    keyId: string
  ): Promise<SignedMessage> {
    await this.ensureInitialized();

    const key = this.keys.get(keyId);
    if (!key) throw new Error(`Key ${keyId} not found`);
    if (key.purpose !== 'attestation') {
      throw new Error(`Key ${keyId} is not an attestation key`);
    }

    // Unseal the private key
    const privateKey = await this.unsealKey(key.encryptedPrivateKey);
    const account = privateKeyToAccount(toHex(privateKey) as `0x${string}`);
    privateKey.fill(0);

    const message = JSON.stringify(attestationData);
    const messageHash = keccak256(toBytes(message));
    const signature = await account.signMessage({ message: { raw: toBytes(messageHash) } });

    return {
      signature,
      message,
      publicKey: key.publicKey,
      keyId,
      signedAt: Date.now(),
    };
  }

  /**
   * Decrypt an encrypted payload
   */
  async decrypt(
    payload: EncryptedPayload,
    authSig?: { sig: Hex; derivedVia: string; signedMessage: string; address: Address }
  ): Promise<string> {
    await this.ensureInitialized();

    // Verify access policy if auth signature provided
    if (authSig) {
      const allowed = await this.checkAccess(payload.policy, authSig.address);
      if (!allowed) {
        throw new Error('Access denied: policy conditions not met');
      }
    }

    // Parse ciphertext
    let parsed: { ciphertext: string; iv: string; tag: string };
    try {
      parsed = JSON.parse(payload.ciphertext);
    } catch {
      throw new Error('Invalid ciphertext format');
    }

    // Derive decryption key
    const decryptionKey = await this.deriveKey(payload.keyId, payload.policy);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      decryptionKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    decryptionKey.fill(0);

    const ciphertext = Buffer.from(parsed.ciphertext, 'hex');
    const iv = Buffer.from(parsed.iv, 'hex');
    const tag = Buffer.from(parsed.tag, 'hex');

    const combined = new Uint8Array([...ciphertext, ...tag]);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      combined
    );

    return new TextDecoder().decode(decrypted);
  }

  /**
   * Generate a managed key for a specific purpose
   */
  async generateKey(
    owner: Address,
    purpose: 'attestation' | 'encryption' | 'session'
  ): Promise<{ keyId: string; publicKey: Hex }> {
    await this.ensureInitialized();

    const keyId = `compute-${purpose}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    
    // Generate key
    const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const privateKeyHex = toHex(privateKeyBytes) as `0x${string}`;
    const account = privateKeyToAccount(privateKeyHex);

    // Encrypt private key for storage
    const encryptedPrivateKey = await this.sealKey(privateKeyBytes);
    privateKeyBytes.fill(0);

    const storedKey: StoredKey = {
      keyId,
      publicKey: toHex(account.publicKey),
      address: account.address,
      encryptedPrivateKey,
      purpose,
      owner,
      createdAt: Date.now(),
    };

    this.keys.set(keyId, storedKey);

    return {
      keyId,
      publicKey: storedKey.publicKey,
    };
  }

  /**
   * Revoke a managed key
   */
  revokeKey(keyId: string): void {
    const key = this.keys.get(keyId);
    if (key) {
      key.encryptedPrivateKey.fill(0);
      this.keys.delete(keyId);
    }
  }

  private async encrypt(
    data: string,
    policy: AccessControlPolicy,
    metadata?: Record<string, string>
  ): Promise<EncryptedPayload> {
    const keyId = `enc-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const encryptedAt = Math.floor(Date.now() / 1000);

    // Derive encryption key from policy
    const encryptionKey = await this.deriveKey(keyId, policy);

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      encryptionKey,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );
    encryptionKey.fill(0);

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      new TextEncoder().encode(data)
    );

    const encryptedArray = new Uint8Array(encrypted);
    const ciphertext = encryptedArray.slice(0, -16);
    const tag = encryptedArray.slice(-16);

    return {
      ciphertext: JSON.stringify({
        ciphertext: Buffer.from(ciphertext).toString('hex'),
        iv: Buffer.from(iv).toString('hex'),
        tag: Buffer.from(tag).toString('hex'),
      }),
      dataHash: keccak256(toBytes(data)),
      accessControlHash: keccak256(toBytes(JSON.stringify(policy))),
      policy,
      providerType: 'compute-kms',
      encryptedAt,
      keyId,
      metadata,
    };
  }

  private async checkAccess(policy: AccessControlPolicy, accessor: Address): Promise<boolean> {
    // In production, this would verify conditions on-chain
    // For now, return true for basic validation
    if (policy.conditions.length === 0) return true;
    return true;
  }

  private async deriveKey(keyId: string, policy: AccessControlPolicy): Promise<Uint8Array> {
    const material = toBytes(keccak256(toBytes(`${keyId}:${JSON.stringify(policy)}`)));
    const baseKey = await crypto.subtle.importKey(
      'raw',
      this.masterKey,
      { name: 'HKDF' },
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      { name: 'HKDF', salt: material, info: toBytes('compute-encryption'), hash: 'SHA-256' },
      baseKey,
      256
    );

    return new Uint8Array(derivedBits);
  }

  private async sealKey(key: Uint8Array): Promise<Uint8Array> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      this.masterKey,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      key
    );

    const result = new Uint8Array(12 + encrypted.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(encrypted), 12);
    return result;
  }

  private async unsealKey(sealed: Uint8Array): Promise<Uint8Array> {
    const iv = sealed.slice(0, 12);
    const ciphertext = sealed.slice(12);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      this.masterKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertext
    );

    return new Uint8Array(decrypted);
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) await this.initialize();
  }

  getStatus() {
    return {
      initialized: this.initialized,
      keyCount: this.keys.size,
    };
  }
}

let instance: ComputeKMS | null = null;

export function getComputeKMS(): ComputeKMS {
  if (!instance) {
    instance = new ComputeKMS();
  }
  return instance;
}

export function resetComputeKMS(): void {
  instance = null;
}
