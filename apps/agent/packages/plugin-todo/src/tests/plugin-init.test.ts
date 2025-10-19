// FIXME: @elizaos/core/test-utils not properly exported in build - commenting out imports until core issue is resolved
import { describe, it, expect } from 'bun:test';
import { TodoPlugin } from '../index';
// import { createMockRuntime } from '@elizaos/core/test-utils';
import type { IAgentRuntime } from '@elizaos/core';

describe('TodoPlugin Initialization', () => {
  let mockRuntime: IAgentRuntime;

  const setupMocks = () => {
    // @ts-expect-error - test mock
    mockRuntime = createMockRuntime({
      db: null, // No database available
      getService: () => null, // No services available in test
    });
  };

  it('should have correct plugin metadata', () => {
    expect(TodoPlugin.name).toBe('todo');
    expect(TodoPlugin.description).toContain('task management');
    expect(TodoPlugin.services).toBeDefined();
    expect(TodoPlugin.actions).toBeDefined();
    expect(TodoPlugin.providers).toBeDefined();
    expect(TodoPlugin.schema).toBeDefined();
  });

  it('should have the correct number of services', () => {
    expect(TodoPlugin.services).toHaveLength(2);
    const services = TodoPlugin.services as Array<{ serviceType: string }>;
    expect(services[0].serviceType).toBe('TODO');
    expect(services[1].serviceType).toBe('TODO_REMINDER');
  });

  it('should have all required actions', () => {
    expect(TodoPlugin.actions).toHaveLength(5);
    const actionNames = TodoPlugin.actions!.map((action) => action.name);
    expect(actionNames).toContain('CREATE_TODO');
    expect(actionNames).toContain('COMPLETE_TODO');
    expect(actionNames).toContain('CONFIRM_TODO');
    expect(actionNames).toContain('UPDATE_TODO');
    expect(actionNames).toContain('CANCEL_TODO');
  });

  it('should have the todos provider', () => {
    expect(TodoPlugin.providers).toHaveLength(1);
    expect(TodoPlugin.providers![0].name).toBe('TODOS');
  });

  it('should have test dependencies', () => {
    expect(TodoPlugin.testDependencies).toContain('@elizaos/plugin-sql');
  });

  it('should have schema with correct tables', () => {
    expect(TodoPlugin.schema).toBeDefined();
    expect(TodoPlugin.schema.todosTable).toBeDefined();
    expect(TodoPlugin.schema.todoTagsTable).toBeDefined();
  });

  it('should export correct types', () => {
    // Check that the plugin exports are defined
    expect(TodoPlugin).toBeDefined();
    expect(TodoPlugin.name).toBe('todo');
    expect(typeof TodoPlugin.init).toBe('function');
  });
});
