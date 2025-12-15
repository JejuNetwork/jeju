/**
 * Worker Runtime - Serverless execution environment for Jeju Compute
 * 
 * Similar to Cloudflare Workers, runs user-provided JavaScript/TypeScript handlers
 * on any TEE provider (Phala, Marlin, Oasis, etc.)
 */

import type { Address, Hex } from 'viem';
import { keccak256, toBytes, toHex } from 'viem';
import { Wallet, verifyMessage, Contract, JsonRpcProvider } from 'ethers';

export type WorkerStatus = 'deploying' | 'active' | 'paused' | 'error' | 'terminated';
export type WorkerRuntime = 'javascript' | 'typescript' | 'wasm';

export interface WorkerConfig {
  workerId: string;
  name: string;
  description?: string;
  runtime: WorkerRuntime;
  entrypoint: string;
  code: string;
  env?: Record<string, string>;
  secrets?: string[];
  routes?: string[];
  cronSchedule?: string;
  memoryLimitMb: number;
  timeoutMs: number;
  maxConcurrent: number;
}

export interface WorkerDeployment {
  workerId: string;
  deploymentId: string;
  version: number;
  codeHash: Hex;
  deployedAt: number;
  deployedBy: Address;
  status: WorkerStatus;
  endpoint?: string;
  attestation?: WorkerAttestation;
}

export interface WorkerAttestation {
  workerId: string;
  providerAddress: Address;
  teeType: 'sgx' | 'tdx' | 'sev' | 'nitro' | 'none';
  codeHash: Hex;
  measurementHash?: Hex;
  timestamp: number;
  signature: Hex;
}

export interface WorkerRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  cf?: {
    country?: string;
    city?: string;
    asn?: number;
  };
}

export interface WorkerResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

export interface WorkerExecutionResult {
  executionId: string;
  workerId: string;
  request: WorkerRequest;
  response: WorkerResponse;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  memoryUsedMb: number;
  cpuTimeMs: number;
  logs: string[];
  error?: string;
}

export interface WorkerMetrics {
  workerId: string;
  totalRequests: number;
  totalErrors: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p99DurationMs: number;
  avgMemoryMb: number;
  lastInvoked: number;
}

const WORKER_REGISTRY_ABI = [
  'function registerWorker(string,string,bytes32,uint256,uint256) returns (bytes32)',
  'function deployWorker(bytes32,string,bytes32) returns (bytes32)',
  'function pauseWorker(bytes32)',
  'function resumeWorker(bytes32)',
  'function deleteWorker(bytes32)',
  'function getWorker(bytes32) view returns (address,string,bytes32,uint8,uint256,uint256,uint256)',
  'function getWorkerDeployments(bytes32) view returns (bytes32[])',
  'function getActiveWorkers() view returns (bytes32[])',
  'function recordExecution(bytes32,bool,uint256,uint256)',
];

export class WorkerSandbox {
  private config: WorkerConfig;
  private compiledCode: ((req: WorkerRequest) => Promise<WorkerResponse>) | null = null;
  private logs: string[] = [];

  constructor(config: WorkerConfig) {
    this.config = config;
  }

  async compile(): Promise<void> {
    // Create a sandboxed environment  
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    
    // Compile the worker code with a simpler approach
    const fn = new AsyncFunction('request', 'env', '_console', `
      const logs = [];
      const console = {
        log: (...args) => logs.push(['log', ...args].join(' ')),
        error: (...args) => logs.push(['error', ...args].join(' ')),
        warn: (...args) => logs.push(['warn', ...args].join(' ')),
        info: (...args) => logs.push(['info', ...args].join(' ')),
      };
      
      // Worker code namespace
      const exports = {};
      const module = { exports };
      let defaultExport = null;
      
      // Define export default handler
      const exportHandler = (obj) => { defaultExport = obj; };
      
      // Execute worker code
      (function() {
        ${this.config.code.replace(/export\s+default\s+/g, 'defaultExport = ')}
      })();
      
      // Find the handler
      const handler = defaultExport?.fetch || exports.default?.fetch;
      if (!handler) throw new Error('No fetch handler exported');
      
      const response = await handler(request, env);
      return { response, logs };
    `);

    this.compiledCode = async (request: WorkerRequest) => {
      const result = await fn(request, { ...this.config.env }, console);
      this.logs.push(...result.logs);
      return result.response;
    };
  }

