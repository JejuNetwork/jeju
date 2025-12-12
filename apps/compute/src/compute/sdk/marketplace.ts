/**
 * Compute Marketplace SDK
 *
 * Interface for the decentralized compute marketplace:
 * - Model discovery (LLM, image, video, audio)
 * - TEE node provisioning and routing
 * - X402 payment integration with JEJU token
 * - Inference routing with TEE attestation
 */

import type { Address } from 'viem';
import { InferenceRegistrySDK } from './inference-registry';
import type { ExtendedSDKConfig } from './types';
import {
  ComputePaymentClient,
  createPaymentClient,
  type PaymentConfig,
  COMPUTE_PRICING,
} from './payment';
import {
  createX402PaymentRequirement,
  X402_NETWORK_CONFIGS,
  type X402Network,
} from './x402';
import type {
  ModelDiscoveryFilter,
  ModelDiscoveryResult,
  ModelEndpoint,
  ModelType,
  RegisteredModel,
  TEEType,
} from './types';
import { ModelTypeEnum, TEETypeEnum, ModelCapabilityEnum } from './types';


export interface MarketplaceConfig {
  rpcUrl: string;
  modelRegistryAddress?: Address;
  paymentConfig?: Partial<PaymentConfig>;
  network?: X402Network;
  preferredPaymentToken?: 'JEJU' | 'ETH' | 'USDC';
}

export interface InferenceRequest {
  modelId: string;
  input: InferenceInput;
  options?: InferenceOptions;
}

export interface InferenceInput {
  // For LLM
  messages?: Array<{ role: string; content: string }>;
  prompt?: string;

  // For image generation
  imagePrompt?: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;

  // For video generation
  videoPrompt?: string;
  duration?: number;
  fps?: number;

  // For audio
  audioPrompt?: string;
  audioInput?: string; // Base64 for speech-to-text

  // For embeddings
  textToEmbed?: string;
}

export interface InferenceOptions {
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  requireTEE?: boolean;
  teeType?: TEEType;
  maxLatencyMs?: number;
  region?: string;
}

export interface InferenceResult {
  requestId: string;
  modelId: string;
  endpoint: string;
  teeType: TEEType;
  attestationHash?: string;

  // LLM output
  content?: string;
  tokensUsed?: { input: number; output: number };

  // Image output
  images?: string[]; // Base64 or URLs

  // Video output
  videoUrl?: string;
  videoDurationSeconds?: number;

  // Audio output
  audioUrl?: string;
  transcript?: string;

  // Embedding output
  embedding?: number[];

  // Cost
  cost: {
    amount: bigint;
    currency: string;
    paid: boolean;
    txHash?: string;
  };

  // Timing
  latencyMs: number;
  coldStart: boolean;
}



export class ComputeMarketplace {
  private config: MarketplaceConfig;
  private registry: InferenceRegistrySDK;
  private payment: ComputePaymentClient;

  private teeGatewayEndpoint: string | null = null;

  constructor(config: MarketplaceConfig) {
    this.config = {
      network: 'jeju-testnet',
      preferredPaymentToken: 'JEJU',
      ...config,
    };

    // Initialize inference registry
    const registryConfig: ExtendedSDKConfig = {
      rpcUrl: config.rpcUrl,
      contracts: {
        registry: '0x0000000000000000000000000000000000000000',
        ledger: '0x0000000000000000000000000000000000000000',
        inference: '0x0000000000000000000000000000000000000000',
        modelRegistry: config.modelRegistryAddress,
      },
    };
    this.registry = new InferenceRegistrySDK(registryConfig);

    // Initialize payment client
    this.payment = createPaymentClient({
      rpcUrl: config.rpcUrl,
      ...config.paymentConfig,
    });
  }

  async getLLMs(): Promise<RegisteredModel[]> {
    return this.registry.getLLMs();
  }

  /** Get all image generation models */
  async getImageGenerators(): Promise<RegisteredModel[]> {
    return this.registry.getImageGenerators();
  }

