/**
 * Cloud-Compute Integration - on-demand TEE provisioning with cold start
 */

import type { Address } from 'viem';
import type { RegisteredModel, ModelPricing, ModelEndpoint, ModelType, ModelDiscoveryResult, ModelDiscoveryFilter, ExtendedSDKConfig } from './types';
import { ModelTypeEnum, ModelSourceTypeEnum, ModelHostingTypeEnum, ModelCapabilityEnum, TEETypeEnum, GPUTypeEnum } from './types';
import { createInferenceRegistry, type InferenceRegistrySDK } from './inference-registry';
import { getEthPrice } from './x402';

const errMsg = (e: unknown): string => e instanceof Error ? e.message : String(e);

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, options).catch((e: Error) => {
      lastError = e;
      return null;
    });
    if (res && (res.ok || res.status < 500)) return res;
    if (attempt < maxRetries - 1) {
      const delay = Math.pow(2, attempt) * 1000;
      console.warn('[Cloud] Retrying request', { url, attempt: attempt + 1, delay });
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError ?? new Error(`Failed after ${maxRetries} retries: ${url}`);
}

export type ComputeNodeStatus = 'cold' | 'provisioning' | 'ready' | 'active' | 'idle' | 'draining' | 'terminated' | 'error';
export type ComputeHardwareType = 'cpu' | 'gpu';
export type ComputeTEEType = 'none' | 'phala' | 'sgx' | 'nitro' | 'sev';
export type ComputeGPUType = 'none' | 'H200' | 'H100' | 'A100_80' | 'A100_40' | 'RTX4090' | 'L40S';

export interface ComputeNodeConfig {
  nodeId: string;
  name: string;
  hardwareType: ComputeHardwareType;
  teeType: ComputeTEEType;
  gpuType: ComputeGPUType;
  gpuMemoryGb?: number;
  cpuCores: number;
  memoryGb: number;
  containerImage: string;
  startupCommand?: string;
  env?: Record<string, string>;
  idleTimeoutMs: number;
  coldStartTimeMs: number;
  pricePerHourWei: bigint;
  regions: string[];
}

export interface ComputeNode {
  config: ComputeNodeConfig;
  status: ComputeNodeStatus;
  endpoint?: string;
  internalEndpoint?: string;
  provisioningStartedAt?: number;
  readySince?: number;
  lastRequestAt?: number;
  activeRequests: number;
  totalRequests: number;
  error?: string;
  providerMeta?: Record<string, unknown>;
}

export interface ComputeNodeMetadata {
  nodeId: string;
  name: string;
  status: ComputeNodeStatus;
  hardwareType: ComputeHardwareType;
  teeType: ComputeTEEType;
  gpuType: ComputeGPUType;
  endpointAvailable: boolean;
  coldStartTimeMs: number;
  estimatedReadyInMs: number;
  pricePerHourWei: string;
  regions: string[];
  activeRequests: number;
  lastActivityAt?: number;
}

export interface ProvisionRequest { nodeId: string; priority?: 'low' | 'normal' | 'high'; timeout?: number }
export interface ProvisionResult { nodeId: string; status: ComputeNodeStatus; endpoint?: string; error?: string; provisionTimeMs?: number }

interface QueuedRequest {
  id: string;
  nodeId: string;
  request: unknown;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timeout: NodeJS.Timeout;
  queuedAt: number;
}

export interface ComputeManagerConfig {
  provisionerEndpoint: string;
  provisionerApiKey?: string;
  rpcUrl: string;
  defaultIdleTimeoutMs: number;
  maxQueueTimeMs: number;
  statusPollIntervalMs: number;
}

export class ComputeNodeManager {
  private nodes = new Map<string, ComputeNode>();
  private queues = new Map<string, QueuedRequest[]>();
  private pollers = new Map<string, NodeJS.Timer>();

  constructor(private config: ComputeManagerConfig) {}

  registerNode(cfg: ComputeNodeConfig): ComputeNode {
    const node: ComputeNode = { config: cfg, status: 'cold', activeRequests: 0, totalRequests: 0 };
    this.nodes.set(cfg.nodeId, node);
    this.queues.set(cfg.nodeId, []);
    console.log('[Compute] Registered', { nodeId: cfg.nodeId, name: cfg.name, hardware: cfg.hardwareType, tee: cfg.teeType, gpu: cfg.gpuType });
    return node;
  }

  getNode(id: string): ComputeNode | undefined { return this.nodes.get(id); }
  getAllNodes(): ComputeNode[] { return [...this.nodes.values()]; }

