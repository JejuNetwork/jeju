/**
 * Signing Coordinator
 *
 * Coordinates threshold signing sessions across MPC nodes.
 */

import type { Hex } from 'viem';
import { keccak256, toBytes, toHex } from 'viem';
import type { SigningSessionState } from './types.js';
import { ThresholdKeyManager, type KeyShare } from './threshold-key-manager.js';

export interface SigningSession {
  sessionId: string;
  userId: string;
  messageHash: Hex;
  status: SigningSessionState['status'];
  threshold: number;
  collectedSignatures: number;
}

export interface PartialSignature {
  nodeId: string;
  shareIndex: number;
  signature: Hex;
  timestamp: number;
}

export interface CombinedSignature {
  signature: Hex;
  r: Hex;
  s: Hex;
  v: number;
}

/**
 * Coordinates signing sessions for threshold signatures
 */
export class SigningCoordinator {
  private sessions: Map<string, SigningSessionState> = new Map();
  private keyManager: ThresholdKeyManager;
  private nodeId: string;
  private sessionTimeout = 60_000; // 1 minute

  constructor(keyManager: ThresholdKeyManager, nodeId: string) {
    this.keyManager = keyManager;
    this.nodeId = nodeId;
  }

  /**
   * Start a new signing session
   */
  async startSession(
    userId: string,
    messageHash: Hex,
    signatureType: 'message' | 'typedData' | 'transaction'
  ): Promise<SigningSession> {
    // Check if we have a key share for this user
    const shareMetadata = this.keyManager.getShareMetadata(userId);
    if (!shareMetadata) {
      throw new Error('No key share found for user');
    }

    const sessionId = this.generateSessionId(userId, messageHash);

    // Check for existing session
    const existing = this.sessions.get(sessionId);
    if (existing && existing.status !== 'failed') {
      return this.sessionToPublic(existing);
    }

    const session: SigningSessionState = {
      sessionId,
      userId,
      messageHash,
      signatureType,
      threshold: shareMetadata.threshold,
      participants: [this.nodeId],
      partialSignatures: new Map(),
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + this.sessionTimeout,
    };

    this.sessions.set(sessionId, session);

    return this.sessionToPublic(session);
  }

  /**
   * Generate partial signature for a session
   */
  async generatePartialSignature(
    sessionId: string
  ): Promise<PartialSignature | null> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    if (session.status === 'complete' || session.status === 'failed') {
      return null;
    }

    // Get our key share
    const share = await this.keyManager.getShare(session.userId);
    if (!share) {
      return null;
    }

    // Generate partial signature
    // In production, this would use proper threshold ECDSA
    const partialSig = await this.signWithShare(share, session.messageHash);

    session.status = 'collecting';
    session.partialSignatures.set(this.nodeId, partialSig);

    return {
      nodeId: this.nodeId,
      shareIndex: share.index,
      signature: partialSig,
      timestamp: Date.now(),
    };
  }

  /**
   * Add a partial signature from another node
   */
  addPartialSignature(
    sessionId: string,
    nodeId: string,
    signature: Hex
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    if (session.status === 'complete' || session.status === 'failed') {
      return false;
    }

    session.partialSignatures.set(nodeId, signature);

    if (!session.participants.includes(nodeId)) {
      session.participants.push(nodeId);
    }

    // Check if we have enough signatures
    if (session.partialSignatures.size >= session.threshold) {
      session.status = 'combining';
    }

    return true;
  }

  /**
   * Combine partial signatures into final signature
   */
  async combineSignatures(sessionId: string): Promise<CombinedSignature | null> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    if (session.partialSignatures.size < session.threshold) {
      return null;
    }

    try {
      // Collect partial signatures
      const partials = Array.from(session.partialSignatures.values());

      // Combine using Lagrange interpolation
      // In production, this would use proper threshold ECDSA combination
      const combined = this.combinePartialSignatures(partials);

      session.status = 'complete';

      // Parse signature components
      const sigBytes = toBytes(combined);
      const r = toHex(sigBytes.slice(0, 32));
      const s = toHex(sigBytes.slice(32, 64));
      const v = sigBytes[64] ?? 27;

      return { signature: combined, r, s, v };
    } catch (error) {
      session.status = 'failed';
      return null;
    }
  }

  /**
   * Get session status
   */
  getSession(sessionId: string): SigningSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    // Check for expiration
    if (Date.now() > session.expiresAt) {
      session.status = 'failed';
    }

    return this.sessionToPublic(session);
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions(): number {
    let cleaned = 0;
    const now = Date.now();

    for (const [id, session] of this.sessions) {
      if (now > session.expiresAt) {
        this.sessions.delete(id);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Generate a deterministic session ID
   */
  private generateSessionId(userId: string, messageHash: Hex): string {
    const input = `${userId}:${messageHash}:${Date.now()}`;
    return keccak256(toBytes(input as `0x${string}`)).slice(0, 18);
  }

  /**
   * Sign message with a key share
   */
  private async signWithShare(
    share: KeyShare,
    messageHash: Hex
  ): Promise<Hex> {
    // Simplified signing - in production would use proper threshold ECDSA
    const messageBytes = toBytes(messageHash);
    const combined = new Uint8Array(messageBytes.length + share.value.length);
    combined.set(messageBytes);
    combined.set(share.value, messageBytes.length);

    const signature = keccak256(combined);
    return signature as Hex;
  }

  /**
   * Combine partial signatures
   */
  private combinePartialSignatures(partials: Hex[]): Hex {
    // Simplified combination - in production would use Lagrange interpolation
    // on the signature shares
    const combined = new Uint8Array(65);

    for (const partial of partials) {
      const partialBytes = toBytes(partial);
      for (let i = 0; i < Math.min(partialBytes.length, 64); i++) {
        combined[i] ^= partialBytes[i];
      }
    }

    // Set recovery byte
    combined[64] = 27;

    return toHex(combined);
  }

  /**
   * Convert internal session to public interface
   */
  private sessionToPublic(session: SigningSessionState): SigningSession {
    return {
      sessionId: session.sessionId,
      userId: session.userId,
      messageHash: session.messageHash,
      status: session.status,
      threshold: session.threshold,
      collectedSignatures: session.partialSignatures.size,
    };
  }
}
