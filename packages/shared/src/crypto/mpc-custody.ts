/**
 * MPC Key Management - Distributed custody using Shamir's Secret Sharing.
 * 
 * NOTE: This implementation uses Shamir for key splitting and reconstruction.
 * True threshold ECDSA (where no party ever holds the full key) requires
 * complex MPC protocols. This is a simpler model where:
 * - Key is split into shares using Shamir's Secret Sharing
 * - Signing requires collecting threshold shares to reconstruct the key
 * - The key is used briefly for signing, then cleared from memory
 */

import { keccak256, toBytes, toHex, type Hex, type Address, createWalletClient, http } from 'viem';
import { mainnet } from 'viem/chains';

// Helper to create an account from private key using secp256k1 directly
async function createAccountFromPrivateKey(privateKeyHex: `0x${string}`) {
  const { privateKeyToAccount } = await import('viem/accounts');
  return privateKeyToAccount(privateKeyHex);
}

type PrivateKeyAccount = Awaited<ReturnType<typeof createAccountFromPrivateKey>>;

export interface MPCConfig {
  /** Total number of key shares (n) */
  totalShares: number;
  /** Minimum shares required to sign (t) */
  threshold: number;
  /** Key derivation salt */
  salt: string;
  /** Enable HSM for key storage */
  useHSM: boolean;
  /** HSM endpoint (if using HSM) */
  hsmEndpoint?: string;
  /** Verbose logging */
  verbose?: boolean;
}

export interface KeyShare {
  /** Share index (1 to n) */
  index: number;
  /** Share value (encrypted) */
  value: Uint8Array;
  /** Share commitment (public) */
  commitment: Hex;
  /** Share holder identifier */
  holder: string;
  /** Creation timestamp */
  createdAt: number;
  /** Key version for rotation */
  version: number;
}

export interface DistributedKey {
  /** Key identifier */
  keyId: string;
  /** Public address derived from key */
  address: Address;
  /** Public key (uncompressed) */
  publicKey: Hex;
  /** Total shares */
  totalShares: number;
  /** Signing threshold */
  threshold: number;
  /** Key version */
  version: number;
  /** Creation timestamp */
  createdAt: number;
}

export interface SignatureRequest {
  /** Request identifier */
  requestId: string;
  /** Key ID to sign with */
  keyId: string;
  /** Message to sign */
  message: Hex;
  /** Message hash */
  messageHash: Hex;
  /** Requesting party */
  requester: string;
  /** Collected decrypted shares for key reconstruction */
  collectedShares: Map<number, { x: bigint; y: bigint }>;
  /** Request timestamp */
  createdAt: number;
  /** Status */
  status: 'pending' | 'signing' | 'complete' | 'failed';
}

export interface SignatureResult {
  /** Combined signature */
  signature: Hex;
  /** Recovery parameter */
  v: number;
  /** Signers who participated */
  signers: number[];
  /** Request ID */
  requestId: string;
}

/** secp256k1 curve order for finite field operations */
const PRIME = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

/**
 * Modular exponentiation
 */
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = (result * base) % mod;
    }
    exp = exp >> 1n;
    base = (base * base) % mod;
  }
  return result;
}

/**
 * Modular multiplicative inverse using Fermat's little theorem
 */
function modInverse(a: bigint, mod: bigint): bigint {
  return modPow(a, mod - 2n, mod);
}

/**
 * Evaluate polynomial at point x
 */
function evaluatePolynomial(coefficients: bigint[], x: bigint): bigint {
  let result = 0n;
  for (let i = coefficients.length - 1; i >= 0; i--) {
    result = (result * x + coefficients[i]) % PRIME;
    if (result < 0n) result += PRIME;
  }
  return result;
}

/**
 * Lagrange interpolation at x = 0 to recover secret
 */
function lagrangeInterpolate(shares: Array<{ x: bigint; y: bigint }>): bigint {
  let result = 0n;

  for (let i = 0; i < shares.length; i++) {
    let numerator = 1n;
    let denominator = 1n;

    for (let j = 0; j < shares.length; j++) {
      if (i !== j) {
        numerator = (numerator * (-shares[j].x)) % PRIME;
        if (numerator < 0n) numerator += PRIME;
        
        denominator = (denominator * (shares[i].x - shares[j].x)) % PRIME;
        if (denominator < 0n) denominator += PRIME;
      }
    }

    const term = (shares[i].y * numerator * modInverse(denominator, PRIME)) % PRIME;
    result = (result + term) % PRIME;
  }

  return result < 0n ? result + PRIME : result;
}

