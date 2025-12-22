/**
 * Crucible Agent Runtime
 * 
 * Real ElizaOS AgentRuntime integration with @jejunetwork/eliza-plugin.
 * Provides full plugin execution with 60+ network actions.
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

// Jeju plugin - loaded once
let jejuPluginLoaded: ElizaPlugin | null = null;

export interface RuntimeConfig {
  agentId: string;
  character: AgentCharacter;
  plugins?: ElizaPlugin[];
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

// ============================================================================
// Crucible Agent Runtime - ElizaOS Integration
// ============================================================================

/**
 * Crucible Agent Runtime
 * 
 * Wraps ElizaOS AgentRuntime with @jejunetwork/eliza-plugin.
 * No fallback - ElizaOS is required.
 */
export class CrucibleAgentRuntime {
  private config: RuntimeConfig;
  private log: Logger;
  private elizaRuntime!: ElizaAgentRuntime;
  private initialized = false;

  constructor(config: RuntimeConfig) {
    this.config = config;
    this.log = config.logger ?? createLogger(`Runtime:${config.agentId}`);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.log.info('Initializing agent runtime', { agentId: this.config.agentId });

    // Load ElizaOS - required
    if (!AgentRuntimeClass) {
      const elizaos = await import('@elizaos/core').catch((e) => {
        throw new Error(`ElizaOS is required but failed to load: ${e}`);
      });
      
      if (!elizaos?.AgentRuntime) {
        throw new Error('ElizaOS AgentRuntime not found in @elizaos/core');
      }
      
      AgentRuntimeClass = elizaos.AgentRuntime as unknown as typeof AgentRuntimeClass;
    }

    // Load jeju plugin - required
    const plugins: ElizaPlugin[] = [...(this.config.plugins ?? [])];
    
    if (!jejuPluginLoaded) {
      const jejuPlugin = await import('@jejunetwork/eliza-plugin').catch((e) => {
        throw new Error(`@jejunetwork/eliza-plugin is required but failed to load: ${e}`);
      });
      
      if (!jejuPlugin?.jejuPlugin) {
        throw new Error('jejuPlugin not found in @jejunetwork/eliza-plugin');
      }
      
      jejuPluginLoaded = jejuPlugin.jejuPlugin as ElizaPlugin;
    }
    
    plugins.push(jejuPluginLoaded);
    this.log.info('Jeju plugin loaded', { 
      actions: (jejuPluginLoaded.actions as unknown[])?.length ?? 0 
    });

    // Convert AgentCharacter to ElizaOS Character format
    const character = this.convertToElizaCharacter(this.config.character);

    // Create the runtime
    this.elizaRuntime = new AgentRuntimeClass!({
      character,
      agentId: this.config.agentId as UUID,
      plugins,
      modelProvider: 'openai', // DWS uses OpenAI-compatible API
    });

    // Register plugins
    for (const plugin of plugins) {
      await this.elizaRuntime.registerPlugin(plugin);
    }

    this.log.info('Agent runtime initialized', { 
      agentId: this.config.agentId,
      characterName: this.config.character.name,
      plugins: plugins.map(p => p.name),
    });
    
    this.initialized = true;
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

  // ============ Lifecycle ============

  isInitialized(): boolean {
    return this.initialized;
  }

  getAgentId(): string {
    return this.config.agentId;
  }

  getCharacter(): AgentCharacter {
    return this.config.character;
  }

  getElizaRuntime(): ElizaAgentRuntime {
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
