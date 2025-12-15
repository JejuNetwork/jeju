/**
 * Inference API E2E Tests
 * 
 * Tests the local inference service.
 * Note: Without API keys, the service returns an honest fallback message.
 * With API keys (OPENAI_API_KEY, ANTHROPIC_API_KEY, or GROQ_API_KEY),
 * it uses real LLM inference.
 */

import { test, expect } from '@playwright/test';

test.describe('Inference API (Live)', () => {
  const inferenceUrl = 'http://localhost:4100';

  test('should respond to health check', async ({ request }) => {
    const response = await request.get(`${inferenceUrl}/health`);
    expect(response.ok()).toBe(true);
    
    const data = await response.json();
    expect(data.status).toBe('ok');
    // providers count shows configured API providers
    expect(typeof data.providers).toBe('number');
  });

  test('should list available models', async ({ request }) => {
    const response = await request.get(`${inferenceUrl}/v1/models`);
    expect(response.ok()).toBe(true);
    
    const data = await response.json();
    expect(data.object).toBe('list');
    expect(data.data).toBeInstanceOf(Array);
    expect(data.data.length).toBeGreaterThan(0);
    
    // Should always have local-fallback at minimum
    const models = data.data.map((m: { id: string }) => m.id);
    expect(models).toContain('local-fallback');
  });

  test('should handle chat completion request', async ({ request }) => {
    const response = await request.post(`${inferenceUrl}/v1/chat/completions`, {
      data: {
        model: 'local-fallback',
        messages: [
          { role: 'user', content: 'hello' }
        ]
      }
    });
    
    expect(response.ok()).toBe(true);
    
    const data = await response.json();
    expect(data.object).toBe('chat.completion');
    expect(data.choices).toBeInstanceOf(Array);
    expect(data.choices.length).toBe(1);
    expect(data.choices[0].message.role).toBe('assistant');
    // Content should be non-empty
    expect(data.choices[0].message.content.length).toBeGreaterThan(0);
  });

  test('should return OpenAI-compatible response format', async ({ request }) => {
    const response = await request.post(`${inferenceUrl}/v1/chat/completions`, {
      data: {
        model: 'local-fallback',
        messages: [
          { role: 'user', content: 'test' }
        ]
      }
    });
    
    expect(response.ok()).toBe(true);
    
    const data = await response.json();
    // Verify OpenAI-compatible structure
    expect(data).toHaveProperty('id');
    expect(data).toHaveProperty('object', 'chat.completion');
    expect(data).toHaveProperty('model');
    expect(data).toHaveProperty('choices');
    expect(data).toHaveProperty('usage');
    expect(data.usage).toHaveProperty('prompt_tokens');
    expect(data.usage).toHaveProperty('completion_tokens');
    expect(data.usage).toHaveProperty('total_tokens');
  });

  test('should indicate when no API key is configured', async ({ request }) => {
    const healthResponse = await request.get(`${inferenceUrl}/health`);
    const health = await healthResponse.json();
    
    // If no providers configured, fallback should mention API keys
    if (health.providers === 0) {
      const response = await request.post(`${inferenceUrl}/v1/chat/completions`, {
        data: {
          model: 'local-fallback',
          messages: [{ role: 'user', content: 'test' }]
        }
      });
      
      const data = await response.json();
      const content = data.choices[0].message.content.toLowerCase();
      // Should mention that API key is needed
      expect(content).toContain('api');
    }
  });
});
