import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { TodoPlugin } from '../index';
import type { IAgentRuntime, Service, ServiceTypeName } from '@elizaos/core';

interface ServiceClass {
  serviceType: ServiceTypeName | string;
  new (...args: unknown[]): Service;
}

describe('TodoPlugin', () => {
  it('should export TodoPlugin with correct structure', () => {
    expect(TodoPlugin).toBeDefined();
    expect(TodoPlugin.name).toBe('todo');
    expect(TodoPlugin.description).toBe(
      'Provides task management functionality with daily recurring and one-off tasks.'
    );
    expect(TodoPlugin.providers).toHaveLength(1);
    expect(TodoPlugin.actions).toHaveLength(5); // Now includes confirmTodoAction
    expect(TodoPlugin.services).toHaveLength(2); // TodoService, TodoReminderService
    expect(TodoPlugin.routes).toBeDefined();
    expect(TodoPlugin.init).toBeInstanceOf(Function);
  });

  it('should have all required actions', () => {
    const actionNames = TodoPlugin.actions?.map((action) => action.name) || [];
    expect(actionNames).toContain('CREATE_TODO');
    expect(actionNames).toContain('COMPLETE_TODO');
    expect(actionNames).toContain('CONFIRM_TODO');
    expect(actionNames).toContain('UPDATE_TODO');
    expect(actionNames).toContain('CANCEL_TODO');
  });

  it('should have all required services', () => {
    const services = TodoPlugin.services as ServiceClass[] | undefined;
    expect(services?.some((s) => s.serviceType === 'TODO')).toBe(true);
    expect(services?.some((s) => s.serviceType === 'TODO_REMINDER')).toBe(true);

    // Other functionality is provided as internal managers within these services:
    // - NotificationManager (within TodoReminderService)
  });
});
