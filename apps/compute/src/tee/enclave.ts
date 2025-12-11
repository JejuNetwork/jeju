/**
 * TEE Enclave
 *
 * Main TEE runtime that manages:
 * - Keystore and wallet (REAL secp256k1 keys)
 * - Attestation quotes (SIMULATED - see warnings)
 * - Encrypted state I/O (REAL AES-256-GCM)
 *
 * ⚠️ SIMULATION MODE:
 * - Keys are derived from code hash (deterministic, but not hardware-bound)
 * - Attestation is simulated (not from Intel/NVIDIA PKI)
 * - Encryption is REAL (production-quality AES-256-GCM)
 *
 * For production: Deploy to a TEE provider
 */

import { type Address, type Hex, keccak256, toBytes } from 'viem';
import {
  type AttestationQuote,
  formatQuoteForDisplay,
  generateQuote,
  setExpectedMeasurement,
  verifyQuote,
} from './attestation.js';
import { type SealedData, TEEKeystore } from './keystore.js';
import { TEEWallet } from './wallet.js';

export interface EnclaveConfig {
  /** Hash of the code being run (simulates Docker image hash) */
  codeHash: Hex;
  /** Unique identifier for this enclave instance */
  instanceId: string;
  /** Enable verbose logging */
  verbose?: boolean;
}

export interface EnclaveState {
  /** Current sealed state */
  sealedState: SealedData | null;
  /** Last state hash (for integrity) */
  stateHash: Hex | null;
  /** Last update timestamp */
  lastUpdate: number;
}

const STATE_KEY_LABEL = 'game_state';

/**
 * TEE Enclave (Simulation Mode)
 *
 * WHAT'S REAL:
 * - secp256k1 wallet (works on-chain!)
 * - AES-256-GCM encryption
 * - HKDF key derivation
 *
 * WHAT'S SIMULATED:
 * - Hardware isolation (keys exist in process memory)
 * - Attestation signatures (not from Intel/NVIDIA)
 */
export class TEEEnclave {
  private keystore: TEEKeystore | null = null;
  private wallet: TEEWallet | null = null;
  private config: EnclaveConfig;
  private state: EnclaveState;
  private attestationQuote: AttestationQuote | null = null;
  private isRunning = false;

  private constructor(config: EnclaveConfig) {
    this.config = config;
    this.state = {
      sealedState: null,
      stateHash: null,
      lastUpdate: 0,
    };
  }

  /**
   * Create and boot an enclave
   */
  static async create(config: EnclaveConfig): Promise<TEEEnclave> {
    if (!config.codeHash || !config.codeHash.startsWith('0x')) {
      throw new Error('Invalid code hash');
    }
    if (!config.instanceId || config.instanceId.length === 0) {
      throw new Error('Invalid instance ID');
    }

    const enclave = new TEEEnclave(config);
    await enclave.boot();
    return enclave;
  }

  /**
   * Boot the enclave and generate initial attestation
   */
  private async boot(): Promise<void> {
    if (this.config.verbose) {
      console.log('\n[TEE Enclave] === BOOTING ENCLAVE ===');
    }

    // Initialize keystore with enclave measurement
    const measurement = keccak256(
      toBytes(`${this.config.codeHash}:${this.config.instanceId}`)
    );
    this.keystore = await TEEKeystore.create(measurement, {
      verbose: this.config.verbose,
    });

    // Derive wallet
    this.wallet = await TEEWallet.create(this.keystore);

    // Set expected measurement for verification
    setExpectedMeasurement(this.config.codeHash);

    // Generate attestation quote
    this.attestationQuote = generateQuote(
      this.config.codeHash,
      this.wallet.address
    );

    // Verify our own quote (self-check)
    const verification = verifyQuote(this.attestationQuote);
    if (!verification.valid) {
      throw new Error(
        `Self-attestation failed: ${verification.errors.join(', ')}`
      );
    }

    this.isRunning = true;

    if (this.config.verbose) {
      console.log('[TEE Enclave] Boot complete. Attestation verified.');
      console.log(formatQuoteForDisplay(this.attestationQuote));
    }
  }

  /**
   * Get the enclave's Ethereum address
   */
  getOperatorAddress(): Address {
    this.ensureRunning();
    return this.wallet!.address;
  }

  /**
   * Get the current attestation quote
   */
  getAttestation(): AttestationQuote {
    this.ensureRunning();
    return this.attestationQuote!;
  }

  /**
   * Encrypt and store state
   */
  async encryptState(stateData: object): Promise<{ cid: string; hash: Hex }> {
    this.ensureRunning();

    const sealed = await this.keystore!.sealJSON(stateData, STATE_KEY_LABEL);

    // Compute content hash (CID simulation)
    const stateJson = JSON.stringify(sealed);
    const hash = keccak256(toBytes(stateJson));
    const cid = `Qm${hash.slice(2, 48)}`;

    this.state = {
      sealedState: sealed,
      stateHash: hash,
      lastUpdate: Date.now(),
    };

    if (this.config.verbose) {
      console.log(
        `[TEE Enclave] State encrypted (v${sealed.version}), CID: ${cid}`
      );
    }

    return { cid, hash };
  }

