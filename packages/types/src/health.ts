/**
 * Jeju Network Standard Health Check API
 * 
 * All decentralized apps should implement this standard health check API
 * to enable automatic monitoring and recovery via the KeepaliveRegistry.
 * 
 * Endpoints:
 * - GET /health - Basic health check
 * - GET /health/ready - Readiness check (dependencies available)
 * - GET /health/live - Liveness check (app is running)
 * - GET /health/resources - Resource-level health details
 */

import type { Address } from 'viem';

// ============ Health Status ============

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unfunded' | 'unknown';

// ============ Basic Health Response ============

/**
 * Response from GET /health
 */
export interface HealthResponse {
  status: HealthStatus;
  service: string;
  version: string;
  timestamp: string;
  uptime: number;
}

// ============ Readiness Check ============

/**
 * Response from GET /health/ready
 */
export interface ReadinessResponse {
  ready: boolean;
  status: HealthStatus;
  dependencies: DependencyHealth[];
}

export interface DependencyHealth {
  name: string;
  type: 'database' | 'cache' | 'api' | 'blockchain' | 'ipfs' | 'storage' | 'compute' | 'trigger';
  status: HealthStatus;
  latencyMs?: number;
  error?: string;
}

// ============ Liveness Check ============

/**
 * Response from GET /health/live
 */
export interface LivenessResponse {
  alive: boolean;
  pid?: number;
  memoryUsage?: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
  };
}

// ============ Resource Health ============

/**
 * Response from GET /health/resources
 */
export interface ResourceHealthResponse {
  status: HealthStatus;
  resources: ResourceHealth[];
  funding: FundingStatus;
}

export type HealthResourceType = 
  | 'ipfs_content'
  | 'compute_endpoint'
  | 'trigger'
  | 'storage'
  | 'agent'
  | 'custom';

export interface ResourceHealth {
  type: HealthResourceType;
  identifier: string;
  status: HealthStatus;
  required: boolean;
  lastCheck: string;
  latencyMs?: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface FundingStatus {
  funded: boolean;
  balance: string;
  minRequired: string;
  vaultAddress: Address;
  autoFundEnabled: boolean;
  estimatedRuntime?: number;
}

// ============ Keepalive Types ============

export interface KeepaliveConfig {
  keepaliveId: string;
  jnsName?: string;
  agentId?: bigint;
  vaultAddress: Address;
  minBalance: bigint;
  checkInterval: number;
  autoFundAmount: bigint;
  autoFundEnabled: boolean;
  resources: KeepaliveResource[];
  dependencies: string[];
}

export interface KeepaliveResource {
  type: HealthResourceType;
  identifier: string;
  healthEndpoint: string;
  minBalance: bigint;
  required: boolean;
}

export interface KeepaliveStatus {
  keepaliveId: string;
  status: HealthStatus;
  funded: boolean;
  balance: bigint;
  lastCheck: number;
  healthyResources: number;
  totalResources: number;
  failedResources: string[];
}

// ============ Health Check Executor ============

export interface KeepaliveHealthCheckRequest {
  keepaliveId: string;
  resources: KeepaliveResource[];
  timeout: number;
}

export interface KeepaliveHealthCheckResult {
  keepaliveId: string;
  status: HealthStatus;
  timestamp: number;
  balance: bigint;
  healthyResources: number;
  totalResources: number;
  failedResources: string[];
  resourceResults: ResourceCheckResult[];
}

export interface ResourceCheckResult {
  type: HealthResourceType;
  identifier: string;
  status: HealthStatus;
  latencyMs: number;
  error?: string;
  response?: HealthResponse | ResourceHealthResponse;
}

// ============ Wake Page Data ============

export interface WakePageData {
  jnsName: string;
  appName: string;
  description: string;
  owner: Address;
  vaultAddress: Address;
  currentBalance: bigint;
  minRequired: bigint;
  fundingNeeded: bigint;
  lastHealthy: number;
  agentId?: bigint;
  avatar?: string;
}

// ============ ENS Mirror Types ============

export interface ENSMirrorConfig {
  ensName: string;
  jnsName: string;
  syncInterval: number;
  enabled: boolean;
}

export interface ENSMirrorStatus {
  ensName: string;
  jnsName: string;
  lastSync: number;
  synced: boolean;
  ensContenthash?: string;
  jnsContenthash?: string;
  error?: string;
}

// ============ Helper Functions ============

/**
 * Check if health response indicates healthy status
 */
export function isHealthy(response: HealthResponse | ResourceHealthResponse): boolean {
  return response.status === 'healthy';
}

/**
 * Check if health response indicates funded status
 */
export function isFunded(status: HealthStatus): boolean {
  return status !== 'unfunded';
}

/**
 * Calculate overall status from resource statuses
 */
export function aggregateStatus(resources: ResourceHealth[]): HealthStatus {
  if (resources.length === 0) return 'unknown';

  const required = resources.filter(r => r.required);
  const requiredUnhealthy = required.filter(r => r.status === 'unhealthy' || r.status === 'unfunded');

  if (requiredUnhealthy.some(r => r.status === 'unfunded')) return 'unfunded';
  if (requiredUnhealthy.length > 0) return 'unhealthy';

  const anyDegraded = resources.some(r => r.status === 'degraded');
  if (anyDegraded) return 'degraded';

  return 'healthy';
}

/**
 * Format balance for display
 */
export function formatBalance(wei: bigint, decimals: number = 18): string {
  const divisor = BigInt(10 ** decimals);
  const whole = wei / divisor;
  const remainder = wei % divisor;
  const fraction = remainder.toString().padStart(decimals, '0').slice(0, 4);
  return `${whole}.${fraction}`;
}

