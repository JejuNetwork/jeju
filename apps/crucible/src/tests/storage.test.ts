/**
 * Storage SDK Tests
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { CrucibleStorage, createStorage } from '../sdk/storage';
import type { AgentCharacter, AgentState, RoomState } from '../types';

describe('CrucibleStorage', () => {
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

  describe('Character Storage', () => {
    const mockCharacter: AgentCharacter = {
      id: 'test-agent',
      name: 'Test Agent',
      description: 'A test agent',
      system: 'You are a test agent.',
      bio: ['Test bio line'],
      messageExamples: [],
      topics: ['testing'],
      adjectives: ['reliable'],
      style: {
        all: ['Be helpful'],
        chat: ['Be concise'],
        post: ['Be engaging'],
      },
    };

    it('should store character and return CID', async () => {
      const expectedCid = 'QmTestCharacterCid';
      
      mockFetch.mockImplementation(() => 
        Promise.resolve(new Response(JSON.stringify({ cid: expectedCid }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      );

      const cid = await storage.storeCharacter(mockCharacter);
      
      expect(cid).toBe(expectedCid);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should load character from CID', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockCharacter), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      );

      const character = await storage.loadCharacter('QmTestCid');
      
      expect(character.id).toBe('test-agent');
      expect(character.name).toBe('Test Agent');
    });

    it('should throw on failed upload', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('Upload failed', { status: 500 }))
      );

      await expect(storage.storeCharacter(mockCharacter)).rejects.toThrow('Failed to upload to IPFS');
    });
  });

  describe('Agent State', () => {
    it('should create initial state', () => {
      const state = storage.createInitialState('agent-123');
      
      expect(state.agentId).toBe('agent-123');
      expect(state.version).toBe(0);
      expect(state.memories).toEqual([]);
      expect(state.rooms).toEqual([]);
      expect(state.context).toEqual({});
    });

    it('should store agent state', async () => {
      const expectedCid = 'QmTestStateCid';
      
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ cid: expectedCid }), {
          status: 200,
        }))
      );

      const state: AgentState = {
        agentId: 'agent-123',
        version: 1,
        memories: [],
        rooms: [],
        context: {},
        updatedAt: Date.now(),
      };

      const cid = await storage.storeAgentState(state);
      expect(cid).toBe(expectedCid);
    });

    it('should update state and increment version', async () => {
      const currentState: AgentState = {
        agentId: 'agent-123',
        version: 5,
        memories: [],
        rooms: [],
        context: { foo: 'bar' },
        updatedAt: Date.now() - 1000,
      };

      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ cid: 'QmNewCid' }), {
          status: 200,
        }))
      );

      const { state, cid } = await storage.updateAgentState(currentState, {
        context: { foo: 'baz', newKey: 'value' },
      });

      expect(state.version).toBe(6);
      expect(state.context).toEqual({ foo: 'baz', newKey: 'value' });
      expect(state.updatedAt).toBeGreaterThan(currentState.updatedAt);
      expect(cid).toBe('QmNewCid');
    });
  });

  describe('Room State', () => {
    it('should create initial room state', () => {
      const state = storage.createInitialRoomState('room-456');
      
      expect(state.roomId).toBe('room-456');
      expect(state.version).toBe(0);
      expect(state.messages).toEqual([]);
      expect(state.scores).toEqual({});
      expect(state.phase).toBe('setup');
    });

    it('should store room state', async () => {
      const expectedCid = 'QmRoomStateCid';
      
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ cid: expectedCid }), {
          status: 200,
        }))
      );

      const state: RoomState = {
        roomId: 'room-456',
        version: 1,
        messages: [],
        scores: {},
        phase: 'active',
        metadata: {},
        updatedAt: Date.now(),
      };

      const cid = await storage.storeRoomState(state);
      expect(cid).toBe(expectedCid);
    });
  });

  describe('IPFS Operations', () => {
    it('should check if CID exists', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 200 }))
      );

      const exists = await storage.exists('QmExistingCid');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent CID', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 404 }))
      );

      const exists = await storage.exists('QmNonExistent');
      expect(exists).toBe(false);
    });

    it('should pin CID', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 200 }))
      );

      await expect(storage.pin('QmTestCid')).resolves.toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
