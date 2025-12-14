/**
 * MPC Types
 *
 * Type definitions for MPC network operations.
 */

import type { Address, Hex } from 'viem';

/**
 * Message types for MPC protocol
 */
export enum MPCMessageType {
  // Key generation
  KEY_GEN_INIT = 'KEY_GEN_INIT',
  KEY_GEN_ROUND_1 = 'KEY_GEN_ROUND_1',
  KEY_GEN_ROUND_2 = 'KEY_GEN_ROUND_2',
  KEY_GEN_ROUND_3 = 'KEY_GEN_ROUND_3',
  KEY_GEN_COMPLETE = 'KEY_GEN_COMPLETE',

  // Signing
  SIGN_INIT = 'SIGN_INIT',
  SIGN_ROUND_1 = 'SIGN_ROUND_1',
  SIGN_ROUND_2 = 'SIGN_ROUND_2',
  SIGN_COMPLETE = 'SIGN_COMPLETE',

  // Node management
  HEARTBEAT = 'HEARTBEAT',
  NODE_JOIN = 'NODE_JOIN',
  NODE_LEAVE = 'NODE_LEAVE',
}

/**
 * Base MPC request
 */
export interface MPCRequest {
  id: string;
  type: MPCMessageType;
  timestamp: number;
  nodeId: string;
}

/**
 * Base MPC response
 */
export interface MPCResponse {
  id: string;
  type: MPCMessageType;
  success: boolean;
  error?: string;
  timestamp: number;
  nodeId: string;
}

/**
 * Key generation request
 */
export interface KeyGenRequest extends MPCRequest {
  type: MPCMessageType.KEY_GEN_INIT;
  /** DID of the user requesting key */
  userId: string;
  /** Threshold required for signing */
  threshold: number;
  /** Total number of key shares */
  totalShares: number;
  /** Auth proof from the user */
  authProof: {
    type: 'wallet' | 'email' | 'oauth';
    signature?: Hex;
    token?: string;
    timestamp: number;
  };
}

/**
 * Key generation response
 */
export interface KeyGenResponse extends MPCResponse {
  type: MPCMessageType.KEY_GEN_COMPLETE;
  /** Public key of the generated key pair */
  publicKey?: Hex;
  /** Derived wallet address */
  walletAddress?: Address;
  /** Share index for this node */
  shareIndex?: number;
}

/**
 * Signing request
 */
export interface SignRequest extends MPCRequest {
  type: MPCMessageType.SIGN_INIT;
  /** DID of the user requesting signature */
  userId: string;
  /** Message hash to sign */
  messageHash: Hex;
  /** Type of signature (message, typed data, transaction) */
  signatureType: 'message' | 'typedData' | 'transaction';
}

/**
 * Signing response with partial signature
 */
export interface SignResponse extends MPCResponse {
  type: MPCMessageType.SIGN_COMPLETE;
  /** Partial signature from this node */
  partialSignature?: Hex;
  /** Combined signature (only from coordinator) */
  fullSignature?: Hex;
  /** Signature components */
  r?: Hex;
  s?: Hex;
  v?: number;
}

/**
 * Node heartbeat for liveness
 */
export interface NodeHeartbeat extends MPCRequest {
  type: MPCMessageType.HEARTBEAT;
  /** Node's current load (0-1) */
  load: number;
  /** Number of active sessions */
  activeSessions: number;
  /** TEE attestation quote (optional, for fresh attestation) */
  attestation?: {
    quote: Hex;
    timestamp: number;
  };
}

/**
 * Key share stored by each node
 */
export interface StoredKeyShare {
  userId: string;
  shareIndex: number;
  encryptedShare: Hex;
  publicKey: Hex;
  walletAddress: Address;
  threshold: number;
  totalShares: number;
  createdAt: number;
  lastUsedAt: number;
}

/**
 * Signing session state
 */
export interface SigningSessionState {
  sessionId: string;
  userId: string;
  messageHash: Hex;
  signatureType: 'message' | 'typedData' | 'transaction';
  threshold: number;
  participants: string[];
  partialSignatures: Map<string, Hex>;
  status: 'pending' | 'collecting' | 'combining' | 'complete' | 'failed';
  createdAt: number;
  expiresAt: number;
}
