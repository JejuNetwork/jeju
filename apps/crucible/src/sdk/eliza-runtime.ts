/**
 * Crucible Agent Runtime
 * 
 * Real ElizaOS AgentRuntime integration with @jejunetwork/eliza-plugin.
 * Provides proper plugin execution, action handling, and message processing.
 * 
 * DWS provides the inference backend; ElizaOS handles agent behavior.
 */

import { getDWSComputeUrl, getCurrentNetwork } from '@jejunetwork/config';
import type { AgentCharacter } from '../types';
import { createLogger, type Logger } from './logger';

// ElizaOS types - dynamically imported to handle version differences
type ElizaCharacter = Record<string, string | string[] | Record<string, unknown> | unknown[]>;
type ElizaPlugin = { name: string; description?: string; actions?: unknown[]; providers?: unknown[]; services?: unknown[] };
type ElizaMemory = { id?: string; userId: string; roomId: string; content: { text: string; source?: string }; createdAt?: number };
type ElizaState = Record<string, unknown>;
type ElizaResponse = { text: string; action?: string; content?: Record<string, unknown> };

interface ElizaAgentRuntime {
  character: ElizaCharacter;
  agentId: string;
  registerPlugin: (plugin: ElizaPlugin) => Promise<void>;
  processMessage: (message: ElizaMemory, state?: ElizaState) => Promise<ElizaResponse>;
  composeState: (message: ElizaMemory) => Promise<ElizaState>;
}

type UUID = string;

// Runtime class constructor type
let AgentRuntimeClass: (new (opts: { 
  character: ElizaCharacter; 
  agentId: UUID; 
  plugins: ElizaPlugin[];
  modelProvider?: string;
}) => ElizaAgentRuntime) | null = null;

// Jeju plugin - loaded dynamically
let jejuPluginLoaded: ElizaPlugin | null = null;

export interface RuntimeConfig {
  agentId: string;
  character: AgentCharacter;
  plugins?: ElizaPlugin[];
  useJejuPlugin?: boolean;
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
  action?: string;
  actions?: Array<{ name: string; params: Record<string, string> }>;
  content?: Record<string, unknown>;
}

// ============================================================================
// DWS Health Check
// ============================================================================

function getDWSEndpoint(): string {
  return process.env.DWS_URL ?? getDWSComputeUrl();
}

export async function checkDWSHealth(): Promise<boolean> {
  const endpoint = getDWSEndpoint();
  const r = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
  return r?.ok ?? false;
}

/**
 * Direct DWS inference (fallback when ElizaOS runtime unavailable)
 */