  getNodeMetadata(id: string): ComputeNodeMetadata | undefined {
    const n = this.nodes.get(id);
    if (!n) return undefined;

    let estimatedReadyInMs = 0;
    if (n.status === 'cold') estimatedReadyInMs = n.config.coldStartTimeMs;
    else if (n.status === 'provisioning' && n.provisioningStartedAt) {
      estimatedReadyInMs = Math.max(0, n.config.coldStartTimeMs - (Date.now() - n.provisioningStartedAt));
    }

    return {
      nodeId: n.config.nodeId, name: n.config.name, status: n.status,
      hardwareType: n.config.hardwareType, teeType: n.config.teeType, gpuType: n.config.gpuType,
      endpointAvailable: n.status === 'ready' || n.status === 'active',
      coldStartTimeMs: n.config.coldStartTimeMs, estimatedReadyInMs,
      pricePerHourWei: n.config.pricePerHourWei.toString(),
      regions: n.config.regions, activeRequests: n.activeRequests, lastActivityAt: n.lastRequestAt,
    };
  }

  getAllNodeMetadata(): ComputeNodeMetadata[] {
    return [...this.nodes.keys()].map(id => this.getNodeMetadata(id)).filter((m): m is ComputeNodeMetadata => !!m);
  }

  async provisionNode(req: ProvisionRequest): Promise<ProvisionResult> {
    const node = this.nodes.get(req.nodeId);
    if (!node) return { nodeId: req.nodeId, status: 'error', error: 'Node not found' };
    if (node.status === 'ready' || node.status === 'active') return { nodeId: req.nodeId, status: node.status, endpoint: node.endpoint };
    if (node.status === 'provisioning') return this.waitForReady(req.nodeId, req.timeout);

    node.status = 'provisioning';
    node.provisioningStartedAt = Date.now();
    console.log('[Compute] Provisioning', { nodeId: req.nodeId, hardware: node.config.hardwareType, tee: node.config.teeType });

    try {
      const res = await this.callProvisioner('provision', {
        nodeId: node.config.nodeId, containerImage: node.config.containerImage,
        startupCommand: node.config.startupCommand, env: node.config.env,
        hardwareType: node.config.hardwareType, teeType: node.config.teeType,
        gpuType: node.config.gpuType, gpuMemoryGb: node.config.gpuMemoryGb,
        cpuCores: node.config.cpuCores, memoryGb: node.config.memoryGb, priority: req.priority,
      });

      node.status = 'ready';
      node.endpoint = res.endpoint;
      node.internalEndpoint = res.internalEndpoint ?? res.endpoint;
      node.readySince = Date.now();
      node.providerMeta = res.providerMeta;
      const provisionTimeMs = Date.now() - node.provisioningStartedAt;

      console.log('[Compute] Ready', { nodeId: req.nodeId, endpoint: node.endpoint, provisionTimeMs });
      this.startIdleMonitor(req.nodeId);
      await this.processQueue(req.nodeId);

      return { nodeId: req.nodeId, status: 'ready', endpoint: node.endpoint, provisionTimeMs };
    } catch (e) {
      node.status = 'error';
      node.error = errMsg(e);
      console.error('[Compute] Failed', { nodeId: req.nodeId, error: node.error });
      this.rejectQueue(req.nodeId, new Error(`Provisioning failed: ${node.error}`));
      return { nodeId: req.nodeId, status: 'error', error: node.error };
    }
  }

  private async waitForReady(nodeId: string, timeout?: number): Promise<ProvisionResult> {
    const deadline = Date.now() + (timeout ?? 120000);
    while (Date.now() < deadline) {
      const n = this.nodes.get(nodeId);
      if (!n) return { nodeId, status: 'error', error: 'Node not found' };
      if (n.status === 'ready' || n.status === 'active') return { nodeId, status: n.status, endpoint: n.endpoint };
      if (n.status === 'error') return { nodeId, status: 'error', error: n.error };
      await new Promise(r => setTimeout(r, this.config.statusPollIntervalMs));
    }
    return { nodeId, status: 'error', error: 'Timeout' };
  }

  async executeRequest<T>(nodeId: string, request: unknown, exec: (endpoint: string, req: unknown) => Promise<T>): Promise<T> {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);

    if ((node.status === 'ready' || node.status === 'active') && node.endpoint) {
      node.activeRequests++;
      node.status = 'active';
      node.lastRequestAt = Date.now();
      try {
        const result = await exec(node.endpoint, request);
        node.totalRequests++;
        return result;
      } finally {
        node.activeRequests--;
        if (node.activeRequests === 0) node.status = 'ready';
      }
    }

