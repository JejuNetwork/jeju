/**
 * Compute SDK - Handles inference through the compute marketplace.
 */

import type { AgentCharacter, ExecutionOptions } from '../types';
import { createLogger, type Logger } from './logger';

export interface ComputeConfig {
  marketplaceUrl: string;
  rpcUrl: string;
  defaultModel?: string;
  logger?: Logger;
}

export interface InferenceRequest {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface InferenceResponse {
  content: string;
  model: string;
  tokensUsed: { input: number; output: number };
  cost: bigint;
  latencyMs: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  pricePerInputToken: bigint;
  pricePerOutputToken: bigint;
  maxContextLength: number;
  capabilities: string[];
}

export class CrucibleCompute {
  private config: ComputeConfig;
  private log: Logger;

  constructor(config: ComputeConfig) {
    this.config = config;
    this.log = config.logger ?? createLogger('Compute');
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    this.log.debug('Fetching available models');
    const r = await fetch(`${this.config.marketplaceUrl}/api/v1/models`);
    if (!r.ok) {
      this.log.error('Failed to fetch models', { status: r.status });
      throw new Error(`Failed to fetch models: ${r.statusText}`);
    }
    const models = ((await r.json()) as { models: ModelInfo[] }).models;
    this.log.debug('Models fetched', { count: models.length });
    return models;
  }

  async getBestModel(requirements: {
    maxCost?: bigint;
    minContextLength?: number;
    capabilities?: string[];
  }): Promise<ModelInfo | null> {
    const models = await this.getAvailableModels();
    const filtered = models.filter(m => {
      if (requirements.minContextLength && m.maxContextLength < requirements.minContextLength) return false;
      if (requirements.capabilities && !requirements.capabilities.every(c => m.capabilities.includes(c))) return false;
      return true;
    });
    if (filtered.length === 0) return null;
    filtered.sort((a, b) => Number((a.pricePerInputToken + a.pricePerOutputToken) - (b.pricePerInputToken + b.pricePerOutputToken)));
    return filtered[0] ?? null;
  }

  async runInference(
    character: AgentCharacter,
    userMessage: string,
    context: { recentMessages?: Array<{ role: string; content: string }>; memories?: string[]; roomContext?: string },
    options?: ExecutionOptions
  ): Promise<InferenceResponse> {
    const model = character.modelPreferences?.large ?? this.config.defaultModel ?? 'llama-3.1-8b';
    this.log.info('Running inference', { model, messageLength: userMessage.length });

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: this.buildSystemPrompt(character, context) },
    ];
    if (context.recentMessages) messages.push(...context.recentMessages);
    messages.push({ role: 'user', content: userMessage });

    const result = await this.inference({
      messages,
      model,
      maxTokens: options?.maxTokens ?? 2048,
      temperature: options?.temperature ?? 0.7,
    });

    this.log.info('Inference complete', { model: result.model, tokensUsed: result.tokensUsed, latencyMs: result.latencyMs });
    return result;
  }

  async inference(request: InferenceRequest): Promise<InferenceResponse> {
    const start = Date.now();
    this.log.debug('Inference request', { model: request.model, messageCount: request.messages.length });

    const r = await fetch(`${this.config.marketplaceUrl}/api/v1/inference`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    });
    if (!r.ok) {
      const error = await r.text();
      this.log.error('Inference failed', { status: r.status, error });
      throw new Error(`Inference failed: ${error}`);
    }

    const result = await r.json() as {
      content: string; model: string; usage: { prompt_tokens: number; completion_tokens: number }; cost: string;
    };
    return {
      content: result.content, model: result.model,
      tokensUsed: { input: result.usage.prompt_tokens, output: result.usage.completion_tokens },
      cost: BigInt(result.cost), latencyMs: Date.now() - start,
    };
  }

  async generateEmbedding(text: string): Promise<number[]> {
    this.log.debug('Generating embedding', { textLength: text.length });
    const r = await fetch(`${this.config.marketplaceUrl}/api/v1/embeddings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: text }),
    });
    if (!r.ok) {
      this.log.error('Embedding failed', { status: r.status });
      throw new Error(`Embedding failed: ${r.statusText}`);
    }
    return ((await r.json()) as { embedding: number[] }).embedding;
  }

  async estimateCost(messages: Array<{ role: string; content: string }>, model: string, maxOutputTokens: number): Promise<bigint> {
    const models = await this.getAvailableModels();
    const m = models.find(x => x.id === model);
    if (!m) throw new Error(`Model not found: ${model}`);

    const inputTokens = Math.ceil(messages.reduce((sum, x) => sum + x.content.length, 0) / 4);
    return BigInt(inputTokens) * BigInt(m.pricePerInputToken) + BigInt(maxOutputTokens) * BigInt(m.pricePerOutputToken);
  }

  private buildSystemPrompt(character: AgentCharacter, context: { memories?: string[]; roomContext?: string }): string {
    const parts = [character.system];
    if (character.bio.length) parts.push('\n\nBackground:', character.bio.join('\n'));
    if (character.style.all.length) parts.push('\n\nStyle:', character.style.all.join('\n'));
    if (context.memories?.length) parts.push('\n\nMemories:', context.memories.join('\n'));
    if (context.roomContext) parts.push('\n\nContext:', context.roomContext);
    return parts.join('\n');
  }
}

export function createCompute(config: ComputeConfig): CrucibleCompute {
  return new CrucibleCompute(config);
}
