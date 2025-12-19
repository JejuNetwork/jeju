/**
 * Inference E2E Tests
 *
 * Tests inference through DWS with all configured providers.
 * Requires API keys in .env: GROQ_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { app } from '../src/server/index';

const HAS_GROQ = !!process.env.GROQ_API_KEY;
const HAS_OPENAI = !!process.env.OPENAI_API_KEY;
const HAS_ANTHROPIC = !!process.env.ANTHROPIC_API_KEY;
const HAS_ANY_PROVIDER = HAS_GROQ || HAS_OPENAI || HAS_ANTHROPIC || 
  !!process.env.TOGETHER_API_KEY || !!process.env.OPENROUTER_API_KEY;

describe('Inference E2E', () => {
  beforeAll(() => {
    console.log('[Inference Tests] Providers configured:');
    console.log(`  - Groq: ${HAS_GROQ ? '✓' : '✗'}`);
    console.log(`  - OpenAI: ${HAS_OPENAI ? '✓' : '✗'}`);
    console.log(`  - Anthropic: ${HAS_ANTHROPIC ? '✓' : '✗'}`);
  });

  // Skip provider tests if no providers are configured
  describe.skipIf(!HAS_ANY_PROVIDER)('Provider Configuration', () => {
    test('should list configured providers', async () => {
      const res = await app.fetch(new Request('http://localhost/api/providers?configured=true'));
      expect(res.status).toBe(200);

      const data = await res.json() as { providers: Array<{ id: string; configured: boolean }> };
      expect(data.providers.length).toBeGreaterThan(0);

      const configuredProviders = data.providers.filter(p => p.configured);
      console.log(`[Inference Tests] ${configuredProviders.length} providers ready`);
    });

    test('should list available models', async () => {
      const res = await app.fetch(new Request('http://localhost/api/v1/models'));
      expect(res.status).toBe(200);

      const data = await res.json() as { models: Array<{ id: string; provider: string }> };
      expect(data.models.length).toBeGreaterThan(0);
      console.log(`[Inference Tests] ${data.models.length} models available`);
    });
  });

  describe('Groq Inference', () => {
    test.skipIf(!HAS_GROQ)('should complete chat with Llama', async () => {
      const start = Date.now();
      const res = await app.fetch(new Request('http://localhost/compute/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: 'What is 2+2? Reply with just the number.' }],
          max_tokens: 10,
        }),
      }));

      const latency = Date.now() - start;
      expect(res.status).toBe(200);

      const data = await res.json() as {
        provider: string;
        model: string;
        choices: Array<{ message: { content: string } }>;
      };

      expect(data.provider).toBe('groq');
      expect(data.choices[0].message.content).toContain('4');
      console.log(`[Groq] Response: "${data.choices[0].message.content}" (${latency}ms)`);
    });
  });

  describe('OpenAI Inference', () => {
    test.skipIf(!HAS_OPENAI)('should complete chat with GPT-4o-mini', async () => {
      const start = Date.now();
      const res = await app.fetch(new Request('http://localhost/compute/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'What is 3+3? Reply with just the number.' }],
          max_tokens: 10,
        }),
      }));

      const latency = Date.now() - start;
      expect(res.status).toBe(200);

      const data = await res.json() as {
        provider: string;
        model: string;
        choices: Array<{ message: { content: string } }>;
      };

      expect(data.provider).toBe('openai');
      expect(data.choices[0].message.content).toContain('6');
      console.log(`[OpenAI] Response: "${data.choices[0].message.content}" (${latency}ms)`);
    });

    test.skipIf(!HAS_OPENAI)('should generate embeddings', async () => {
      const res = await app.fetch(new Request('http://localhost/compute/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: 'Hello DWS',
          model: 'text-embedding-3-small',
        }),
      }));

      expect(res.status).toBe(200);

      const data = await res.json() as {
        object: string;
        model: string;
        data: Array<{ embedding: number[] }>;
      };

      expect(data.object).toBe('list');
      expect(data.data[0].embedding.length).toBe(1536);
      console.log(`[OpenAI] Embedding dimensions: ${data.data[0].embedding.length}`);
    });
  });

  describe('Anthropic Inference', () => {
    test.skipIf(!HAS_ANTHROPIC)('should complete chat with Claude', async () => {
      const start = Date.now();
      const res = await app.fetch(new Request('http://localhost/compute/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-latest',
          messages: [{ role: 'user', content: 'What is 4+4? Reply with just the number.' }],
          max_tokens: 10,
        }),
      }));

      const latency = Date.now() - start;
      expect(res.status).toBe(200);

      const data = await res.json() as {
        provider: string;
        model: string;
        choices: Array<{ message: { content: string } }>;
      };

      expect(data.provider).toBe('anthropic');
      expect(data.choices[0].message.content).toContain('8');
      console.log(`[Anthropic] Response: "${data.choices[0].message.content}" (${latency}ms)`);
    });
  });

  describe('Convenience Endpoints', () => {
    test.skipIf(!HAS_GROQ)('should work via /api/v1/inference', async () => {
      const res = await app.fetch(new Request('http://localhost/api/v1/inference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: 'What is 5+5? Just the number.' }],
          maxTokens: 10,
        }),
      }));

      expect(res.status).toBe(200);

      const data = await res.json() as { content: string; provider: string };
      expect(data.content).toContain('10');
      expect(data.provider).toBe('groq');
    });
  });
});

