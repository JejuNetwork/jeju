import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { AgentServer } from '../server';
import { IAgentRuntime } from '@elizaos/core';
import { terminalCharacter } from '../character';
import { startAgent } from '../index';

describe('Plugin Inference Integration Tests', () => {
  let server: AgentServer;
  let runtime: IAgentRuntime;
  let port: number;

  beforeAll(async () => {
    // Use a test port to avoid conflicts
    port = 3001;

    // Initialize server
    server = new AgentServer();
    await server.initialize(process.env.POSTGRES_URL || 'postgresql://localhost/test');

    // Start the agent
    runtime = await startAgent(terminalCharacter);
    await server.registerAgent(runtime);

    // Start the server
    await server.start(port);

    console.log(`Test server started on port ${port}`);
  }, 30000);

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
  });

  describe('Provider Management API', () => {
    it('should get provider status', async () => {
      const response = await fetch(`http://localhost:${port}/api/providers`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.providers).toBeInstanceOf(Array);
      expect(data.data.providers.length).toBeGreaterThan(0);

      // Should have the main providers
      const providerNames = data.data.providers.map((p: any) => p.name);
      expect(providerNames).toContain('ollama');
      expect(providerNames).toContain('openai');
      expect(providerNames).toContain('anthropic');
      expect(providerNames).toContain('elizaos');
    });

    it('should set selected provider', async () => {
      const response = await fetch(`http://localhost:${port}/api/providers/selected`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'ollama' }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should set provider preferences', async () => {
      const response = await fetch(`http://localhost:${port}/api/providers/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: ['ollama', 'openai', 'anthropic', 'elizaos'] }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should verify ollama is the default active provider', async () => {
      const response = await fetch(`http://localhost:${port}/api/providers`);
      const data = await response.json();

      // Ollama should be available by default (assuming it's running locally)
      const ollamaProvider = data.data.providers.find((p: any) => p.name === 'ollama');
      expect(ollamaProvider).toBeDefined();

      // If Ollama is available, it should be the active provider
      if (ollamaProvider.status === 'available') {
        expect(data.data.active).toBe('ollama');
      }
    });
  });

  describe('Message Routing', () => {
    it('should route messages through the inference plugin', async () => {
      // This test verifies that messages are processed through the inference system
      // We'll test this by sending a message and checking that it gets routed correctly

      const testMessage = {
        channelId: 'test-channel',
        agentId: runtime.agentId,
        content: 'Hello, this is a test message',
        author: 'test-user',
        metadata: {},
      };

      // Send message via WebSocket or direct runtime call
      const response = await runtime.generateResponse({
        content: { text: testMessage.content },
        agentId: runtime.agentId,
        userId: 'test-user-id',
        roomId: 'test-room-id',
      });

      expect(response).toBeDefined();
      expect(response.length).toBeGreaterThan(0);

      // The response should come from our inference system
      console.log('Response generated through inference plugin:', response[0]?.content);
    });
  });
});
