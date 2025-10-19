// FIXME: @elizaos/core/test-utils not properly exported in build - commenting out imports until core issue is resolved
import { describe, expect, it } from 'bun:test';
import { TodoPlugin } from '../index';
import { TodoReminderService } from '../services/reminderService';
import { createMockRuntime } from './test-utils';

// Mock runtime for testing
const mockRuntime = createMockRuntime({
  db: null, // Will be skipped in services
  getService: () => null,
  // @ts-expect-error - simplified for testing
  useModel: () => Promise.resolve('Mock response'),
  composeState: () => Promise.resolve({ values: {}, text: '', data: {} }),
  getRoom: () => Promise.resolve(null),
  emitEvent: () => Promise.resolve(),
});

describe('Todo Plugin E2E Simple Tests', () => {
  it('should initialize plugin successfully', async () => {
    expect(() => TodoPlugin.init?.({}, mockRuntime)).not.toThrow();
  });

  it('should create reminder service successfully', async () => {
    const service = await TodoReminderService.start(mockRuntime);
    expect(service).toBeDefined();
    expect(service.serviceName).toBe('TODO_REMINDER');
    await service.stop();
  });

  it('should have working action validation', () => {
    const createAction = TodoPlugin.actions?.find((a) => a.name === 'CREATE_TODO');
    expect(createAction).toBeDefined();
    expect(createAction?.validate).toBeDefined();
    expect(typeof createAction?.handler).toBe('function');
  });

  it('should export all required types', () => {
    expect(typeof TodoPlugin.name).toBe('string');
    expect(Array.isArray(TodoPlugin.actions)).toBe(true);
    expect(Array.isArray(TodoPlugin.services)).toBe(true);
    expect(Array.isArray(TodoPlugin.providers)).toBe(true);
    expect(TodoPlugin.schema).toBeDefined();
  });
});
