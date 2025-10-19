import { mock } from 'bun:test';
import type { IAgentRuntime, Memory, State, UUID } from '@elizaos/core';

export function createMockRuntime(overrides: Partial<IAgentRuntime> = {}): IAgentRuntime {
  // Create a minimal mock runtime with only essential properties
  // Use 'as any' to bypass strict type checking for test mocks
  const mockRuntime = {
    agentId: 'test-agent-id' as UUID,
    db: null,
    actions: [],
    providers: [],
    evaluators: [],
    services: new Map(),
    character: {
      name: 'Test Agent',
      id: 'test-agent-id' as UUID,
      username: 'test-agent',
      bio: [],
      settings: {},
      system: 'test system',
      plugins: [],
    },
    // Add commonly used methods as mocks
    getSetting: mock(() => null),
    getService: mock(() => null),
    hasService: mock(() => false),
    registerService: mock(),
    unregisterService: mock(),
    initialize: mock(() => Promise.resolve()),
    stop: mock(() => Promise.resolve()),
    evaluate: mock(() => Promise.resolve(null)),
    processActions: mock(() => Promise.resolve()),
    useModel: mock(() => Promise.resolve('test response')),
    ensureConnection: mock(() => Promise.resolve()),
    composeState: mock(() => Promise.resolve({ data: {}, values: {}, text: '' } as State)),
    createMemory: mock(() => Promise.resolve('test-memory-id' as UUID)),
    updateGoal: mock(() => Promise.resolve()),
    getGoals: mock(() => Promise.resolve([])),
    deleteGoal: mock(() => Promise.resolve()),
    ...overrides,
  } as any; // Use 'as any' to bypass strict type checking for test mocks

  return mockRuntime as IAgentRuntime;
}

export function createMockMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'test-memory-id' as UUID,
    entityId: 'test-entity-id' as UUID,
    agentId: 'test-agent-id' as UUID,
    roomId: 'test-room-id' as UUID,
    content: {
      text: 'test memory',
    },
    createdAt: Date.now(),
    ...overrides,
  };
}

export function createMockState(overrides: Partial<State> = {}): State {
  return {
    data: {},
    values: {},
    text: '',
    ...overrides,
  };
}
