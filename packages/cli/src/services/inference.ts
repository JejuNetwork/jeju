/**
 * Local Inference Service
 * 
 * Wraps external inference providers (OpenAI, Claude, Groq) as local
 * decentralized inference nodes for development/testing.
 * 
 * Provides OpenAI-compatible API at localhost.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from '../lib/logger';

export interface InferenceConfig {
  port: number;
  providers: InferenceProvider[];
  defaultModel?: string;
}

export interface InferenceProvider {
  name: string;
  type: 'openai' | 'anthropic' | 'groq' | 'local';
  apiKey?: string;
  baseUrl?: string;
  models: string[];
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

const DEFAULT_PROVIDERS: InferenceProvider[] = [
  {
    name: 'openai',
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  {
    name: 'anthropic',
    type: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  },
  {
    name: 'groq',
    type: 'groq',
    apiKey: process.env.GROQ_API_KEY,
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
  },
];

class LocalInferenceServer {
  private app: Hono;
  private providers: InferenceProvider[];
  private port: number;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private defaultModel: string;

  constructor(config: Partial<InferenceConfig> = {}) {
    this.port = config.port || 4100;
    this.providers = config.providers || DEFAULT_PROVIDERS.filter(p => p.apiKey);
    this.defaultModel = config.defaultModel || this.getDefaultModel();
    this.app = new Hono();
    this.setupRoutes();
  }

  private getDefaultModel(): string {
    // Prefer Groq for speed, then OpenAI, then Anthropic
    for (const provider of this.providers) {
      if (provider.type === 'groq' && provider.apiKey) return 'llama-3.1-70b-versatile';
      if (provider.type === 'openai' && provider.apiKey) return 'gpt-4o-mini';
      if (provider.type === 'anthropic' && provider.apiKey) return 'claude-3-5-haiku-20241022';
    }
    return 'local-fallback';
  }

  private setupRoutes(): void {
    this.app.use('*', cors());

    // Health check
    this.app.get('/health', (c) => c.json({ status: 'ok', providers: this.providers.length }));

    // Models list
    this.app.get('/v1/models', (c) => {
      const models = this.providers.flatMap(p =>
        p.models.map(m => ({
          id: m,
          object: 'model',
          created: Date.now(),
          owned_by: p.name,
        }))
      );

      // Add local fallback
      models.push({
        id: 'local-fallback',
        object: 'model',
        created: Date.now(),
        owned_by: 'jeju',
      });

      return c.json({ object: 'list', data: models });
    });

    // Chat completions
    this.app.post('/v1/chat/completions', async (c) => {
      const body = await c.req.json<ChatRequest>();
      const model = body.model || this.defaultModel;

      // Find provider for model
      const provider = this.findProviderForModel(model);

      if (!provider) {
        // Local fallback
        return c.json(this.localFallback(body));
      }

      try {
        const response = await this.proxyToProvider(provider, body);
        return c.json(response);
      } catch (error) {
        logger.warn(`Provider ${provider.name} failed, using fallback`);
        return c.json(this.localFallback(body));
      }
    });
  }

  private findProviderForModel(model: string): InferenceProvider | null {
    for (const provider of this.providers) {
      if (provider.models.includes(model) && provider.apiKey) {
        return provider;
      }
    }
    return null;
  }

  private async proxyToProvider(provider: InferenceProvider, request: ChatRequest): Promise<object> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    let body = request;
    let url = `${provider.baseUrl}/chat/completions`;

    if (provider.type === 'anthropic') {
      headers['x-api-key'] = provider.apiKey!;
      headers['anthropic-version'] = '2023-06-01';
      url = `${provider.baseUrl}/messages`;

      // Convert OpenAI format to Anthropic format
      const systemMessage = request.messages.find(m => m.role === 'system');
      const otherMessages = request.messages.filter(m => m.role !== 'system');

      body = {
        model: request.model,
        max_tokens: request.max_tokens || 2048,
        messages: otherMessages,
        ...(systemMessage && { system: systemMessage.content }),
      } as ChatRequest;
    } else {
      headers['Authorization'] = `Bearer ${provider.apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Provider ${provider.name} returned ${response.status}`);
    }

    const data = await response.json();

    // Normalize Anthropic response to OpenAI format
    if (provider.type === 'anthropic') {
      return {
        id: data.id,
        object: 'chat.completion',
        model: data.model,
        choices: [
          {
            message: {
              role: 'assistant',
              content: data.content[0].text,
            },
            finish_reason: data.stop_reason === 'end_turn' ? 'stop' : data.stop_reason,
          },
        ],
        usage: {
          prompt_tokens: data.usage.input_tokens,
          completion_tokens: data.usage.output_tokens,
          total_tokens: data.usage.input_tokens + data.usage.output_tokens,
        },
      };
    }

    return data;
  }

  private localFallback(request: ChatRequest): object {
    const lastMessage = request.messages[request.messages.length - 1];
    const content = this.generateLocalResponse(lastMessage?.content || '');

    return {
      id: `local-${Date.now()}`,
      object: 'chat.completion',
      model: 'local-fallback',
      created: Math.floor(Date.now() / 1000),
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    };
  }

  private generateLocalResponse(_input: string): string {
    // No fake AI responses - be honest that we need an API key
    return `**AI Service Unavailable**

No inference provider configured. To enable AI chat:

1. Set one of these environment variables:
   - OPENAI_API_KEY (for GPT-4)
   - ANTHROPIC_API_KEY (for Claude)
   - GROQ_API_KEY (for Llama - fastest/cheapest)

2. Restart the inference server

Get API keys from:
- OpenAI: https://platform.openai.com/api-keys
- Anthropic: https://console.anthropic.com/
- Groq: https://console.groq.com/keys (free tier available)

The wallet UI still works - you can use the sidebar to access all features directly.`;
  }

  async start(): Promise<void> {
    this.server = Bun.serve({
      port: this.port,
      fetch: this.app.fetch,
    });

    logger.success(`Inference server running on http://localhost:${this.port}`);
    logger.info(`Available providers: ${this.providers.map(p => p.name).join(', ') || 'none (local fallback only)'}`);
    logger.info(`Default model: ${this.defaultModel}`);
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }

  getPort(): number {
    return this.port;
  }
}

export const createInferenceServer = (config?: Partial<InferenceConfig>) => new LocalInferenceServer(config);
export { LocalInferenceServer };

