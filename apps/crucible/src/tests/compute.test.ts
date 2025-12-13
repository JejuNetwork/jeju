/**
 * Compute SDK Tests
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { CrucibleCompute, createCompute } from '../sdk/compute';
import type { AgentCharacter } from '../types';

describe('CrucibleCompute', () => {
  let compute: CrucibleCompute;
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    compute = createCompute({
      marketplaceUrl: 'http://localhost:4007',
      rpcUrl: 'http://localhost:8545',
      defaultModel: 'llama-3.1-8b',
    });
    mockFetch = mock(() => Promise.resolve(new Response()));
    global.fetch = mockFetch as typeof fetch;
  });

  describe('Model Discovery', () => {
    it('should fetch available models', async () => {
      // Note: In production, prices come as strings and need conversion
      const mockModels = {
        models: [
          {
            id: 'llama-3.1-8b',
            name: 'Llama 3.1 8B',
            provider: 'provider-1',
            pricePerInputToken: 100,
            pricePerOutputToken: 150,
            maxContextLength: 8192,
            capabilities: ['chat', 'reasoning'],
          },
          {
            id: 'llama-3.1-70b',
            name: 'Llama 3.1 70B',
            provider: 'provider-2',
            pricePerInputToken: 500,
            pricePerOutputToken: 750,
            maxContextLength: 32768,
            capabilities: ['chat', 'reasoning', 'coding'],
          },
        ],
      };

      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockModels), { status: 200 }))
      );

      const models = await compute.getAvailableModels();
      
      expect(models.length).toBe(2);
      expect(models[0].id).toBe('llama-3.1-8b');
      expect(models[1].capabilities).toContain('coding');
    });

    it('should handle empty model list', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 }))
      );

      const models = await compute.getAvailableModels();
      expect(models.length).toBe(0);
    });

    it('should throw on model fetch error', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('Service unavailable', { status: 503 }))
      );

      await expect(compute.getAvailableModels()).rejects.toThrow('Failed to fetch models');
    });

    it('should find best model by context length', async () => {
      const mockModels = {
        models: [
          { id: 'small', name: 'Small', provider: 'p1', pricePerInputToken: 100, pricePerOutputToken: 100, maxContextLength: 4096, capabilities: ['chat'] },
          { id: 'large', name: 'Large', provider: 'p2', pricePerInputToken: 200, pricePerOutputToken: 200, maxContextLength: 32768, capabilities: ['chat'] },
        ],
      };

      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockModels), { status: 200 }))
      );

      const model = await compute.getBestModel({ minContextLength: 16000 });
      expect(model?.id).toBe('large');
    });

    it('should find best model by capabilities', async () => {
      const mockModels = {
        models: [
          { id: 'chat-only', name: 'Chat', provider: 'p1', pricePerInputToken: 100, pricePerOutputToken: 100, maxContextLength: 8192, capabilities: ['chat'] },
          { id: 'coder', name: 'Coder', provider: 'p2', pricePerInputToken: 200, pricePerOutputToken: 200, maxContextLength: 8192, capabilities: ['chat', 'coding'] },
        ],
      };

      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockModels), { status: 200 }))
      );

      const model = await compute.getBestModel({ capabilities: ['coding'] });
      expect(model?.id).toBe('coder');
    });

    it('should return null when no model matches requirements', async () => {
      const mockModels = {
        models: [
          { id: 'small', name: 'Small', provider: 'p1', pricePerInputToken: 100, pricePerOutputToken: 100, maxContextLength: 4096, capabilities: ['chat'] },
        ],
      };

      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockModels), { status: 200 }))
      );

      const model = await compute.getBestModel({ minContextLength: 100000 });
      expect(model).toBeNull();
    });
  });

  describe('Inference', () => {
    it('should run basic inference', async () => {
      const mockResponse = {
        content: 'Hello! How can I help you?',
        model: 'llama-3.1-8b',
        usage: { prompt_tokens: 50, completion_tokens: 10 },
        cost: '1000000000000000',
      };

      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockResponse), { status: 200 }))
      );

      const result = await compute.inference({
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hi!' },
        ],
        model: 'llama-3.1-8b',
      });

      expect(result.content).toBe('Hello! How can I help you?');
      expect(result.model).toBe('llama-3.1-8b');
      expect(result.tokensUsed.input).toBe(50);
      expect(result.tokensUsed.output).toBe(10);
      expect(result.cost).toBe(1000000000000000n);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should throw on inference error', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('Model overloaded', { status: 503 }))
      );

      await expect(compute.inference({
        messages: [{ role: 'user', content: 'Hi' }],
      })).rejects.toThrow('Inference failed');
    });

    it('should handle empty response content', async () => {
      const mockResponse = {
        content: '',
        model: 'llama-3.1-8b',
        usage: { prompt_tokens: 50, completion_tokens: 0 },
        cost: '500000000000000',
      };

      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockResponse), { status: 200 }))
      );

      const result = await compute.inference({
        messages: [{ role: 'user', content: 'Repeat nothing.' }],
      });

      expect(result.content).toBe('');
      expect(result.tokensUsed.output).toBe(0);
    });

    it('should run inference with character context', async () => {
      const character: AgentCharacter = {
        id: 'test-agent',
        name: 'TestBot',
        description: 'A test agent',
        system: 'You are TestBot, a helpful assistant.',
        bio: ['Created for testing'],
        messageExamples: [],
        topics: ['testing'],
        adjectives: ['helpful'],
        style: {
          all: ['Be concise'],
          chat: ['Be friendly'],
          post: ['Be engaging'],
        },
        modelPreferences: {
          small: 'llama-3.1-8b',
          large: 'llama-3.1-70b',
        },
      };

      const mockResponse = {
        content: 'Hello from TestBot!',
        model: 'llama-3.1-70b',
        usage: { prompt_tokens: 100, completion_tokens: 10 },
        cost: '2000000000000000',
      };

      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockResponse), { status: 200 }))
      );

      const result = await compute.runInference(
        character,
        'Hello!',
        { memories: ['User prefers TypeScript'] }
      );

      expect(result.content).toBe('Hello from TestBot!');
      expect(result.model).toBe('llama-3.1-70b');

      // Verify request includes system prompt
      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[0].content).toContain('TestBot');
    });

    it('should include memories in context', async () => {
      const character: AgentCharacter = {
        id: 'memory-test',
        name: 'MemBot',
        description: '',
        system: 'You remember things.',
        bio: [],
        messageExamples: [],
        topics: [],
        adjectives: [],
        style: { all: [], chat: [], post: [] },
      };

      const mockResponse = {
        content: 'I remember!',
        model: 'llama-3.1-8b',
        usage: { prompt_tokens: 100, completion_tokens: 5 },
        cost: '1000000000000000',
      };

      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockResponse), { status: 200 }))
      );

      await compute.runInference(
        character,
        'What do you remember?',
        { memories: ['User likes coffee', 'User works at startup'] }
      );

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string);
      expect(body.messages[0].content).toContain('User likes coffee');
      expect(body.messages[0].content).toContain('User works at startup');
    });

    it('should use default model when character has no preference', async () => {
      const character: AgentCharacter = {
        id: 'no-pref',
        name: 'NoPrefs',
        description: '',
        system: 'Basic agent.',
        bio: [],
        messageExamples: [],
        topics: [],
        adjectives: [],
        style: { all: [], chat: [], post: [] },
      };

      const mockResponse = {
        content: 'Response',
        model: 'llama-3.1-8b',
        usage: { prompt_tokens: 50, completion_tokens: 5 },
        cost: '500000000000000',
      };

      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockResponse), { status: 200 }))
      );

      await compute.runInference(character, 'Hi', {});

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string);
      expect(body.model).toBe('llama-3.1-8b'); // Default model
    });
  });

  describe('Embeddings', () => {
    it('should generate embeddings', async () => {
      const mockEmbedding = { embedding: Array(1536).fill(0).map(() => Math.random()) };

      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockEmbedding), { status: 200 }))
      );

      const embedding = await compute.generateEmbedding('This is a test text');
      
      expect(embedding.length).toBe(1536);
      expect(typeof embedding[0]).toBe('number');
    });

    it('should throw on embedding error', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('Error', { status: 500 }))
      );

      await expect(compute.generateEmbedding('test')).rejects.toThrow('Embedding failed');
    });

    it('should handle empty text embedding', async () => {
      const mockEmbedding = { embedding: Array(1536).fill(0) };

      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockEmbedding), { status: 200 }))
      );

      const embedding = await compute.generateEmbedding('');
      expect(embedding.length).toBe(1536);
    });

    it('should handle very long text', async () => {
      const longText = 'A'.repeat(100000);
      const mockEmbedding = { embedding: Array(1536).fill(0.5) };

      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockEmbedding), { status: 200 }))
      );

      const embedding = await compute.generateEmbedding(longText);
      expect(embedding.length).toBe(1536);

      // Verify the text was sent
      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string);
      expect(body.input.length).toBe(100000);
    });
  });

  describe('Cost Estimation', () => {
    it('should estimate cost for messages', async () => {
      const mockModels = {
        models: [
          { id: 'llama-3.1-8b', name: 'Llama', provider: 'p1', pricePerInputToken: 1000, pricePerOutputToken: 2000, maxContextLength: 8192, capabilities: ['chat'] },
        ],
      };

      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockModels), { status: 200 }))
      );

      const cost = await compute.estimateCost(
        [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello!' },
        ],
        'llama-3.1-8b',
        100
      );

      // Input: ~24 chars = ~6 tokens * 1000 = 6000
      // Output: 100 tokens * 2000 = 200000
      expect(cost).toBeGreaterThan(0n);
    });

    it('should throw for unknown model in cost estimation', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 }))
      );

      await expect(compute.estimateCost(
        [{ role: 'user', content: 'Hi' }],
        'unknown-model',
        100
      )).rejects.toThrow('Model not found');
    });

    it('should handle very long message in cost estimation', async () => {
      const mockModels = {
        models: [
          { id: 'llama-3.1-8b', name: 'Llama', provider: 'p1', pricePerInputToken: 1, pricePerOutputToken: 1, maxContextLength: 8192, capabilities: ['chat'] },
        ],
      };

      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockModels), { status: 200 }))
      );

      const longContent = 'A'.repeat(10000);
      const cost = await compute.estimateCost(
        [{ role: 'user', content: longContent }],
        'llama-3.1-8b',
        100
      );

      // ~2500 input tokens + 100 output = ~2600 tokens
      expect(cost).toBeGreaterThan(2500n);
    });
  });
});
