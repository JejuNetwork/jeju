import { mock } from 'bun:test';
import type { IAgentRuntime, Memory, State, UUID } from '@elizaos/core';

export function createMockRuntime(
  overrides: Partial<IAgentRuntime> = {}
): IAgentRuntime {
  return {
    agentId: '00000000-0000-0000-0000-000000000001' as UUID,
    getConversationLength: mock(() => 10),
    getSetting: mock(() => null),
    getService: mock(() => null),
    hasService: mock(() => false),
    registerService: mock(),
    initialize: mock(() => Promise.resolve()),
    stop: mock(() => Promise.resolve()),
    evaluate: mock(() => Promise.resolve(null)),
    processActions: mock(() => Promise.resolve()),
    useModel: mock(() => Promise.resolve('test response')) as any,
    ensureConnection: mock(() => Promise.resolve()),
    composeState: mock(() =>
      Promise.resolve({ data: {}, values: {}, text: '' } as State)
    ),
    createMemory: mock(() => Promise.resolve('test-memory-id' as UUID)),
    actions: [],
    providers: [],
    evaluators: [],
    services: new Map(),
    db: null,
    plugins: [],
    routes: [],
    logger: console,
    character: {
      name: 'Test Agent',
      id: '00000000-0000-0000-0000-000000000001' as UUID,
      username: 'test-agent',
      bio: [],
      settings: {},
      system: 'test system',
      plugins: [],
    },
    ...overrides,
  } as IAgentRuntime;
}

export function createMockMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: '00000000-0000-0000-0000-000000000002' as UUID,
    entityId: '00000000-0000-0000-0000-000000000003' as UUID,
    agentId: '00000000-0000-0000-0000-000000000001' as UUID,
    roomId: '00000000-0000-0000-0000-000000000004' as UUID,
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
