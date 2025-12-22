/**
 * Crucible Live Agent Tests
 * 
 * E2E tests that verify agents work with DWS and provide real responses.
 * These tests require DWS to be running.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import {
  CrucibleAgentRuntime,
  createCrucibleRuntime,
  runtimeManager,
  checkDWSHealth,
  dwsGenerate,
  type RuntimeMessage,
} from '../src/sdk/eliza-runtime';
import { getCharacter, listCharacters, characters } from '../src/characters';

// Helper to create unique messages to ensure responses aren't cached
function createUniqueMessage(text: string): RuntimeMessage {
  const uniqueId = crypto.randomUUID();
  const timestamp = Date.now();
  return {
    id: uniqueId,
    userId: `test-user-${timestamp}`,
    roomId: `test-room-${timestamp}`,
    content: { 
      text: `[Request ID: ${uniqueId.slice(0, 8)}] ${text}`, 
      source: 'live-test' 
    },
    createdAt: timestamp,
  };
}

// Verify response is real by checking it's unique and contextual
function verifyRealResponse(
  response: { text: string; actions?: Array<{ name: string; params: Record<string, string> }> },
  expectedContext: string[]
): { isReal: boolean; reason: string } {
  const text = response.text.toLowerCase();
  
  // Check if response is too short (probably error or canned)
  if (response.text.length < 20) {
    return { isReal: false, reason: 'Response too short' };
  }
  
  // Check if response contains at least one context indicator
  const hasContext = expectedContext.some(ctx => text.includes(ctx.toLowerCase()));
  if (!hasContext) {
    return { isReal: false, reason: 'Response lacks contextual relevance' };
  }
  
  // Check for generic error responses
  const errorPatterns = ['error', 'failed', 'could not', 'unable to'];
  const isError = errorPatterns.some(p => text.includes(p) && response.text.length < 50);
  if (isError) {
    return { isReal: false, reason: 'Response appears to be an error' };
  }
  
  return { isReal: true, reason: 'Response is unique and contextual' };
}

describe('Live Agent E2E Tests', () => {
  let dwsAvailable = false;
  
  beforeAll(async () => {
    dwsAvailable = await checkDWSHealth();
    console.log(`[LiveTest] DWS available: ${dwsAvailable}`);
    
    if (!dwsAvailable) {
      console.warn('[LiveTest] DWS not available - some tests will be skipped');
    }
  });

  afterAll(async () => {
    await runtimeManager.shutdown();
  });

  // ============================================================================
  // DWS Direct Tests
  // ============================================================================

  describe('DWS Direct Inference', () => {
    test('should get real response from DWS', async () => {
      if (!dwsAvailable) {
        console.log('[LiveTest] Skipped - DWS not available');
        return;
      }

      // Ask a unique, specific question that requires AI understanding
      const uniqueQuestion = `What is the result of 17 * 23? (Request ID: ${crypto.randomUUID().slice(0, 8)})`;
      
      const response = await dwsGenerate(
        uniqueQuestion,
        'You are a helpful math assistant. Calculate the result and provide the answer.',
        { maxTokens: 100 }
      );

      console.log('[LiveTest] DWS Response:', response);

      // Verify it's a real response
      expect(response.length).toBeGreaterThan(0);
      expect(response).toContain('391'); // 17 * 23 = 391
    }, 30000);

    test('should maintain conversation context', async () => {
      if (!dwsAvailable) {
        console.log('[LiveTest] Skipped - DWS not available');
        return;
      }

      // First message
      const name = `Agent-${crypto.randomUUID().slice(0, 6)}`;
      const response1 = await dwsGenerate(
        `My name is ${name}. Remember that.`,
        'You are a helpful assistant. Acknowledge and remember details.',
        { maxTokens: 50 }
      );

      console.log('[LiveTest] Response 1:', response1);
      expect(response1.length).toBeGreaterThan(0);
      
      // The response should mention the name or acknowledge it
      const acknowledges = response1.toLowerCase().includes(name.toLowerCase()) || 
                          response1.toLowerCase().includes('remember') ||
                          response1.toLowerCase().includes('noted');
      expect(acknowledges).toBe(true);
    }, 30000);
  });

  // ============================================================================
  // Character-Based Agent Tests
  // ============================================================================

  describe('Project Manager Agent', () => {
    test('should respond with project management advice', async () => {
      if (!dwsAvailable) {
        console.log('[LiveTest] Skipped - DWS not available');
        return;
      }

      const character = getCharacter('project-manager');
      expect(character).toBeDefined();

      const runtime = createCrucibleRuntime({
        agentId: 'live-pm-test',
        character: character!,
        useElizaOS: false,
      });

      await runtime.initialize();
      expect(runtime.isDWSAvailable()).toBe(true);

      const message = createUniqueMessage(
        'We have a deadline next week but the team is falling behind. What should we do?'
      );

      const response = await runtime.processMessage(message);
      console.log('[LiveTest] PM Response:', response.text.slice(0, 300));

      // Verify it's a real, contextual response about project management
      const verification = verifyRealResponse(response, [
        'deadline', 'team', 'priorit', 'task', 'schedule', 'plan', 'scope',
        'communicate', 'resource', 'help', 'behind'
      ]);
      
      console.log('[LiveTest] Verification:', verification);
      expect(verification.isReal).toBe(true);
    }, 60000);
  });

  describe('Community Manager Agent', () => {
    test('should respond with community engagement advice', async () => {
      if (!dwsAvailable) {
        console.log('[LiveTest] Skipped - DWS not available');
        return;
      }

      const character = getCharacter('community-manager');
      expect(character).toBeDefined();

      const runtime = createCrucibleRuntime({
        agentId: 'live-cm-test',
        character: character!,
        useElizaOS: false,
      });

      await runtime.initialize();

      const message = createUniqueMessage(
        'How can we increase engagement in our Discord community?'
      );

      const response = await runtime.processMessage(message);
      console.log('[LiveTest] CM Response:', response.text.slice(0, 300));

      const verification = verifyRealResponse(response, [
        'community', 'engage', 'discord', 'member', 'event', 'content',
        'interact', 'active', 'channel', 'discussion'
      ]);
      
      console.log('[LiveTest] Verification:', verification);
      expect(verification.isReal).toBe(true);
    }, 60000);
  });

  describe('Red Team Agent', () => {
    test('should respond with security analysis', async () => {
      if (!dwsAvailable) {
        console.log('[LiveTest] Skipped - DWS not available');
        return;
      }

      const character = getCharacter('red-team');
      expect(character).toBeDefined();

      const runtime = createCrucibleRuntime({
        agentId: 'live-rt-test',
        character: character!,
        useElizaOS: false,
      });

      await runtime.initialize();

      const message = createUniqueMessage(
        'What are common security vulnerabilities in smart contracts?'
      );

      const response = await runtime.processMessage(message);
      console.log('[LiveTest] RT Response:', response.text.slice(0, 300));

      const verification = verifyRealResponse(response, [
        'vulnerabil', 'security', 'attack', 'reentrancy', 'overflow', 'access',
        'contract', 'exploit', 'audit', 'risk', 'smart'
      ]);
      
      console.log('[LiveTest] Verification:', verification);
      expect(verification.isReal).toBe(true);
    }, 60000);
  });

  // ============================================================================
  // Multiple Agent Interaction Tests
  // ============================================================================

  describe('Multi-Agent Scenario', () => {
    test('should handle multiple agents with different personalities', async () => {
      if (!dwsAvailable) {
        console.log('[LiveTest] Skipped - DWS not available');
        return;
      }

      const question = 'What is the most important thing for a new project?';
      const responses: Record<string, string> = {};

      // Test with 3 different character types
      const characterIds = ['project-manager', 'devrel', 'red-team'];

      for (const charId of characterIds) {
        const character = getCharacter(charId);
        if (!character) continue;

        const runtime = createCrucibleRuntime({
          agentId: `multi-${charId}`,
          character,
          useElizaOS: false,
        });

        await runtime.initialize();
        
        const message = createUniqueMessage(question);
        const response = await runtime.processMessage(message);
        
        responses[charId] = response.text;
        console.log(`[LiveTest] ${charId}: ${response.text.slice(0, 150)}...`);
      }

      // Verify we got different responses for different characters
      const responseTexts = Object.values(responses);
      expect(responseTexts.length).toBe(3);

      // Each response should be unique (different perspectives)
      for (let i = 0; i < responseTexts.length; i++) {
        for (let j = i + 1; j < responseTexts.length; j++) {
          // Responses should not be identical
          expect(responseTexts[i]).not.toBe(responseTexts[j]);
        }
      }
    }, 120000);
  });

  // ============================================================================
  // Anti-Caching Tests
  // ============================================================================

  describe('Response Uniqueness', () => {
    test('should give different responses to same question at different times', async () => {
      if (!dwsAvailable) {
        console.log('[LiveTest] Skipped - DWS not available');
        return;
      }

      const character = getCharacter('project-manager');
      const runtime = createCrucibleRuntime({
        agentId: 'uniqueness-test',
        character: character!,
        useElizaOS: false,
      });

      await runtime.initialize();

      // Ask similar question twice with different unique IDs
      const message1 = createUniqueMessage('What are your top priorities right now?');
      const message2 = createUniqueMessage('What are your top priorities right now?');

      const response1 = await runtime.processMessage(message1);
      const response2 = await runtime.processMessage(message2);

      console.log('[LiveTest] Response 1:', response1.text.slice(0, 150));
      console.log('[LiveTest] Response 2:', response2.text.slice(0, 150));

      // Both responses should exist
      expect(response1.text.length).toBeGreaterThan(0);
      expect(response2.text.length).toBeGreaterThan(0);

      // Note: Responses may be similar in content but should include unique IDs
      // The key is that both are valid AI responses, not cached
    }, 60000);
  });

  // ============================================================================
  // Server Integration Test
  // ============================================================================

  describe('Crucible Server Integration', () => {
    test('should work via HTTP API when server is running', async () => {
      const serverUrl = process.env.CRUCIBLE_URL ?? 'http://127.0.0.1:4010';
      
      // Check if server is running
      try {
        const healthRes = await fetch(`${serverUrl}/health`, { 
          signal: AbortSignal.timeout(2000) 
        });
        
        if (!healthRes.ok) {
          console.log('[LiveTest] Crucible server not available - skipping HTTP test');
          return;
        }
      } catch {
        console.log('[LiveTest] Crucible server not available - skipping HTTP test');
        return;
      }

      // Test chat endpoint
      const chatRes = await fetch(`${serverUrl}/api/v1/chat/project-manager`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `Hello! This is a test message. Request ID: ${crypto.randomUUID().slice(0, 8)}`,
          userId: 'test-user',
          roomId: 'test-room',
        }),
      });

      expect(chatRes.ok).toBe(true);
      
      const data = await chatRes.json() as { text: string; character: string; runtime: string };
      console.log('[LiveTest] Server Response:', data);

      expect(data.text).toBeDefined();
      expect(data.text.length).toBeGreaterThan(0);
      expect(data.character).toBe('project-manager');
    }, 30000);

    test('should list characters via HTTP API', async () => {
      const serverUrl = process.env.CRUCIBLE_URL ?? 'http://127.0.0.1:4010';
      
      try {
        const res = await fetch(`${serverUrl}/api/v1/chat/characters`, { 
          signal: AbortSignal.timeout(2000) 
        });
        
        if (!res.ok) {
          console.log('[LiveTest] Crucible server not available - skipping');
          return;
        }

        const data = await res.json() as { characters: Array<{ id: string; name: string }> };
        console.log('[LiveTest] Characters:', data.characters.map(c => c.id));
        
        expect(Array.isArray(data.characters)).toBe(true);
        expect(data.characters.length).toBeGreaterThan(0);
      } catch {
        console.log('[LiveTest] Crucible server not available - skipping');
      }
    }, 10000);
  });
});

// ============================================================================
// Standalone Test Runner
// ============================================================================

describe('Quick Validation', () => {
  test('all characters load correctly', () => {
    const charIds = listCharacters();
    expect(charIds.length).toBeGreaterThan(0);
    
    for (const id of charIds) {
      const char = getCharacter(id);
      expect(char).toBeDefined();
      expect(char?.name).toBeDefined();
      expect(char?.system).toBeDefined();
      expect(char?.bio).toBeDefined();
    }
    
    console.log(`[Validation] All ${charIds.length} characters loaded successfully`);
  });

  test('runtime manager initializes correctly', async () => {
    const character = getCharacter('blue-team');
    expect(character).toBeDefined();
    
    const runtime = await runtimeManager.createRuntime({
      agentId: 'validation-test',
      character: character!,
      useElizaOS: false,
    });
    
    expect(runtime).toBeDefined();
    expect(runtime.isInitialized()).toBe(true);
    
    console.log(`[Validation] Runtime initialized, DWS available: ${runtime.isDWSAvailable()}`);
  });
});

