/**
 * Jeju Decentralized Proxy Network - Shared Types
 * @module @jeju/proxy/types
 */

import type { Address } from 'viem';

// ============ Region Types ============

/**
 * Standard region codes (ISO 3166-1 alpha-2)
 */
export const REGION_CODES = {
  US: 'US',
  GB: 'GB',
  DE: 'DE',
  FR: 'FR',
  JP: 'JP',
  KR: 'KR',
  SG: 'SG',
  AU: 'AU',
  BR: 'BR',
  IN: 'IN',
  CA: 'CA',
  NL: 'NL',
  SE: 'SE',
  CH: 'CH',
  HK: 'HK',
} as const;

export type RegionCode = keyof typeof REGION_CODES;

export function hashRegion(region: RegionCode): `0x${string}` {
  const { keccak256, toHex } = require('viem');
  return keccak256(toHex(region)) as `0x${string}`;
}

export function regionFromHash(hash: `0x${string}`): RegionCode | null {
  for (const region of Object.keys(REGION_CODES) as RegionCode[]) {
    if (hashRegion(region) === hash) return region;
  }
  return null;
}

// ============ Node Types ============

export interface ProxyNode {
  address: Address;
  regionCode: RegionCode;
  regionHash: `0x${string}`;
  endpoint: string;
  stake: bigint;
  registeredAt: number;
  totalBytesServed: bigint;
  totalSessions: number;
  successfulSessions: number;
  active: boolean;
}

export interface ConnectedNode extends ProxyNode {
  connectionId: string;
  connectedAt: number;
  lastHeartbeat: number;
  currentLoad: number; // 0-100
  pendingRequests: number;
  maxConcurrentRequests: number;
}

// ============ Session Types ============

export const SessionStatus = {
  PENDING: 0,
  ACTIVE: 1,
  COMPLETED: 2,
  CANCELLED: 3,
  EXPIRED: 4,
  DISPUTED: 5,
} as const;

export type SessionStatusType = typeof SessionStatus[keyof typeof SessionStatus];

export interface ProxySession {
  sessionId: `0x${string}`;
  client: Address;
  node: Address | null;
  regionCode: RegionCode;
  deposit: bigint;
  usedAmount: bigint;
  bytesServed: bigint;
  createdAt: number;
  closedAt: number | null;
  status: SessionStatusType;
}

// ============ Request Types ============

export interface ProxyRequest {
  requestId: string;
  sessionId: `0x${string}`;
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  followRedirects?: boolean;
  maxRedirects?: number;
}

export interface ProxyResponse {
  requestId: string;
  sessionId: `0x${string}`;
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bytesTransferred: number;
  latencyMs: number;
  nodeAddress: Address;
  error?: string;
}

// ============ Coordinator Types ============

export interface CoordinatorConfig {
  rpcUrl: string;
  registryAddress: Address;
  paymentAddress: Address;
  privateKey: string;
  port: number;
  wsPort?: number;
  heartbeatIntervalMs?: number;
  requestTimeoutMs?: number;
  maxConcurrentRequestsPerNode?: number;
  externalProviders?: ExternalProviderConfig[];
}

export interface ExternalProviderConfig {
  name: string;
  type: 'brightdata' | 'oxylabs' | 'mysterium';
  apiKey: string;
  endpoint?: string;
  enabled: boolean;
  priority: number; // Lower = higher priority for fallback
  markupBps: number; // Basis points markup (100 = 1%)
}

// ============ Node Client Types ============

export interface NodeClientConfig {
  coordinatorUrl: string;
  privateKey: string;
  regionCode: RegionCode;
  maxConcurrentRequests?: number;
  heartbeatIntervalMs?: number;
}

export interface NodeTask {
  taskId: string;
  request: ProxyRequest;
  assignedAt: number;
  deadline: number;
}

// ============ WebSocket Message Types ============

export const WsMessageType = {
  // Coordinator -> Node
  AUTH_REQUEST: 'AUTH_REQUEST',
  AUTH_RESPONSE: 'AUTH_RESPONSE',
  TASK_ASSIGN: 'TASK_ASSIGN',
  HEARTBEAT_REQUEST: 'HEARTBEAT_REQUEST',
  
  // Node -> Coordinator
  AUTH_SUBMIT: 'AUTH_SUBMIT',
  TASK_RESULT: 'TASK_RESULT',
  HEARTBEAT_RESPONSE: 'HEARTBEAT_RESPONSE',
  STATUS_UPDATE: 'STATUS_UPDATE',
  
  // Both
  ERROR: 'ERROR',
  DISCONNECT: 'DISCONNECT',
} as const;

export type WsMessageTypeValue = typeof WsMessageType[keyof typeof WsMessageType];

export interface WsMessage {
  type: WsMessageTypeValue;
  id: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface AuthSubmitPayload {
  address: Address;
  regionCode: RegionCode;
  signature: string;
  nonce: string;
  maxConcurrentRequests: number;
}

export interface AuthResponsePayload {
  success: boolean;
  connectionId?: string;
  error?: string;
}

export interface TaskAssignPayload {
  taskId: string;
  request: ProxyRequest;
  deadline: number;
}

export interface TaskResultPayload {
  taskId: string;
  success: boolean;
  response?: ProxyResponse;
  error?: string;
}

export interface HeartbeatResponsePayload {
  currentLoad: number;
  pendingRequests: number;
  memoryUsage: number;
  uptime: number;
}

export interface StatusUpdatePayload {
  currentLoad: number;
  pendingRequests: number;
  available: boolean;
}

// ============ External Provider Types ============

export interface ExternalProxyProvider {
  name: string;
  type: ExternalProviderConfig['type'];
  isAvailable(): Promise<boolean>;
  getRate(region: RegionCode): Promise<bigint>; // Cost per GB in wei
  fetchViaProxy(request: ProxyRequest, region: RegionCode): Promise<ProxyResponse>;
  getSupportedRegions(): Promise<RegionCode[]>;
}

// ============ SDK Types ============

export interface ProxySDKConfig {
  coordinatorUrl: string;
  rpcUrl?: string;
  paymentAddress?: Address;
  signer?: { address: Address; signMessage: (msg: string) => Promise<string> };
}

export interface FetchOptions {
  regionCode?: RegionCode;
  sessionId?: `0x${string}`;
  timeout?: number;
  headers?: Record<string, string>;
  method?: ProxyRequest['method'];
  body?: string;
}

export interface FetchResult {
  success: boolean;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  bytesTransferred: number;
  latencyMs: number;
  nodeAddress?: Address;
  sessionId: `0x${string}`;
  cost: bigint;
  error?: string;
}

// ============ API Response Types ============

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface SessionOpenResponse {
  sessionId: `0x${string}`;
  txHash: `0x${string}`;
  deposit: bigint;
  regionCode: RegionCode;
}

export interface RegionInfo {
  code: RegionCode;
  name: string;
  nodeCount: number;
  averageLatencyMs: number;
  available: boolean;
}

