import { describe, it, expect, beforeAll } from 'bun:test';
import { logger } from '@elizaos/core';
import { ClaudeProxy } from '../claude-proxy';

// Define mock runtime interface
interface MockRuntime {
  getSetting: (key: string) => string | undefined;
  useModel?: (modelType: string, params: unknown) => Promise<string>;
}

describe('Claude Proxy Simple Tests', () => {
  let mockRuntime: MockRuntime;

  beforeAll(() => {
    // Load environment variables from root .env
    const dotenv = require('dotenv');
    const path = require('path');
    const envPath = path.join(process.cwd(), '..', '..', '.env');
    dotenv.config({ path: envPath });
  });

  it('should detect available providers correctly', async () => {
    // Test with only OpenAI available
    mockRuntime = {
      getSetting: (key: string) => {
        if (key === 'OPENAI_API_KEY') return process.env.OPENAI_API_KEY;
        return undefined;
      },
      useModel: async (_modelType: string, params: unknown) => {
        // Mock response
        return 'OpenAI fallback working';
      },
    };

    const proxy = new ClaudeProxy(mockRuntime);

    // Test provider selection
    const selectProvider = (proxy as any).selectProvider.bind(proxy);
    const provider = await selectProvider();

    console.log('Selected provider:', provider);
    expect(provider).toBe('openai');
  });

  it('should convert Claude messages to OpenAI format correctly', async () => {
    mockRuntime = {
      getSetting: () => undefined,
      useModel: async () => 'test response',
    };

    const proxy = new ClaudeProxy(mockRuntime);

    const claudeRequest = {
      model: 'claude-3-opus-20240229',
      system: 'You are a helpful assistant.',
      messages: [
        {
          role: 'user' as const,
          content: 'Hello!',
        },
        {
          role: 'assistant' as const,
          content: 'Hi there! How can I help you?',
        },
        {
          role: 'user' as const,
          content: [
            {
              type: 'text' as const,
              text: 'What is 2+2?',
            },
          ],
        },
      ],
      max_tokens: 100,
    };

    // Test message conversion
    const convertMethod = (proxy as any).convertClaudeToOpenAI.bind(proxy);
    const openAIMessages = convertMethod(claudeRequest);

    expect(openAIMessages).toHaveLength(4); // system + 3 messages
    expect(openAIMessages[0].role).toBe('system');
    expect(openAIMessages[0].content).toBe('You are a helpful assistant.');
    expect(openAIMessages[1].role).toBe('user');
    expect(openAIMessages[1].content).toBe('Hello!');
    expect(openAIMessages[2].role).toBe('assistant');
    expect(openAIMessages[2].content).toBe('Hi there! How can I help you?');
    expect(openAIMessages[3].role).toBe('user');
    expect(openAIMessages[3].content).toBe('What is 2+2?');
  });

  it('should format Claude response structure correctly', async () => {
    mockRuntime = {
      getSetting: () => undefined,
      useModel: async () => 'test response',
    };

    const proxy = new ClaudeProxy(mockRuntime);

    // Test response formatting
    const formatMethod = (proxy as any).formatClaudeResponse.bind(proxy);
    const claudeResponse = formatMethod('Hello from the proxy!', 'claude-3-opus-20240229');

    expect(claudeResponse).toHaveProperty('id');
    expect(claudeResponse.type).toBe('message');
    expect(claudeResponse.role).toBe('assistant');
    expect(claudeResponse.model).toBe('claude-3-opus-20240229');
    expect(claudeResponse.content).toHaveLength(1);
    expect(claudeResponse.content[0].type).toBe('text');
    expect(claudeResponse.content[0].text).toBe('Hello from the proxy!');
    expect(claudeResponse.stop_reason).toBe('end_turn');
    expect(claudeResponse.usage).toHaveProperty('input_tokens');
    expect(claudeResponse.usage).toHaveProperty('output_tokens');
  });

  it('should make direct Anthropic proxy request when API key is available', async () => {
    // Skip if no Anthropic key
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('Skipping test - ANTHROPIC_API_KEY not found');
      return;
    }

    mockRuntime = {
      getSetting: (key: string) => {
        if (key === 'ANTHROPIC_API_KEY') return process.env.ANTHROPIC_API_KEY;
        if (key === 'ANTHROPIC_API_URL') return 'https://api.anthropic.com';
        return undefined;
      },
    };

    const proxy = new ClaudeProxy(mockRuntime);

    const claudeRequest = {
      model: 'claude-3-haiku-20240307',
      messages: [
        {
          role: 'user' as const,
          content: 'Reply with exactly: "Direct proxy test successful"',
        },
      ],
      max_tokens: 50,
      temperature: 0.1,
    };

    const makeProxyRequest = (proxy as any).makeAnthropicProxyRequest.bind(proxy);
    const response = await makeProxyRequest(claudeRequest);

    expect(response).toBeDefined();
    expect(response.type).toBe('message');
    expect(response.content[0].text).toContain('Direct proxy test successful');

    console.log('Direct Anthropic proxy response:', response.content[0].text);
  });

  it('should handle errors gracefully', async () => {
    mockRuntime = {
      getSetting: () => undefined,
      useModel: async () => {
        throw new Error('Model not available');
      },
    };

    const proxy = new ClaudeProxy(mockRuntime);

    const claudeRequest = {
      model: 'claude-3-opus-20240229',
      messages: [
        {
          role: 'user' as const,
          content: 'Test error handling',
        },
      ],
      max_tokens: 50,
    };

    try {
      await proxy.processRequest(claudeRequest);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeDefined();
      // The error will be 'Model not available' because Ollama is always considered available
      // but fails when trying to use the model
      expect(error.message).toContain('Model not available');
    }
  });
});
