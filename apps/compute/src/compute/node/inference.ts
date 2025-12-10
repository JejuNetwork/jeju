/**
 * Inference engine for compute nodes
 *
 * Supports multiple backends:
 * - Ollama: Local LLM server
 * - llama.cpp: Direct llama.cpp integration
 * - Mock: Testing mode
 */

import { encode } from 'gpt-tokenizer';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelConfig,
} from './types';

/**
 * Count tokens using GPT tokenizer (cl100k_base encoding)
 * This is accurate for GPT-5 and a reasonable approximation for other models
 */
export function countTokens(text: string): number {
  return encode(text).length;
}

interface OllamaStreamChunk {
  message?: { content?: string };
  done?: boolean;
}

/**
 * Parse JSON or return null if invalid (for NDJSON streaming)
 */
function parseJsonOrNull(text: string): OllamaStreamChunk | null {
  if (!text.startsWith('{')) return null;
  const parsed = JSON.parse(text) as OllamaStreamChunk;
  return typeof parsed === 'object' && parsed !== null ? parsed : null;
}

/**
 * Base inference engine interface
 */
export interface InferenceEngine {
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  stream(request: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk>;
  countTokens(text: string): number;
}

/**
 * Mock inference engine for testing
 */
export class MockInferenceEngine implements InferenceEngine {
  private model: string;

  constructor(config: ModelConfig) {
    this.model = config.name;
  }

  async complete(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    const inputTokens = this.countTokens(
      request.messages.map((m) => m.content).join(' ')
    );

    // Generate mock response
    const responseContent = this.generateMockResponse(request);
    const outputTokens = this.countTokens(responseContent);

    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: this.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: responseContent,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
    };
  }

  async *stream(
    request: ChatCompletionRequest
  ): AsyncGenerator<ChatCompletionChunk> {
    const response = this.generateMockResponse(request);
    const words = response.split(' ');

    const id = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    // First chunk with role
    yield {
      id,
      object: 'chat.completion.chunk',
      created,
      model: this.model,
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: '' },
          finish_reason: null,
        },
      ],
    };

    // Stream words
    for (const word of words) {
      await new Promise((r) => setTimeout(r, 50)); // Simulate delay

      yield {
        id,
        object: 'chat.completion.chunk',
        created,
        model: this.model,
        choices: [
          {
            index: 0,
            delta: { content: `${word} ` },
            finish_reason: null,
          },
        ],
      };
    }

    // Final chunk
    yield {
      id,
      object: 'chat.completion.chunk',
      created,
      model: this.model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: 'stop',
        },
      ],
    };
  }

  countTokens(text: string): number {
    return countTokens(text);
  }

  private generateMockResponse(request: ChatCompletionRequest): string {
    const lastMessage = request.messages[request.messages.length - 1];
    if (!lastMessage) {
      return 'No message provided.';
    }

    // Check for simple math questions (for testing)
    const content = lastMessage.content.toLowerCase();
    if (content.includes('2+2') || content.includes('2 + 2')) {
      return 'The answer is 4.';
    }
    if (content.includes('hello')) {
      return 'Hello! How can I help you today?';
    }

    return `This is a mock response from the ${this.model} model. Your message was: "${lastMessage.content}"`;
  }
}

/**
 * Ollama inference engine
 */
export class OllamaInferenceEngine implements InferenceEngine {
  private endpoint: string;
  private model: string;

  constructor(config: ModelConfig) {
    this.endpoint = config.endpoint || 'http://localhost:11434';
    this.model = config.name;
  }

  async complete(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: request.messages,
        stream: false,
        options: {
          temperature: request.temperature ?? 0.7,
          num_predict: request.max_tokens ?? 2048,
          seed: request.seed,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama error: ${response.status} ${await response.text()}`
      );
    }

    const data = await response.json() as {
      message: { content: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: this.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: data.message.content,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: data.prompt_eval_count || 0,
        completion_tokens: data.eval_count || 0,
        total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
    };
  }

  async *stream(
    request: ChatCompletionRequest
  ): AsyncGenerator<ChatCompletionChunk> {
    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: request.messages,
        stream: true,
        options: {
          temperature: request.temperature ?? 0.7,
          num_predict: request.max_tokens ?? 2048,
          seed: request.seed,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    const id = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    // First chunk with role
    yield {
      id,
      object: 'chat.completion.chunk',
      created,
      model: this.model,
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: '' },
          finish_reason: null,
        },
      ],
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const lines = text.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        // Parse NDJSON - skip partial lines that aren't valid JSON yet
        const data = parseJsonOrNull(line);
        if (!data) continue;

        yield {
          id,
          object: 'chat.completion.chunk',
          created,
          model: this.model,
          choices: [
            {
              index: 0,
              delta: { content: data.message?.content || '' },
              finish_reason: data.done ? 'stop' : null,
            },
          ],
        };
      }
    }
  }

  countTokens(text: string): number {
    return countTokens(text);
  }
}

/**
 * Create inference engine based on config
 */
export function createInferenceEngine(config: ModelConfig): InferenceEngine {
  switch (config.backend) {
    case 'ollama':
      return new OllamaInferenceEngine(config);
    case 'mock':
    default:
      return new MockInferenceEngine(config);
  }
}
