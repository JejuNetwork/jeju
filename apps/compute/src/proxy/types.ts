/**
 * Jeju Decentralized Proxy Network - Shared Types
 * @module @jeju/proxy/types
 */

import type { Address } from 'viem';
import { keccak256, toHex } from 'viem';

// Re-export for convenience
export type { Address };

// ============ Region Types ============

export const REGION_CODES = {
  US: 'US', GB: 'GB', DE: 'DE', FR: 'FR', JP: 'JP',
  KR: 'KR', SG: 'SG', AU: 'AU', BR: 'BR', IN: 'IN',
  CA: 'CA', NL: 'NL', SE: 'SE', CH: 'CH', HK: 'HK',
} as const;

export type RegionCode = keyof typeof REGION_CODES;

// Pre-computed region hashes for O(1) lookup
const REGION_HASHES = Object.fromEntries(
  Object.keys(REGION_CODES).map((r) => [r, keccak256(toHex(r))])
) as Record<RegionCode, `0x${string}`>;

const HASH_TO_REGION = Object.fromEntries(
  Object.entries(REGION_HASHES).map(([r, h]) => [h, r])
) as Record<string, RegionCode>;

export const hashRegion = (region: RegionCode): `0x${string}` => REGION_HASHES[region];
export const regionFromHash = (hash: `0x${string}`): RegionCode | null => HASH_TO_REGION[hash] ?? null;
export const getAllRegionCodes = (): RegionCode[] => Object.keys(REGION_CODES) as RegionCode[];

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
  currentLoad: number;
  pendingRequests: number;
  maxConcurrentRequests: number;
}

// ============ Session Types ============

export const SessionStatus = {
  PENDING: 0, ACTIVE: 1, COMPLETED: 2,
  CANCELLED: 3, EXPIRED: 4, DISPUTED: 5,
} as const;

export type SessionStatusType = (typeof SessionStatus)[keyof typeof SessionStatus];

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

// ============ Request/Response Types ============

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

export interface ProxyRequest {
  requestId: string;
  sessionId: `0x${string}`;
  url: string;
  method: HttpMethod;
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

// ============ Provider Types ============

export type DecentralizedProviderType = 'mysterium' | 'orchid' | 'sentinel';

export interface ExternalProviderConfig {
  name: string;
  type: DecentralizedProviderType;
  endpoint?: string;
  enabled: boolean;
  priority: number;
  markupBps: number;
}

export interface ExternalProxyProvider {
  readonly name: string;
  readonly type: DecentralizedProviderType;
  isAvailable(): Promise<boolean>;
  getRate(region: RegionCode): Promise<bigint>;
  fetchViaProxy(request: ProxyRequest, region: RegionCode): Promise<ProxyResponse>;
  getSupportedRegions(): Promise<RegionCode[]>;
}

// ============ Config Types ============

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

// ============ WebSocket Types ============

export const WsMessageType = {
  AUTH_REQUEST: 'AUTH_REQUEST',
  AUTH_RESPONSE: 'AUTH_RESPONSE',
  TASK_ASSIGN: 'TASK_ASSIGN',
  HEARTBEAT_REQUEST: 'HEARTBEAT_REQUEST',
  AUTH_SUBMIT: 'AUTH_SUBMIT',
  TASK_RESULT: 'TASK_RESULT',
  HEARTBEAT_RESPONSE: 'HEARTBEAT_RESPONSE',
  STATUS_UPDATE: 'STATUS_UPDATE',
  ERROR: 'ERROR',
  DISCONNECT: 'DISCONNECT',
} as const;

export type WsMessageTypeValue = (typeof WsMessageType)[keyof typeof WsMessageType];

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
  method?: HttpMethod;
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

// ============ API Types ============

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
