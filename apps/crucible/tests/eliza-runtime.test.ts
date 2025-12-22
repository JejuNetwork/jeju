/**
 * Crucible Agent Runtime Tests
 * 
 * Tests ElizaOS + @jejunetwork/eliza-plugin integration.
 */

import { describe, test, expect } from 'bun:test';
import {
  CrucibleAgentRuntime,
  createCrucibleRuntime,
  runtimeManager,
  type RuntimeMessage,
} from '../src/sdk/eliza-runtime';
import { getCharacter, listCharacters } from '../src/characters';

describe('Crucible Agent Runtime', () => {
  describe('Runtime Creation', () => {
    test('should create runtime with character', async () => {
      const character = getCharacter('project-manager');
      expect(character).toBeDefined();

      const runtime = createCrucibleRuntime({
        agentId: 'test-pm',
        character: character!,
      });

      expect(runtime).toBeInstanceOf(CrucibleAgentRuntime);
      expect(runtime.getAgentId()).toBe('test-pm');
    });

    test('should initialize runtime with ElizaOS and jejuPlugin', async () => {
      const character = getCharacter('community-manager');
      expect(character).toBeDefined();

      const runtime = createCrucibleRuntime({
        agentId: 'test-cm',
        character: character!,
      });

      await runtime.initialize();
      expect(runtime.isInitialized()).toBe(true);
      expect(runtime.getElizaRuntime()).toBeDefined();
    });
  });

  describe('Message Processing', () => {
    test('should process message through ElizaOS', async () => {
      const character = getCharacter('project-manager');
      const runtime = createCrucibleRuntime({
        agentId: 'test-pm-msg',
        character: character!,
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
    }, 60000);

    test('should handle action responses', async () => {
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
    test('should expose ElizaOS runtime', async () => {
      const character = getCharacter('community-manager');
      const runtime = createCrucibleRuntime({
        agentId: 'elizaos-runtime-test',
        character: character!,
      });

      await runtime.initialize();

      const elizaRuntime = runtime.getElizaRuntime();
      expect(elizaRuntime).toBeDefined();
      
      console.log('[Test] ElizaOS runtime:', {
        agentId: elizaRuntime.agentId,
        characterName: (elizaRuntime.character as { name?: string }).name,
      });
    });
  });
});
