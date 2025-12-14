/**
 * MPC Node Service
 *
 * Main service for running an MPC node.
 * Handles key generation, signing, and network communication.
 */

import type { Address, Hex } from 'viem';
import { TEEKeystore } from '../tee/keystore.js';
import { generateQuote } from '../tee/attestation.js';
import { ThresholdKeyManager } from './threshold-key-manager.js';
import { SigningCoordinator, type CombinedSignature } from './signing-coordinator.js';
import {
  MPCMessageType,
  type KeyGenRequest,
  type KeyGenResponse,
  type SignRequest,
  type SignResponse,
  type NodeHeartbeat,
} from './types.js';

export interface MPCNodeConfig {
  /** Unique node identifier */
  nodeId: string;
  /** Node's network endpoint */
  endpoint: string;
  /** TEE enclave measurement */
  enclaveMeasurement: string;
  /** Network ID (e.g., 'jeju-mainnet') */
  networkId: string;
  /** Threshold for key generation */
  defaultThreshold: number;
  /** Total shares for key generation */
  defaultTotalShares: number;
  /** Other nodes in the network */
  peers: Array<{ nodeId: string; endpoint: string }>;
  /** Enable verbose logging */
  verbose?: boolean;
}

export interface MPCNodeStatus {
  nodeId: string;
  endpoint: string;
  networkId: string;
  healthy: boolean;
  activeSessions: number;
  storedKeys: number;
  lastHeartbeat: number;
  attestationValid: boolean;
}

/**
 * MPC Node Service
 */
export class MPCNodeService {
  private config: MPCNodeConfig;
  private keystore: TEEKeystore | null = null;
  private keyManager: ThresholdKeyManager | null = null;
  private signingCoordinator: SigningCoordinator | null = null;
  private initialized = false;
  private lastHeartbeat = 0;

  constructor(config: MPCNodeConfig) {
    this.config = config;
  }

  /**
   * Initialize the MPC node
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Initialize TEE keystore
    this.keystore = await TEEKeystore.create(this.config.enclaveMeasurement, {
      verbose: this.config.verbose,
    });

    // Initialize key manager and signing coordinator
    this.keyManager = new ThresholdKeyManager(this.keystore);
    this.signingCoordinator = new SigningCoordinator(
      this.keyManager,
      this.config.nodeId
    );

    this.initialized = true;
    this.lastHeartbeat = Date.now();

    if (this.config.verbose) {
      console.log(`[MPC Node ${this.config.nodeId}] Initialized`);
    }
  }

  /**
   * Get node status
   */
  getStatus(): MPCNodeStatus {
    return {
      nodeId: this.config.nodeId,
      endpoint: this.config.endpoint,
      networkId: this.config.networkId,
      healthy: this.initialized,
      activeSessions: 0, // Would track actual sessions
      storedKeys: 0, // Would track stored key shares
      lastHeartbeat: this.lastHeartbeat,
      attestationValid: true, // Would verify TEE attestation
    };
  }

  /**
   * Handle key generation request
   */
  async handleKeyGen(request: KeyGenRequest): Promise<KeyGenResponse> {
    if (!this.initialized || !this.keyManager || !this.keystore) {
      return {
        id: request.id,
        type: MPCMessageType.KEY_GEN_COMPLETE,
        success: false,
        error: 'Node not initialized',
        timestamp: Date.now(),
        nodeId: this.config.nodeId,
      };
    }

    try {
      // Verify auth proof
      if (!this.verifyAuthProof(request.authProof)) {
        return {
          id: request.id,
          type: MPCMessageType.KEY_GEN_COMPLETE,
          success: false,
          error: 'Invalid auth proof',
          timestamp: Date.now(),
          nodeId: this.config.nodeId,
        };
      }

      // Generate threshold key
      const generated = await this.keyManager.generateKey(request.userId, {
        threshold: request.threshold || this.config.defaultThreshold,
        totalShares: request.totalShares || this.config.defaultTotalShares,
      });

      // Store our share
      const ourShareIndex = this.getOurShareIndex();
      const ourShare = generated.shares[ourShareIndex - 1];
      if (ourShare) {
        await this.keyManager.storeShare(
          request.userId,
          ourShare,
          generated.publicKey,
          generated.walletAddress,
          {
            threshold: request.threshold || this.config.defaultThreshold,
            totalShares: request.totalShares || this.config.defaultTotalShares,
          }
        );
      }

      // Distribute other shares to peers (in production)
      // For now, just return success

      return {
        id: request.id,
        type: MPCMessageType.KEY_GEN_COMPLETE,
        success: true,
        timestamp: Date.now(),
        nodeId: this.config.nodeId,
        publicKey: generated.publicKey,
        walletAddress: generated.walletAddress,
        shareIndex: ourShareIndex,
      };
    } catch (error) {
      return {
        id: request.id,
        type: MPCMessageType.KEY_GEN_COMPLETE,
        success: false,
        error: error instanceof Error ? error.message : 'Key generation failed',
        timestamp: Date.now(),
        nodeId: this.config.nodeId,
      };
    }
  }

