/**
 * Storage SDK Edge Cases and Error Handling Tests
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { CrucibleStorage, createStorage } from '../sdk/storage';
import type { AgentCharacter, AgentState, RoomState, RoomMessage, MemoryEntry } from '../types';

describe('CrucibleStorage Edge Cases', () => {
  let storage: CrucibleStorage;
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    storage = createStorage({
      apiUrl: 'http://localhost:3100',
      ipfsGateway: 'http://localhost:3100',
    });
    mockFetch = mock(() => Promise.resolve(new Response()));
    global.fetch = mockFetch as typeof fetch;
  });

  describe('Character Storage - Boundary Conditions', () => {
    it('should handle character with empty arrays', async () => {
      const minimalCharacter: AgentCharacter = {
        id: 'minimal',
        name: 'M',
        description: '',
        system: 'You are minimal.',
        bio: [],
        messageExamples: [],
        topics: [],
        adjectives: [],
        style: { all: [], chat: [], post: [] },
      };

      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ cid: 'QmMinimal' }), { status: 200 }))
      );

      const cid = await storage.storeCharacter(minimalCharacter);
      expect(cid).toBe('QmMinimal');

      // Verify the request body contains proper JSON
      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string);
      const parsed = JSON.parse(body.content);
      expect(parsed.bio).toEqual([]);
    });

    it('should handle character with very long content', async () => {
      const longSystem = 'A'.repeat(100000);
      const longCharacter: AgentCharacter = {
        id: 'long-character',
        name: 'Long',
        description: 'B'.repeat(10000),
        system: longSystem,
        bio: Array(100).fill('Bio line'),
        messageExamples: [],
        topics: Array(50).fill('topic'),
        adjectives: Array(20).fill('adj'),
        style: { all: [], chat: [], post: [] },
      };

      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ cid: 'QmLong' }), { status: 200 }))
      );

      const cid = await storage.storeCharacter(longCharacter);
      expect(cid).toBe('QmLong');

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string);
      expect(body.content.length).toBeGreaterThan(100000);
    });

    it('should handle character with unicode and special characters', async () => {
      const unicodeCharacter: AgentCharacter = {
        id: 'unicode-test',
        name: '日本語エージェント',
        description: '这是一个测试 🚀 émojis & spëcial chars <script>alert(1)</script>',
        system: 'You speak multiple languages: 中文, 日本語, العربية',
        bio: ['Line with "quotes" and \'apostrophes\'', 'Line with\nnewlines\tand\ttabs'],
        messageExamples: [],
        topics: ['日本語', 'العربية'],
        adjectives: ['émotional'],
        style: { all: [], chat: [], post: [] },
      };

      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ cid: 'QmUnicode' }), { status: 200 }))
      );

      const cid = await storage.storeCharacter(unicodeCharacter);
      expect(cid).toBe('QmUnicode');
    });
  });

  describe('Character Storage - Error Handling', () => {
    it('should throw on network error', async () => {
      mockFetch.mockImplementation(() => Promise.reject(new Error('Network error')));

      const character: AgentCharacter = {
        id: 'test', name: 'Test', description: '', system: 'Test',
        bio: [], messageExamples: [], topics: [], adjectives: [],
        style: { all: [], chat: [], post: [] },
      };

      await expect(storage.storeCharacter(character)).rejects.toThrow('Network error');
    });

    it('should throw on 400 Bad Request', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('Invalid content', { status: 400 }))
      );

      const character: AgentCharacter = {
        id: 'test', name: 'Test', description: '', system: 'Test',
        bio: [], messageExamples: [], topics: [], adjectives: [],
        style: { all: [], chat: [], post: [] },
      };

      await expect(storage.storeCharacter(character)).rejects.toThrow('Failed to upload to IPFS');
    });

    it('should throw on 503 Service Unavailable', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('Service unavailable', { status: 503 }))
      );

      const character: AgentCharacter = {
        id: 'test', name: 'Test', description: '', system: 'Test',
        bio: [], messageExamples: [], topics: [], adjectives: [],
        style: { all: [], chat: [], post: [] },
      };

      await expect(storage.storeCharacter(character)).rejects.toThrow('Failed to upload to IPFS');
    });

    it('should throw on malformed JSON response', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('not json', { status: 200 }))
      );

      const character: AgentCharacter = {
        id: 'test', name: 'Test', description: '', system: 'Test',
        bio: [], messageExamples: [], topics: [], adjectives: [],
        style: { all: [], chat: [], post: [] },
      };

      await expect(storage.storeCharacter(character)).rejects.toThrow();
    });

    it('should throw on load with 404 Not Found', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('Not found', { status: 404 }))
      );

      await expect(storage.loadCharacter('QmNonExistent')).rejects.toThrow('Failed to fetch from IPFS');
    });
  });

  describe('Agent State - Edge Cases', () => {
    it('should handle state with many memories', async () => {
      const memories: MemoryEntry[] = Array(1000).fill(null).map((_, i) => ({
        id: `mem-${i}`,
        content: `Memory content ${i}`,
        importance: Math.random(),
        createdAt: Date.now() - i * 1000,
      }));

      const state: AgentState = {
        agentId: 'agent-many-memories',
        version: 100,
        memories,
        rooms: Array(50).fill(null).map((_, i) => `room-${i}`),
        context: { deep: { nested: { object: { value: 123 } } } },
        updatedAt: Date.now(),
      };

      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ cid: 'QmManyMemories' }), { status: 200 }))
      );

      const cid = await storage.storeAgentState(state);
      expect(cid).toBe('QmManyMemories');
    });

    it('should handle state with embeddings', async () => {
      const embedding = Array(1536).fill(0).map(() => Math.random());
      const memories: MemoryEntry[] = [{
        id: 'mem-embed',
        content: 'Memory with embedding',
        embedding,
        importance: 0.9,
        createdAt: Date.now(),
      }];

      const state: AgentState = {
        agentId: 'agent-embeddings',
        version: 1,
        memories,
        rooms: [],
        context: {},
        updatedAt: Date.now(),
      };

      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ cid: 'QmEmbeddings' }), { status: 200 }))
      );

      const cid = await storage.storeAgentState(state);
      expect(cid).toBe('QmEmbeddings');

      // Verify embedding is included
      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string);
      expect(body.content).toContain('embedding');
    });

    it('should preserve version 0 on initial state', () => {
      const state = storage.createInitialState('new-agent');
      expect(state.version).toBe(0);
      expect(state.agentId).toBe('new-agent');
    });

    it('should increment version correctly across multiple updates', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ cid: 'QmUpdated' }), { status: 200 }))
      );

      let state = storage.createInitialState('agent-versioned');
      expect(state.version).toBe(0);

      for (let i = 1; i <= 10; i++) {
        const { state: newState } = await storage.updateAgentState(state, { context: { step: i } });
        expect(newState.version).toBe(i);
        state = newState;
      }

      expect(state.version).toBe(10);
    });
  });

  describe('Room State - Edge Cases', () => {
    it('should handle room with many messages', async () => {
      const messages: RoomMessage[] = Array(500).fill(null).map((_, i) => ({
        id: `msg-${i}`,
        agentId: `agent-${i % 5}`,
        content: `Message content ${i} with some text`,
        timestamp: Date.now() - i * 1000,
        action: i % 10 === 0 ? 'POST_TO_ROOM' : undefined,
      }));

      const state: RoomState = {
        roomId: 'room-many-messages',
        version: 50,
        messages,
        scores: Object.fromEntries(Array(5).fill(null).map((_, i) => [`agent-${i}`, i * 10])),
        phase: 'active',
        metadata: { roundNumber: 10 },
        updatedAt: Date.now(),
      };

      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ cid: 'QmManyMessages' }), { status: 200 }))
      );

      const cid = await storage.storeRoomState(state);
      expect(cid).toBe('QmManyMessages');
    });

    it('should handle all room phases', () => {
      const phases = ['setup', 'active', 'paused', 'completed', 'archived'] as const;
      
      for (const phase of phases) {
        const state = storage.createInitialRoomState(`room-${phase}`);
        state.phase = phase;
        expect(state.phase).toBe(phase);
      }
    });

    it('should handle negative scores', async () => {
      const state: RoomState = {
        roomId: 'room-negative-scores',
        version: 1,
        messages: [],
        scores: { 'agent-1': -50, 'agent-2': 100, 'agent-3': -25 },
        phase: 'active',
        metadata: {},
        updatedAt: Date.now(),
      };

      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ cid: 'QmNegative' }), { status: 200 }))
      );

      const cid = await storage.storeRoomState(state);
      expect(cid).toBe('QmNegative');

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string);
      const parsed = JSON.parse(body.content);
      expect(parsed.scores['agent-1']).toBe(-50);
    });
  });

  describe('IPFS Operations - Edge Cases', () => {
    it('should handle exists check with timeout', async () => {
      mockFetch.mockImplementation(() =>
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100))
      );

      await expect(storage.exists('QmTimeout')).rejects.toThrow('Timeout');
    });

    it('should handle pin with 409 Conflict (already pinned)', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('Already pinned', { status: 409 }))
      );

      // 409 is not ok, so it should throw
      await expect(storage.pin('QmAlreadyPinned')).rejects.toThrow('Failed to pin CID');
    });

    it('should handle CID with various formats', async () => {
      const cids = [
        'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG', // CIDv0
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi', // CIDv1
        'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku', // CIDv1 raw
      ];

      for (const cid of cids) {
        mockFetch.mockImplementation(() =>
          Promise.resolve(new Response(null, { status: 200 }))
        );

        const exists = await storage.exists(cid);
        expect(exists).toBe(true);
      }
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent character uploads', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        return Promise.resolve(new Response(JSON.stringify({ cid: `QmConcurrent${callCount}` }), { status: 200 }));
      });

      const characters: AgentCharacter[] = Array(10).fill(null).map((_, i) => ({
        id: `concurrent-${i}`,
        name: `Agent ${i}`,
        description: '',
        system: 'Test',
        bio: [],
        messageExamples: [],
        topics: [],
        adjectives: [],
        style: { all: [], chat: [], post: [] },
      }));

      const results = await Promise.all(characters.map(c => storage.storeCharacter(c)));
      
      expect(results.length).toBe(10);
      expect(new Set(results).size).toBe(10); // All unique CIDs
    });

    it('should handle concurrent state updates', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ cid: 'QmConcurrentState' }), { status: 200 }))
      );

      const baseState = storage.createInitialState('concurrent-agent');

      // Simulate concurrent updates (they will have same base version)
      const updates = await Promise.all([
        storage.updateAgentState(baseState, { context: { update: 1 } }),
        storage.updateAgentState(baseState, { context: { update: 2 } }),
        storage.updateAgentState(baseState, { context: { update: 3 } }),
      ]);

      // All should have version 1 since they all started from version 0
      expect(updates[0].state.version).toBe(1);
      expect(updates[1].state.version).toBe(1);
      expect(updates[2].state.version).toBe(1);
    });
  });

  describe('Data Integrity', () => {
    it('should preserve exact character data through round-trip', async () => {
      const original: AgentCharacter = {
        id: 'integrity-test',
        name: 'Integrity',
        description: 'Test data integrity',
        system: 'You are a test agent for data integrity.',
        bio: ['First line', 'Second line'],
        messageExamples: [[
          { name: 'user', content: { text: 'Hello' } },
          { name: 'agent', content: { text: 'Hi there!' } },
        ]],
        topics: ['testing', 'integrity'],
        adjectives: ['careful', 'precise'],
        style: {
          all: ['Be precise'],
          chat: ['Be friendly'],
          post: ['Be engaging'],
        },
        modelPreferences: {
          small: 'llama-3.1-8b',
          large: 'llama-3.1-70b',
          embedding: 'text-embedding-ada-002',
        },
        mcpServers: ['org-tools'],
        a2aCapabilities: ['search'],
      };

      // Capture what was sent
      let sentContent: string = '';
      mockFetch.mockImplementation((url: string, options: RequestInit) => {
        if (options.method === 'POST') {
          const body = JSON.parse(options.body as string);
          sentContent = body.content;
        }
        return Promise.resolve(new Response(JSON.stringify({ cid: 'QmIntegrity' }), { status: 200 }));
      });

      await storage.storeCharacter(original);

      // Verify the sent content matches original
      const parsed = JSON.parse(sentContent);
      expect(parsed.id).toBe(original.id);
      expect(parsed.name).toBe(original.name);
      expect(parsed.system).toBe(original.system);
      expect(parsed.bio).toEqual(original.bio);
      expect(parsed.modelPreferences).toEqual(original.modelPreferences);
      expect(parsed.mcpServers).toEqual(original.mcpServers);
    });
  });
});
