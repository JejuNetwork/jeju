/**
 * Cloud-Compute Integration
 *
 * Bridges the cloud platform with the decentralized compute marketplace.
 * Enables:
 * - Dynamic model broadcasting from cloud to on-chain registry
 * - Inference routing through cloud and decentralized providers
 * - A2A and MCP endpoint discovery for cloud services
 * - ERC-8004 integration for agent/service discovery
 *
 * Cloud serves as a provider in the compute marketplace, exposing:
 * - LLM models (OpenAI, Anthropic, local)
 * - Image generation (FLUX, Stable Diffusion)
 * - Video generation (Luma, Runway)
 * - Audio/speech services
 */

import type { Address } from 'viem';
import type {
  RegisteredModel,
  ModelPricing,
  ModelEndpoint,
  ModelType,
  ModelDiscoveryResult,
  ModelDiscoveryFilter,
} from './types';
import {
  ModelTypeEnum,
  ModelSourceTypeEnum,
  ModelHostingTypeEnum,
  ModelCapabilityEnum,
  TEETypeEnum,
  GPUTypeEnum,
} from './types';
import { createInferenceRegistry, type InferenceRegistrySDK } from './inference-registry';
import type { ExtendedSDKConfig } from './types';

// ============================================================================
// Types
// ============================================================================

/** Cloud model from the cloud platform */
export interface CloudModelInfo {
  id: string;
  name: string;
  provider: string;           // OpenAI, Anthropic, etc.
  providerId: string;         // Internal provider ID
  modelType: 'llm' | 'image' | 'video' | 'audio' | 'embedding';
  multiModal?: boolean;
  contextWindow?: number;
  maxResolution?: string;
  maxDuration?: number;
  inputPricePerMillion?: number;   // USD
  outputPricePerMillion?: number;  // USD
  pricePerImage?: number;          // USD
  pricePerSecond?: number;         // USD
  capabilities?: string[];
}

/** Cloud A2A skill */
export interface CloudA2ASkill {
  id: string;
  description: string;
  handler?: string;
}

/** Cloud provider status */
export interface CloudProviderStatus {
  available: boolean;
  modelCount: number;
  skillCount: number;
  lastSync: number;
  endpoint: string;
}

/** Cloud integration configuration */
export interface CloudIntegrationConfig {
  cloudEndpoint: string;              // Cloud API endpoint
  cloudApiKey?: string;               // API key for cloud
  rpcUrl: string;                     // Blockchain RPC
  modelRegistryAddress?: string;      // On-chain model registry
  identityRegistryAddress?: string;   // ERC-8004 identity registry
  providerAddress?: Address;          // Cloud's on-chain provider address
  syncIntervalMs?: number;            // Model sync interval (default: 60000)
  enableBroadcasting?: boolean;       // Register models on-chain (default: false)
}

// ============================================================================
// Cloud Model Broadcaster
// ============================================================================

/**
 * CloudModelBroadcaster
 *
 * Syncs cloud platform models to the on-chain InferenceRegistry.
 * This allows decentralized discovery of cloud-hosted models.
 */
export class CloudModelBroadcaster {
  private config: CloudIntegrationConfig;
  private registry: InferenceRegistrySDK | null = null;
  private cachedModels: Map<string, CloudModelInfo> = new Map();
  private cachedSkills: CloudA2ASkill[] = [];
  private lastSync = 0;
  private syncIntervalMs: number;

  constructor(config: CloudIntegrationConfig) {
    this.config = config;
    this.syncIntervalMs = config.syncIntervalMs ?? 60000;

    if (config.modelRegistryAddress && config.enableBroadcasting) {
      this.registry = createInferenceRegistry({
        rpcUrl: config.rpcUrl,
        contracts: {
          registry: '0x0',
          ledger: '0x0',
          inference: '0x0',
          modelRegistry: config.modelRegistryAddress,
        },
      });
    }
  }