  /**
   * Handle signing request
   */
  async handleSign(request: SignRequest): Promise<SignResponse> {
    if (!this.initialized || !this.signingCoordinator) {
      return {
        id: request.id,
        type: MPCMessageType.SIGN_COMPLETE,
        success: false,
        error: 'Node not initialized',
        timestamp: Date.now(),
        nodeId: this.config.nodeId,
      };
    }

    try {
      // Start or join signing session
      const session = await this.signingCoordinator.startSession(
        request.userId,
        request.messageHash,
        request.signatureType
      );

      // Generate our partial signature
      const partial = await this.signingCoordinator.generatePartialSignature(
        session.sessionId
      );

      if (!partial) {
        return {
          id: request.id,
          type: MPCMessageType.SIGN_COMPLETE,
          success: false,
          error: 'Failed to generate partial signature',
          timestamp: Date.now(),
          nodeId: this.config.nodeId,
        };
      }

      // In a real implementation, we would:
      // 1. Broadcast our partial signature to peers
      // 2. Collect partial signatures from peers
      // 3. Combine when we have threshold signatures

      // For dev mode, combine immediately (threshold = 1)
      let combined: CombinedSignature | null = null;
      if (session.threshold === 1) {
        combined = await this.signingCoordinator.combineSignatures(
          session.sessionId
        );
      }

      return {
        id: request.id,
        type: MPCMessageType.SIGN_COMPLETE,
        success: true,
        timestamp: Date.now(),
        nodeId: this.config.nodeId,
        partialSignature: partial.signature,
        fullSignature: combined?.signature,
        r: combined?.r,
        s: combined?.s,
        v: combined?.v,
      };
    } catch (error) {
      return {
        id: request.id,
        type: MPCMessageType.SIGN_COMPLETE,
        success: false,
        error: error instanceof Error ? error.message : 'Signing failed',
        timestamp: Date.now(),
        nodeId: this.config.nodeId,
      };
    }
  }

  /**
   * Generate heartbeat
   */
  async generateHeartbeat(): Promise<NodeHeartbeat> {
    this.lastHeartbeat = Date.now();

    // Generate fresh attestation
    // Use a placeholder operator address for heartbeats
    const operatorAddress = '0x0000000000000000000000000000000000000000' as Address;
    const attestationQuote = generateQuote(
      this.config.enclaveMeasurement as Hex,
      operatorAddress
    );

    return {
      id: `heartbeat-${this.config.nodeId}-${Date.now()}`,
      type: MPCMessageType.HEARTBEAT,
      timestamp: Date.now(),
      nodeId: this.config.nodeId,
      load: 0.1, // Would calculate actual load
      activeSessions: 0,
      attestation: {
        quote: attestationQuote.cpuSignature,
        timestamp: attestationQuote.timestamp,
      },
    };
  }

  /**
   * Verify auth proof from user
   */
  private verifyAuthProof(authProof: KeyGenRequest['authProof']): boolean {
    // Verify timestamp is recent (within 5 minutes)
    const maxAge = 5 * 60 * 1000;
    if (Date.now() - authProof.timestamp > maxAge) {
      return false;
    }

    // In production, would verify:
    // - Wallet signature
    // - Email verification token
    // - OAuth token validity

    return true;
  }

  /**
   * Get this node's share index
   */
  private getOurShareIndex(): number {
    // In production, would be based on node registration order
    const peerIndex = this.config.peers.findIndex(
      (p) => p.nodeId === this.config.nodeId
    );
    return peerIndex >= 0 ? peerIndex + 1 : 1;
  }

  /**
   * Shutdown the node
   */
  shutdown(): void {
    if (this.keystore) {
      this.keystore.clear();
    }
    this.initialized = false;

    if (this.config.verbose) {
      console.log(`[MPC Node ${this.config.nodeId}] Shutdown`);
    }
  }
}
