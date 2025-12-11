/**
 * External Model Provider Bridge
 *
 * Provides an interface for accessing models via external APIs.
 * All model configurations come from the on-chain registry - no hardcoded models.
 *
 * Features:
 * - Standard inference API interface
 * - X402 payment integration
 * - Paymaster/multi-token support
 * - Automatic routing based on registry
 */

import { Wallet } from 'ethers';
import type { Address } from 'viem';
import type {
  InferenceRequest,
  InferenceResponse,
  ModelPricing,
  RegisteredModel,
} from './types';
import { createPaymentClient, type ComputePaymentClient } from './payment';
import type { X402Network, X402PaymentRequirement } from './x402';
import { ZERO_ADDRESS } from './x402';
import { createInferenceRegistry, type InferenceRegistrySDK } from './inference-registry';

export interface ExternalProviderConfig {
  rpcUrl: string;
  modelRegistryAddress?: string;
  network?: X402Network;
  recipientAddress?: Address;
  bundlerUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface InferenceOptions {
  paymentMethod?: 'x402' | 'credits' | 'paymaster' | 'direct';
  preferredToken?: Address;
  pricing?: Partial<ModelPricing>;
  timeout?: number;
}

export interface InferenceResult extends InferenceResponse {
  cost: bigint;
  paymentToken: Address;
  txHash?: string;
  servedBy: string;
  latencyMs: number;
}

interface StandardChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * External Model Provider
 *
 * Routes inference requests to models registered in the on-chain registry.
 * Uses endpoint URLs from the registry to make requests.
 */
export class ExternalModelProvider {
  private config: Required<ExternalProviderConfig>;
  private paymentClient: ComputePaymentClient | null;
  private registry: InferenceRegistrySDK;
  private signer: Wallet | null;

  constructor(config: ExternalProviderConfig, signer?: Wallet) {
    this.config = {
      rpcUrl: config.rpcUrl ?? process.env.JEJU_RPC_URL ?? 'http://127.0.0.1:9545',
      modelRegistryAddress: config.modelRegistryAddress ?? process.env.MODEL_REGISTRY_ADDRESS ?? '',
      network: config.network ?? 'jeju',
      recipientAddress: config.recipientAddress ?? ZERO_ADDRESS,
      bundlerUrl: config.bundlerUrl ?? process.env.BUNDLER_URL ?? '',
      timeout: config.timeout ?? 60000,
      maxRetries: config.maxRetries ?? 3,
    };

    this.signer = signer ?? null;

    this.paymentClient = this.config.rpcUrl
      ? createPaymentClient({ rpcUrl: this.config.rpcUrl, bundlerUrl: this.config.bundlerUrl })
      : null;

    this.registry = createInferenceRegistry({
      rpcUrl: this.config.rpcUrl,
      contracts: {
        registry: '0x0',
        ledger: '0x0',
        inference: '0x0',
        modelRegistry: this.config.modelRegistryAddress,
      },
    });
  }

  setSigner(signer: Wallet): void {
    this.signer = signer;
  }

  /** Get all models from the on-chain registry */
  async getAvailableModels(): Promise<RegisteredModel[]> {
    return this.registry.getAllModels();
  }

  /** Get a specific model from the registry */
  async getModel(modelId: string): Promise<RegisteredModel | null> {
    try {
      return await this.registry.getModel(modelId);
    } catch {
      return null;
    }
  }

  /** Estimate cost for a request */
  async estimateCost(
    modelId: string,
    estimatedInputTokens: number,
    estimatedOutputTokens: number
  ): Promise<bigint> {
    const model = await this.getModel(modelId);
    if (!model) throw new Error(`Model ${modelId} not found in registry`);
    return this.registry.estimateCost(model, estimatedInputTokens, estimatedOutputTokens);
  }

  /** Create a payment requirement for X402 */
  async createPaymentRequirement(
    modelId: string,
    estimatedInputTokens: number,
    estimatedOutputTokens: number
  ): Promise<X402PaymentRequirement> {
    const cost = await this.estimateCost(modelId, estimatedInputTokens, estimatedOutputTokens);

    return {
      x402Version: 1,
      error: `Payment required for ${modelId} inference`,
      accepts: [
        {
          scheme: 'exact',
          network: this.config.network,
          maxAmountRequired: cost.toString(),
          asset: ZERO_ADDRESS,
          payTo: this.config.recipientAddress,
          resource: `/v1/chat/completions?model=${modelId}`,
          description: `Inference request for ${modelId}`,
        },
        {
          scheme: 'credit',
          network: this.config.network,
          maxAmountRequired: cost.toString(),
          asset: ZERO_ADDRESS,
          payTo: this.config.recipientAddress,
          resource: `/v1/chat/completions?model=${modelId}`,
          description: 'Pay from prepaid credits',
        },
        {
          scheme: 'paymaster',
          network: this.config.network,
          maxAmountRequired: cost.toString(),
          asset: ZERO_ADDRESS,
          payTo: this.config.recipientAddress,
          resource: `/v1/chat/completions?model=${modelId}`,
          description: 'Pay with any supported token',
        },
      ],
    };
  }