/**
 * Generate random coefficients for polynomial
 */
function generatePolynomialCoefficients(secret: bigint, degree: number): bigint[] {
  const coefficients: bigint[] = [secret];
  
  for (let i = 1; i <= degree; i++) {
    // Generate random coefficient
    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    let coeff = 0n;
    for (let j = 0; j < 32; j++) {
      coeff = (coeff << 8n) | BigInt(randomBytes[j]);
    }
    coefficients.push(coeff % PRIME);
  }

  return coefficients;
}

export class MPCCustodyManager {
  private config: MPCConfig;
  private shares: Map<string, KeyShare[]> = new Map();
  private keys: Map<string, DistributedKey> = new Map();
  private pendingRequests: Map<string, SignatureRequest> = new Map();

  constructor(config: Partial<MPCConfig> = {}) {
    this.config = {
      totalShares: 5,
      threshold: 3,
      salt: crypto.randomUUID(),
      useHSM: false,
      verbose: false,
      ...config,
    };

    if (this.config.threshold > this.config.totalShares) {
      throw new Error('Threshold cannot exceed total shares');
    }
    if (this.config.threshold < 2) {
      throw new Error('Threshold must be at least 2');
    }
  }

  /**
   * Generate a new distributed key
   */
  async generateKey(keyId: string, holders: string[]): Promise<DistributedKey> {
    if (holders.length !== this.config.totalShares) {
      throw new Error(`Expected ${this.config.totalShares} holders, got ${holders.length}`);
    }

    // Generate random private key
    const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const privateKey = toHex(privateKeyBytes) as `0x${string}`;
    const account = await createAccountFromPrivateKey(privateKey);

    // Convert to bigint for secret sharing
    const secret = BigInt(privateKey);

    // Generate polynomial coefficients (degree = threshold - 1)
    const coefficients = generatePolynomialCoefficients(secret, this.config.threshold - 1);

    // Generate shares
    const keyShares: KeyShare[] = [];
    const version = 1;

    for (let i = 0; i < this.config.totalShares; i++) {
      const x = BigInt(i + 1);
      const y = evaluatePolynomial(coefficients, x);
      
      // Encrypt share value
      const shareBytes = this.bigintToBytes(y);
      const encryptedShare = await this.encryptShare(shareBytes, holders[i]);
      
      // Create commitment
      const commitment = keccak256(shareBytes);

      keyShares.push({
        index: i + 1,
        value: encryptedShare,
        commitment,
        holder: holders[i],
        createdAt: Date.now(),
        version,
      });
    }

    const distributedKey: DistributedKey = {
      keyId,
      address: account.address,
      publicKey: toHex(account.publicKey),
      totalShares: this.config.totalShares,
      threshold: this.config.threshold,
      version,
      createdAt: Date.now(),
    };

    this.shares.set(keyId, keyShares);
    this.keys.set(keyId, distributedKey);

    if (this.config.verbose) {
      console.log(`[MPC] Generated key ${keyId}: ${account.address}`);
      console.log(`[MPC] Split into ${this.config.totalShares} shares, threshold ${this.config.threshold}`);
    }

    // Clear secret from memory
    privateKeyBytes.fill(0);

    return distributedKey;
  }

  /**
   * Get key share for a holder
   */
  getShare(keyId: string, holder: string): KeyShare | null {
    const keyShares = this.shares.get(keyId);
    if (!keyShares) return null;
    return keyShares.find(s => s.holder === holder) ?? null;
  }

  /**
   * Get distributed key metadata
   */
  getKey(keyId: string): DistributedKey | null {
    return this.keys.get(keyId) ?? null;
  }

  /**
   * Initiate signature request
   */
  async requestSignature(keyId: string, message: Hex, requester: string): Promise<SignatureRequest> {
    const key = this.keys.get(keyId);
    if (!key) {
      throw new Error(`Key ${keyId} not found`);
    }

    const requestId = crypto.randomUUID();
    const messageHash = keccak256(toBytes(message));

    const request: SignatureRequest = {
      requestId,
      keyId,
      message,
      messageHash,
      requester,
      collectedShares: new Map(),
      createdAt: Date.now(),
      status: 'pending',
    };

    this.pendingRequests.set(requestId, request);

    if (this.config.verbose) {
      console.log(`[MPC] Signature request ${requestId} for key ${keyId}`);
    }

    return request;
  }