  /**
   * Fetch available models from cloud endpoint
   */
  async fetchCloudModels(): Promise<CloudModelInfo[]> {
    const response = await fetch(`${this.config.cloudEndpoint}/api/v1/models`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch cloud models: ${response.status}`);
    }

    const data = await response.json() as { models: CloudModelInfo[] };
    return data.models;
  }

  /**
   * Fetch A2A skills from cloud
   */
  async fetchCloudSkills(): Promise<CloudA2ASkill[]> {
    const response = await fetch(`${this.config.cloudEndpoint}/.well-known/agent-card.json`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      return [];
    }

    const card = await response.json() as { skills?: Array<{ id: string; description: string }> };
    return (card.skills ?? []).map(s => ({
      id: s.id,
      description: s.description,
    }));
  }

  /**
   * Sync cloud models to local cache and optionally to on-chain registry
   */
  async sync(): Promise<void> {
    const now = Date.now();
    if (now - this.lastSync < this.syncIntervalMs) {
      return; // Skip if synced recently
    }

    const [models, skills] = await Promise.all([
      this.fetchCloudModels(),
      this.fetchCloudSkills(),
    ]);

    // Update local cache
    this.cachedModels.clear();
    for (const model of models) {
      this.cachedModels.set(model.id, model);
    }
    this.cachedSkills = skills;
    this.lastSync = now;

    // Broadcast to on-chain registry if enabled
    if (this.config.enableBroadcasting && this.registry) {
      await this.broadcastToRegistry(models);
    }
  }

  /**
   * Register cloud models on-chain
   */
  private async broadcastToRegistry(models: CloudModelInfo[]): Promise<void> {
    if (!this.registry) return;

    for (const model of models) {
      const registeredModel = this.cloudToRegisteredModel(model);
      
      // Check if already registered
      const existingModel = await this.registry.getModel(registeredModel.modelId);
      if (existingModel) {
        // Update pricing if needed
        continue;
      }

      // Register new model
      await this.registry.registerModel({
        modelId: registeredModel.modelId,
        name: registeredModel.name,
        description: registeredModel.description,
        version: '1.0.0',
        modelType: registeredModel.modelType,
        sourceType: registeredModel.sourceType,
        hostingType: registeredModel.hostingType,
        creatorName: registeredModel.creator.name,
        creatorWebsite: registeredModel.creator.website,
        capabilities: registeredModel.capabilities,
        contextWindow: registeredModel.contextWindow,
        pricing: registeredModel.pricing,
        hardware: registeredModel.hardware,
      });

      // Add cloud endpoint
      await this.registry.addEndpoint({
        modelId: registeredModel.modelId,
        endpoint: `${this.config.cloudEndpoint}/api/v1`,
        region: 'global',
        teeType: TEETypeEnum.NONE,
        maxConcurrent: 1000,
      });
    }
  }

  /**
   * Convert cloud model to RegisteredModel format
   */
  cloudToRegisteredModel(cloud: CloudModelInfo): RegisteredModel {
    const modelType = this.mapModelType(cloud.modelType);
    const capabilities = this.mapCapabilities(cloud);
    const pricing = this.mapPricing(cloud);

    return {
      modelId: `cloud/${cloud.provider.toLowerCase()}/${cloud.id}`,
      name: cloud.name,
      description: `${cloud.name} via ${cloud.provider}`,
      version: '1.0.0',
      modelType,
      sourceType: ModelSourceTypeEnum.CLOSED_SOURCE,
      hostingType: ModelHostingTypeEnum.CENTRALIZED,
      creator: {
        name: cloud.provider,
        website: this.getProviderWebsite(cloud.provider),
        verified: true,
        trustScore: 100,
      },
      capabilities,
      contextWindow: cloud.contextWindow ?? 0,
      pricing,
      hardware: {
        minGpuVram: 0,
        recommendedGpuType: GPUTypeEnum.NONE,
        minCpuCores: 0,
        minMemory: 0,
        teeRequired: false,
        teeType: TEETypeEnum.NONE,
      },
      registeredAt: Date.now(),
      updatedAt: Date.now(),
      active: true,
      totalRequests: 0n,
      avgLatencyMs: 0,
      uptime: 100,
    };
  }

  private mapModelType(type: string): ModelType {
    switch (type) {
      case 'llm': return ModelTypeEnum.LLM;
      case 'image': return ModelTypeEnum.IMAGE_GEN;
      case 'video': return ModelTypeEnum.VIDEO_GEN;
      case 'audio': return ModelTypeEnum.AUDIO_GEN;
      case 'embedding': return ModelTypeEnum.EMBEDDING;
      default: return ModelTypeEnum.LLM;
    }
  }

  private mapCapabilities(cloud: CloudModelInfo): number {
    let caps = 0;
    
    if (cloud.modelType === 'llm') {
      caps |= ModelCapabilityEnum.TEXT_GENERATION;
      caps |= ModelCapabilityEnum.STREAMING;
    }
    if (cloud.modelType === 'image') {
      caps |= ModelCapabilityEnum.IMAGE_GENERATION;
    }
    if (cloud.modelType === 'video') {
      caps |= ModelCapabilityEnum.VIDEO_GENERATION;
    }
    if (cloud.modelType === 'audio') {
      caps |= ModelCapabilityEnum.TEXT_TO_SPEECH | ModelCapabilityEnum.AUDIO_GENERATION;
    }
    if (cloud.modelType === 'embedding') {
      caps |= ModelCapabilityEnum.EMBEDDINGS;
    }
    if (cloud.multiModal) {
      caps |= ModelCapabilityEnum.VISION | ModelCapabilityEnum.MULTIMODAL;
    }
    if (cloud.contextWindow && cloud.contextWindow > 32000) {
      caps |= ModelCapabilityEnum.LONG_CONTEXT;
    }

    return caps;
  }

  private mapPricing(cloud: CloudModelInfo): ModelPricing {
    // Convert USD pricing to wei (assuming 1 ETH = $3000 for estimation)
    const ethPerUsd = 1 / 3000;
    const weiPerUsd = BigInt(Math.floor(ethPerUsd * 1e18));

    return {
      pricePerInputToken: cloud.inputPricePerMillion 
        ? (weiPerUsd * BigInt(Math.floor(cloud.inputPricePerMillion * 1e6))) / 1_000_000n
        : 0n,
      pricePerOutputToken: cloud.outputPricePerMillion
        ? (weiPerUsd * BigInt(Math.floor(cloud.outputPricePerMillion * 1e6))) / 1_000_000n
        : 0n,
      pricePerImageInput: 0n,
      pricePerImageOutput: cloud.pricePerImage
        ? weiPerUsd * BigInt(Math.floor(cloud.pricePerImage * 1e6)) / 1_000_000n
        : 0n,
      pricePerVideoSecond: cloud.pricePerSecond
        ? weiPerUsd * BigInt(Math.floor(cloud.pricePerSecond * 1e6)) / 1_000_000n
        : 0n,
      pricePerAudioSecond: cloud.pricePerSecond
        ? weiPerUsd * BigInt(Math.floor(cloud.pricePerSecond * 1e6)) / 1_000_000n
        : 0n,
      minimumFee: weiPerUsd / 1000n, // $0.001 minimum
      currency: 'ETH',
    };
  }

  private getProviderWebsite(provider: string): string {
    const websites: Record<string, string> = {
      openai: 'https://openai.com',
      anthropic: 'https://anthropic.com',
      google: 'https://google.com',
      meta: 'https://meta.com',
      mistral: 'https://mistral.ai',
      flux: 'https://blackforestlabs.ai',
      luma: 'https://lumalabs.ai',
      runway: 'https://runwayml.com',
      elevenlabs: 'https://elevenlabs.io',
    };
    return websites[provider.toLowerCase()] ?? 'https://elizacloud.ai';
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.cloudApiKey) {
      headers['Authorization'] = `Bearer ${this.config.cloudApiKey}`;
    }
    return headers;
  }

  /**
   * Get cached models
   */
  getModels(): CloudModelInfo[] {
    return Array.from(this.cachedModels.values());
  }

  /**
   * Get cached skills
   */
  getSkills(): CloudA2ASkill[] {
    return this.cachedSkills;
  }

  /**
   * Get model by ID
   */
  getModel(modelId: string): CloudModelInfo | undefined {
    return this.cachedModels.get(modelId);
  }

  /**
   * Check if synced
   */
  isSynced(): boolean {
    return this.lastSync > 0;
  }
}

// ============================================================================
// Cloud Provider Bridge
// ============================================================================

/**
 * CloudProviderBridge
 *
 * Routes inference requests through the cloud platform.
 * Integrates with compute marketplace for access.
 */
export class CloudProviderBridge {
  private config: CloudIntegrationConfig;
  private broadcaster: CloudModelBroadcaster;

  constructor(config: CloudIntegrationConfig) {
    this.config = config;
    this.broadcaster = new CloudModelBroadcaster(config);
  }

  /**
   * Initialize and sync with cloud
   */
  async initialize(): Promise<void> {
    await this.broadcaster.sync();
  }

  /**
   * Get provider status
   */
  async getStatus(): Promise<CloudProviderStatus> {
    const models = this.broadcaster.getModels();
    const skills = this.broadcaster.getSkills();

    return {
      available: this.broadcaster.isSynced(),
      modelCount: models.length,
      skillCount: skills.length,
      lastSync: Date.now(),
      endpoint: this.config.cloudEndpoint,
    };
  }

  /**
   * Discover models from cloud matching filter
   */
  async discoverModels(filter?: ModelDiscoveryFilter): Promise<ModelDiscoveryResult[]> {
    await this.broadcaster.sync();

    const cloudModels = this.broadcaster.getModels();
    const results: ModelDiscoveryResult[] = [];

    for (const cloud of cloudModels) {
      const registered = this.cloudToRegisteredModel(cloud);

      // Apply filters
      if (filter?.modelType !== undefined && registered.modelType !== filter.modelType) {
        continue;
      }
      if (filter?.capabilities && (registered.capabilities & filter.capabilities) !== filter.capabilities) {
        continue;
      }
      if (filter?.minContextWindow && registered.contextWindow < filter.minContextWindow) {
        continue;
      }

      const endpoint: ModelEndpoint = {
        modelId: registered.modelId,
        providerAddress: this.config.providerAddress ?? '0x0000000000000000000000000000000000000000',
        endpoint: `${this.config.cloudEndpoint}/api/v1`,
        region: 'global',
        teeType: TEETypeEnum.NONE,
        attestationHash: '',
        active: true,
        currentLoad: 0,
        maxConcurrent: 1000,
        pricing: registered.pricing,
      };

      results.push({
        model: registered,
        endpoints: [endpoint],
        recommendedEndpoint: endpoint,
      });
    }

    return results;
  }

  /**
   * Make inference request to cloud
   */
  async inference(
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    options?: {
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
    }
  ): Promise<{
    id: string;
    model: string;
    content: string;
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    cost?: number;
  }> {
    const response = await fetch(`${this.config.cloudEndpoint}/api/v1/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: modelId,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 1024,
        stream: options?.stream ?? false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Cloud inference failed: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      id: string;
      model: string;
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      cost?: number;
    };

    return {
      id: data.id,
      model: data.model,
      content: data.choices[0]?.message.content ?? '',
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
      cost: data.cost,
    };
  }