  /** Complete inference request with payment */
  async complete(
    request: InferenceRequest,
    options?: InferenceOptions
  ): Promise<InferenceResult> {
    const startTime = Date.now();
    const model = await this.getModel(request.model);
    if (!model) {
      throw new Error(`Model ${request.model} not found in registry`);
    }

    // Get the best endpoint for this model
    const endpoint = await this.registry.getBestEndpoint(request.model);
    if (!endpoint) {
      throw new Error(`No available endpoint for model ${request.model}`);
    }

    // Estimate tokens for payment
    const estimatedInputTokens = this.estimateTokens(
      request.messages.map(m => m.content).join(' ')
    );
    const estimatedOutputTokens = request.max_tokens ?? 1000;

    // Handle payment if required
    const paymentMethod = options?.paymentMethod ?? 'x402';
    let txHash: string | undefined;
    let paymentToken: Address = ZERO_ADDRESS;

    if (paymentMethod !== 'direct' && this.signer) {
      const cost = this.registry.estimateCost(model, estimatedInputTokens, estimatedOutputTokens);

      if (paymentMethod === 'paymaster' && this.paymentClient) {
        const result = await this.paymentClient.payForCompute(
          this.signer,
          cost,
          options?.preferredToken
        );
        txHash = result.txHash;
        paymentToken = result.tokenUsed;
      }
    }

    // Make the inference request to the endpoint
    const response = await this.makeInferenceRequest(request, endpoint.endpoint, options?.timeout);

    // Calculate actual cost based on usage
    const actualCost = this.calculateActualCost(model, response.usage);
    const latencyMs = Date.now() - startTime;

    return {
      ...response,
      cost: actualCost,
      paymentToken,
      txHash,
      servedBy: endpoint.providerAddress,
      latencyMs,
    };
  }

  private async makeInferenceRequest(
    request: InferenceRequest,
    endpointUrl: string,
    timeout?: number
  ): Promise<InferenceResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      timeout ?? this.config.timeout
    );

    const response = await fetch(`${endpointUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        stream: request.stream ?? false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Inference error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as StandardChatResponse;

    return {
      id: data.id,
      model: request.model,
      choices: data.choices.map(c => ({
        message: {
          role: c.message.role,
          content: c.message.content ?? '',
        },
        finish_reason: c.finish_reason,
      })),
      usage: {
        prompt_tokens: data.usage.prompt_tokens,
        completion_tokens: data.usage.completion_tokens,
        total_tokens: data.usage.total_tokens,
      },
    };
  }

  private calculateActualCost(
    model: RegisteredModel,
    usage: { prompt_tokens: number; completion_tokens: number }
  ): bigint {
    return this.registry.estimateCost(model, usage.prompt_tokens, usage.completion_tokens);
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /** Stream inference request */
  async *stream(
    request: InferenceRequest,
    _options?: InferenceOptions
  ): AsyncGenerator<{ content: string; done: boolean }> {
    const model = await this.getModel(request.model);
    if (!model) {
      throw new Error(`Model ${request.model} not found in registry`);
    }

    const endpoint = await this.registry.getBestEndpoint(request.model);
    if (!endpoint) {
      throw new Error(`No available endpoint for model ${request.model}`);
    }

    const response = await fetch(`${endpoint.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Inference error (${response.status}): ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const lines = text.split('\n').filter(l => l.startsWith('data: '));

      for (const line of lines) {
        const data = line.slice(6);
        if (data === '[DONE]') {
          yield { content: '', done: true };
          return;
        }

        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const content = parsed.choices?.[0]?.delta?.content ?? '';
        if (content) {
          yield { content, done: false };
        }
      }
    }
  }
}

export function createExternalProvider(
  config: ExternalProviderConfig,
  signer?: Wallet
): ExternalModelProvider {
  return new ExternalModelProvider(config, signer);
}

/** @deprecated Use createExternalProvider instead */
export const createCloudProvider = createExternalProvider;
/** @deprecated Use ExternalModelProvider instead */
export type CloudModelProvider = ExternalModelProvider;