    if (node.status === 'cold' || node.status === 'error') {
      this.provisionNode({ nodeId }).catch(e => console.error('[Compute] Background provision failed', { nodeId, error: errMsg(e) }));
    }

    return new Promise((resolve, reject) => {
      const queue = this.queues.get(nodeId);
      if (!queue) { reject(new Error(`No queue for ${nodeId}`)); return; }

      const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timer = setTimeout(() => {
        const idx = queue.findIndex(q => q.id === id);
        if (idx >= 0) { queue.splice(idx, 1); reject(new Error('Queue timeout')); }
      }, this.config.maxQueueTimeMs);

      queue.push({ id, nodeId, request, resolve: resolve as (v: unknown) => void, reject, timeout: timer, queuedAt: Date.now() });
      console.log('[Compute] Queued', { nodeId, requestId: id, queueLength: queue.length, status: node.status });
    });
  }

  private async processQueue(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId);
    const queue = this.queues.get(nodeId);
    if (!node || !queue || queue.length === 0) return;

    console.log('[Compute] Processing queue', { nodeId, queueLength: queue.length });
    while (queue.length > 0) {
      const item = queue.shift()!;
      clearTimeout(item.timeout);
      item.resolve({ endpoint: node.endpoint, request: item.request });
    }
  }

  private rejectQueue(nodeId: string, error: Error): void {
    const queue = this.queues.get(nodeId);
    if (!queue) return;
    while (queue.length > 0) {
      const item = queue.shift()!;
      clearTimeout(item.timeout);
      item.reject(error);
    }
  }

  private stopIdleMonitor(nodeId: string): void {
    const poller = this.pollers.get(nodeId);
    if (poller) {
      clearInterval(poller);
      this.pollers.delete(nodeId);
    }
  }

  private startIdleMonitor(nodeId: string): void {
    this.stopIdleMonitor(nodeId);

    const poller = setInterval(() => {
      const n = this.nodes.get(nodeId);
      if (!n || n.status === 'error' || n.status === 'cold' || n.status === 'terminated') {
        this.stopIdleMonitor(nodeId);
        return;
      }
      if ((n.status !== 'ready' && n.status !== 'idle') || n.activeRequests > 0) return;

      const idle = Date.now() - (n.lastRequestAt ?? n.readySince ?? Date.now());
      if (idle > n.config.idleTimeoutMs) {
        console.log('[Compute] Idle timeout', { nodeId, idleMs: idle });
        this.terminateNode(nodeId).catch(e => console.error('[Compute] Idle termination failed', { nodeId, error: errMsg(e) }));
      } else if (idle > n.config.idleTimeoutMs / 2) {
        n.status = 'idle';
      }
    }, this.config.statusPollIntervalMs);

    this.pollers.set(nodeId, poller);
  }

  async terminateNode(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    if (node.activeRequests > 0) {
      node.status = 'draining';
      const deadline = Date.now() + 30000;
      while (node.activeRequests > 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, 1000));
    }

    this.stopIdleMonitor(nodeId);

    await this.callProvisioner('terminate', { nodeId }).catch(e => console.error('[Compute] Provisioner terminate failed', { nodeId, error: errMsg(e) }));

    Object.assign(node, {
      status: 'cold', endpoint: undefined, internalEndpoint: undefined,
      provisioningStartedAt: undefined, readySince: undefined, lastRequestAt: undefined,
      activeRequests: 0, error: undefined, providerMeta: undefined,
    });
    console.log('[Compute] Terminated', { nodeId });
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.nodes.keys()].map(id => this.terminateNode(id)));
    console.log('[Compute] All nodes terminated');
  }

  private async callProvisioner(action: string, params: Record<string, unknown>): Promise<{ endpoint?: string; internalEndpoint?: string; providerMeta?: Record<string, unknown> }> {
    const res = await fetchWithRetry(`${this.config.provisionerEndpoint}/api/v1/compute/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.provisionerApiKey ? { Authorization: `Bearer ${this.config.provisionerApiKey}` } : {}),
      },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`Provisioner ${action} failed: ${res.status} - ${await res.text()}`);
    return res.json() as Promise<{ endpoint?: string; internalEndpoint?: string; providerMeta?: Record<string, unknown> }>;
  }
}

export interface CloudModelInfo {
  id: string;
  name: string;
  provider: string;
  modelType: 'llm' | 'image' | 'video' | 'audio' | 'embedding';
  multiModal?: boolean;
  contextWindow?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  pricePerImage?: number;
  pricePerSecond?: number;
}

export interface CloudIntegrationConfig {
  cloudEndpoint: string;
  cloudApiKey?: string;
  rpcUrl: string;
  modelRegistryAddress?: string;
  providerAddress?: Address;
  syncIntervalMs?: number;
  enableBroadcasting?: boolean;
}

export class CloudModelBroadcaster {
  private registry: InferenceRegistrySDK | null = null;
  private models = new Map<string, CloudModelInfo>();
  private lastSync = 0;
  private syncInterval: number;

  constructor(private config: CloudIntegrationConfig) {
    this.syncInterval = config.syncIntervalMs ?? 60000;
    if (config.modelRegistryAddress && config.enableBroadcasting) {
      this.registry = createInferenceRegistry({
        rpcUrl: config.rpcUrl,
        contracts: { registry: '0x0', ledger: '0x0', inference: '0x0', modelRegistry: config.modelRegistryAddress },
      });
    }
  }

  async sync(): Promise<void> {
    if (Date.now() - this.lastSync < this.syncInterval) return;

    const res = await fetchWithRetry(`${this.config.cloudEndpoint}/api/v1/models`, { headers: this.getHeaders() });
    if (!res.ok) throw new Error(`Fetch models failed: ${res.status}`);

    const data = await res.json() as { models: CloudModelInfo[] };
    this.models.clear();
    for (const m of data.models) this.models.set(m.id, m);
    this.lastSync = Date.now();

    if (this.config.enableBroadcasting && this.registry) {
      for (const m of data.models) {
        const reg = this.toRegisteredModel(m);
        if (await this.registry.getModel(reg.modelId)) continue;
        await this.registry.registerModel({
          modelId: reg.modelId, name: reg.name, description: reg.description, version: '1.0.0',
          modelType: reg.modelType, sourceType: reg.sourceType, hostingType: reg.hostingType,
          creatorName: reg.creator.name, creatorWebsite: reg.creator.website,
          capabilities: reg.capabilities, contextWindow: reg.contextWindow, pricing: reg.pricing, hardware: reg.hardware,
        });
        await this.registry.addEndpoint({
          modelId: reg.modelId, endpoint: `${this.config.cloudEndpoint}/api/v1`,
          region: 'global', teeType: TEETypeEnum.NONE, maxConcurrent: 1000,
        });
      }
    }
  }

  toRegisteredModel(m: CloudModelInfo): RegisteredModel {
    const typeMap: Record<string, ModelType> = { llm: ModelTypeEnum.LLM, image: ModelTypeEnum.IMAGE_GEN, video: ModelTypeEnum.VIDEO_GEN, audio: ModelTypeEnum.AUDIO_GEN, embedding: ModelTypeEnum.EMBEDDING };
    const websites: Record<string, string> = { openai: 'https://openai.com', anthropic: 'https://anthropic.com', google: 'https://google.com', meta: 'https://meta.com', mistral: 'https://mistral.ai' };

    let caps = 0;
    if (m.modelType === 'llm') caps |= ModelCapabilityEnum.TEXT_GENERATION | ModelCapabilityEnum.STREAMING;
    if (m.modelType === 'image') caps |= ModelCapabilityEnum.IMAGE_GENERATION;
    if (m.modelType === 'video') caps |= ModelCapabilityEnum.VIDEO_GENERATION;
    if (m.modelType === 'audio') caps |= ModelCapabilityEnum.TEXT_TO_SPEECH | ModelCapabilityEnum.AUDIO_GENERATION;
    if (m.modelType === 'embedding') caps |= ModelCapabilityEnum.EMBEDDINGS;
    if (m.multiModal) caps |= ModelCapabilityEnum.VISION | ModelCapabilityEnum.MULTIMODAL;
    if (m.contextWindow && m.contextWindow > 32000) caps |= ModelCapabilityEnum.LONG_CONTEXT;

    const weiPerUsd = BigInt(Math.floor((1 / getEthPrice()) * 1e18));
    const pricing: ModelPricing = {
      pricePerInputToken: m.inputPricePerMillion ? (weiPerUsd * BigInt(Math.floor(m.inputPricePerMillion * 1e6))) / 1_000_000n : 0n,
      pricePerOutputToken: m.outputPricePerMillion ? (weiPerUsd * BigInt(Math.floor(m.outputPricePerMillion * 1e6))) / 1_000_000n : 0n,
      pricePerImageInput: 0n,
      pricePerImageOutput: m.pricePerImage ? weiPerUsd * BigInt(Math.floor(m.pricePerImage * 1e6)) / 1_000_000n : 0n,
      pricePerVideoSecond: m.pricePerSecond ? weiPerUsd * BigInt(Math.floor(m.pricePerSecond * 1e6)) / 1_000_000n : 0n,
      pricePerAudioSecond: m.pricePerSecond ? weiPerUsd * BigInt(Math.floor(m.pricePerSecond * 1e6)) / 1_000_000n : 0n,
      minimumFee: weiPerUsd / 1000n, currency: 'ETH',
    };

    return {
      modelId: `cloud/${m.provider.toLowerCase()}/${m.id}`, name: m.name, description: `${m.name} via ${m.provider}`,
      version: '1.0.0', modelType: typeMap[m.modelType] ?? ModelTypeEnum.LLM,
      sourceType: ModelSourceTypeEnum.CLOSED_SOURCE, hostingType: ModelHostingTypeEnum.CENTRALIZED,
      creator: { name: m.provider, website: websites[m.provider.toLowerCase()] ?? 'https://jeju.network', verified: false, trustScore: 0 },
      capabilities: caps, contextWindow: m.contextWindow ?? 0, pricing,
      hardware: { minGpuVram: 0, recommendedGpuType: GPUTypeEnum.NONE, minCpuCores: 0, minMemory: 0, teeRequired: false, teeType: TEETypeEnum.NONE },
      registeredAt: Date.now(), updatedAt: Date.now(), active: true, totalRequests: 0n, avgLatencyMs: 0, uptime: 0,
    };
  }

  getHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.cloudApiKey) h['Authorization'] = `Bearer ${this.config.cloudApiKey}`;
    return h;
  }

  getModels(): CloudModelInfo[] { return [...this.models.values()]; }
  getModel(id: string): CloudModelInfo | undefined { return this.models.get(id); }
  isSynced(): boolean { return this.lastSync > 0; }
}

export class CloudProviderBridge {
  private broadcaster: CloudModelBroadcaster;

  constructor(private config: CloudIntegrationConfig) {
    this.broadcaster = new CloudModelBroadcaster(config);
  }

  async initialize(): Promise<void> { await this.broadcaster.sync(); }

  async discoverModels(filter?: ModelDiscoveryFilter): Promise<ModelDiscoveryResult[]> {
    await this.broadcaster.sync();
    const results: ModelDiscoveryResult[] = [];

    for (const m of this.broadcaster.getModels()) {
      const reg = this.broadcaster.toRegisteredModel(m);
      if (filter?.modelType !== undefined && reg.modelType !== filter.modelType) continue;
      if (filter?.capabilities && (reg.capabilities & filter.capabilities) !== filter.capabilities) continue;
      if (filter?.minContextWindow && reg.contextWindow < filter.minContextWindow) continue;

      const endpoint: ModelEndpoint = {
        modelId: reg.modelId, providerAddress: this.config.providerAddress ?? '0x0000000000000000000000000000000000000000',
        endpoint: `${this.config.cloudEndpoint}/api/v1`, region: 'global', teeType: TEETypeEnum.NONE,
        attestationHash: '', active: true, currentLoad: 0, maxConcurrent: 1000, pricing: reg.pricing,
      };
      results.push({ model: reg, endpoints: [endpoint], recommendedEndpoint: endpoint });
    }
    return results;
  }

  async inference(modelId: string, messages: Array<{ role: string; content: string }>, opts?: { temperature?: number; maxTokens?: number }): Promise<{ id: string; model: string; content: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    const res = await fetchWithRetry(`${this.config.cloudEndpoint}/api/v1/chat/completions`, {
      method: 'POST',
      headers: this.broadcaster.getHeaders(),
      body: JSON.stringify({ model: modelId, messages, temperature: opts?.temperature ?? 0.7, max_tokens: opts?.maxTokens ?? 1024 }),
    });
    if (!res.ok) throw new Error(`Inference failed: ${res.status} - ${await res.text()}`);

    const data = await res.json() as { id: string; model: string; choices: Array<{ message: { content: string } }>; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } };
    return { id: data.id, model: data.model, content: data.choices[0]?.message.content ?? '', usage: { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens, totalTokens: data.usage.total_tokens } };
  }

  async getStatus(): Promise<{ endpoint: string; modelCount: number }> {
    await this.broadcaster.sync();
    return { endpoint: this.config.cloudEndpoint, modelCount: this.broadcaster.getModels().length };
  }

  getAvailableSkills(): never[] { return []; }

  executeSkill(): never { throw new Error('Skills not supported'); }
}

export class ModelDiscovery {
  private cloudBridge: CloudProviderBridge | null = null;
  private registrySDK: InferenceRegistrySDK | null = null;
  private computeManager: ComputeNodeManager | null = null;

  constructor(config: CloudIntegrationConfig & { registryConfig?: ExtendedSDKConfig; computeConfig?: ComputeManagerConfig }) {
    if (config.cloudEndpoint) this.cloudBridge = new CloudProviderBridge(config);
    if (config.registryConfig) this.registrySDK = createInferenceRegistry(config.registryConfig);
    if (config.computeConfig) this.computeManager = new ComputeNodeManager(config.computeConfig);
  }

  async initialize(): Promise<void> { if (this.cloudBridge) await this.cloudBridge.initialize(); }

  async discoverAll(filter?: ModelDiscoveryFilter): Promise<{ cloud: ModelDiscoveryResult[]; decentralized: ModelDiscoveryResult[]; combined: ModelDiscoveryResult[] }> {
    const [cloud, decentralized] = await Promise.all([
      this.cloudBridge?.discoverModels(filter) ?? [],
      this.registrySDK?.discoverModels(filter ?? {}) ?? [],
    ]);

    const seen = new Set<string>();
    const combined = [...cloud, ...decentralized].filter(r => { if (seen.has(r.model.modelId)) return false; seen.add(r.model.modelId); return true; });

    return { cloud, decentralized, combined };
  }

  getCloudBridge(): CloudProviderBridge | null { return this.cloudBridge; }
  getRegistrySDK(): InferenceRegistrySDK | null { return this.registrySDK; }
  getComputeManager(): ComputeNodeManager | null { return this.computeManager; }
}

export const createComputeNodeManager = (c: ComputeManagerConfig) => new ComputeNodeManager(c);
export const createCloudBroadcaster = (c: CloudIntegrationConfig) => new CloudModelBroadcaster(c);
export const createCloudBridge = (c: CloudIntegrationConfig) => new CloudProviderBridge(c);
export const createModelDiscovery = (c: CloudIntegrationConfig & { registryConfig?: ExtendedSDKConfig; computeConfig?: ComputeManagerConfig }) => new ModelDiscovery(c);

export function createFromEnv(): ModelDiscovery {
  const config: CloudIntegrationConfig & { registryConfig?: ExtendedSDKConfig; computeConfig?: ComputeManagerConfig } = {
    cloudEndpoint: process.env.CLOUD_ENDPOINT ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:8010',
    cloudApiKey: process.env.CLOUD_API_KEY,
    rpcUrl: process.env.RPC_URL ?? process.env.JEJU_RPC_URL ?? 'http://localhost:9545',
    modelRegistryAddress: process.env.MODEL_REGISTRY_ADDRESS,
    providerAddress: process.env.CLOUD_PROVIDER_ADDRESS as Address | undefined,
    syncIntervalMs: parseInt(process.env.CLOUD_SYNC_INTERVAL ?? '60000', 10),
    enableBroadcasting: process.env.ENABLE_CLOUD_BROADCASTING === 'true',
  };

  if (process.env.MODEL_REGISTRY_ADDRESS) {
    config.registryConfig = {
      rpcUrl: config.rpcUrl,
      contracts: { registry: process.env.COMPUTE_REGISTRY_ADDRESS ?? '0x0', ledger: process.env.LEDGER_ADDRESS ?? '0x0', inference: process.env.INFERENCE_ADDRESS ?? '0x0', modelRegistry: process.env.MODEL_REGISTRY_ADDRESS },
    };
  }

  if (process.env.PROVISIONER_ENDPOINT) {
    config.computeConfig = {
      provisionerEndpoint: process.env.PROVISIONER_ENDPOINT, provisionerApiKey: process.env.PROVISIONER_API_KEY, rpcUrl: config.rpcUrl,
      defaultIdleTimeoutMs: parseInt(process.env.COMPUTE_IDLE_TIMEOUT_MS ?? '300000', 10),
      maxQueueTimeMs: parseInt(process.env.COMPUTE_MAX_QUEUE_MS ?? '120000', 10),
      statusPollIntervalMs: parseInt(process.env.COMPUTE_POLL_INTERVAL_MS ?? '5000', 10),
    };
  }

  return new ModelDiscovery(config);
}
