/**
 * Type Definition Tests
 * 
 * Tests to ensure type definitions are correct and comprehensive.
 */

import { describe, it, expect } from 'bun:test';
import type {
  AgentDefinition,
  AgentCharacter,
  AgentState,
  MemoryEntry,
  Room,
  RoomMember,
  RoomType,
  AgentRole,
  RoomConfig,
  RoomState,
  RoomMessage,
  RoomPhase,
  Team,
  TeamType,
  ExecutionRequest,
  ExecutionResult,
  ExecutionStatus,
  ExecutionOutput,
  ExecutionCost,
  ExecutionMetadata,
  AgentAction,
  AgentTrigger,
  TriggerType,
  TriggerConfig,
  AgentVault,
  VaultTransaction,
  AgentSearchFilter,
  ServiceSearchFilter,
  SearchResult,
  CrucibleConfig,
} from '../types';

describe('Type Definitions', () => {
  describe('Agent Types', () => {
    it('should create valid AgentDefinition', () => {
      const agent: AgentDefinition = {
        agentId: 1n,
        owner: '0x1234567890123456789012345678901234567890',
        name: 'Test Agent',
        characterCid: 'QmCharacterCid',
        stateCid: 'QmStateCid',
        vaultAddress: '0x1234567890123456789012345678901234567890',
        active: true,
        registeredAt: Date.now(),
        lastExecutedAt: Date.now(),
        executionCount: 10,
      };

      expect(agent.agentId).toBe(1n);
      expect(agent.active).toBe(true);
    });

    it('should create valid AgentState', () => {
      const state: AgentState = {
        agentId: 'agent-1',
        version: 5,
        memories: [],
        rooms: ['room-1', 'room-2'],
        context: { lastTopic: 'testing' },
        updatedAt: Date.now(),
      };

      expect(state.version).toBe(5);
      expect(state.rooms.length).toBe(2);
    });

    it('should create valid MemoryEntry', () => {
      const memory: MemoryEntry = {
        id: 'mem-1',
        content: 'User mentioned they like TypeScript',
        embedding: [0.1, 0.2, 0.3],
        importance: 0.8,
        createdAt: Date.now(),
        roomId: 'room-1',
        userId: 'user-123',
      };

      expect(memory.importance).toBe(0.8);
      expect(memory.embedding?.length).toBe(3);
    });
  });

  describe('Room Types', () => {
    it('should support all room types', () => {
      const roomTypes: RoomType[] = ['collaboration', 'adversarial', 'debate', 'council'];
      expect(roomTypes.length).toBe(4);
    });

    it('should support all agent roles', () => {
      const roles: AgentRole[] = ['participant', 'moderator', 'red_team', 'blue_team', 'observer'];
      expect(roles.length).toBe(5);
    });

    it('should support all room phases', () => {
      const phases: RoomPhase[] = ['setup', 'active', 'paused', 'completed', 'archived'];
      expect(phases.length).toBe(5);
    });

    it('should create valid Room', () => {
      const room: Room = {
        roomId: 1n,
        name: 'Security Review',
        description: 'Red vs Blue security challenge',
        owner: '0x1234567890123456789012345678901234567890',
        stateCid: 'QmRoomState',
        members: [],
        roomType: 'adversarial',
        config: {
          maxMembers: 10,
          turnBased: true,
          turnTimeout: 300,
          visibility: 'members_only',
        },
        active: true,
        createdAt: Date.now(),
      };

      expect(room.roomType).toBe('adversarial');
      expect(room.config.turnBased).toBe(true);
    });

    it('should create valid RoomMember', () => {
      const member: RoomMember = {
        agentId: 1n,
        role: 'red_team',
        joinedAt: Date.now(),
        lastActiveAt: Date.now(),
        score: 50,
      };

      expect(member.role).toBe('red_team');
      expect(member.score).toBe(50);
    });
  });

  describe('Team Types', () => {
    it('should support all team types', () => {
      const teamTypes: TeamType[] = ['red', 'blue', 'neutral', 'mixed'];
      expect(teamTypes.length).toBe(4);
    });

    it('should create valid Team', () => {
      const team: Team = {
        teamId: 1n,
        name: 'Red Squad',
        objective: 'Find security vulnerabilities',
        members: [1n, 2n, 3n],
        vaultAddress: '0x1234567890123456789012345678901234567890',
        teamType: 'red',
        leaderId: 1n,
        active: true,
      };

      expect(team.members.length).toBe(3);
      expect(team.teamType).toBe('red');
    });
  });

  describe('Execution Types', () => {
    it('should support all execution statuses', () => {
      const statuses: ExecutionStatus[] = ['pending', 'running', 'completed', 'failed', 'timeout'];
      expect(statuses.length).toBe(5);
    });

    it('should create valid ExecutionRequest', () => {
      const request: ExecutionRequest = {
        agentId: 1n,
        triggerId: 'trigger-123',
        input: {
          message: 'Hello agent',
          roomId: 'room-1',
          userId: 'user-456',
          context: { source: 'discord' },
        },
        options: {
          maxTokens: 1024,
          temperature: 0.7,
          requireTee: true,
          maxCost: 1000000000000000n,
          timeout: 30,
        },
      };

      expect(request.input.message).toBe('Hello agent');
      expect(request.options?.requireTee).toBe(true);
    });

    it('should create valid ExecutionResult', () => {
      const result: ExecutionResult = {
        executionId: 'exec-123',
        agentId: 1n,
        status: 'completed',
        output: {
          response: 'Hello! How can I help?',
          actions: [],
          stateUpdates: {},
          roomMessages: [],
        },
        newStateCid: 'QmNewState',
        cost: {
          total: 1000000000000000n,
          inference: 800000000000000n,
          storage: 100000000000000n,
          executionFee: 100000000000000n,
          currency: 'ETH',
          txHash: '0x123',
        },
        metadata: {
          startedAt: Date.now() - 5000,
          completedAt: Date.now(),
          latencyMs: 5000,
          model: 'llama-3.1-8b',
          tokensUsed: { input: 100, output: 50 },
          executor: '0x1234567890123456789012345678901234567890',
          attestationHash: '0xabcd',
        },
      };

      expect(result.status).toBe('completed');
      expect(result.cost.currency).toBe('ETH');
    });
  });

  describe('Trigger Types', () => {
    it('should support all trigger types', () => {
      const types: TriggerType[] = ['cron', 'webhook', 'event', 'room_message'];
      expect(types.length).toBe(4);
    });

    it('should create valid AgentTrigger', () => {
      const trigger: AgentTrigger = {
        triggerId: 'trigger-123',
        agentId: 1n,
        type: 'cron',
        config: {
          cronExpression: '0 9 * * 1-5',
          paymentMode: 'vault',
          pricePerExecution: 100000000000000n,
        },
        active: true,
        lastFiredAt: Date.now(),
        fireCount: 42,
      };

      expect(trigger.type).toBe('cron');
      expect(trigger.fireCount).toBe(42);
    });
  });

  describe('Vault Types', () => {
    it('should create valid AgentVault', () => {
      const vault: AgentVault = {
        address: '0x1234567890123456789012345678901234567890',
        agentId: 1n,
        balance: 1000000000000000000n,
        spendLimit: 100000000000000000n,
        approvedSpenders: ['0xabcd'],
        totalSpent: 500000000000000000n,
        lastFundedAt: Date.now(),
      };

      expect(vault.balance).toBe(1000000000000000000n);
    });

    it('should create valid VaultTransaction', () => {
      const tx: VaultTransaction = {
        txHash: '0x123abc',
        type: 'spend',
        amount: 100000000000000n,
        spender: '0xexecutor',
        description: 'Inference cost for execution exec-123',
        timestamp: Date.now(),
      };

      expect(tx.type).toBe('spend');
    });
  });

  describe('Search Types', () => {
    it('should create valid AgentSearchFilter', () => {
      const filter: AgentSearchFilter = {
        name: 'Jimmy',
        owner: '0x1234567890123456789012345678901234567890',
        active: true,
        capabilities: ['project-management'],
        roomId: 1n,
        limit: 20,
        offset: 0,
      };

      expect(filter.limit).toBe(20);
    });

    it('should create valid SearchResult', () => {
      const result: SearchResult<{ id: string }> = {
        items: [{ id: '1' }, { id: '2' }],
        total: 100,
        hasMore: true,
      };

      expect(result.items.length).toBe(2);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('Config Types', () => {
    it('should create valid CrucibleConfig', () => {
      const config: CrucibleConfig = {
        rpcUrl: 'http://localhost:8545',
        privateKey: '0x123',
        contracts: {
          agentVault: '0x1234567890123456789012345678901234567890',
          roomRegistry: '0x1234567890123456789012345678901234567890',
          triggerRegistry: '0x1234567890123456789012345678901234567890',
          identityRegistry: '0x1234567890123456789012345678901234567890',
          serviceRegistry: '0x1234567890123456789012345678901234567890',
        },
        services: {
          computeMarketplace: 'http://localhost:4007',
          storageApi: 'http://localhost:3100',
          ipfsGateway: 'http://localhost:3100',
          indexerGraphql: 'http://localhost:4350/graphql',
        },
        network: 'localnet',
      };

      expect(config.network).toBe('localnet');
    });
  });
});
