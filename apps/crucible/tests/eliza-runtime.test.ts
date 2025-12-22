/**
 * Crucible Agent Runtime Tests
 * 
 * Tests both runtime modes:
 * 1. ElizaOS + @jejunetwork/eliza-plugin (full capabilities)
 * 2. DWS fallback (character-template inference)
 */

import { describe, test, expect } from 'bun:test';
import {
  CrucibleAgentRuntime,
  createCrucibleRuntime,
  runtimeManager,
  checkDWSHealth,
  dwsGenerate,
  type RuntimeMessage,
} from '../src/sdk/eliza-runtime';
import { getCharacter, listCharacters } from '../src/characters';

describe('Crucible Agent Runtime', () => {
  describe('DWS Health Check', () => {
    test('should have checkDWSHealth function', () => {
      expect(typeof checkDWSHealth).toBe('function');
    });

    test('should check DWS availability', async () => {
      const available = await checkDWSHealth();
      console.log('[Test] DWS available:', available);
      expect(typeof available).toBe('boolean');
    });
  });

  describe('DWS Generate (fallback mode)', () => {
    test('should have dwsGenerate function', () => {
      expect(typeof dwsGenerate).toBe('function');
    });

    test('should generate response when DWS available', async () => {
      const available = await checkDWSHealth();
      if (!available) {
        console.log('[Test] Skipping - DWS not available');
        return;
      }

      const response = await dwsGenerate(
        'What is the capital of France?',
        'You are a helpful assistant. Be brief.',
        { maxTokens: 50 }
      );

      expect(typeof response).toBe('string');
      expect(response.length).toBeGreaterThan(0);
      console.log('[Test] DWS response:', response.slice(0, 100));
    }, 30000);
  });

  describe('Runtime Creation', () => {
    test('should create runtime with character', async () => {
      const character = getCharacter('project-manager');
      expect(character).toBeDefined();

      const runtime = createCrucibleRuntime({
        agentId: 'test-pm',
        character: character!,
        useJejuPlugin: false, // Skip plugin for basic test
      });

      expect(runtime).toBeInstanceOf(CrucibleAgentRuntime);
      expect(runtime.getAgentId()).toBe('test-pm');
    });

    test('should initialize runtime and detect capabilities', async () => {
      const character = getCharacter('community-manager');
      expect(character).toBeDefined();

      const runtime = createCrucibleRuntime({
        agentId: 'test-cm',
        character: character!,
        useJejuPlugin: true, // Try to load plugin
      });

      await runtime.initialize();
      expect(runtime.isInitialized()).toBe(true);
      
      console.log('[Test] DWS available:', runtime.isDWSAvailable());
      console.log('[Test] ElizaOS available:', runtime.isElizaOSAvailable());
    });

    test('should report runtime type correctly', async () => {
      const character = getCharacter('devrel');
      expect(character).toBeDefined();

      const runtime = createCrucibleRuntime({
        agentId: 'test-devrel',
        character: character!,
      });

      await runtime.initialize();
      
      // Should be initialized regardless of which mode
      expect(runtime.isInitialized()).toBe(true);
      
      // At least one mode should be available
      expect(runtime.isDWSAvailable() || runtime.isElizaOSAvailable()).toBe(true);
    });
  });

  describe('Message Processing', () => {
    test('should process message through runtime', async () => {
      const available = await checkDWSHealth();
      if (!available) {
        console.log('[Test] Skipping - DWS not available');
        return;
      }

      const character = getCharacter('project-manager');
      const runtime = createCrucibleRuntime({
        agentId: 'test-pm-msg',
        character: character!,
        useJejuPlugin: false, // Use DWS fallback for predictable test
      });

      await runtime.initialize();

      const message: RuntimeMessage = {
        id: crypto.randomUUID(),
        userId: 'test-user',
        roomId: 'test-room',
        content: { text: 'Create a todo for reviewing the documentation', source: 'test' },
        createdAt: Date.now(),
      };

      const response = await runtime.processMessage(message);

      expect(response).toBeDefined();
      expect(typeof response.text).toBe('string');
      expect(response.text.length).toBeGreaterThan(0);
      
      console.log('[Test] Response:', response.text.slice(0, 200));
      console.log('[Test] Action:', response.action);
      console.log('[Test] Actions:', response.actions);
    }, 60000);

    test('should handle action responses', async () => {
      const available = await checkDWSHealth();
      if (!available) {
        console.log('[Test] Skipping - DWS not available');
        return;
      }

      const character = getCharacter('project-manager');
      const runtime = createCrucibleRuntime({
        agentId: 'test-pm-action',
        character: character!,
      });

      await runtime.initialize();

      const message: RuntimeMessage = {
        id: crypto.randomUUID(),
        userId: 'test-user',
        roomId: 'test-room',
        content: { text: 'Schedule a daily standup at 9am', source: 'test' },
        createdAt: Date.now(),
      };

      const response = await runtime.processMessage(message);
      
      console.log('[Test] Response:', response.text);
      console.log('[Test] Action:', response.action);
      console.log('[Test] Actions:', response.actions);

      // Response should contain text
      expect(response.text.length).toBeGreaterThan(0);
    }, 60000);
  });

  describe('Runtime Manager', () => {
    test('should create and track runtimes', async () => {
      const character = getCharacter('devrel');
      expect(character).toBeDefined();

      const runtime = await runtimeManager.createRuntime({
        agentId: 'devrel-test',
        character: character!,
        useJejuPlugin: false,
      });

      expect(runtime).toBeInstanceOf(CrucibleAgentRuntime);
      
      const retrieved = runtimeManager.getRuntime('devrel-test');
      expect(retrieved).toBe(runtime);

      const all = runtimeManager.getAllRuntimes();
      expect(all.length).toBeGreaterThan(0);
    });

    test('should not duplicate runtimes', async () => {
      const character = getCharacter('liaison');
      expect(character).toBeDefined();

      const runtime1 = await runtimeManager.createRuntime({
        agentId: 'liaison-test',
        character: character!,
      });

      const runtime2 = await runtimeManager.createRuntime({
        agentId: 'liaison-test',
        character: character!,
      });

      expect(runtime1).toBe(runtime2);
    });

    test('should report capabilities for each runtime', async () => {
      const runtimes = runtimeManager.getAllRuntimes();
      
      for (const runtime of runtimes) {
        console.log(`[Test] Runtime ${runtime.getAgentId()}:`, {
          elizaos: runtime.isElizaOSAvailable(),
          dws: runtime.isDWSAvailable(),
        });
      }
    });

    test('should shutdown all runtimes', async () => {
      await runtimeManager.shutdown();
      const all = runtimeManager.getAllRuntimes();
      expect(all.length).toBe(0);
    });
  });

  describe('Character Library', () => {
    test('should list available characters', () => {
      const chars = listCharacters();
      expect(chars.length).toBeGreaterThan(0);
      console.log('[Test] Available characters:', chars);
    });

    test('should load all characters', () => {
      const charIds = listCharacters();
      for (const id of charIds) {
        const char = getCharacter(id);
        expect(char).toBeDefined();
        expect(char?.name).toBeDefined();
        expect(char?.system).toBeDefined();
        console.log(`[Test] Character: ${id} -> ${char?.name}`);
      }
    });

    test('project-manager should have correct structure', () => {
      const pm = getCharacter('project-manager');
      expect(pm).toBeDefined();
      expect(pm?.name).toBe('Jimmy');
      expect(pm?.bio?.length).toBeGreaterThan(0);
      expect(pm?.style?.all?.length).toBeGreaterThan(0);
    });

    test('red-team should have correct structure', () => {
      const rt = getCharacter('red-team');
      expect(rt).toBeDefined();
      expect(rt?.topics?.some(t => t.includes('security'))).toBe(true);
    });
  });

  describe('ElizaOS Integration', () => {
    test('should detect ElizaOS availability', async () => {
      const character = getCharacter('project-manager');
      const runtime = createCrucibleRuntime({
        agentId: 'elizaos-test',
        character: character!,
        useJejuPlugin: true,
      });

      await runtime.initialize();

      // Log the result - either mode is acceptable
      if (runtime.isElizaOSAvailable()) {
        console.log('[Test] ElizaOS mode: Full plugin support enabled');
        expect(runtime.getElizaRuntime()).toBeDefined();
      } else {
        console.log('[Test] DWS fallback mode: Character-inference only');
        expect(runtime.isDWSAvailable()).toBe(true);
      }
    });

    test('should expose ElizaOS runtime when available', async () => {
      const character = getCharacter('community-manager');
      const runtime = createCrucibleRuntime({
        agentId: 'elizaos-runtime-test',
        character: character!,
        useJejuPlugin: true,
      });

      await runtime.initialize();

      const elizaRuntime = runtime.getElizaRuntime();
      
      if (elizaRuntime) {
        console.log('[Test] ElizaOS runtime available:', {
          agentId: elizaRuntime.agentId,
          characterName: (elizaRuntime.character as { name?: string }).name,
        });
      } else {
        console.log('[Test] ElizaOS runtime not available - using DWS fallback');
      }
    });
  });
});
