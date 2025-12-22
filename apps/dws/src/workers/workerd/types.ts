/**
 * Workerd Runtime Types
 * Cloudflare Workers-compatible V8 isolate runtime
 */

import type { Address } from 'viem'

// ============================================================================
// Workerd Configuration Types
// ============================================================================

export type WorkerdRuntimeMode = 'single' | 'pool' | 'distributed'

export interface WorkerdConfig {
  /** Path to workerd binary */
  binaryPath: string
  /** Directory for worker code and configs */
  workDir: string
  /** Port range for worker instances */
  portRange: { min: number; max: number }
  /** Max concurrent isolates per process */
  maxIsolatesPerProcess: number
  /** Isolate memory limit in MB */
  isolateMemoryMb: number
  /** Request timeout in ms */
  requestTimeoutMs: number
  /** Idle timeout before shutdown in ms */
  idleTimeoutMs: number
  /** Enable CPU time limits */
  cpuTimeLimitMs: number
  /** Enable subrequest limits */
  subrequestLimit: number
  /** Runtime mode */
  mode: WorkerdRuntimeMode
}

export const DEFAULT_WORKERD_CONFIG: WorkerdConfig = {
  binaryPath: process.env.WORKERD_PATH || '/usr/local/bin/workerd',
  workDir: process.env.WORKERD_WORK_DIR || '/tmp/dws-workerd',
  portRange: { min: 30000, max: 35000 },
  maxIsolatesPerProcess: 50,
  isolateMemoryMb: 128,
  requestTimeoutMs: 30000,
  cpuTimeLimitMs: 50,
  subrequestLimit: 50,
  idleTimeoutMs: 300000, // 5 minutes
  mode: 'pool',
}

// ============================================================================
// Worker Definition Types
// ============================================================================

export type WorkerdCompatibilityDate = string // YYYY-MM-DD format

export interface WorkerdModule {
  name: string
  type: 'esModule' | 'commonJs' | 'text' | 'data' | 'json' | 'wasm'
  content: string | Buffer
}

export interface WorkerdBinding {
  name: string
  type:
    | 'text'
    | 'json'
    | 'data'
    | 'wasmModule'
    | 'service'
    | 'durableObjectNamespace'
    | 'kvNamespace'
    | 'r2Bucket'
    | 'queue'
    | 'analyticsEngine'
  value?: string | object | Buffer
  service?: string
  className?: string
}

export interface WorkerdWorkerDefinition {
  id: string
  name: string
  owner: Address
  modules: WorkerdModule[]
  bindings: WorkerdBinding[]
  compatibilityDate: WorkerdCompatibilityDate
  compatibilityFlags?: string[]
  /** Main module name (must match a module in modules array) */
  mainModule: string
  /** Memory limit in MB */
  memoryMb: number
  /** CPU time limit in ms */
  cpuTimeMs: number
  /** Request timeout in ms */
  timeoutMs: number
  /** IPFS CID of the code bundle */
  codeCid: string
  /** Version number */
  version: number
  /** Deployment status */
  status: 'pending' | 'deploying' | 'active' | 'inactive' | 'error'
  /** Creation timestamp */
  createdAt: number
  /** Last update timestamp */
  updatedAt: number
  /** Error message if status is 'error' */
  error?: string
}

// ============================================================================
// Workerd Process Types
// ============================================================================

export interface WorkerdProcess {
  id: string
  pid: number
  port: number
  status: 'starting' | 'ready' | 'busy' | 'stopping' | 'stopped' | 'error'
  workers: Set<string>
  startedAt: number
  lastRequestAt: number
  requestCount: number
  errorCount: number
  process: { kill: () => void; exited: Promise<number> }
}

export interface WorkerdInstance {
  workerId: string
  processId: string
  port: number
  status: 'starting' | 'ready' | 'busy' | 'error'
  activeRequests: number
  totalRequests: number
  startedAt: number
  lastUsedAt: number
  memoryUsedMb: number
  cpuTimeMs: number
}

// ============================================================================
// Invocation Types
// ============================================================================

export interface WorkerdRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string | Buffer
}

export interface WorkerdResponse {
  status: number
  headers: Record<string, string>
  body: string | Buffer
}

export interface WorkerdInvocation {
  id: string
  workerId: string
  request: WorkerdRequest
  response?: WorkerdResponse
  startedAt: number
  completedAt?: number
  durationMs?: number
  cpuTimeMs?: number
  status: 'pending' | 'running' | 'success' | 'error' | 'timeout'
  error?: string
  logs: WorkerdLogEntry[]
}

export interface WorkerdLogEntry {
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  timestamp: number
}

// ============================================================================
// Metrics Types
// ============================================================================

export interface WorkerdMetrics {
  workerId: string
  invocations: number
  errors: number
  avgDurationMs: number
  p50DurationMs: number
  p95DurationMs: number
  p99DurationMs: number
  avgCpuTimeMs: number
  coldStarts: number
  warmStarts: number
  wallTimeMs: number
  cpuTimeMs: number
  memoryUsedMb: number
}

export interface WorkerdPoolMetrics {
  totalProcesses: number
  activeProcesses: number
  totalWorkers: number
  activeWorkers: number
  pendingRequests: number
  requestsPerSecond: number
  avgLatencyMs: number
  errorRate: number
}

// ============================================================================
// Capnp Config Generation
// ============================================================================

export interface WorkerdCapnpSocket {
  name: string
  address: string
  http?: Record<string, never>
  https?: { keypair: string }
  service: string
}

export interface WorkerdCapnpService {
  name: string
  worker: string
  disk?: { path: string; writable: boolean }
  network?: { allow: string[] }
}

export interface WorkerdCapnpWorker {
  modules: Array<{
    name: string
    esModule?: string
    commonJs?: string
    text?: string
    data?: string
    json?: string
    wasm?: string
  }>
  bindings: Array<{
    name: string
    text?: string
    json?: string
    data?: string
    wasmModule?: string
    service?: string
  }>
  compatibilityDate: string
  compatibilityFlags?: string[]
}

export interface WorkerdCapnpConfig {
  sockets: WorkerdCapnpSocket[]
  services: WorkerdCapnpService[]
  workers: Record<string, WorkerdCapnpWorker>
}

// ============================================================================
// Events
// ============================================================================

export type WorkerdEvent =
  | { type: 'worker:deployed'; workerId: string; version: number }
  | { type: 'worker:undeployed'; workerId: string }
  | { type: 'worker:error'; workerId: string; error: string }
  | { type: 'process:started'; processId: string; port: number }
  | { type: 'process:stopped'; processId: string; exitCode: number }
  | { type: 'invocation:started'; invocationId: string; workerId: string }
  | { type: 'invocation:completed'; invocationId: string; durationMs: number }
  | { type: 'invocation:error'; invocationId: string; error: string }

export type WorkerdEventHandler = (event: WorkerdEvent) => void

// ============================================================================
// Executor Interface
// ============================================================================

/**
 * Minimal interface for WorkerdExecutor that tests can mock.
 * The real WorkerdExecutor class implements this interface.
 */
export interface IWorkerdExecutor {
  initialize(): Promise<void>
  deployWorker(worker: WorkerdWorkerDefinition): Promise<void>
  undeployWorker(workerId: string): Promise<void>
  getWorker(workerId: string): Pick<WorkerdWorkerDefinition, 'status'> | null
  getInstance(
    workerId: string,
  ): (Pick<WorkerdInstance, 'status' | 'port'> & { endpoint: string }) | null
  invoke(workerId: string, request: WorkerdRequest): Promise<WorkerdResponse>
}
