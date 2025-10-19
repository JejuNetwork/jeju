import { describe, it, expect, beforeEach } from 'bun:test';
import { generateCodeAction } from '../actions/generate-code';
import { projectsProvider } from '../providers/projects-provider';
import {
  AgentRuntime,
  elizaLogger,
  type IAgentRuntime,
  type UUID,
  type Memory,
  type State,
} from '@elizaos/core';
import { formsPlugin } from '@elizaos/plugin-forms';
import { autocoderPlugin } from '../index';
import { v4 as uuidv4 } from 'uuid';

// Mock SQL plugin to avoid database issues
const mockSqlPlugin = {
  name: '@elizaos/plugin-sql',
  description: 'Mock SQL plugin for testing',
  actions: [],
  providers: [],
  services: [],
  init: async () => {
    elizaLogger.info('Mock SQL plugin initialized');
  },
};

// Create real runtime
const createRealRuntime = async () => {
  // Force BunSQLite for testing
  process.env.FORCE_BUNSQLITE = 'true';
  process.env.DATABASE_PATH = ':memory:'; // Use in-memory database
  process.env.ELIZA_TEST_MODE = 'true';
  process.env.SECRET_SALT = process.env.SECRET_SALT || 'test-salt-for-testing-only-not-secure';

  const runtime = new AgentRuntime({
    agentId: uuidv4() as UUID,
    character: {
      name: 'Test Agent',
      bio: ['Test agent for autocoder'],
      secrets: {},
      settings: {},
      plugins: [],
    },
  });

  // Use a mock database adapter to avoid SQL plugin issues
  // MUST be set before initialize()
  (runtime as any).adapter = {
    query: async () => [],
    execute: async () => ({ rows: [] }),
    initialized: true,
    init: async () => {},
    close: async () => {},
    // Agent methods
    getAgents: async () => [],
    createAgent: async (agent: any) => agent,
    updateAgent: async (id: string, updates: any) => ({ id, ...updates }),
    deleteAgent: async (id: string) => {},
    getAgent: async (id: string) => ({ id, name: 'Test Agent' }),
    // Room methods
    getRooms: async () => [],
    getRoomsByIds: async (ids: string[]) => ids.map((id) => ({ id })),
    createRoom: async (room: any) => room,
    updateRoom: async (id: string, updates: any) => ({ id, ...updates }),
    deleteRoom: async (id: string) => {},
    getRoom: async (id: string) => ({ id }),
    // Participant methods
    getParticipants: async () => [],
    getParticipantsByIds: async (ids: string[]) => ids.map((id) => ({ id })),
    getParticipantsForRoom: async (roomId: string) => [],
    addParticipantsToRoom: async (participantIds: string[], roomId: string) => true,
    createParticipant: async (participant: any) => participant,
    updateParticipant: async (id: string, updates: any) => ({ id, ...updates }),
    deleteParticipant: async (id: string) => {},
    getParticipant: async (id: string) => ({ id }),
    // Memory methods
    getMemories: async () => [],
    getMemoriesByIds: async (ids: string[]) => ids.map((id) => ({ id })),
    createMemory: async (memory: any) => memory,
    updateMemory: async (id: string, updates: any) => ({ id, ...updates }),
    deleteMemory: async (id: string) => {},
    getMemory: async (id: string) => ({ id }),
    // Entity methods
    getEntitiesByIds: async (ids: string[]) => ids.map((id) => ({ id })),
    createEntity: async (entity: any) => entity,
    updateEntity: async (id: string, updates: any) => ({ id, ...updates }),
    deleteEntity: async (id: string) => {},
    getEntity: async (id: string) => ({ id }),
    // World methods
    updateWorld: async (world: any) => world,
    // Participants methods
    addParticipantsRoom: async (entityIds: string[], roomId: string) => true,
    removeParticipantsRoom: async (entityIds: string[], roomId: string) => true,
  };

  // Register plugins in correct order
  await runtime.registerPlugin(formsPlugin);
  await runtime.registerPlugin(autocoderPlugin);

  // Initialize runtime
  await runtime.initialize();

  // Log service status
  elizaLogger.info('Runtime initialized', {
    hasForms: runtime.getService('forms') !== undefined,
    hasCodeGen: runtime.getService('code-generation') !== undefined,
  });

  return runtime;
};

describe('Generate Code Action', () => {
  let runtime: IAgentRuntime;

  beforeEach(async () => {
    runtime = await createRealRuntime();
  });

  it('should validate messages correctly', async () => {
    const message: Memory = {
      id: uuidv4() as UUID,
      entityId: uuidv4() as UUID,
      agentId: runtime.agentId,
      roomId: uuidv4() as UUID,
      content: { text: 'generate test-plugin' },
      createdAt: Date.now(),
    };
    const isValid = await generateCodeAction.validate(runtime, message);
    expect(isValid).toBe(true);
  });

  it('should handle generation', async () => {
    const message: Memory = {
      id: uuidv4() as UUID,
      entityId: uuidv4() as UUID,
      agentId: runtime.agentId,
      roomId: uuidv4() as UUID,
      content: { text: 'generate test-plugin for handling user authentication' },
      createdAt: Date.now(),
    };
    const state: State = {
      values: {},
      data: {},
      text: '',
    };
    const callback = async (response: any) => {
      console.log('Generation response:', response);
      return [];
    };

    const result = await generateCodeAction.handler(runtime, message, state, {}, callback);

    expect(result).toBeDefined();
  });
});

describe('Projects Provider', () => {
  let runtime: IAgentRuntime;

  beforeEach(async () => {
    runtime = await createRealRuntime();
  });

  it('should get projects from planning service', async () => {
    const memory: Memory = {
      id: uuidv4() as UUID,
      entityId: uuidv4() as UUID,
      agentId: runtime.agentId,
      roomId: uuidv4() as UUID,
      content: { text: 'test' },
      createdAt: Date.now(),
    };
    const state: State = {
      values: {},
      data: {},
      text: '',
    };
    const result = await projectsProvider.get(runtime, memory, state);
    expect(result).toBeDefined();
    expect(result.text).toBeDefined();
  });

  it('should handle missing service gracefully', async () => {
    // Create runtime without planning service
    const bareRuntime = new AgentRuntime({
      agentId: uuidv4() as UUID,
      character: {
        name: 'Test Agent',
        bio: ['Test agent'],
      },
    });

    const memory: Memory = {
      id: uuidv4() as UUID,
      entityId: uuidv4() as UUID,
      agentId: bareRuntime.agentId,
      roomId: uuidv4() as UUID,
      content: { text: 'test' },
      createdAt: Date.now(),
    };
    const state: State = {
      values: {},
      data: {},
      text: '',
    };

    const result = await projectsProvider.get(bareRuntime, memory, state);
    expect(result).toBeDefined();
    // Provider returns specific message when service not available
    expect(result.text).toContain('not available');
  });
});
