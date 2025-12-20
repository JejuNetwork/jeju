/**
 * Compute SDK - Handles inference through DWS (Decentralized Workstation Service)
 * 
 * Uses the same DWS infrastructure as Autocrat and Otto for unified AI inference.
 */

import { getDWSComputeUrl, getCurrentNetwork } from '@jejunetwork/config';
import type { AgentCharacter, ExecutionOptions } from '../types';
import { createLogger, type Logger } from './logger';

export interface ComputeConfig {
  marketplaceUrl?: string; // Optional - falls back to DWS
  rpcUrl: string;
  defaultModel?: string;
  logger?: Logger;
}

// Get DWS endpoint from centralized config
function getDWSEndpoint(): string {
  return process.env.DWS_URL ?? process.env.COMPUTE_MARKETPLACE_URL ?? getDWSComputeUrl();
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
    const endpoint = this.getEndpoint();
    const r = await fetch(`${endpoint}/models`);
    if (!r.ok) {
      this.log.error('Failed to fetch models', { status: r.status, endpoint });
      throw new Error(`Failed to fetch models from ${endpoint}: ${r.statusText}`);
    }
    const data = await r.json() as { models?: ModelInfo[]; data?: ModelInfo[] };
    const models = data.models ?? data.data ?? [];
    this.log.debug('Models fetched', { count: models.length });
    return models;
  }

  private getEndpoint(): string {
    return this.config.marketplaceUrl ?? getDWSEndpoint();
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
    const endpoint = this.getEndpoint();
    this.log.debug('Inference request', { model: request.model, messageCount: request.messages.length, endpoint });

    // Use OpenAI-compatible chat/completions endpoint (same as Autocrat/Otto)
    const r = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model ?? this.config.defaultModel ?? 'llama-3.1-8b-instant',
        messages: request.messages,
        max_tokens: request.maxTokens ?? 2048,
        temperature: request.temperature ?? 0.7,
      }),
    });

    if (!r.ok) {
      const error = await r.text();
      const network = getCurrentNetwork();
      this.log.error('Inference failed', { status: r.status, error, network, endpoint });
      throw new Error(`DWS inference failed (network: ${network}): ${error}`);
    }

    const result = await r.json() as {
      choices?: Array<{ message?: { content: string } }>;
      content?: string;
      model?: string;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const content = result.choices?.[0]?.message?.content ?? result.content ?? '';
    const usage = result.usage ?? { prompt_tokens: 0, completion_tokens: 0 };

    return {
      content,
      model: result.model ?? request.model ?? 'unknown',
      tokensUsed: { input: usage.prompt_tokens, output: usage.completion_tokens },
      cost: 0n, // DWS handles billing separately
      latencyMs: Date.now() - start,
    };
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const endpoint = this.getEndpoint();
    this.log.debug('Generating embedding', { textLength: text.length, endpoint });
    const r = await fetch(`${endpoint}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text, model: 'text-embedding-3-small' }),
    });
    if (!r.ok) {
      const network = getCurrentNetwork();
      this.log.error('Embedding failed', { status: r.status, network });
      throw new Error(`Embedding failed (network: ${network}): ${r.statusText}`);
    }
    const data = await r.json() as { embedding?: number[]; data?: Array<{ embedding: number[] }> };
    return data.embedding ?? data.data?.[0]?.embedding ?? [];
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
