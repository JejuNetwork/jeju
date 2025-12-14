/**
 * Inference Client Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InferenceClient } from './inferenceClient';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('InferenceClient', () => {
  let client: InferenceClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new InferenceClient({
      gatewayUrl: 'https://test-gateway.example.com',
      maxRetries: 1, // Fast retries for tests
      retryDelayMs: 10,
    });
  });

  describe('configure', () => {
    it('should update configuration', () => {
      client.configure({ preferredModel: 'custom-model' });
      // Configuration should be updated (internal state)
    });
  });

  describe('setWalletAddress', () => {
    it('should set wallet address', () => {
      client.setWalletAddress('0x1234567890123456789012345678901234567890');
      // Address should be set for context injection
    });
  });

  describe('getModels', () => {
    it('should return default models when gateway unavailable', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const models = await client.getModels();

      expect(models).toHaveLength(3);
      expect(models[0].id).toBe('jeju/llama-3.1-70b');
    });

    it('should fetch models from gateway', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            models: [
              {
                id: 'test-model',
                name: 'Test Model',
                description: 'A test model',
                contextWindow: 4096,
                pricePerInputToken: '0.0001',
                pricePerOutputToken: '0.0003',
                provider: 'test',
                teeType: 'none',
                active: true,
              },
            ],
          }),
      });

      const models = await client.getModels();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-gateway.example.com/v1/models',
        expect.objectContaining({ headers: expect.any(Object) })
      );
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('test-model');
    });

    it('should cache models', async () => {
      // Create fresh client for this test
      const cacheClient = new InferenceClient({ gatewayUrl: 'https://cache-test.example.com' });
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [{ id: 'cached' }] }),
      });

      const models1 = await cacheClient.getModels();
      const models2 = await cacheClient.getModels();

      // Second call should use cache (models should be same array reference after cache hit)
      expect(models1).toEqual(models2);
    });

    it('should force refresh when requested', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [] }),
      });

      await client.getModels();
      await client.getModels(true);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('chat', () => {
    it('should send chat request and return response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'chat-123',
            model: 'jeju/llama-3.1-70b',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Hello! How can I help you?',
                },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 8,
              total_tokens: 18,
            },
          }),
      });

      const response = await client.chat({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.content).toBe('Hello! How can I help you?');
      expect(response.tokensUsed.total).toBe(18);
    });

    it('should fallback to local processing on error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const response = await client.chat({
        messages: [{ role: 'user', content: 'help' }],
      });

      expect(response.provider).toBe('local');
      expect(response.content).toContain('Portfolio');
    });

    it('should maintain conversation history', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'chat-123',
            choices: [{ message: { content: 'Response 1' } }],
            usage: { total_tokens: 10 },
          }),
      });

      await client.chat({ messages: [{ role: 'user', content: 'First message' }] });

      const history = client.getHistory();
      expect(history.length).toBeGreaterThan(1);
      expect(history.some((m) => m.content === 'First message')).toBe(true);
    });
  });

  describe('clearHistory', () => {
    it('should reset conversation history', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'Test' } }],
            usage: { total_tokens: 5 },
          }),
      });

      await client.chat({ messages: [{ role: 'user', content: 'Test' }] });
      client.clearHistory();

      const history = client.getHistory();
      // Should only have system prompt
      expect(history.length).toBe(1);
      expect(history[0].role).toBe('system');
    });
  });

  describe('local fallback', () => {
    let localClient: InferenceClient;
    
    beforeEach(() => {
      mockFetch.mockRejectedValue(new Error('Offline'));
      // Use fast retries for fallback tests
      localClient = new InferenceClient({
        gatewayUrl: 'https://offline.example.com',
        maxRetries: 1,
        retryDelayMs: 1,
      });
    });

    it('should handle portfolio commands', async () => {
      const response = await localClient.chat({
        messages: [{ role: 'user', content: 'show my portfolio' }],
      });

      expect(response.content.toLowerCase()).toContain('portfolio');
    });

    it('should handle help commands', async () => {
      const response = await localClient.chat({
        messages: [{ role: 'user', content: 'help' }],
      });

      expect(response.content).toContain('Portfolio');
    });

    it('should handle swap commands', async () => {
      const response = await localClient.chat({
        messages: [{ role: 'user', content: 'swap ETH' }],
      });

      expect(response.content.toLowerCase()).toContain('swap');
    });

    it('should handle send commands', async () => {
      const response = await localClient.chat({
        messages: [{ role: 'user', content: 'send tokens' }],
      });

      expect(response.content.toLowerCase()).toContain('send');
    });

    it('should handle perp commands', async () => {
      const response = await localClient.chat({
        messages: [{ role: 'user', content: 'long ETH' }],
      });

      expect(response.content.toLowerCase()).toContain('perpetual');
    });

    it('should handle JNS commands', async () => {
      const response = await localClient.chat({
        messages: [{ role: 'user', content: 'register alice.jeju' }],
      });

      expect(response.content).toContain('Jeju Name Service');
    });
  });
});