  /**
   * Generate image via cloud
   */
  async generateImage(
    prompt: string,
    options?: {
      model?: string;
      size?: string;
      quality?: string;
    }
  ): Promise<{ url: string; cost?: number }> {
    const response = await fetch(`${this.config.cloudEndpoint}/api/v1/images/generations`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        prompt,
        model: options?.model ?? 'flux',
        size: options?.size ?? '1024x1024',
        quality: options?.quality ?? 'standard',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Cloud image generation failed: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      data: Array<{ url: string }>;
      cost?: number;
    };

    return {
      url: data.data[0]?.url ?? '',
      cost: data.cost,
    };
  }

  /**
   * Execute A2A skill on cloud
   */
  async executeSkill(
    skillId: string,
    input: string | Record<string, unknown>,
    options?: { timeout?: number }
  ): Promise<unknown> {
    const response = await fetch(`${this.config.cloudEndpoint}/api/a2a`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            parts: typeof input === 'string'
              ? [{ type: 'text', text: input }]
              : [{ type: 'data', data: { skill: skillId, ...input } }],
          },
        },
      }),
      signal: options?.timeout ? AbortSignal.timeout(options.timeout) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Cloud A2A skill failed: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      result?: { status?: { message?: { parts?: Array<{ text?: string; data?: unknown }> } } };
      error?: { message: string };
    };

    if (data.error) {
      throw new Error(`A2A error: ${data.error.message}`);
    }

    const parts = data.result?.status?.message?.parts ?? [];
    const textPart = parts.find(p => p.text);
    const dataPart = parts.find(p => p.data);

    return dataPart?.data ?? textPart?.text ?? data.result;
  }

  /**
   * Get available A2A skills
   */
  getAvailableSkills(): CloudA2ASkill[] {
    return this.broadcaster.getSkills();
  }

  private cloudToRegisteredModel(cloud: CloudModelInfo): RegisteredModel {
    return this.broadcaster.cloudToRegisteredModel(cloud);
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.cloudApiKey) {
      headers['Authorization'] = `Bearer ${this.config.cloudApiKey}`;
    }
    return headers;
  }
}