  /** Get all video generation models */
  async getVideoGenerators(): Promise<RegisteredModel[]> {
    return this.registry.getVideoGenerators();
  }

  /** Get all audio generation models */
  async getAudioGenerators(): Promise<RegisteredModel[]> {
    return this.registry.getAudioGenerators();
  }

  /** Get all speech-to-text models */
  async getSpeechToTextModels(): Promise<RegisteredModel[]> {
    return this.registry.getSpeechToTextModels();
  }

  /** Get all text-to-speech models */
  async getTextToSpeechModels(): Promise<RegisteredModel[]> {
    return this.registry.getTextToSpeechModels();
  }

  /** Get all embedding models */
  async getEmbeddingModels(): Promise<RegisteredModel[]> {
    return this.registry.getEmbeddingModels();
  }

  /** Get all multimodal models */
  async getMultimodalModels(): Promise<RegisteredModel[]> {
    return this.registry.getMultimodalModels();
  }

  /** Discover models with custom filters */
  async discoverModels(filter: ModelDiscoveryFilter): Promise<ModelDiscoveryResult[]> {
    return this.registry.discoverModels(filter);
  }

  /** Get model by ID */
  async getModel(modelId: string): Promise<RegisteredModel> {
    return this.registry.getModel(modelId);
  }

  /** Get available endpoints for a model */
  async getEndpoints(modelId: string): Promise<ModelEndpoint[]> {
    return this.registry.getEndpoints(modelId);
  }

  /** Get the best endpoint for a model (considers load, TEE, latency) */
  async getBestEndpoint(modelId: string, options?: InferenceOptions): Promise<ModelEndpoint | null> {
    const endpoints = await this.registry.getEndpoints(modelId);
    if (endpoints.length === 0) return null;

    // Filter by requirements
    let candidates = endpoints.filter(e => e.active);

    if (options?.requireTEE) {
      candidates = candidates.filter(e => e.teeType !== TEETypeEnum.NONE);
    }

    if (options?.teeType !== undefined) {
      candidates = candidates.filter(e => e.teeType === options.teeType);
    }

    if (options?.region) {
      const regionCandidates = candidates.filter(e => e.region === options.region);
      if (regionCandidates.length > 0) {
        candidates = regionCandidates;
      }
    }

    if (candidates.length === 0) return null;

    // Sort by load (prefer less loaded)
    candidates.sort((a, b) => a.currentLoad - b.currentLoad);

    return candidates[0] ?? null;
  }

  setTEEGateway(endpoint: string): void {
    this.teeGatewayEndpoint = endpoint;
  }

