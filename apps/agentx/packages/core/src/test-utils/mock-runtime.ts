import { IAgentRuntime, Memory, State, Service, UUID, asUUID } from '../types';

/**
 * Simple mock runtime for tests - just use createMockRuntime() and cast to IAgentRuntime when needed
 */
export function createMockRuntime(overrides: Partial<IAgentRuntime> = {}): Partial<IAgentRuntime> {
  return {
    agentId: asUUID('test-agent-id'),
    services: new Map(),
    getService: (name: string) => null,
    registerService: (service: typeof Service) => Promise.resolve(),
    ...overrides,
  };
}

/**
 * Simple mock memory creator
 */
export function createMockMemory(text: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id: asUUID('test-memory-id'),
    entityId: asUUID('test-user-id'),
    agentId: asUUID('test-agent-id'),
    roomId: asUUID('test-room-id'),
    content: { text },
    createdAt: Date.now(),
    ...overrides,
  };
}

/**
 * Simple mock state creator
 */
export function createMockState(overrides: Partial<State> = {}): State {
  return {
    values: {},
    data: {},
    text: '',
    agentId: asUUID('test-agent-id'),
    roomId: asUUID('test-room-id'),
    userId: asUUID('test-user-id'),
    agentName: 'Test Agent',
    ...overrides,
  };
}