// ============================================================================
// Discovery Service
// ============================================================================

/**
 * ModelDiscovery
 *
 * Combines cloud and decentralized model discovery into a single interface.
 * Provides intelligent routing based on availability, cost, and capabilities.
 */
export class ModelDiscovery {
  private cloudBridge: CloudProviderBridge | null = null;
  private registrySDK: InferenceRegistrySDK | null = null;
  private readonly config: CloudIntegrationConfig & { registryConfig?: ExtendedSDKConfig };

  constructor(config: CloudIntegrationConfig & { registryConfig?: ExtendedSDKConfig }) {
    this.config = config;

    // Initialize cloud bridge
    if (this.config.cloudEndpoint) {
      this.cloudBridge = new CloudProviderBridge(this.config);
    }

    // Initialize on-chain registry
    if (this.config.registryConfig) {
      this.registrySDK = createInferenceRegistry(this.config.registryConfig);
    }
  }


  /**
   * Initialize both discovery sources
   */
  async initialize(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.cloudBridge) {
      promises.push(this.cloudBridge.initialize());
    }

    await Promise.all(promises);
  }

  /**
   * Discover all available models from both sources
   */
  async discoverAll(filter?: ModelDiscoveryFilter): Promise<{
    cloud: ModelDiscoveryResult[];
    decentralized: ModelDiscoveryResult[];
    combined: ModelDiscoveryResult[];
  }> {
    const [cloudResults, decentralizedResults] = await Promise.all([
      this.cloudBridge?.discoverModels(filter) ?? Promise.resolve([]),
      this.registrySDK?.discoverModels(filter ?? {}) ?? Promise.resolve([]),
    ]);

    // Combine and deduplicate by model ID
    const seen = new Set<string>();
    const combined: ModelDiscoveryResult[] = [];

    // Prefer cloud models for known providers (faster response)
    for (const result of cloudResults) {
      if (!seen.has(result.model.modelId)) {
        seen.add(result.model.modelId);
        combined.push(result);
      }
    }

    // Add decentralized models not in cloud
    for (const result of decentralizedResults) {
      if (!seen.has(result.model.modelId)) {
        seen.add(result.model.modelId);
        combined.push(result);
      }
    }

    return {
      cloud: cloudResults,
      decentralized: decentralizedResults,
      combined,
    };
  }

  /**
   * Get best model for a given requirement
   */
  async selectBestModel(params: {
    modelType?: ModelType;
    capabilities?: number;
    maxPricePerRequest?: bigint;
    preferCloud?: boolean;
    preferDecentralized?: boolean;
  }): Promise<ModelDiscoveryResult | null> {
    const filter: ModelDiscoveryFilter = {
      modelType: params.modelType,
      capabilities: params.capabilities,
      active: true,
    };

    const { combined } = await this.discoverAll(filter);

    if (combined.length === 0) {
      return null;
    }

    // Sort by preference
    const sorted = [...combined].sort((a, b) => {
      // Preference flags
      if (params.preferCloud) {
        const aIsCloud = a.model.hostingType === ModelHostingTypeEnum.CENTRALIZED;
        const bIsCloud = b.model.hostingType === ModelHostingTypeEnum.CENTRALIZED;
        if (aIsCloud && !bIsCloud) return -1;
        if (!aIsCloud && bIsCloud) return 1;
      }
      if (params.preferDecentralized) {
        const aIsDecentralized = a.model.hostingType === ModelHostingTypeEnum.DECENTRALIZED;
        const bIsDecentralized = b.model.hostingType === ModelHostingTypeEnum.DECENTRALIZED;
        if (aIsDecentralized && !bIsDecentralized) return -1;
        if (!aIsDecentralized && bIsDecentralized) return 1;
      }

      // Sort by price
      const priceA = a.model.pricing.pricePerInputToken + a.model.pricing.pricePerOutputToken;
      const priceB = b.model.pricing.pricePerInputToken + b.model.pricing.pricePerOutputToken;
      return Number(priceA - priceB);
    });

    return sorted[0] ?? null;
  }

  /**
   * Get cloud bridge (if available)
   */
  getCloudBridge(): CloudProviderBridge | null {
    return this.cloudBridge;
  }

  /**
   * Get registry SDK (if available)
   */
  getRegistrySDK(): InferenceRegistrySDK | null {
    return this.registrySDK;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create cloud model broadcaster
 */
export function createCloudBroadcaster(config: CloudIntegrationConfig): CloudModelBroadcaster {
  return new CloudModelBroadcaster(config);
}

/**
 * Create cloud provider bridge
 */
export function createCloudBridge(config: CloudIntegrationConfig): CloudProviderBridge {
  return new CloudProviderBridge(config);
}

/**
 * Create model discovery
 */
export function createModelDiscovery(
  config: CloudIntegrationConfig & { registryConfig?: ExtendedSDKConfig }
): ModelDiscovery {
  return new ModelDiscovery(config);
}

/**
 * Create from environment variables
 */
export function createCloudIntegrationFromEnv(): ModelDiscovery {
  const config: CloudIntegrationConfig & { registryConfig?: ExtendedSDKConfig } = {
    cloudEndpoint: process.env.CLOUD_ENDPOINT ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://elizacloud.ai',
    cloudApiKey: process.env.CLOUD_API_KEY,
    rpcUrl: process.env.RPC_URL ?? process.env.JEJU_RPC_URL ?? 'http://localhost:9545',
    modelRegistryAddress: process.env.MODEL_REGISTRY_ADDRESS,
    identityRegistryAddress: process.env.IDENTITY_REGISTRY_ADDRESS,
    providerAddress: process.env.CLOUD_PROVIDER_ADDRESS as Address | undefined,
    syncIntervalMs: parseInt(process.env.CLOUD_SYNC_INTERVAL ?? '60000', 10),
    enableBroadcasting: process.env.ENABLE_CLOUD_BROADCASTING === 'true',
  };

  // Add registry config if addresses provided
  if (process.env.MODEL_REGISTRY_ADDRESS) {
    config.registryConfig = {
      rpcUrl: config.rpcUrl,
      contracts: {
        registry: process.env.COMPUTE_REGISTRY_ADDRESS ?? '0x0',
        ledger: process.env.LEDGER_ADDRESS ?? '0x0',
        inference: process.env.INFERENCE_ADDRESS ?? '0x0',
        modelRegistry: process.env.MODEL_REGISTRY_ADDRESS,
      },
    };
  }

  return createModelDiscovery(config);
}
