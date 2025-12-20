/**
 * Crucible ElizaOS Runtime Adapter
 * 
 * Provides ElizaOS-compatible runtime for Crucible agents.
 * Uses DWS for decentralized AI inference (same as Autocrat and Otto).
 */

import { getDWSComputeUrl, getCurrentNetwork } from '@jejunetwork/config';
import type { AgentCharacter, AgentState } from '../types';
import { createLogger, type Logger } from './logger';

// ElizaOS types - loaded dynamically to avoid import errors when not installed
type ElizaAgentRuntime = {
  character: unknown;
  agentId: string;
  registerPlugin: (plugin: unknown) => Promise<void>;
  processActions: (memory: unknown, responses: unknown[], state: unknown, callback: unknown) => Promise<void>;
};
type UUID = string;

let ElizaAgentRuntimeClass: (new (opts: unknown) => ElizaAgentRuntime) | null = null;

export interface RuntimeConfig {
  agentId: string;
  character: AgentCharacter;
  useElizaOS?: boolean; // If true, uses ElizaOS when available; if false, uses DWS directly
  plugins?: unknown[];
  logger?: Logger;
}

export interface RuntimeMessage {
  id: string;
  userId: string;
  roomId: string;
  content: { text: string; source?: string };
  createdAt: number;
}

export interface RuntimeResponse {
  text: string;
  actions?: Array<{ name: string; params: Record<string, string> }>;
}

// Get DWS endpoint
function getDWSEndpoint(): string {
  return process.env.DWS_URL ?? getDWSComputeUrl();
}

export async function checkDWSHealth(): Promise<boolean> {
  const endpoint = getDWSEndpoint();
  try {
    const r = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(2000) });
    return r?.ok ?? false;
  } catch {
    return false;
  }
}

// DWS generate function (same pattern as Autocrat)
export async function dwsGenerate(
  prompt: string,
  systemPrompt: string,
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  const endpoint = getDWSEndpoint();
  const r = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 500,
    }),
  });

  if (!r.ok) {
    const network = getCurrentNetwork();
    throw new Error(`DWS compute error (network: ${network}): ${r.status}`);
  }

  const data = (await r.json()) as { choices?: Array<{ message?: { content: string } }>; content?: string };
  return data.choices?.[0]?.message?.content ?? data.content ?? '';
}

/**
 * Crucible Agent Runtime
 * 
 * Wraps ElizaOS (when available) or provides DWS-only fallback.
 * Ensures consistent behavior across all Jeju Network agents.
 */
export class CrucibleAgentRuntime {
  private config: RuntimeConfig;
  private log: Logger;
  private elizaRuntime: ElizaAgentRuntime | null = null;
  private initialized = false;
  private dwsAvailable = false;