  async getTEENodes(providerType?: string): Promise<Array<{
    id: string;
    endpoint: string;
    providerType: string;
    status: string;
    warmth: string;
    models: string[];
    hardware: {
      isSecure: boolean;
      hardwareType: string;
      gpuType: string | null;
    };
    warning?: string;
  }>> {
    if (!this.teeGatewayEndpoint) {
      return [];
    }

    const url = providerType 
      ? `${this.teeGatewayEndpoint}/api/v1/tee/nodes?provider=${providerType}`
      : `${this.teeGatewayEndpoint}/api/v1/tee/nodes`;
      
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch TEE nodes: ${response.statusText}`);
    }

    const data = await response.json() as {
      nodes: Array<{
        id: string;
        endpoint: string;
        providerType: string;
        status: string;
        warmth: string;
        models: string[];
        hardware: {
          isSecure: boolean;
          hardwareType: string;
          gpuType: string | null;
        };
        warning?: string;
      }>;
    };

    return data.nodes;
  }

  async getTEEEndpoint(
    modelId: string, 
    options?: { requireSecure?: boolean; providerType?: string }
  ): Promise<{ endpoint: string; teeType: TEEType; coldStart: boolean; warning?: string }> {
    if (!this.teeGatewayEndpoint) {
      throw new Error('TEE gateway not configured');
    }

    const response = await fetch(`${this.teeGatewayEndpoint}/api/v1/tee/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        model: modelId,
        requireSecure: options?.requireSecure,
        providerType: options?.providerType,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to get TEE endpoint: ${response.statusText}`);
    }

    const data = await response.json() as {
      endpoint: string;
      teeType: string;
      coldStart: boolean;
      warning?: string;
    };

    const teeTypeMap: Record<string, TEEType> = {
      'intel-tdx': TEETypeEnum.INTEL_TDX,
      'intel-sgx': TEETypeEnum.INTEL_SGX,
      'amd-sev': TEETypeEnum.AMD_SEV,
      'arm-trustzone': TEETypeEnum.ARM_TRUSTZONE,
      'none': TEETypeEnum.NONE,
      'simulated': TEETypeEnum.SIMULATED,
    };

    return {
      endpoint: data.endpoint,
      teeType: teeTypeMap[data.teeType] ?? TEETypeEnum.NONE,
      coldStart: data.coldStart ?? false,
      warning: data.warning,
    };
  }


  /** Execute inference request with automatic endpoint selection and payment */
  async inference(request: InferenceRequest): Promise<InferenceResult> {
    const startTime = Date.now();

    // Get model info
    const model = await this.getModel(request.modelId);

    // Find best endpoint
    let endpoint: ModelEndpoint | null = null;
    let coldStart = false;

    if (request.options?.requireTEE && this.teeGatewayEndpoint) {
      const teeResult = await this.getTEEEndpoint(request.modelId, {
        requireSecure: request.options.requireTEE,
      });
      coldStart = teeResult.coldStart;
      
      if (teeResult.warning) {
        console.warn(`[ComputeMarketplace] ${teeResult.warning}`);
      }
      
      endpoint = {
        modelId: request.modelId,
        providerAddress: '',
        endpoint: teeResult.endpoint,
        region: 'tee-cloud',
        teeType: teeResult.teeType,
        attestationHash: '',
        active: true,
        currentLoad: 0,
        maxConcurrent: 100,
        pricing: model.pricing,
      };
    } else {
      endpoint = await this.getBestEndpoint(request.modelId, request.options);
    }

    if (!endpoint) {
      throw new Error(`No available endpoint for model: ${request.modelId}`);
    }

    // Execute inference based on model type
    const result = await this.executeInference(model, endpoint, request);

    // Calculate cost
    const cost = this.calculateCost(model, result);

    return {
      requestId: crypto.randomUUID(),
      modelId: request.modelId,
      endpoint: endpoint.endpoint,
      teeType: endpoint.teeType,
      attestationHash: endpoint.attestationHash,
      ...result,
      cost: {
        amount: cost,
        currency: model.pricing.currency,
        paid: false, // Will be updated after payment
      },
      latencyMs: Date.now() - startTime,
      coldStart,
    };
  }

  private async executeInference(
    model: RegisteredModel,
    endpoint: ModelEndpoint,
    request: InferenceRequest
  ): Promise<Partial<InferenceResult>> {
    switch (model.modelType) {
      case ModelTypeEnum.LLM:
        return this.executeLLMInference(endpoint, request);
      case ModelTypeEnum.IMAGE_GEN:
        return this.executeImageGeneration(endpoint, request);
      case ModelTypeEnum.VIDEO_GEN:
        return this.executeVideoGeneration(endpoint, request);
      case ModelTypeEnum.AUDIO_GEN:
        return this.executeAudioGeneration(endpoint, request);
      case ModelTypeEnum.SPEECH_TO_TEXT:
        return this.executeSpeechToText(endpoint, request);
      case ModelTypeEnum.TEXT_TO_SPEECH:
        return this.executeTextToSpeech(endpoint, request);
      case ModelTypeEnum.EMBEDDING:
        return this.executeEmbedding(endpoint, request);
      case ModelTypeEnum.MULTIMODAL:
        return this.executeMultimodal(endpoint, request);
      default:
        throw new Error(`Unsupported model type: ${model.modelType}`);
    }
  }

  private async executeLLMInference(
    endpoint: ModelEndpoint,
    request: InferenceRequest
  ): Promise<Partial<InferenceResult>> {
    const response = await fetch(`${endpoint.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.modelId,
        messages: request.input.messages ?? [{ role: 'user', content: request.input.prompt }],
        max_tokens: request.options?.maxTokens,
        temperature: request.options?.temperature,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM inference failed: ${response.statusText}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    return {
      content: data.choices[0]?.message?.content,
      tokensUsed: {
        input: data.usage.prompt_tokens,
        output: data.usage.completion_tokens,
      },
    };
  }

  private async executeImageGeneration(
    endpoint: ModelEndpoint,
    request: InferenceRequest
  ): Promise<Partial<InferenceResult>> {
    const response = await fetch(`${endpoint.endpoint}/v1/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.modelId,
        prompt: request.input.imagePrompt,
        negative_prompt: request.input.negativePrompt,
        width: request.input.width ?? 1024,
        height: request.input.height ?? 1024,
        steps: request.input.steps ?? 30,
      }),
    });

    if (!response.ok) {
      throw new Error(`Image generation failed: ${response.statusText}`);
    }

    const data = await response.json() as {
      data: Array<{ url?: string; b64_json?: string }>;
    };

    return {
      images: data.data.map(d => d.url ?? d.b64_json ?? ''),
    };
  }

  private async executeVideoGeneration(
    endpoint: ModelEndpoint,
    request: InferenceRequest
  ): Promise<Partial<InferenceResult>> {
    const response = await fetch(`${endpoint.endpoint}/v1/videos/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.modelId,
        prompt: request.input.videoPrompt,
        duration: request.input.duration ?? 5,
        fps: request.input.fps ?? 24,
      }),
    });

    if (!response.ok) {
      throw new Error(`Video generation failed: ${response.statusText}`);
    }

    const data = await response.json() as {
      video_url: string;
      duration_seconds: number;
    };

    return {
      videoUrl: data.video_url,
      videoDurationSeconds: data.duration_seconds,
    };
  }

  private async executeAudioGeneration(
    endpoint: ModelEndpoint,
    request: InferenceRequest
  ): Promise<Partial<InferenceResult>> {
    const response = await fetch(`${endpoint.endpoint}/v1/audio/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.modelId,
        prompt: request.input.audioPrompt,
      }),
    });

    if (!response.ok) {
      throw new Error(`Audio generation failed: ${response.statusText}`);
    }

    const data = await response.json() as { audio_url: string };

    return {
      audioUrl: data.audio_url,
    };
  }

  private async executeSpeechToText(
    endpoint: ModelEndpoint,
    request: InferenceRequest
  ): Promise<Partial<InferenceResult>> {
    const response = await fetch(`${endpoint.endpoint}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.modelId,
        audio: request.input.audioInput,
      }),
    });

    if (!response.ok) {
      throw new Error(`Speech-to-text failed: ${response.statusText}`);
    }

    const data = await response.json() as { text: string };

    return {
      transcript: data.text,
    };
  }

  private async executeTextToSpeech(
    endpoint: ModelEndpoint,
    request: InferenceRequest
  ): Promise<Partial<InferenceResult>> {
    const response = await fetch(`${endpoint.endpoint}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.modelId,
        input: request.input.prompt,
      }),
    });

    if (!response.ok) {
      throw new Error(`Text-to-speech failed: ${response.statusText}`);
    }

    const data = await response.json() as { audio_url: string };

    return {
      audioUrl: data.audio_url,
    };
  }

  private async executeEmbedding(
    endpoint: ModelEndpoint,
    request: InferenceRequest
  ): Promise<Partial<InferenceResult>> {
    const response = await fetch(`${endpoint.endpoint}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.modelId,
        input: request.input.textToEmbed,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding failed: ${response.statusText}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };

    return {
      embedding: data.data[0]?.embedding,
    };
  }

  private async executeMultimodal(
    endpoint: ModelEndpoint,
    request: InferenceRequest
  ): Promise<Partial<InferenceResult>> {
    // Multimodal uses LLM-style chat completions with image support
    return this.executeLLMInference(endpoint, request);
  }


  /** Calculate cost based on model type and usage */
  calculateCost(model: RegisteredModel, result: Partial<InferenceResult>): bigint {
    const pricing = model.pricing;

    switch (model.modelType) {
      case ModelTypeEnum.LLM:
      case ModelTypeEnum.MULTIMODAL: {
        const inputTokens = result.tokensUsed?.input ?? 0;
        const outputTokens = result.tokensUsed?.output ?? 0;
        const tokenCost =
          BigInt(inputTokens) * pricing.pricePerInputToken +
          BigInt(outputTokens) * pricing.pricePerOutputToken;
        return tokenCost > pricing.minimumFee ? tokenCost : pricing.minimumFee;
      }

      case ModelTypeEnum.IMAGE_GEN: {
        const imageCount = result.images?.length ?? 1;
        const imageCost = BigInt(imageCount) * pricing.pricePerImageOutput;
        return imageCost > pricing.minimumFee ? imageCost : pricing.minimumFee;
      }

      case ModelTypeEnum.VIDEO_GEN: {
        const seconds = result.videoDurationSeconds ?? 5;
        const videoCost = BigInt(seconds) * pricing.pricePerVideoSecond;
        return videoCost > pricing.minimumFee ? videoCost : pricing.minimumFee;
      }

      case ModelTypeEnum.AUDIO_GEN:
      case ModelTypeEnum.SPEECH_TO_TEXT:
      case ModelTypeEnum.TEXT_TO_SPEECH: {
        // Estimate 1 second per request for simplicity
        const audioCost = pricing.pricePerAudioSecond;
        return audioCost > pricing.minimumFee ? audioCost : pricing.minimumFee;
      }

      case ModelTypeEnum.EMBEDDING: {
        // Embeddings typically charged per input token
        const inputTokens = result.tokensUsed?.input ?? 100;
        const embeddingCost = BigInt(inputTokens) * pricing.pricePerInputToken;
        return embeddingCost > pricing.minimumFee ? embeddingCost : pricing.minimumFee;
      }

      default:
        return pricing.minimumFee;
    }
  }

  /** Get X402 payment requirement for an inference request */
  getPaymentRequirement(
    modelId: string,
    estimatedCost: bigint,
    description?: string
  ): ReturnType<typeof createX402PaymentRequirement> {
    const network = this.config.network ?? 'jeju-testnet';
    const networkConfig = X402_NETWORK_CONFIGS[network];

    return createX402PaymentRequirement({
      network,
      recipient: this.config.paymentConfig?.ledgerManagerAddress ?? '0x0' as Address,
      amount: estimatedCost,
      asset: networkConfig.usdc,
      resource: `/v1/inference/${modelId}`,
      description: description ?? `Inference request for ${modelId}`,
    });
  }

  /** Get credit balance for a user */
  async getCreditBalance(userAddress: string): Promise<{
    total: bigint;
    usdc: bigint;
    eth: bigint;
    jeju: bigint;
  }> {
    const balance = await this.payment.getCreditBalances(userAddress);
    return {
      total: balance.total,
      usdc: balance.usdc,
      eth: balance.eth,
      jeju: balance.elizaOS, // JEJU uses the same slot as elizaOS in credit manager
    };
  }


  /** Get standard compute pricing */
  static getPricing() {
    return COMPUTE_PRICING;
  }

  /** Get model type name */
  static getModelTypeName(modelType: ModelType): string {
    const names: Record<ModelType, string> = {
      [ModelTypeEnum.LLM]: 'Large Language Model',
      [ModelTypeEnum.IMAGE_GEN]: 'Image Generation',
      [ModelTypeEnum.VIDEO_GEN]: 'Video Generation',
      [ModelTypeEnum.AUDIO_GEN]: 'Audio Generation',
      [ModelTypeEnum.SPEECH_TO_TEXT]: 'Speech to Text',
      [ModelTypeEnum.TEXT_TO_SPEECH]: 'Text to Speech',
      [ModelTypeEnum.EMBEDDING]: 'Embedding',
      [ModelTypeEnum.MULTIMODAL]: 'Multimodal',
    };
    return names[modelType] ?? 'Unknown';
  }

  /** Get capability names from bitmask */
  static getCapabilityNames(capabilities: number): string[] {
    const names: string[] = [];
    const caps = ModelCapabilityEnum;

    if (capabilities & caps.TEXT_GENERATION) names.push('Text Generation');
    if (capabilities & caps.CODE_GENERATION) names.push('Code Generation');
    if (capabilities & caps.VISION) names.push('Vision');
    if (capabilities & caps.FUNCTION_CALLING) names.push('Function Calling');
    if (capabilities & caps.STREAMING) names.push('Streaming');
    if (capabilities & caps.EMBEDDINGS) names.push('Embeddings');
    if (capabilities & caps.LONG_CONTEXT) names.push('Long Context');
    if (capabilities & caps.REASONING) names.push('Reasoning');
    if (capabilities & caps.IMAGE_GENERATION) names.push('Image Generation');
    if (capabilities & caps.IMAGE_EDITING) names.push('Image Editing');
    if (capabilities & caps.SPEECH_TO_TEXT) names.push('Speech to Text');
    if (capabilities & caps.TEXT_TO_SPEECH) names.push('Text to Speech');
    if (capabilities & caps.AUDIO_GENERATION) names.push('Audio Generation');
    if (capabilities & caps.VIDEO_GENERATION) names.push('Video Generation');
    if (capabilities & caps.VIDEO_ANALYSIS) names.push('Video Analysis');
    if (capabilities & caps.MULTIMODAL) names.push('Multimodal');

    return names;
  }

  // ============================================================================
  // Trigger Integration
  // ============================================================================

  /**
   * Create a cron trigger for scheduled compute jobs
   * @param name - Trigger name
   * @param cronExpression - Cron expression (e.g., '* * * * *' for every minute)
   * @param endpoint - Endpoint to call on trigger
   * @param options - Additional options
   */
  async createCronTrigger(
    name: string,
    cronExpression: string,
    endpoint: string,
    options?: {
      description?: string;
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      timeout?: number;
      payment?: {
        mode: 'x402' | 'prepaid' | 'free';
        pricePerExecution?: bigint;
      };
    }
  ): Promise<string> {
    const { getTriggerIntegration } = await import('./trigger-integration');
    const integration = getTriggerIntegration();

    return integration.registerTrigger({
      source: 'local',
      type: 'cron',
      name,
      cronExpression,
      target: {
        type: 'http',
        endpoint,
        method: options?.method ?? 'POST',
        timeout: options?.timeout ?? 30,
      },
      active: true,
      description: options?.description,
      payment: options?.payment ? {
        mode: options.payment.mode,
        pricePerExecution: options.payment.pricePerExecution,
      } : undefined,
    });
  }

  /**
   * Create a webhook trigger
   * @param name - Trigger name
   * @param webhookPath - Path for webhook (e.g., '/webhooks/my-trigger')
   * @param endpoint - Endpoint to call on trigger
   */
  async createWebhookTrigger(
    name: string,
    webhookPath: string,
    endpoint: string,
    options?: {
      description?: string;
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      timeout?: number;
      requireX402?: boolean;
      pricePerExecution?: bigint;
    }
  ): Promise<string> {
    const { getTriggerIntegration } = await import('./trigger-integration');
    const integration = getTriggerIntegration();

    return integration.registerTrigger({
      source: 'local',
      type: 'webhook',
      name,
      webhookPath,
      target: {
        type: 'http',
        endpoint,
        method: options?.method ?? 'POST',
        timeout: options?.timeout ?? 30,
      },
      active: true,
      description: options?.description,
      payment: options?.requireX402 ? {
        mode: 'x402',
        pricePerExecution: options.pricePerExecution,
      } : undefined,
    });
  }

  /**
   * Create an event trigger
   * @param name - Trigger name
   * @param eventTypes - Event types to listen for
   * @param endpoint - Endpoint to call on trigger
   */
  async createEventTrigger(
    name: string,
    eventTypes: string[],
    endpoint: string,
    options?: {
      description?: string;
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      timeout?: number;
    }
  ): Promise<string> {
    const { getTriggerIntegration } = await import('./trigger-integration');
    const integration = getTriggerIntegration();

    return integration.registerTrigger({
      source: 'local',
      type: 'event',
      name,
      eventTypes,
      target: {
        type: 'http',
        endpoint,
        method: options?.method ?? 'POST',
        timeout: options?.timeout ?? 30,
      },
      active: true,
      description: options?.description,
    });
  }

  /**
   * Subscribe to a trigger with callback endpoint
   * @param triggerId - ID of the trigger to subscribe to
   * @param callbackEndpoint - Your endpoint to receive trigger callbacks
   * @param options - Subscription options
   */
  async subscribeTrigger(
    triggerId: string,
    callbackEndpoint: string,
    subscriberAddress: Address,
    options?: {
      callbackMethod?: 'GET' | 'POST' | 'PUT';
      authToken?: string;
      paymentMode?: 'x402' | 'prepaid' | 'free';
      prepaidBalance?: bigint;
      maxExecutions?: number;
    }
  ): Promise<{ subscriptionId: string }> {
    const { getTriggerIntegration } = await import('./trigger-integration');
    const integration = getTriggerIntegration();

    const subscription = await integration.subscribe({
      triggerId,
      subscriberAddress,
      callbackEndpoint,
      callbackMethod: options?.callbackMethod ?? 'POST',
      callbackAuth: options?.authToken ? {
        type: 'bearer',
        value: options.authToken,
      } : undefined,
      payment: {
        mode: options?.paymentMode ?? 'free',
        pricePerExecution: 0n,
        prepaidBalance: options?.prepaidBalance,
      },
      maxExecutions: options?.maxExecutions,
    });

    return { subscriptionId: subscription.id };
  }

  /**
   * Get all registered triggers
   */
  async getTriggers(filter?: {
    type?: 'cron' | 'webhook' | 'event';
    active?: boolean;
  }): Promise<Array<{
    id: string;
    name: string;
    type: string;
    active: boolean;
    cronExpression?: string;
    webhookPath?: string;
    eventTypes?: string[];
  }>> {
    const { getTriggerIntegration } = await import('./trigger-integration');
    const integration = getTriggerIntegration();

    const triggers = integration.getTriggers({
      type: filter?.type,
      active: filter?.active,
    });

    return triggers.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      active: t.active,
      cronExpression: t.cronExpression,
      webhookPath: t.webhookPath,
      eventTypes: t.eventTypes,
    }));
  }

  /**
   * Execute a trigger manually
   */
  async executeTrigger(
    triggerId: string,
    input?: Record<string, unknown>
  ): Promise<{
    executionId: string;
    status: string;
    output?: Record<string, unknown>;
    proof?: {
      executorSignature: string;
      timestamp: number;
      outputHash: string;
    };
  }> {
    const { getTriggerIntegration } = await import('./trigger-integration');
    const integration = getTriggerIntegration();

    const result = await integration.executeTrigger({
      triggerId,
      input,
    });

    return {
      executionId: result.executionId,
      status: result.status,
      output: result.output,
      proof: result.proof ? {
        executorSignature: result.proof.executorSignature,
        timestamp: result.proof.timestamp,
        outputHash: result.proof.outputHash,
      } : undefined,
    };
  }
}


export function createComputeMarketplace(config: MarketplaceConfig): ComputeMarketplace {
  return new ComputeMarketplace(config);
}

// Re-export types
export { ModelTypeEnum, TEETypeEnum, ModelCapabilityEnum };