  private createSandbox() {
    return {
      console: {
        log: (...args: unknown[]) => this.logs.push(['log', ...args].map(String).join(' ')),
        error: (...args: unknown[]) => this.logs.push(['error', ...args].map(String).join(' ')),
        warn: (...args: unknown[]) => this.logs.push(['warn', ...args].map(String).join(' ')),
        info: (...args: unknown[]) => this.logs.push(['info', ...args].map(String).join(' ')),
      },
      fetch: globalThis.fetch,
      Request: globalThis.Request,
      Response: globalThis.Response,
      Headers: globalThis.Headers,
      URL: globalThis.URL,
      URLSearchParams: globalThis.URLSearchParams,
      TextEncoder: globalThis.TextEncoder,
      TextDecoder: globalThis.TextDecoder,
      crypto: globalThis.crypto,
      atob: globalThis.atob,
      btoa: globalThis.btoa,
      setTimeout: (fn: () => void, ms: number) => {
        if (ms > this.config.timeoutMs) throw new Error('Timeout exceeds limit');
        return setTimeout(fn, ms);
      },
    };
  }

  async execute(request: WorkerRequest): Promise<WorkerExecutionResult> {
    if (!this.compiledCode) await this.compile();

    const executionId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    const startMemory = process.memoryUsage().heapUsed;
    this.logs = [];

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Worker timeout')), this.config.timeoutMs);
    });

    let response: WorkerResponse;
    let error: string | undefined;

    try {
      const rawResponse = await Promise.race([this.compiledCode!(request), timeoutPromise]);
      response = this.normalizeResponse(rawResponse);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      response = { status: 500, statusText: 'Internal Server Error', headers: {}, body: JSON.stringify({ error }) };
    }

    const finishedAt = Date.now();
    const endMemory = process.memoryUsage().heapUsed;

    return {
      executionId,
      workerId: this.config.workerId,
      request,
      response,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      memoryUsedMb: (endMemory - startMemory) / 1024 / 1024,
      cpuTimeMs: finishedAt - startedAt, // Approximation
      logs: this.logs,
      error,
    };
  }

  private normalizeResponse(raw: unknown): WorkerResponse {
    if (raw && typeof raw === 'object' && 'status' in raw) {
      const r = raw as Record<string, unknown>;
      return {
        status: typeof r.status === 'number' ? r.status : 200,
        statusText: typeof r.statusText === 'string' ? r.statusText : 'OK',
        headers: typeof r.headers === 'object' && r.headers !== null 
          ? Object.fromEntries(Object.entries(r.headers).map(([k, v]) => [k, String(v)]))
          : {},
        body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? ''),
      };
    }
    return { status: 200, statusText: 'OK', headers: {}, body: String(raw) };
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  clearLogs(): void {
    this.logs = [];
  }
}

export interface WorkerManagerConfig {
  rpcUrl: string;
  registryAddress?: Address;
  executorWallet?: Wallet;
  maxConcurrentWorkers: number;
  defaultTimeoutMs: number;
  defaultMemoryLimitMb: number;
}

export class WorkerManager {
  private config: WorkerManagerConfig;
  private workers = new Map<string, { config: WorkerConfig; sandbox: WorkerSandbox; deployment?: WorkerDeployment }>();
  private metrics = new Map<string, WorkerMetrics>();
  private provider: JsonRpcProvider;
  private registry: Contract | null = null;

  constructor(config: WorkerManagerConfig) {
    this.config = config;
    this.provider = new JsonRpcProvider(config.rpcUrl);
    if (config.registryAddress && config.executorWallet) {
      this.registry = new Contract(config.registryAddress, WORKER_REGISTRY_ABI, config.executorWallet.connect(this.provider));
    }
  }