  constructor(config: RuntimeConfig) {
    this.config = config;
    this.log = config.logger ?? createLogger(`Runtime:${config.agentId}`);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.log.info('Initializing runtime', { agentId: this.config.agentId });

    // Check DWS availability
    this.dwsAvailable = await checkDWSHealth();
    this.log.info('DWS health', { available: this.dwsAvailable, endpoint: getDWSEndpoint() });

    // Try to initialize ElizaOS runtime if requested
    if (this.config.useElizaOS !== false) {
      try {
        await this.initElizaOS();
      } catch (e) {
        this.log.warn('ElizaOS init failed, using DWS-only mode', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    this.initialized = true;
  }

  private async initElizaOS(): Promise<void> {
    if (!ElizaAgentRuntimeClass) {
      const elizaos = await import('@elizaos/core');
      ElizaAgentRuntimeClass = elizaos.AgentRuntime as unknown as typeof ElizaAgentRuntimeClass;
    }

    if (!ElizaAgentRuntimeClass) {
      throw new Error('ElizaOS AgentRuntime not available');
    }

    // Convert Crucible character to ElizaOS character format
    const elizaCharacter = this.toElizaCharacter(this.config.character);
    
    const runtime = new ElizaAgentRuntimeClass({
      character: elizaCharacter,
      agentId: this.config.agentId as UUID,
      plugins: this.config.plugins ?? [],
    });

    // Register plugins
    for (const plugin of this.config.plugins ?? []) {
      await runtime.registerPlugin(plugin);
    }

    this.elizaRuntime = runtime;
    this.log.info('ElizaOS runtime initialized');
  }

  /**
   * Process a message through the runtime
   */
  async processMessage(message: RuntimeMessage): Promise<RuntimeResponse> {
    if (!this.initialized) {
      await this.initialize();
    }

    // If ElizaOS is available, use it
    if (this.elizaRuntime) {
      return this.processWithEliza(message);
    }

    // Otherwise, use DWS directly
    return this.processWithDWS(message);
  }

  private async processWithEliza(message: RuntimeMessage): Promise<RuntimeResponse> {
    const responses: string[] = [];

    const memory = {
      id: message.id as UUID,
      userId: message.userId as UUID,
      roomId: message.roomId as UUID,
      content: message.content,
      createdAt: message.createdAt,
    };

    await this.elizaRuntime?.processActions(
      memory,
      responses as unknown as never[],
      undefined,
      async (response: { text?: string }) => {
        if (response.text) {
          responses.push(response.text);
        }
      }
    );

    return {
      text: responses.join('\n') || 'I received your message.',
      actions: this.extractActions(responses.join('\n')),
    };
  }

  private async processWithDWS(message: RuntimeMessage): Promise<RuntimeResponse> {
    if (!this.dwsAvailable) {
      throw new Error(`DWS compute required but not available (network: ${getCurrentNetwork()})`);
    }

    const systemPrompt = this.buildSystemPrompt();
    const response = await dwsGenerate(message.content.text, systemPrompt, {
      maxTokens: 1000,
      temperature: 0.7,
    });

    return {
      text: response,
      actions: this.extractActions(response),
    };
  }

  private buildSystemPrompt(): string {
    const char = this.config.character;
    const parts = [char.system];

    if (char.bio?.length) {
      parts.push('\n\nBackground:', char.bio.join('\n'));
    }
    if (char.style?.all?.length) {
      parts.push('\n\nStyle guidelines:', char.style.all.join('\n'));
    }
    if (char.topics?.length) {
      parts.push('\n\nTopics of expertise:', char.topics.join(', '));
    }

    return parts.join('\n');
  }

  /**
   * Extract action commands from response
   * Format: [ACTION: NAME | param=value, param2=value2]
   */
  private extractActions(text: string): Array<{ name: string; params: Record<string, string> }> {
    const actions: Array<{ name: string; params: Record<string, string> }> = [];
    const actionRegex = /\[ACTION:\s*(\w+)\s*\|([^\]]+)\]/g;

    let match;
    while ((match = actionRegex.exec(text)) !== null) {
      const name = match[1];
      const paramsStr = match[2];
      const params: Record<string, string> = {};

      // Parse params: "key=value, key2=value2"
      const paramPairs = paramsStr.split(',').map(p => p.trim());
      for (const pair of paramPairs) {
        const [key, ...valueParts] = pair.split('=');
        if (key && valueParts.length) {
          params[key.trim()] = valueParts.join('=').trim();
        }
      }

      actions.push({ name, params });
    }

    return actions;
  }

  /**
   * Convert Crucible character to ElizaOS character format
   */
  private toElizaCharacter(char: AgentCharacter): Record<string, unknown> {
    return {
      name: char.name,
      system: char.system,
      bio: char.bio,
      messageExamples: char.messageExamples,
      topics: char.topics,
      adjectives: char.adjectives,
      style: char.style,
      settings: {
        model: char.modelPreferences?.large ?? 'llama-3.1-8b-instant',
        secrets: {
          OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
          GROQ_API_KEY: process.env.GROQ_API_KEY,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        },
      },
    };
  }

  // ============ Lifecycle ============

  isInitialized(): boolean {
    return this.initialized;
  }

  isDWSAvailable(): boolean {
    return this.dwsAvailable;
  }

  isElizaOSAvailable(): boolean {
    return !!this.elizaRuntime;
  }

  getAgentId(): string {
    return this.config.agentId;
  }

  getCharacter(): AgentCharacter {
    return this.config.character;
  }
}

/**
 * Create a new Crucible agent runtime
 */
export function createCrucibleRuntime(config: RuntimeConfig): CrucibleAgentRuntime {
  return new CrucibleAgentRuntime(config);
}

/**
 * Runtime manager for multiple agents
 */
export class CrucibleRuntimeManager {
  private runtimes = new Map<string, CrucibleAgentRuntime>();
  private log = createLogger('RuntimeManager');

  async createRuntime(config: RuntimeConfig): Promise<CrucibleAgentRuntime> {
    if (this.runtimes.has(config.agentId)) {
      return this.runtimes.get(config.agentId)!;
    }

    const runtime = new CrucibleAgentRuntime(config);
    await runtime.initialize();
    this.runtimes.set(config.agentId, runtime);

    this.log.info('Runtime created', { agentId: config.agentId });
    return runtime;
  }

  getRuntime(agentId: string): CrucibleAgentRuntime | undefined {
    return this.runtimes.get(agentId);
  }

  getAllRuntimes(): CrucibleAgentRuntime[] {
    return Array.from(this.runtimes.values());
  }

  async shutdown(): Promise<void> {
    this.runtimes.clear();
    this.log.info('All runtimes shut down');
  }
}

export const runtimeManager = new CrucibleRuntimeManager();

