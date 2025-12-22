/**
 * Crucible Agent Runtime
 * 
 * Character-based agent runtime using DWS for inference.
 * Integrates jeju plugin actions for network capabilities.
 * 
 * Uses DWS OpenAI-compatible API with character-based system prompts.
 */

import { getDWSComputeUrl } from '@jejunetwork/config';
import type { AgentCharacter } from '../types';
import { createLogger, type Logger } from './logger';

// Jeju plugin action definitions
interface JejuAction {
  name: string;
  description: string;
  parameters?: Record<string, { type: string; description?: string }>;
}

// Loaded jeju plugin actions
let jejuActions: JejuAction[] = [];
let jejuPluginLoaded = false;

export interface RuntimeConfig {
  agentId: string;
  character: AgentCharacter;
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
}

// ============================================================================
// DWS Integration
// ============================================================================

function getDWSEndpoint(): string {
  return process.env.DWS_URL ?? getDWSComputeUrl();
}

export async function checkDWSHealth(): Promise<boolean> {
  const endpoint = getDWSEndpoint();
  const r = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
  return r?.ok ?? false;
}

interface DWSChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface DWSChatRequest {
  model: string;
  messages: DWSChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

interface DWSChatResponse {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
}

/**
 * Get the best available inference endpoint
 */
function getInferenceConfig(): { endpoint: string; apiKey?: string; model: string } {
  // Check for OpenAI API key
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return {
      endpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: openaiKey,
      model: 'gpt-4o-mini',
    };
  }

  // Check for OpenRouter API key
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey) {
    return {
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: openrouterKey,
      model: 'openai/gpt-4o-mini',
    };
  }

  // Fall back to DWS
  return {
    endpoint: getDWSEndpoint() + '/compute/chat/completions',
    model: 'llama-3.1-8b-instant',
  };
}

/**
 * Call OpenAI-compatible chat completions API
 */
async function generateResponse(
  systemPrompt: string,
  userMessage: string,
  options: { model?: string; temperature?: number } = {}
): Promise<string> {
  const config = getInferenceConfig();
  const model = options.model ?? config.model;

  const request: DWSChatRequest = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: options.temperature ?? 0.7,
    max_tokens: 1024,
  };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Inference request failed: ${response.status} ${error}`);
  }

  const data = (await response.json()) as DWSChatResponse;
  return data.choices[0]?.message?.content ?? '';
}

// ============================================================================
// Crucible Agent Runtime
// ============================================================================

/**
 * Crucible Agent Runtime
 * 
 * Character-based agent using DWS for inference.
 * Includes jeju plugin actions in context.
 */
export class CrucibleAgentRuntime {
  private config: RuntimeConfig;
  private log: Logger;
  private initialized = false;

  constructor(config: RuntimeConfig) {
    this.config = config;
    this.log = config.logger ?? createLogger(`Runtime:${config.agentId}`);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.log.info('Initializing agent runtime', { agentId: this.config.agentId });

    // Check what inference backend is available
    const config = getInferenceConfig();
    if (config.apiKey) {
      this.log.info('Using API-based inference', { endpoint: config.endpoint.split('/')[2] });
    } else {
      // Check DWS availability
      const dwsOk = await checkDWSHealth();
      if (!dwsOk) {
        throw new Error(`No inference backend available. Set OPENAI_API_KEY or OPENROUTER_API_KEY, or start DWS at ${getDWSEndpoint()}`);
      }
      this.log.info('Using DWS inference');
    }

    // Load jeju plugin actions if not already loaded
    if (!jejuPluginLoaded) {
      try {
        const jejuPlugin = await import('@jejunetwork/eliza-plugin');
        if (jejuPlugin?.jejuPlugin?.actions) {
          jejuActions = (jejuPlugin.jejuPlugin.actions as JejuAction[]).map((a) => ({
            name: a.name,
            description: a.description ?? '',
            parameters: a.parameters,
          }));
          this.log.info('Jeju plugin loaded', { actions: jejuActions.length });
        }
        jejuPluginLoaded = true;
      } catch (e) {
        this.log.warn('Jeju plugin not available', { error: String(e) });
        jejuPluginLoaded = true; // Mark as attempted
      }
    }

    this.log.info('Agent runtime initialized', { 
      agentId: this.config.agentId,
      characterName: this.config.character.name,
      actions: jejuActions.length,
    });
    
    this.initialized = true;
  }

  /**
   * Build system prompt from character
   */
  private buildSystemPrompt(): string {
    const char = this.config.character;
    const parts: string[] = [];

    // Character identity
    parts.push(`You are ${char.name}.`);
    
    if (char.system) {
      parts.push(char.system);
    }

    // Bio
    if (char.bio) {
      const bio = Array.isArray(char.bio) ? char.bio.join(' ') : char.bio;
      parts.push(bio);
    }

    // Topics
    if (char.topics?.length) {
      parts.push(`You are knowledgeable about: ${char.topics.join(', ')}.`);
    }

    // Adjectives
    if (char.adjectives?.length) {
      parts.push(`Your personality traits: ${char.adjectives.join(', ')}.`);
    }

    // Style
    if (char.style?.all?.length) {
      parts.push(`Communication style: ${char.style.all.join(' ')}`);
    }

    // Available actions (from jeju plugin)
    if (jejuActions.length > 0) {
      parts.push('\nYou have access to the following actions:');
      for (const action of jejuActions.slice(0, 20)) { // Limit to 20 for prompt length
        parts.push(`- ${action.name}: ${action.description}`);
      }
      parts.push('\nWhen you need to take an action, respond with [ACTION:ACTION_NAME] followed by your message.');
    }

    return parts.join('\n\n');
  }

  /**
   * Extract action from response if present
   */
  private extractAction(text: string): { action?: string; cleanText: string } {
    const actionMatch = text.match(/\[ACTION:([A-Z_]+)\]/i);
    if (actionMatch) {
      return {
        action: actionMatch[1].toUpperCase(),
        cleanText: text.replace(actionMatch[0], '').trim(),
      };
    }
    return { cleanText: text };
  }

  /**
   * Process a message through the agent
   */
  async processMessage(message: RuntimeMessage): Promise<RuntimeResponse> {
    if (!this.initialized) {
      await this.initialize();
    }

    const systemPrompt = this.buildSystemPrompt();
    const userText = message.content.text;

    this.log.info('Processing message', { 
      agentId: this.config.agentId,
      userId: message.userId,
      textLength: userText.length,
    });

    // Generate response
    const rawResponse = await generateResponse(systemPrompt, userText);

    // Extract action if present
    const { action, cleanText } = this.extractAction(rawResponse);

    this.log.info('Generated response', { 
      agentId: this.config.agentId,
      responseLength: cleanText.length,
      action,
    });

    return {
      text: cleanText,
      action,
      actions: action ? [{ name: action, params: {} }] : undefined,
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

  /** Check if actions are available */
  hasActions(): boolean {
    return jejuActions.length > 0;
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