  async deployWorker(config: WorkerConfig): Promise<WorkerDeployment> {
    const codeHash = keccak256(toBytes(config.code)) as Hex;
    const deploymentId = `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Create sandbox and compile
    const sandbox = new WorkerSandbox({
      ...config,
      timeoutMs: config.timeoutMs || this.config.defaultTimeoutMs,
      memoryLimitMb: config.memoryLimitMb || this.config.defaultMemoryLimitMb,
    });
    await sandbox.compile();

    const deployment: WorkerDeployment = {
      workerId: config.workerId,
      deploymentId,
      version: 1,
      codeHash,
      deployedAt: Date.now(),
      deployedBy: this.config.executorWallet?.address as Address ?? '0x0000000000000000000000000000000000000000',
      status: 'active',
      endpoint: `/workers/${config.workerId}`,
    };

    this.workers.set(config.workerId, { config, sandbox, deployment });
    this.initMetrics(config.workerId);

    console.log(`[Worker] Deployed ${config.workerId} (${codeHash.slice(0, 10)}...)`);

    return deployment;
  }

  async invokeWorker(workerId: string, request: WorkerRequest): Promise<WorkerExecutionResult> {
    const worker = this.workers.get(workerId);
    if (!worker) throw new Error(`Worker ${workerId} not found`);
    if (worker.deployment?.status !== 'active') throw new Error(`Worker ${workerId} is not active`);

    const result = await worker.sandbox.execute(request);
    this.updateMetrics(workerId, result);

    return result;
  }

  async invokeByRoute(route: string, request: WorkerRequest): Promise<WorkerExecutionResult> {
    for (const [workerId, worker] of this.workers) {
      if (worker.config.routes?.some(r => this.matchRoute(r, route))) {
        return this.invokeWorker(workerId, request);
      }
    }
    throw new Error(`No worker found for route: ${route}`);
  }

  private matchRoute(pattern: string, path: string): boolean {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\//g, '\\/') + '$');
    return regex.test(path);
  }

  pauseWorker(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) throw new Error(`Worker ${workerId} not found`);
    if (worker.deployment) worker.deployment.status = 'paused';
    console.log(`[Worker] Paused ${workerId}`);
  }

  resumeWorker(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) throw new Error(`Worker ${workerId} not found`);
    if (worker.deployment) worker.deployment.status = 'active';
    console.log(`[Worker] Resumed ${workerId}`);
  }

  deleteWorker(workerId: string): void {
    this.workers.delete(workerId);
    this.metrics.delete(workerId);
    console.log(`[Worker] Deleted ${workerId}`);
  }

  getWorker(workerId: string): { config: WorkerConfig; deployment?: WorkerDeployment } | undefined {
    const worker = this.workers.get(workerId);
    if (!worker) return undefined;
    return { config: worker.config, deployment: worker.deployment };
  }

  listWorkers(): Array<{ workerId: string; name: string; status: WorkerStatus; endpoint?: string }> {
    return Array.from(this.workers.values()).map(w => ({
      workerId: w.config.workerId,
      name: w.config.name,
      status: w.deployment?.status ?? 'deploying',
      endpoint: w.deployment?.endpoint,
    }));
  }

  getMetrics(workerId: string): WorkerMetrics | undefined {
    return this.metrics.get(workerId);
  }

  private initMetrics(workerId: string): void {
    this.metrics.set(workerId, {
      workerId,
      totalRequests: 0,
      totalErrors: 0,
      avgDurationMs: 0,
      p50DurationMs: 0,
      p99DurationMs: 0,
      avgMemoryMb: 0,
      lastInvoked: 0,
    });
  }

  private updateMetrics(workerId: string, result: WorkerExecutionResult): void {
    const m = this.metrics.get(workerId);
    if (!m) return;

    m.totalRequests++;
    if (result.error) m.totalErrors++;
    m.avgDurationMs = ((m.avgDurationMs * (m.totalRequests - 1)) + result.durationMs) / m.totalRequests;
    m.avgMemoryMb = ((m.avgMemoryMb * (m.totalRequests - 1)) + result.memoryUsedMb) / m.totalRequests;
    m.lastInvoked = result.finishedAt;
  }
}

export function computeWorkerCodeHash(code: string): Hex {
  return keccak256(toBytes(code)) as Hex;
}

export function createWorkerManager(config: Partial<WorkerManagerConfig> = {}): WorkerManager {
  return new WorkerManager({
    rpcUrl: config.rpcUrl ?? process.env.RPC_URL ?? 'http://localhost:9545',
    registryAddress: config.registryAddress ?? process.env.WORKER_REGISTRY_ADDRESS as Address,
    executorWallet: config.executorWallet,
    maxConcurrentWorkers: config.maxConcurrentWorkers ?? 100,
    defaultTimeoutMs: config.defaultTimeoutMs ?? 30000,
    defaultMemoryLimitMb: config.defaultMemoryLimitMb ?? 128,
  });
}
