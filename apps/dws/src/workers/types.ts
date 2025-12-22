/**
 * Serverless Workers Types
 * AWS Lambda / Vercel Functions compatible worker runtime
 */

import type { Address } from 'viem';

export type WorkerRuntime = 'bun' | 'node' | 'deno';
// Re-export consolidated WorkerStatus
import type { WorkerStatus } from '@jejunetwork/types';
export type { WorkerStatus };
export type InvocationType = 'sync' | 'async' | 'event';

export interface WorkerFunction {
  id: string;
  name: string;
  owner: Address;
  runtime: WorkerRuntime;
  handler: string;            // e.g., "index.handler"
  codeCid: string;            // IPFS CID of code bundle
  memory: number;             // MB (128, 256, 512, 1024, 2048)
  timeout: number;            // ms (max 900000 = 15 min)
  env: Record<string, string>;
  status: WorkerStatus;
  version: number;
  createdAt: number;
  updatedAt: number;
  lastInvokedAt?: number;
  invocationCount: number;
  avgDurationMs: number;
  errorCount: number;
}

export interface WorkerDeployment {
  functionId: string;
  version: number;
  codeCid: string;
  deployedAt: number;
  status: 'pending' | 'deployed' | 'failed';
  error?: string;
}

export interface WorkerInvocation {
  id: string;
  functionId: string;
  type: InvocationType;
  payload: unknown;
  caller: Address;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  status: 'pending' | 'running' | 'success' | 'error' | 'timeout';
  result?: unknown;
  error?: string;
  logs: string[];
  memoryUsedMb?: number;
  billedDurationMs?: number;
}

export interface WorkerEvent {
  type: 'http' | 'schedule' | 'queue' | 'storage' | 'custom';
  source: string;
  data: unknown;
  timestamp: number;
}

export interface HTTPEvent {
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: string | null;
}

export interface HTTPResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
}

export interface WorkerContext {
  functionId: string;
  invocationId: string;
  memoryLimitMb: number;
  timeoutMs: number;
  remainingTimeMs: () => number;
  env: Record<string, string>;
}

export interface WorkerLimits {
  maxMemoryMb: number;
  maxTimeoutMs: number;
  maxPayloadSize: number;      // bytes
  maxResponseSize: number;     // bytes
  maxConcurrency: number;
  maxCodeSize: number;         // bytes
}

export const DEFAULT_WORKER_LIMITS: WorkerLimits = {
  maxMemoryMb: 2048,
  maxTimeoutMs: 900000,        // 15 minutes
  maxPayloadSize: 6 * 1024 * 1024,    // 6MB
  maxResponseSize: 6 * 1024 * 1024,   // 6MB
  maxConcurrency: 1000,
  maxCodeSize: 50 * 1024 * 1024,      // 50MB
};

export interface WorkerPoolConfig {
  maxWarmInstances: number;    // Warm instances per function
  idleTimeout: number;         // Time before cold (ms)
  maxConcurrentInvocations: number;
  scaleUpThreshold: number;    // Queue depth to scale
  scaleDownDelay: number;      // Time before scale down (ms)
}

export const DEFAULT_POOL_CONFIG: WorkerPoolConfig = {
  maxWarmInstances: 10,
  idleTimeout: 300000,         // 5 minutes
  maxConcurrentInvocations: 100,
  scaleUpThreshold: 5,
  scaleDownDelay: 60000,       // 1 minute
};

export interface WorkerInstance {
  id: string;
  functionId: string;
  version: number;
  process?: unknown;           // Bun.Subprocess
  port: number;
  status: 'starting' | 'ready' | 'busy' | 'stopping' | 'stopped';
  activeInvocations: number;
  totalInvocations: number;
  startedAt: number;
  lastUsedAt: number;
  memoryUsedMb: number;
}

export interface WorkerMetrics {
  functionId: string;
  invocations: number;
  errors: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  coldStarts: number;
  warmStarts: number;
  throttles: number;
  concurrentExecutions: number;
  timestamp: number;
}

export interface DeployParams {
  name: string;
  runtime?: WorkerRuntime;
  handler?: string;
  code: Buffer | string;       // Code bundle or base64
  memory?: number;
  timeout?: number;
  env?: Record<string, string>;
}

export interface InvokeParams {
  functionId: string;
  payload?: unknown;
  type?: InvocationType;
  timeout?: number;
}

export interface InvokeResult {
  invocationId: string;
  status: 'success' | 'error' | 'timeout';
  result?: unknown;
  error?: string;
  durationMs: number;
  billedDurationMs: number;
  memoryUsedMb: number;
  logs: string[];
}

