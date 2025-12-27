/**
 * Workerd Runtime Types
 * Cloudflare Workers-compatible V8 isolate runtime
 */

import type { Address } from 'viem'
import { z } from 'zod'

// Workerd Configuration Types

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
  /** DWS exec API URL for file/process operations (workerd-compatible) */
  execUrl?: string
}

// Config injection for workerd compatibility
let workerdGlobalConfig: Partial<WorkerdConfig> | null = null

export function configureWorkerd(config: Partial<WorkerdConfig>): void {
  workerdGlobalConfig = { ...workerdGlobalConfig, ...config }
}

export function getDefaultWorkerdConfig(): WorkerdConfig {
  // Use injected config, fallback to process.env for backwards compatibility
  const binaryPath =
    workerdGlobalConfig?.binaryPath ??
    (typeof process !== 'undefined' && process.env.WORKERD_PATH
      ? process.env.WORKERD_PATH
      : '/usr/local/bin/workerd')
  const workDir =
    workerdGlobalConfig?.workDir ??
    (typeof process !== 'undefined' && process.env.WORKERD_WORK_DIR
      ? process.env.WORKERD_WORK_DIR
      : '/tmp/dws-workerd')

  return {
    binaryPath,
    workDir,
    portRange: workerdGlobalConfig?.portRange ?? { min: 30000, max: 35000 },
    maxIsolatesPerProcess: workerdGlobalConfig?.maxIsolatesPerProcess ?? 50,
    isolateMemoryMb: workerdGlobalConfig?.isolateMemoryMb ?? 128,
    requestTimeoutMs: workerdGlobalConfig?.requestTimeoutMs ?? 30000,
    cpuTimeLimitMs: workerdGlobalConfig?.cpuTimeLimitMs ?? 50,
    subrequestLimit: workerdGlobalConfig?.subrequestLimit ?? 50,
    idleTimeoutMs: workerdGlobalConfig?.idleTimeoutMs ?? 300000, // 5 minutes
    mode: workerdGlobalConfig?.mode ?? 'pool',
    execUrl: workerdGlobalConfig?.execUrl,
  }
}

export const DEFAULT_WORKERD_CONFIG: WorkerdConfig = getDefaultWorkerdConfig()

// Worker Definition Types

export type WorkerdCompatibilityDate = string // YYYY-MM-DD format

export const WorkerdModuleType = {
  ES_MODULE: 'esModule',
  COMMON_JS: 'commonJs',
  TEXT: 'text',
  DATA: 'data',
  JSON: 'json',
  WASM: 'wasm',
} as const
export type WorkerdModuleType =
  (typeof WorkerdModuleType)[keyof typeof WorkerdModuleType]

export interface WorkerdModule {
  name: string
  type: WorkerdModuleType
  content: string | Uint8Array
}

export const WorkerdBindingType = {
  TEXT: 'text',
  JSON: 'json',
  DATA: 'data',
  WASM_MODULE: 'wasmModule',
  SERVICE: 'service',
  DURABLE_OBJECT_NAMESPACE: 'durableObjectNamespace',
  KV_NAMESPACE: 'kvNamespace',
  R2_BUCKET: 'r2Bucket',
  QUEUE: 'queue',
  ANALYTICS_ENGINE: 'analyticsEngine',
} as const
export type WorkerdBindingType =
  (typeof WorkerdBindingType)[keyof typeof WorkerdBindingType]

/** Value types for different binding types */
export interface WorkerdBindingValueMap {
  text: string
  json: Record<string, unknown>
  data: Uint8Array
  wasmModule: Uint8Array
  service: undefined
  durableObjectNamespace: undefined
  kvNamespace: undefined
  r2Bucket: undefined
  queue: undefined
  analyticsEngine: undefined
}

export interface WorkerdBinding {
  name: string
  type: WorkerdBindingType
  value?: WorkerdBindingValueMap[WorkerdBindingType]
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

// Workerd Process Types

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

// Invocation Types

export const HttpMethod = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DELETE',
  HEAD: 'HEAD',
  OPTIONS: 'OPTIONS',
} as const
export type HttpMethod = (typeof HttpMethod)[keyof typeof HttpMethod]

export interface WorkerdRequest {
  method: HttpMethod | string
  url: string
  headers: Record<string, string>
  body?: string | Uint8Array
}

export interface WorkerdResponse {
  status: number
  headers: Record<string, string>
  body: string | Uint8Array
}

/** Schema for JSON-parsed WorkerdResponse (body always string from JSON) */
export const WorkerdResponseSchema = z.object({
  status: z.number(),
  headers: z.record(z.string(), z.string()),
  body: z.string(),
})

/** Schema for wrapped invocation result */
export const WorkerdInvocationResultSchema = z.object({
  response: WorkerdResponseSchema,
})

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

// Metrics Types

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

// Capnp Config Generation

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

// Events

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

// Executor Interface

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
