/**
 * @fileoverview Farcaster Hub Types
 */

import type { Address, Hex } from 'viem';

export interface HubConfig {
  /** Hub gRPC URL (e.g., 'hub.testnet.jejunetwork.org:2283') */
  hubUrl: string;
  /** HTTP API URL (optional, for REST endpoints) */
  httpUrl?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
}

export interface FarcasterProfile {
  fid: number;
  username: string;
  displayName: string;
  bio: string;
  pfpUrl: string;
  custodyAddress: Address;
  verifiedAddresses: Address[];
  followerCount: number;
  followingCount: number;
  registeredAt: number;
}

export interface FarcasterCast {
  hash: Hex;
  fid: number;
  text: string;
  timestamp: number;
  parentHash?: Hex;
  parentFid?: number;
  parentUrl?: string;
  embeds: CastEmbed[];
  mentions: number[];
  mentionsPositions: number[];
}

export interface CastEmbed {
  url?: string;
  castId?: {
    fid: number;
    hash: Hex;
  };
}

export interface FarcasterReaction {
  fid: number;
  targetFid: number;
  targetHash: Hex;
  type: 'like' | 'recast';
  timestamp: number;
}

export interface FarcasterLink {
  fid: number;
  targetFid: number;
  type: 'follow';
  timestamp: number;
}

export interface FarcasterVerification {
  fid: number;
  address: Address;
  protocol: 'ethereum' | 'solana';
  timestamp: number;
  chainId: number;
}

export interface UserData {
  fid: number;
  type: UserDataType;
  value: string;
  timestamp: number;
}

export type UserDataType = 
  | 'pfp'
  | 'display'
  | 'bio'
  | 'url'
  | 'username'
  | 'location';

export interface HubInfoResponse {
  version: string;
  isSyncing: boolean;
  nickname: string;
  rootHash: string;
  dbStats: {
    numMessages: number;
    numFidEvents: number;
    numFnameEvents: number;
  };
  peerId: string;
  hubOperatorFid: number;
}

export interface CastFilter {
  fid?: number;
  parentUrl?: string;
  pageSize?: number;
  pageToken?: string;
  reverse?: boolean;
}

export interface PaginatedResponse<T> {
  messages: T[];
  nextPageToken?: string;
}

