/**
 * Container Execution Types
 * Types for decentralized serverless container execution
 */

import type { Address } from 'viem';
import type { JSONValue } from '../shared/validation';

// ============================================================================
// Container Image Types
// ============================================================================

export interface ContainerImage {
  repoId: string;
  namespace: string;
  name: string;
  tag: string;
  digest: string;
  manifestCid: string;
  layerCids: string[];
  size: number;
  architectures: string[];
  publishedAt: number;
}

export interface ImagePullResult {
  image: ContainerImage;
  cachedLayers: number;
  downloadedLayers: number;
  pullTimeMs: number;
}

// ============================================================================
// Container Instance Types
// ============================================================================

export type ContainerState =
  | 'creating'
  | 'pulling'
  | 'starting'
  | 'running'
  | 'warm'
  | 'cooling'
  | 'stopped'
  | 'failed';

export interface ContainerResources {
  cpuCores: number;
  memoryMb: number;
  storageMb: number;
  networkBandwidthMbps?: number;
  gpuType?: string;
  gpuCount?: number;
}

export interface ContainerInstance {
  instanceId: string;
  imageDigest: string;
  repoId: string;
  state: ContainerState;
  resources: ContainerResources;
  createdAt: number;
  startedAt: number | null;
  lastActivityAt: number;
  warmUntil: number | null;
  requestsHandled: number;
  owner: Address;
  nodeId: string;
  endpoint?: string;
  port?: number;
}

// ============================================================================
// Execution Types
// ============================================================================

export type ExecutionMode = 'serverless' | 'dedicated' | 'spot';

export interface ExecutionRequest {
  imageRef: string; // namespace/name:tag or @sha256:digest
  command?: string[];
  env?: Record<string, string>;
  resources: ContainerResources;
  mode: ExecutionMode;
  timeout: number;
  /** Input data to pass to the container (JSON-serializable) */
  input?: JSONValue;
  webhook?: string;
  warmthConfig?: WarmthConfig;
}

export interface ExecutionResult {
  executionId: string;
  instanceId: string;
  status: 'success' | 'failed' | 'timeout' | 'cancelled';
  /** Output data from the container (JSON-serializable or null) */
  output: JSONValue | null;
  logs?: string;
  exitCode: number | null;
  metrics: ExecutionMetrics;
}

export interface ExecutionMetrics {
  queueTimeMs: number;
  pullTimeMs: number;
  coldStartMs: number;
  executionTimeMs: number;
  totalTimeMs: number;
  cpuUsagePercent: number;
  memoryUsedMb: number;
  networkInBytes: number;
  networkOutBytes: number;
  wasColdStart: boolean;
}

// ============================================================================
// Warmth Management Types
// ============================================================================

export interface WarmthConfig {
  keepWarmMs: number;        // How long to keep container warm after request
  minWarmInstances: number;  // Minimum warm instances to maintain
  maxWarmInstances: number;  // Maximum warm instances
  scaleUpThreshold: number;  // Request queue length to trigger scale up
  scaleDownThreshold: number; // Idle time before scale down
  preWarmSchedule?: string;  // Cron schedule for pre-warming
}

export const DEFAULT_WARMTH_CONFIG: WarmthConfig = {
  keepWarmMs: 60000,         // 1 minute
  minWarmInstances: 0,
  maxWarmInstances: 10,
  scaleUpThreshold: 5,
  scaleDownThreshold: 300000, // 5 minutes
};

export interface WarmPoolStats {
  imageDigest: string;
  warmCount: number;
  coolingCount: number;
  totalRequests: number;
  avgColdStartMs: number;
  avgWarmStartMs: number;
  hitRate: number;
}

// ============================================================================
// Node Types
// ============================================================================

export interface ComputeNode {
  nodeId: string;
  address: Address;
  endpoint: string;
  region: string;
  zone: string;
  resources: {
    totalCpu: number;
    totalMemoryMb: number;
    totalStorageMb: number;
    availableCpu: number;
    availableMemoryMb: number;
    availableStorageMb: number;
    gpuTypes: string[];
  };
  capabilities: string[];
  containers: Map<string, ContainerInstance>;
  cachedImages: Set<string>;
  lastHeartbeat: number;
  status: 'online' | 'draining' | 'offline';
  reputation: number;
}

// ============================================================================
// Pricing Types
// ============================================================================

export interface ComputePricing {
  basePerSecond: bigint;      // Base price per second
  cpuPerCoreSecond: bigint;   // Price per CPU core per second
  memoryPerMbSecond: bigint;  // Price per MB RAM per second
  storagePerMbSecond: bigint; // Price per MB storage per second
  gpuPerSecond: bigint;       // Price per GPU per second
  networkPerMb: bigint;       // Price per MB network transfer
  coldStartPenalty: bigint;   // Extra cost for cold starts
}

export const DEFAULT_PRICING: ComputePricing = {
  basePerSecond: 1000000000n,        // 0.000000001 ETH
  cpuPerCoreSecond: 500000000n,      // 0.0000000005 ETH per core
  memoryPerMbSecond: 100000000n,     // 0.0000000001 ETH per MB
  storagePerMbSecond: 10000000n,     // 0.00000000001 ETH per MB
  gpuPerSecond: 10000000000n,        // 0.00000001 ETH per GPU
  networkPerMb: 1000000000n,         // 0.000000001 ETH per MB
  coldStartPenalty: 5000000000n,     // 0.000000005 ETH
};

// ============================================================================
// Cache Types
// ============================================================================

export interface LayerCache {
  digest: string;
  cid: string;
  size: number;
  localPath: string;
  cachedAt: number;
  lastAccessedAt: number;
  hitCount: number;
}

export interface ImageCache {
  digest: string;
  repoId: string;
  cachedAt: number;
  lastAccessedAt: number;
  hitCount: number;
  layers: LayerCache[];
  totalSize: number;
}

// ============================================================================
// Event Types
// ============================================================================

export type ContainerEvent =
  | { type: 'instance_created'; instanceId: string; imageDigest: string }
  | { type: 'instance_started'; instanceId: string; coldStartMs: number }
  | { type: 'instance_warmed'; instanceId: string; warmUntil: number }
  | { type: 'instance_cooling'; instanceId: string }
  | { type: 'instance_stopped'; instanceId: string; reason: string }
  | { type: 'execution_started'; executionId: string; instanceId: string }
  | { type: 'execution_completed'; executionId: string; metrics: ExecutionMetrics }
  | { type: 'scale_up'; imageDigest: string; newCount: number }
  | { type: 'scale_down'; imageDigest: string; newCount: number };

export type ContainerEventHandler = (event: ContainerEvent) => void;



