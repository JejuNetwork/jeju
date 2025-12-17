/**
 * Load Balancer Types
 * Scale-to-zero architecture like Vast.ai/Akash
 */

import type { Address } from 'viem';

export type InstanceStatus = 'starting' | 'running' | 'draining' | 'stopped' | 'error';
export type ScalingAction = 'scale_up' | 'scale_down' | 'none';

export interface LoadBalancerConfig {
  minInstances: number;          // 0 for scale-to-zero
  maxInstances: number;
  targetConcurrency: number;     // Target requests per instance
  scaleUpThreshold: number;      // Queue depth to trigger scale-up
  scaleDownThreshold: number;    // Idle time (ms) before scale-down
  scaleUpCooldown: number;       // Min ms between scale-up events
  scaleDownCooldown: number;     // Min ms between scale-down events
  connectionDrainTimeout: number;// Graceful shutdown timeout (ms)
  healthCheckInterval: number;   // Health check interval (ms)
  requestTimeout: number;        // Request timeout (ms)
  keepAliveTimeout: number;      // Keep-alive timeout (ms)
  maxQueueSize: number;          // Max pending requests
}

export const DEFAULT_LB_CONFIG: LoadBalancerConfig = {
  minInstances: 0,               // Scale to zero
  maxInstances: 100,
  targetConcurrency: 10,
  scaleUpThreshold: 5,           // Scale up when queue > 5
  scaleDownThreshold: 60000,     // Scale down after 60s idle
  scaleUpCooldown: 5000,         // 5s between scale-ups
  scaleDownCooldown: 30000,      // 30s between scale-downs
  connectionDrainTimeout: 30000, // 30s drain timeout
  healthCheckInterval: 10000,    // 10s health checks
  requestTimeout: 30000,         // 30s request timeout
  keepAliveTimeout: 5000,        // 5s keep-alive
  maxQueueSize: 1000,
};

export interface Instance {
  id: string;
  serviceId: string;
  endpoint: string;
  status: InstanceStatus;
  region: string;
  operator: Address;
  currentConnections: number;
  totalRequests: number;
  avgLatencyMs: number;
  lastHealthCheck: number;
  startedAt: number;
  lastActivityAt: number;
  metadata: Record<string, string>;
}

export interface ServiceDefinition {
  id: string;
  name: string;
  type: 'worker' | 'api' | 'proxy' | 'scraper' | 'rpc' | 'vpn';
  image?: string;               // Container image
  entrypoint?: string;          // Worker entrypoint
  env: Record<string, string>;
  ports: number[];
  resources: ResourceRequirements;
  healthCheck: HealthCheckConfig;
  scaling: ScalingConfig;
  network?: NetworkConfig;
}

export interface ResourceRequirements {
  cpuCores: number;
  memoryMb: number;
  diskGb?: number;
  gpuType?: 'none' | 'nvidia-t4' | 'nvidia-a10' | 'nvidia-a100';
  gpuCount?: number;
  bandwidthMbps?: number;
}

export interface HealthCheckConfig {
  path: string;
  port: number;
  interval: number;
  timeout: number;
  healthyThreshold: number;
  unhealthyThreshold: number;
}

export interface ScalingConfig {
  minInstances: number;
  maxInstances: number;
  targetConcurrency: number;
  scaleUpThreshold: number;
  scaleDownDelay: number;
}

export interface NetworkConfig {
  ingressPorts?: number[];
  egressRules?: string[];
  enableIPv6?: boolean;
}

export interface QueuedRequest {
  id: string;
  serviceId: string;
  request: Request;
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  queuedAt: number;
  deadline: number;
}

export interface LoadBalancerStats {
  activeInstances: number;
  totalInstances: number;
  queuedRequests: number;
  totalRequestsServed: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  requestsPerSecond: number;
  scalingEvents: ScalingEvent[];
}

export interface ScalingEvent {
  action: ScalingAction;
  serviceId: string;
  fromCount: number;
  toCount: number;
  reason: string;
  timestamp: number;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;      // Failures before opening
  resetTimeout: number;          // Time before half-open (ms)
  halfOpenRequests: number;      // Requests to allow in half-open
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  lastFailure: number;
  halfOpenAttempts: number;
}

export interface ConnectionPoolConfig {
  maxConnections: number;
  minConnections: number;
  acquireTimeout: number;
  idleTimeout: number;
  maxRetries: number;
}

export interface PooledConnection {
  id: string;
  instanceId: string;
  createdAt: number;
  lastUsedAt: number;
  inUse: boolean;
}

