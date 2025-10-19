import { IAgentRuntime, ModelType, logger } from '@elizaos/core';
import { InferenceProvider } from './index';

// Claude API Types
interface ClaudeTool {
  name: string;
  description?: string;
  input_schema: any;
}

type ClaudeContent =
  | string
  | Array<{
      type: 'text' | 'image' | 'tool_use' | 'tool_result';
      text?: string;
      source?: {
        type: 'base64';
        media_type: string;
        data: string;
      };
      id?: string;
      name?: string;
      input?: any;
      tool_use_id?: string;
      content?: any;
    }>;

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: ClaudeContent;
}

interface ClaudeMessagesRequest {
  model: string;
  messages: ClaudeMessage[];
  system?: string;
  max_tokens: number;
  stop_sequences?: string[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  tools?: ClaudeTool[];
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
}

interface ClaudeResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: Array<{
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: any;
  }>;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// OpenAI-style types for compatibility
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content:
    | string
    | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

/**
 * Claude-to-Provider Proxy
 * Converts Claude API requests to the appropriate provider format
 */
export class ClaudeProxy {
  constructor(private runtime: IAgentRuntime) {}

  /**
   * Process a Claude API request and route it to the appropriate provider
   */
  async processRequest(claudeRequest: ClaudeMessagesRequest): Promise<ClaudeResponse> {
    // Determine which provider to use
    const provider = await this.selectProvider();

    logger.info(`[CLAUDE_PROXY] Routing request to provider: ${provider}`);

    switch (provider) {
      case InferenceProvider.ANTHROPIC:
        // Native Anthropic - make direct API request
        return this.makeAnthropicProxyRequest(claudeRequest);

      case InferenceProvider.OPENAI:
        return this.handleOpenAIRequest(claudeRequest);

      case InferenceProvider.GROQ:
        return this.handleGroqRequest(claudeRequest);

      case InferenceProvider.OLLAMA:
        return this.handleOllamaRequest(claudeRequest);

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  /**
   * Make a direct proxy request to Anthropic's API
   */
  private async makeAnthropicProxyRequest(
    claudeRequest: ClaudeMessagesRequest
  ): Promise<ClaudeResponse> {
    const apiKey = this.runtime.getSetting('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const baseUrl = this.runtime.getSetting('ANTHROPIC_API_URL') || 'https://api.anthropic.com';

    
      // Make direct request to Anthropic API
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(claudeRequest),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Anthropic API error: ${response.status} - ${errorBody}`);
      }

      const data = (await response.json()) as ClaudeResponse;
      return data;
    
  }

  /**
   * Select the best available provider
   */
  private async selectProvider(): Promise<InferenceProvider> {
    // Check available providers in order of preference
    const preferences = [
      InferenceProvider.ANTHROPIC,
      InferenceProvider.OPENAI,
      InferenceProvider.GROQ,
      InferenceProvider.OLLAMA,
    ];

    for (const provider of preferences) {
      if (await this.isProviderAvailable(provider)) {
        return provider;
      }
    }

    throw new Error('No inference providers available');
  }

  /**
   * Check if a provider is available
   */
  private async isProviderAvailable(provider: InferenceProvider): Promise<boolean> {
    switch (provider) {
      case InferenceProvider.ANTHROPIC:
        return !!this.runtime.getSetting('ANTHROPIC_API_KEY');
      case InferenceProvider.OPENAI:
        return !!this.runtime.getSetting('OPENAI_API_KEY');
      case InferenceProvider.GROQ:
        return !!this.runtime.getSetting('GROQ_API_KEY');
      case InferenceProvider.OLLAMA:
        // Ollama is always available if installed
        return true;
      default:
        return false;
    }
  }

  /**
   * Handle OpenAI requests by converting format
   */
  private async handleOpenAIRequest(claudeRequest: ClaudeMessagesRequest): Promise<ClaudeResponse> {
    const openAIMessages = this.convertClaudeToOpenAI(claudeRequest);

    // Create a formatted prompt for the runtime
    const prompt = this.formatOpenAIPrompt(openAIMessages, claudeRequest.system);

    const response = await this.runtime.useModel(ModelType.TEXT_LARGE, {
      runtime: this.runtime,
      prompt,
      modelType: ModelType.TEXT_LARGE,
      maxTokens: claudeRequest.max_tokens,
      temperature: claudeRequest.temperature,
      stopSequences: claudeRequest.stop_sequences,
    });

    return this.formatClaudeResponse(response, claudeRequest.model);
  }

  /**
   * Handle Groq requests
   */
  private async handleGroqRequest(claudeRequest: ClaudeMessagesRequest): Promise<ClaudeResponse> {
    // Groq uses OpenAI-compatible format
    return this.handleOpenAIRequest(claudeRequest);
  }

  /**
   * Handle Ollama requests
   */
  private async handleOllamaRequest(claudeRequest: ClaudeMessagesRequest): Promise<ClaudeResponse> {
    // Ollama also uses OpenAI-compatible format
    const prompt = this.convertClaudeToPrompt(claudeRequest);

    const response = await this.runtime.useModel(ModelType.TEXT_LARGE, {
      runtime: this.runtime,
      prompt,
      modelType: ModelType.TEXT_LARGE,
      maxTokens: claudeRequest.max_tokens,
      temperature: claudeRequest.temperature,
      stopSequences: claudeRequest.stop_sequences,
    });

    return this.formatClaudeResponse(response, claudeRequest.model);
  }

  /**
   * Convert Claude messages to OpenAI format
   */
  private convertClaudeToOpenAI(claudeRequest: ClaudeMessagesRequest): OpenAIMessage[] {
    const openAIMessages: OpenAIMessage[] = [];

    if (claudeRequest.system) {
      openAIMessages.push({ role: 'system', content: claudeRequest.system });
    }

    for (const message of claudeRequest.messages) {
      if (message.role === 'user') {
        if (Array.isArray(message.content)) {
          const content = message.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('\n');
          openAIMessages.push({ role: 'user', content });
        } else {
          openAIMessages.push({ role: 'user', content: message.content });
        }
      } else if (message.role === 'assistant') {
        if (Array.isArray(message.content)) {
          const textContent = message.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('\n');
          openAIMessages.push({ role: 'assistant', content: textContent || '' });
        } else {
          openAIMessages.push({ role: 'assistant', content: message.content });
        }
      }
    }

    return openAIMessages;
  }

  /**
   * Convert Claude messages to a simple prompt string
   */
  private convertClaudeToPrompt(claudeRequest: ClaudeMessagesRequest): string {
    let prompt = '';

    if (claudeRequest.system) {
      prompt += `System: ${claudeRequest.system}\n\n`;
    }

    for (const message of claudeRequest.messages) {
      const role = message.role === 'user' ? 'User' : 'Assistant';

      if (Array.isArray(message.content)) {
        const textContent = message.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('\n');
        prompt += `${role}: ${textContent}\n\n`;
      } else {
        prompt += `${role}: ${message.content}\n\n`;
      }
    }

    return prompt.trim();
  }

  /**
   * Format OpenAI messages as a prompt
   */
  private formatOpenAIPrompt(messages: OpenAIMessage[], system?: string): string {
    let prompt = '';

    if (system) {
      prompt += `${system}\n\n`;
    }

    for (const message of messages) {
      if (message.role === 'system') {
        continue; // Already handled above
      }

      const role = message.role === 'user' ? 'User' : 'Assistant';
      const content =
        typeof message.content === 'string'
          ? message.content
          : message.content.map((c) => c.text).join('\n');

      prompt += `${role}: ${content}\n\n`;
    }

    return prompt.trim();
  }

  /**
   * Format response in Claude format
   */
  private formatClaudeResponse(text: string, model: string): ClaudeResponse {
    return {
      id: `msg_${Math.random().toString(36).substr(2, 9)}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [
        {
          type: 'text',
          text,
        },
      ],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 0, // Would need token counting
        output_tokens: 0, // Would need token counting
      },
    };
  }
}

/**
 * Create a Claude API handler for the inference plugin
 */
export function createClaudeHandler(runtime: IAgentRuntime) {
  const proxy = new ClaudeProxy(runtime);

  return async (request: ClaudeMessagesRequest): Promise<ClaudeResponse> => {
    
      return await proxy.processRequest(request);
    
  };
}