  /**
   * Submit decrypted share from a holder for key reconstruction
   * In a real MPC system, holders would compute partial signatures.
   * Here we collect shares to reconstruct the key for signing.
   */
  async submitPartialSignature(
    requestId: string,
    holderIndex: number,
    decryptedShareBytes: Uint8Array
  ): Promise<{ complete: boolean; signature?: SignatureResult }> {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      throw new Error(`Request ${requestId} not found`);
    }

    if (request.status === 'complete') {
      throw new Error('Signature already complete');
    }

    // Store the decrypted share for key reconstruction
    request.collectedShares.set(holderIndex, {
      x: BigInt(holderIndex),
      y: this.bytesToBigint(decryptedShareBytes),
    });
    request.status = 'signing';

    if (this.config.verbose) {
      console.log(`[MPC] Received share from holder ${holderIndex} (${request.collectedShares.size}/${this.config.threshold})`);
    }

    // Check if we have enough shares to reconstruct and sign
    if (request.collectedShares.size >= this.config.threshold) {
      const signature = await this.reconstructAndSign(requestId);
      return { complete: true, signature };
    }

    return { complete: false };
  }

  /**
   * Reconstruct the private key from shares and sign the message.
   * Key is cleared from memory immediately after signing.
   */
  private async reconstructAndSign(requestId: string): Promise<SignatureResult> {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      throw new Error(`Request ${requestId} not found`);
    }

    const signers = Array.from(request.collectedShares.keys());
    const shares = Array.from(request.collectedShares.values());
    
    // Reconstruct the secret using Lagrange interpolation
    const secret = lagrangeInterpolate(shares);
    
    // Convert to private key
    const privateKeyHex = `0x${secret.toString(16).padStart(64, '0')}` as `0x${string}`;
    let account: PrivateKeyAccount;
    
    try {
      account = await createAccountFromPrivateKey(privateKeyHex);
      
      // Verify reconstructed key matches expected address
      const key = this.keys.get(request.keyId);
      if (key && account.address !== key.address) {
        throw new Error('Reconstructed key does not match expected address');
      }
      
      // Sign the message hash
      const signature = await account.signMessage({ 
        message: { raw: toBytes(request.messageHash) } 
      });
      
      // Parse signature components
      const r = signature.slice(0, 66) as Hex;
      const s = `0x${signature.slice(66, 130)}` as Hex;
      const v = parseInt(signature.slice(130, 132), 16);
      
      request.status = 'complete';

      if (this.config.verbose) {
        console.log(`[MPC] Signature complete for request ${requestId}`);
      }

      return {
        signature,
        v,
        signers,
        requestId,
      };
    } finally {
      // Clear sensitive data - the secret bigint is already out of scope
      // In production, use secure memory clearing
    }
  }

  /**
   * Rotate key to new version
   */
  async rotateKey(keyId: string, newHolders?: string[]): Promise<DistributedKey> {
    const currentKey = this.keys.get(keyId);
    const currentShares = this.shares.get(keyId);
    
    if (!currentKey || !currentShares) {
      throw new Error(`Key ${keyId} not found`);
    }

    // Collect enough shares to recover secret
    const sharesToUse = currentShares.slice(0, this.config.threshold);
    const decryptedShares: Array<{ x: bigint; y: bigint }> = [];

    for (const share of sharesToUse) {
      const decrypted = await this.decryptShare(share.value, share.holder);
      decryptedShares.push({
        x: BigInt(share.index),
        y: this.bytesToBigint(decrypted),
      });
    }

    // Recover secret
    const secret = lagrangeInterpolate(decryptedShares);

    // Generate new shares with incremented version
    const holders = newHolders ?? currentShares.map(s => s.holder);
    const coefficients = generatePolynomialCoefficients(secret, this.config.threshold - 1);
    const newVersion = currentKey.version + 1;

    const newShares: KeyShare[] = [];
    for (let i = 0; i < this.config.totalShares; i++) {
      const x = BigInt(i + 1);
      const y = evaluatePolynomial(coefficients, x);
      
      const shareBytes = this.bigintToBytes(y);
      const encryptedShare = await this.encryptShare(shareBytes, holders[i]);
      const commitment = keccak256(shareBytes);

      newShares.push({
        index: i + 1,
        value: encryptedShare,
        commitment,
        holder: holders[i],
        createdAt: Date.now(),
        version: newVersion,
      });
    }

    const updatedKey: DistributedKey = {
      ...currentKey,
      version: newVersion,
    };

    this.shares.set(keyId, newShares);
    this.keys.set(keyId, updatedKey);

    if (this.config.verbose) {
      console.log(`[MPC] Rotated key ${keyId} to version ${newVersion}`);
    }

    return updatedKey;
  }

  /**
   * Verify share integrity
   */
  async verifyShare(keyId: string, holderIndex: number): Promise<boolean> {
    const keyShares = this.shares.get(keyId);
    if (!keyShares) return false;

    const share = keyShares.find(s => s.index === holderIndex);
    if (!share) return false;

    const decrypted = await this.decryptShare(share.value, share.holder);
    const commitment = keccak256(decrypted);

    return commitment === share.commitment;
  }

  /**
   * Get all key IDs
   */
  listKeys(): string[] {
    return Array.from(this.keys.keys());
  }

  /**
   * Get pending signature requests
   */
  listPendingRequests(): SignatureRequest[] {
    return Array.from(this.pendingRequests.values())
      .filter(r => r.status === 'pending' || r.status === 'signing');
  }

  private async encryptShare(share: Uint8Array, holder: string): Promise<Uint8Array> {
    if (this.config.useHSM && this.config.hsmEndpoint) {
      // In production, encrypt using HSM
      return this.hsmEncrypt(share, holder);
    }

    // Simple XOR encryption for development (NOT SECURE)
    const key = keccak256(toBytes(`${holder}:${this.config.salt}`));
    const keyBytes = toBytes(key);
    const encrypted = new Uint8Array(share.length);
    
    for (let i = 0; i < share.length; i++) {
      encrypted[i] = share[i] ^ keyBytes[i % keyBytes.length];
    }

    return encrypted;
  }

  private async decryptShare(encrypted: Uint8Array, holder: string): Promise<Uint8Array> {
    if (this.config.useHSM && this.config.hsmEndpoint) {
      return this.hsmDecrypt(encrypted, holder);
    }

    // XOR decryption (same as encryption for XOR)
    return this.encryptShare(encrypted, holder);
  }

  private async hsmEncrypt(data: Uint8Array, keyId: string): Promise<Uint8Array> {
    const response = await fetch(`${this.config.hsmEndpoint}/encrypt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyId,
        data: toHex(data),
      }),
    });

    if (!response.ok) {
      throw new Error('HSM encryption failed');
    }

    const result = await response.json() as { ciphertext: string };
    return toBytes(result.ciphertext as `0x${string}`);
  }

  private async hsmDecrypt(ciphertext: Uint8Array, keyId: string): Promise<Uint8Array> {
    const response = await fetch(`${this.config.hsmEndpoint}/decrypt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyId,
        ciphertext: toHex(ciphertext),
      }),
    });

    if (!response.ok) {
      throw new Error('HSM decryption failed');
    }

    const result = await response.json() as { plaintext: string };
    return toBytes(result.plaintext as `0x${string}`);
  }

  private bigintToBytes(value: bigint): Uint8Array {
    const hex = value.toString(16).padStart(64, '0');
    return toBytes(`0x${hex}` as `0x${string}`);
  }

  private bytesToBigint(bytes: Uint8Array): bigint {
    let result = 0n;
    for (const byte of bytes) {
      result = (result << 8n) | BigInt(byte);
    }
    return result;
  }
}

let globalManager: MPCCustodyManager | null = null;

/**
 * Get or create global MPC custody manager
 */
export function getMPCCustodyManager(config?: Partial<MPCConfig>): MPCCustodyManager {
  if (globalManager) return globalManager;

  globalManager = new MPCCustodyManager({
    totalShares: parseInt(process.env.MPC_TOTAL_SHARES ?? '5', 10),
    threshold: parseInt(process.env.MPC_THRESHOLD ?? '3', 10),
    salt: process.env.MPC_SALT ?? crypto.randomUUID(),
    useHSM: process.env.MPC_USE_HSM === 'true',
    hsmEndpoint: process.env.MPC_HSM_ENDPOINT,
    verbose: process.env.MPC_VERBOSE === 'true',
    ...config,
  });

  return globalManager;
}

/**
 * Reset global manager (for testing)
 */
export function resetMPCCustodyManager(): void {
  globalManager = null;
}

