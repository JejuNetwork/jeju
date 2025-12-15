/**
 * Threshold Encryption for OAuth3
 * 
 * Enables multi-node session decryption using threshold cryptography.
 * Sessions are encrypted such that any k-of-n TEE nodes can decrypt.
 * 
 * Uses FROST threshold signing combined with ECIES for encryption.
 * 
 * Key Derivation:
 * 1. MPC cluster generates a shared public key
 * 2. Sessions are encrypted to the shared public key
 * 3. Decryption requires threshold of nodes to participate
 */

import { keccak256, toBytes, toHex, type Hex, type Address } from 'viem';

export interface ThresholdKeyConfig {
  /** Cluster ID for the MPC group */
  clusterId: string;
  /** Threshold required for decryption (k) */
  threshold: number;
  /** Total number of nodes (n) */
  totalNodes: number;
  /** Public key of the threshold group */
  publicKey: Hex;
  /** Endpoint for MPC operations */
  mpcEndpoint: string;
}

export interface EncryptedPayload {
  /** Ephemeral public key for ECIES */
  ephemeralPubKey: Hex;
  /** Encrypted data */
  ciphertext: Hex;
  /** AES nonce */
  nonce: Hex;
  /** Authentication tag */
  tag: Hex;
  /** Cluster ID used for encryption */
  clusterId: string;
  /** Version of encryption scheme */
  version: number;
}

export interface DecryptionShare {
  /** Node ID providing the share */
  nodeId: string;
  /** Decryption share */
  share: Hex;
  /** Proof of correct share */
  proof: Hex;
}

/**
 * Threshold Encryption Service
 * 
 * Provides encryption that requires k-of-n nodes to decrypt.
 */
export class ThresholdEncryptionService {
  private config: ThresholdKeyConfig;

  constructor(config: ThresholdKeyConfig) {
    this.config = config;
  }

  /**
   * Encrypt data using threshold encryption
   * 
   * The data is encrypted to the cluster's shared public key.
   * Any threshold of nodes can collaborate to decrypt.
   */
  async encrypt(data: string): Promise<EncryptedPayload> {
    const dataBytes = new TextEncoder().encode(data);
    
    // Generate ephemeral key pair
    const ephemeralKey = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits']
    );

    // Export ephemeral public key
    const ephemeralPubKeyRaw = await crypto.subtle.exportKey('raw', ephemeralKey.publicKey);
    const ephemeralPubKey = toHex(new Uint8Array(ephemeralPubKeyRaw));

    // In production, we'd do ECDH with the cluster's public key
    // For now, we derive a symmetric key from the ephemeral key and cluster public key
    const sharedSecret = await this.deriveSharedSecret(ephemeralKey.privateKey);
    
    // Derive encryption key from shared secret
    const encryptionKey = await this.deriveEncryptionKey(sharedSecret);

    // Encrypt with AES-GCM
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const algorithm: AesGcmParams = { name: 'AES-GCM', iv: nonce };
    
    const ciphertext = await crypto.subtle.encrypt(
      algorithm,
      encryptionKey,
      dataBytes
    );

    // The last 16 bytes of AES-GCM output are the auth tag
    const ciphertextBytes = new Uint8Array(ciphertext);
    const tag = ciphertextBytes.slice(-16);
    const encryptedData = ciphertextBytes.slice(0, -16);

    return {
      ephemeralPubKey,
      ciphertext: toHex(encryptedData),
      nonce: toHex(nonce),
      tag: toHex(tag),
      clusterId: this.config.clusterId,
      version: 1,
    };
  }

  /**
   * Request decryption from the MPC cluster
   * 
   * This contacts the MPC endpoint to gather threshold shares.
   */
  async decrypt(payload: EncryptedPayload): Promise<string> {
    if (payload.clusterId !== this.config.clusterId) {
      throw new Error('Payload encrypted for different cluster');
    }

    // Request decryption shares from MPC nodes
    const response = await fetch(`${this.config.mpcEndpoint}/decrypt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ephemeralPubKey: payload.ephemeralPubKey,
        ciphertext: payload.ciphertext,
        nonce: payload.nonce,
        tag: payload.tag,
        clusterId: payload.clusterId,
      }),
    });

    if (!response.ok) {
      throw new Error(`MPC decryption failed: ${response.status}`);
    }

    const result = await response.json() as { plaintext: string };
    return result.plaintext;
  }

  /**
   * Derive shared secret using ECDH with cluster public key
   */
  private async deriveSharedSecret(ephemeralPrivateKey: CryptoKey): Promise<ArrayBuffer> {
    const clusterPubKeyBytes = toBytes(this.config.publicKey);
    
    // Validate public key format (must be 65 bytes for uncompressed P-256)
    if (clusterPubKeyBytes.length !== 65 && clusterPubKeyBytes.length !== 33) {
      throw new Error(`Invalid cluster public key length: ${clusterPubKeyBytes.length}. Expected 65 (uncompressed) or 33 (compressed) bytes.`);
    }
    
    // Convert to ArrayBuffer for crypto.subtle
    const keyBuffer = new ArrayBuffer(clusterPubKeyBytes.length);
    new Uint8Array(keyBuffer).set(clusterPubKeyBytes);
    
    // Import the cluster's public key for ECDH
    const clusterPublicKey = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    );
    
    // Perform actual ECDH key agreement
    return crypto.subtle.deriveBits(
      { name: 'ECDH', public: clusterPublicKey },
      ephemeralPrivateKey,
      256
    );
  }

  /**
   * Derive AES key from shared secret
   */
  private async deriveEncryptionKey(sharedSecret: ArrayBuffer): Promise<CryptoKey> {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      sharedSecret,
      'HKDF',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new TextEncoder().encode('oauth3-session-encryption'),
        info: new TextEncoder().encode(this.config.clusterId),
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Get the cluster configuration
   */
  getConfig(): ThresholdKeyConfig {
    return this.config;
  }

  /**
   * Check if the MPC cluster is healthy
   */
  async isHealthy(): Promise<boolean> {
    const response = await fetch(`${this.config.mpcEndpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);

    return response?.ok ?? false;
  }

  /**
   * Get the minimum number of nodes required for decryption
   */
  getThreshold(): number {
    return this.config.threshold;
  }
}

/**
 * Create a threshold encryption service from MPC cluster info
 */
export async function createThresholdEncryption(
  mpcEndpoint: string
): Promise<ThresholdEncryptionService> {
  // Fetch cluster info from MPC endpoint
  const response = await fetch(`${mpcEndpoint}/cluster-info`);
  
  if (!response.ok) {
    throw new Error(`Failed to get cluster info: ${response.status}`);
  }

  const clusterInfo = await response.json() as {
    clusterId: string;
    threshold: number;
    totalNodes: number;
    publicKey: Hex;
  };

  return new ThresholdEncryptionService({
    clusterId: clusterInfo.clusterId,
    threshold: clusterInfo.threshold,
    totalNodes: clusterInfo.totalNodes,
    publicKey: clusterInfo.publicKey,
    mpcEndpoint,
  });
}

/**
 * Derive a deterministic encryption key for local-only encryption
 * 
 * Use this when MPC is not available. The key should be securely stored.
 */
export function deriveLocalEncryptionKey(
  seed: Hex,
  salt: string = 'oauth3-local-key'
): Hex {
  const combined = keccak256(toBytes(`${seed}:${salt}`));
  return combined;
}
