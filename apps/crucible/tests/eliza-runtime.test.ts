/**
 * Crucible ElizaOS Runtime Tests
 * 
 * Verifies the unified ElizaOS-compatible runtime works correctly.
 * Uses the same DWS infrastructure as Autocrat and Otto.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  CrucibleAgentRuntime,
  CrucibleRuntimeManager,
  createCrucibleRuntime,
  runtimeManager,
  checkDWSHealth,
  dwsGenerate,
  type RuntimeMessage,
} from '../src/sdk/eliza-runtime';
import { getCharacter, listCharacters } from '../src/characters';

describe('Crucible ElizaOS Runtime', () => {
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

  describe('DWS Generate', () => {
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
        useElizaOS: false, // Use DWS-only for testing
      });

      expect(runtime).toBeInstanceOf(CrucibleAgentRuntime);
      expect(runtime.getAgentId()).toBe('test-pm');
    });

    test('should initialize runtime', async () => {
      const character = getCharacter('community-manager');
      expect(character).toBeDefined();

      const runtime = createCrucibleRuntime({
        agentId: 'test-cm',
        character: character!,
        useElizaOS: false,
      });

      await runtime.initialize();
      expect(runtime.isInitialized()).toBe(true);
      
      console.log('[Test] DWS available:', runtime.isDWSAvailable());
    });
  });

  describe('Message Processing', () => {
    test('should process message when DWS available', async () => {
      const available = await checkDWSHealth();
      if (!available) {
        console.log('[Test] Skipping - DWS not available');
        return;
      }

      const character = getCharacter('project-manager');
      const runtime = createCrucibleRuntime({
        agentId: 'test-pm-msg',
        character: character!,
        useElizaOS: false,
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
      console.log('[Test] Actions:', response.actions);
    }, 60000);

    test('should extract action commands from response', async () => {
      const available = await checkDWSHealth();
      if (!available) {
        console.log('[Test] Skipping - DWS not available');
        return;
      }

      const character = getCharacter('project-manager');
      const runtime = createCrucibleRuntime({
        agentId: 'test-pm-action',
        character: character!,
        useElizaOS: false,
      });

      await runtime.initialize();

      // Ask for a specific action that should trigger action syntax
      const message: RuntimeMessage = {
        id: crypto.randomUUID(),
        userId: 'test-user',
        roomId: 'test-room',
        content: { text: 'Schedule a daily standup at 9am', source: 'test' },
        createdAt: Date.now(),
      };

      const response = await runtime.processMessage(message);
      
      console.log('[Test] Response:', response.text);
      console.log('[Test] Actions:', response.actions);

      // Response should either contain text or actions
      expect(response.text.length > 0 || (response.actions?.length ?? 0) > 0).toBe(true);
    }, 60000);
  });

  describe('Runtime Manager', () => {
    test('should create and track runtimes', async () => {
      const character = getCharacter('devrel');
      expect(character).toBeDefined();

      const runtime = await runtimeManager.createRuntime({
        agentId: 'devrel-test',
        character: character!,
        useElizaOS: false,
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
});