  /**
   * Decrypt and load state
   */
  async decryptState<T = object>(
    sealed: SealedData,
    version?: number
  ): Promise<T> {
    this.ensureRunning();
    return this.keystore!.unsealJSON<T>(sealed, version);
  }

  /**
   * Rotate the state encryption key
   */
  async rotateStateKey(): Promise<{
    oldVersion: number;
    newVersion: number;
    newCid: string;
  }> {
    this.ensureRunning();

    if (!this.state.sealedState) {
      throw new Error('No state to re-encrypt during rotation');
    }

    if (this.config.verbose) {
      console.log('\n[TEE Enclave] === KEY ROTATION ===');
    }

    // Decrypt with old key
    const oldVersion = this.state.sealedState.version;
    const plainState = await this.keystore!.unsealJSON<object>(
      this.state.sealedState
    );

    // Rotate the key in keystore
    const { newVersion } = await this.keystore!.rotateKey(STATE_KEY_LABEL);

    // Re-encrypt with new key
    const { cid: newCid } = await this.encryptState(plainState);

    if (this.config.verbose) {
      console.log(
        `[TEE Enclave] Key rotated: v${oldVersion} -> v${newVersion}, new CID: ${newCid}`
      );
    }

    return { oldVersion, newVersion, newCid };
  }

  /**
   * Sign a message proving enclave identity
   */
  signMessage(message: string) {
    this.ensureRunning();
    return this.wallet!.signMessage(message);
  }

  /**
   * Sign a transaction for blockchain interaction (deterministic)
   */
  signTransaction(to: Address, data: Hex, value = 0n) {
    this.ensureRunning();
    return this.wallet!.signTransaction(to, data, value);
  }

  /**
   * Get the wallet account for REAL on-chain transactions
   * This returns a viem account that can sign actual Ethereum transactions!
   */
  getWalletAccount() {
    this.ensureRunning();
    return this.wallet!.getAccount();
  }

  /**
   * Get the wallet private key (only use inside TEE!)
   * This is needed for creating viem wallet clients
   */
  getPrivateKey(): Hex {
    this.ensureRunning();
    return this.wallet!.getPrivateKey();
  }

  /**
   * Check if this is running in simulation mode
   */
  isSimulated(): boolean {
    return true; // This class is always simulation mode
  }

  /**
   * Generate a heartbeat
   */
  generateHeartbeat(): {
    timestamp: number;
    stateHash: Hex | null;
    signature: Hex;
  } {
    this.ensureRunning();

    const timestamp = Date.now();
    const heartbeatData = `heartbeat:${timestamp}:${this.state.stateHash ?? 'genesis'}`;
    const signed = this.wallet!.signMessage(heartbeatData);

    return {
      timestamp,
      stateHash: this.state.stateHash,
      signature: signed.signature,
    };
  }

  /**
   * Get enclave status
   */
  getStatus(): {
    running: boolean;
    address: Address | null;
    stateVersion: number;
    lastUpdate: number;
    attestationValid: boolean;
  } {
    const attestationValid = this.attestationQuote
      ? verifyQuote(this.attestationQuote).valid
      : false;

    return {
      running: this.isRunning,
      address: this.wallet?.address ?? null,
      stateVersion: this.state.sealedState?.version ?? 0,
      lastUpdate: this.state.lastUpdate,
      attestationValid,
    };
  }

  /**
   * Get current sealed state (for storage/backup)
   */
  getSealedState(): SealedData | null {
    return this.state.sealedState;
  }

  /**
   * Load sealed state from storage
   */
  loadSealedState(sealed: SealedData): void {
    this.ensureRunning();

    const stateJson = JSON.stringify(sealed);
    this.state.sealedState = sealed;
    this.state.stateHash = keccak256(toBytes(stateJson));
    this.state.lastUpdate = Date.now();

    if (this.config.verbose) {
      console.log(`[TEE Enclave] Loaded sealed state (v${sealed.version})`);
    }
  }

  /**
   * Shutdown the enclave
   */
  async shutdown(): Promise<void> {
    if (this.config.verbose) {
      console.log('[TEE Enclave] Shutting down...');
    }

    this.isRunning = false;
    this.keystore?.clear();
    this.keystore = null;
    this.wallet = null;
  }

  /**
   * Check if enclave is running
   */
  private ensureRunning(): void {
    if (!this.isRunning || !this.keystore || !this.wallet) {
      throw new Error('Enclave is not running');
    }
  }
}