export async function dwsGenerate(
  prompt: string,
  systemPrompt: string,
  options: { maxTokens?: number; temperature?: number; model?: string } = {}
): Promise<string> {
  const endpoint = getDWSEndpoint();
  const r = await fetch(`${endpoint}/compute/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options.model ?? 'llama-3.1-8b-instant',
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
    const errorText = await r.text();
    throw new Error(`DWS compute error (network: ${network}): ${r.status} - ${errorText}`);
  }

  const data = (await r.json()) as { choices?: Array<{ message?: { content: string } }>; content?: string };
  return data.choices?.[0]?.message?.content ?? data.content ?? '';
}

// ============================================================================
// Crucible Agent Runtime - Real ElizaOS Integration
// ============================================================================

/**
 * Crucible Agent Runtime
 * 
 * Wraps ElizaOS AgentRuntime with @jejunetwork/eliza-plugin for:
 * - Real plugin/action execution
 * - Proper message handling
 * - DWS-backed inference
 */
export class CrucibleAgentRuntime {
  private config: RuntimeConfig;
  private log: Logger;
  private elizaRuntime: ElizaAgentRuntime | null = null;
  private initialized = false;
  private dwsAvailable = false;
  private elizaAvailable = false;
  private systemPrompt: string = '';

  constructor(config: RuntimeConfig) {
    this.config = config;
    this.log = config.logger ?? createLogger(`Runtime:${config.agentId}`);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.log.info('Initializing agent runtime', { agentId: this.config.agentId });

    // Check DWS availability
    this.dwsAvailable = await checkDWSHealth();
    if (!this.dwsAvailable) {
      this.log.warn('DWS not available - some features may be limited');
    }

    // Try to initialize ElizaOS runtime
    await this.initializeElizaRuntime();

    // Build system prompt for fallback mode
    this.systemPrompt = this.buildSystemPrompt();

    this.log.info('Agent runtime initialized', { 
      agentId: this.config.agentId,
      characterName: this.config.character.name,
      elizaAvailable: this.elizaAvailable,
      dwsAvailable: this.dwsAvailable,
    });
    
    this.initialized = true;
  }

  /**
   * Initialize the real ElizaOS runtime with plugins
   */
  private async initializeElizaRuntime(): Promise<void> {
    // Dynamically import ElizaOS
    if (!AgentRuntimeClass) {
      const elizaos = await import('@elizaos/core').catch((e) => {
        this.log.warn('ElizaOS not available', { error: String(e) });
        return null;
      });
      
      if (elizaos?.AgentRuntime) {
        AgentRuntimeClass = elizaos.AgentRuntime as unknown as typeof AgentRuntimeClass;
      }
    }

    if (!AgentRuntimeClass) {
      this.log.info('Running without ElizaOS runtime - using DWS inference directly');
      return;
    }

    // Load jeju plugin if requested
    const plugins: ElizaPlugin[] = [...(this.config.plugins ?? [])];
    
    if (this.config.useJejuPlugin !== false) {
      if (!jejuPluginLoaded) {
        const jejuPlugin = await import('@jejunetwork/eliza-plugin').catch((e) => {
          this.log.warn('Jeju plugin not available', { error: String(e) });
          return null;
        });
        
        if (jejuPlugin?.jejuPlugin) {
          jejuPluginLoaded = jejuPlugin.jejuPlugin as ElizaPlugin;
        }
      }
      
      if (jejuPluginLoaded) {
        plugins.push(jejuPluginLoaded);
        this.log.info('Jeju plugin loaded', { 
          actions: (jejuPluginLoaded.actions as unknown[])?.length ?? 0 
        });
      }
    }

    // Convert AgentCharacter to ElizaOS Character format
    const character = this.convertToElizaCharacter(this.config.character);

    // Create the runtime
    this.elizaRuntime = new AgentRuntimeClass({
      character,
      agentId: this.config.agentId as UUID,
      plugins,
      modelProvider: 'openai', // DWS uses OpenAI-compatible API
    });

    // Register plugins
    for (const plugin of plugins) {
      await this.elizaRuntime.registerPlugin(plugin);
    }

    this.elizaAvailable = true;
    this.log.info('ElizaOS runtime initialized', { plugins: plugins.map(p => p.name) });
  }

  /**
   * Convert AgentCharacter to ElizaOS Character format
   */
  private convertToElizaCharacter(char: AgentCharacter): ElizaCharacter {
    return {
      name: char.name,
      system: char.system,
      bio: char.bio,
      messageExamples: char.messageExamples,
      topics: char.topics,
      adjectives: char.adjectives,
      style: char.style,
      modelEndpointOverride: getDWSEndpoint() + '/compute/chat/completions',
      settings: {
        model: char.modelPreferences?.large ?? 'llama-3.1-8b-instant',
        ...(char.mcpServers ? { mcpServers: char.mcpServers } : {}),
      },
      plugins: [],
    };
  }

  /**
   * Process a message through the agent
   */
  async processMessage(message: RuntimeMessage): Promise<RuntimeResponse> {
    if (!this.initialized) {
      await this.initialize();
    }

    // If ElizaOS runtime is available, use it for proper action handling
    if (this.elizaRuntime && this.elizaAvailable) {
      return this.processWithEliza(message);
    }

    // Fallback to direct DWS inference
    return this.processWithDWS(message);
  }

  /**
   * Process message through ElizaOS runtime (full action support)
   */
  private async processWithEliza(message: RuntimeMessage): Promise<RuntimeResponse> {
    if (!this.elizaRuntime) {
      throw new Error('ElizaOS runtime not initialized');
    }

    const elizaMessage: ElizaMemory = {
      id: message.id,
      userId: message.userId,
      roomId: message.roomId,
      content: { text: message.content.text, source: message.content.source },
      createdAt: message.createdAt,
    };

    // Compose state for context
    const state = await this.elizaRuntime.composeState(elizaMessage);

    // Process through ElizaOS
    const response = await this.elizaRuntime.processMessage(elizaMessage, state);

    return {
      text: response.text,
      action: response.action,
      content: response.content,
      actions: response.action ? [{ name: response.action, params: {} }] : undefined,
    };
  }

  /**
   * Process message with direct DWS inference (fallback)
   */
  private async processWithDWS(message: RuntimeMessage): Promise<RuntimeResponse> {
    if (!this.dwsAvailable) {
      throw new Error(`DWS compute not available for agent ${this.config.agentId}`);
    }

    const response = await dwsGenerate(message.content.text, this.systemPrompt, {
      maxTokens: 1000,
      temperature: 0.7,
    });

    return {
      text: response,
      actions: this.extractActions(response),
    };
  }

  /**
   * Build system prompt from character definition
   */
  private buildSystemPrompt(): string {
    const char = this.config.character;
    const parts = [`You are ${char.name}.`, char.system];

    if (char.bio?.length) {
      parts.push('\n\nBackground:', char.bio.join('\n'));
    }
    if (char.style?.all?.length) {
      parts.push('\n\nStyle guidelines:', char.style.all.join('\n'));
    }
    if (char.topics?.length) {
      parts.push('\n\nTopics of expertise:', char.topics.join(', '));
    }
    if (char.adjectives?.length) {
      parts.push('\n\nPersonality traits:', char.adjectives.join(', '));
    }

    return parts.join('\n');
  }

  /**
   * Extract action commands from response (fallback parsing)
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

  // ============ Lifecycle ============

  isInitialized(): boolean {
    return this.initialized;
  }

  isDWSAvailable(): boolean {
    return this.dwsAvailable;
  }

  isElizaOSAvailable(): boolean {
    return this.elizaAvailable;
  }

  getAgentId(): string {
    return this.config.agentId;
  }

  getCharacter(): AgentCharacter {
    return this.config.character;
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  getElizaRuntime(): ElizaAgentRuntime | null {
    return this.elizaRuntime;
  }
}

/**
 * Create a new Crucible agent runtime
 */
export function createCrucibleRuntime(config: RuntimeConfig): CrucibleAgentRuntime {
  return new CrucibleAgentRuntime(config);
}

// ============================================================================
// Runtime Manager
// ============================================================================

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

    this.log.info('Runtime created', { 
      agentId: config.agentId,
      elizaOS: runtime.isElizaOSAvailable(),
      dws: runtime.isDWSAvailable(),
    });
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
