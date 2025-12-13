/**
 * Todo Service Tests
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { TodoService, createTodoService } from '../services/todos';
import { OrgStorage, createOrgStorage } from '../services/storage';
import type { OrgState, Todo } from '../types';

describe('TodoService', () => {
  let storage: OrgStorage;
  let todoService: TodoService;
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    storage = createOrgStorage({
      apiUrl: 'http://localhost:3100',
      ipfsGateway: 'http://localhost:3100',
    });
    todoService = createTodoService(storage);
    mockFetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ cid: 'QmTest' }), { status: 200 }))
    );
    global.fetch = mockFetch as typeof fetch;
  });

  describe('Create Todo', () => {
    it('should create todo with minimal params', async () => {
      const state = storage.createInitialState('org-1');
      
      const { todo, state: newState } = await todoService.create(state, {
        title: 'Test Todo',
        createdBy: 'agent-1',
      });

      expect(todo.title).toBe('Test Todo');
      expect(todo.priority).toBe('medium'); // default
      expect(todo.status).toBe('pending'); // default
      expect(todo.createdBy).toBe('agent-1');
      expect(todo.id).toBeDefined();
      expect(todo.createdAt).toBeDefined();
      expect(newState.todos.length).toBe(1);
    });

    it('should create todo with all params', async () => {
      const state = storage.createInitialState('org-1');
      const dueDate = Date.now() + 86400000;
      
      const { todo } = await todoService.create(state, {
        title: 'Full Todo',
        description: 'Detailed description',
        priority: 'urgent',
        dueDate,
        assigneeAgentId: 'agent-2',
        assigneeName: 'Jimmy',
        tags: ['important', 'review'],
        createdBy: 'agent-1',
      });

      expect(todo.title).toBe('Full Todo');
      expect(todo.description).toBe('Detailed description');
      expect(todo.priority).toBe('urgent');
      expect(todo.dueDate).toBe(dueDate);
      expect(todo.assigneeAgentId).toBe('agent-2');
      expect(todo.assigneeName).toBe('Jimmy');
      expect(todo.tags).toEqual(['important', 'review']);
    });

    it('should generate unique IDs for each todo', async () => {
      const state = storage.createInitialState('org-1');
      
      const { todo: todo1, state: state1 } = await todoService.create(state, {
        title: 'Todo 1',
        createdBy: 'agent-1',
      });

      const { todo: todo2 } = await todoService.create(state1, {
        title: 'Todo 2',
        createdBy: 'agent-1',
      });

      expect(todo1.id).not.toBe(todo2.id);
    });
  });

  describe('Update Todo', () => {
    it('should update todo title', async () => {
      const state = storage.createInitialState('org-1');
      const { todo, state: state1 } = await todoService.create(state, {
        title: 'Original',
        createdBy: 'agent-1',
      });

      const { todo: updated } = await todoService.update(state1, todo.id, {
        title: 'Updated Title',
      });

      expect(updated.title).toBe('Updated Title');
    });

    it('should update todo status', async () => {
      const state = storage.createInitialState('org-1');
      const { todo, state: state1 } = await todoService.create(state, {
        title: 'Test',
        createdBy: 'agent-1',
      });

      const { todo: updated } = await todoService.update(state1, todo.id, {
        status: 'in_progress',
      });

      expect(updated.status).toBe('in_progress');
    });

    it('should update multiple fields at once', async () => {
      const state = storage.createInitialState('org-1');
      const { todo, state: state1 } = await todoService.create(state, {
        title: 'Test',
        createdBy: 'agent-1',
      });

      const { todo: updated } = await todoService.update(state1, todo.id, {
        title: 'New Title',
        priority: 'high',
        tags: ['urgent'],
      });

      expect(updated.title).toBe('New Title');
      expect(updated.priority).toBe('high');
      expect(updated.tags).toEqual(['urgent']);
    });

    it('should clear dueDate when set to null', async () => {
      const state = storage.createInitialState('org-1');
      const { todo, state: state1 } = await todoService.create(state, {
        title: 'Test',
        dueDate: Date.now() + 86400000,
        createdBy: 'agent-1',
      });

      const { todo: updated } = await todoService.update(state1, todo.id, {
        dueDate: null,
      });

      expect(updated.dueDate).toBeUndefined();
    });

    it('should throw on non-existent todo', async () => {
      const state = storage.createInitialState('org-1');

      await expect(todoService.update(state, 'non-existent', {
        title: 'Updated',
      })).rejects.toThrow('Todo not found');
    });
  });

  describe('Complete Todo', () => {
    it('should mark todo as completed', async () => {
      const state = storage.createInitialState('org-1');
      const { todo, state: state1 } = await todoService.create(state, {
        title: 'Test',
        createdBy: 'agent-1',
      });

      const { todo: completed } = await todoService.complete(state1, todo.id);

      expect(completed.status).toBe('completed');
      expect(completed.completedAt).toBeDefined();
    });

    it('should set completedAt timestamp', async () => {
      const state = storage.createInitialState('org-1');
      const { todo, state: state1 } = await todoService.create(state, {
        title: 'Test',
        createdBy: 'agent-1',
      });

      const before = Date.now();
      const { todo: completed } = await todoService.complete(state1, todo.id);
      const after = Date.now();

      expect(completed.completedAt).toBeGreaterThanOrEqual(before);
      expect(completed.completedAt).toBeLessThanOrEqual(after);
    });
  });

  describe('List Todos', () => {
    async function createTestState(): Promise<OrgState> {
      let state = storage.createInitialState('org-1');

      // Create varied todos - status is set via update after creation
      const todoData: Array<{ title: string; priority: 'urgent' | 'high' | 'medium' | 'low'; targetStatus: 'pending' | 'in_progress' | 'completed' | 'cancelled'; dueDate?: number }> = [
        { title: 'Urgent Task', priority: 'urgent', targetStatus: 'pending', dueDate: Date.now() + 3600000 },
        { title: 'High Priority', priority: 'high', targetStatus: 'in_progress' },
        { title: 'Medium Task', priority: 'medium', targetStatus: 'pending' },
        { title: 'Low Priority', priority: 'low', targetStatus: 'completed' },
        { title: 'Old Task', priority: 'medium', targetStatus: 'cancelled' },
      ];

      for (const data of todoData) {
        const { todo, state: newState } = await todoService.create(state, { 
          title: data.title, 
          priority: data.priority, 
          dueDate: data.dueDate,
          createdBy: 'test' 
        });
        state = newState;
        
        // Update status if not pending (default)
        if (data.targetStatus !== 'pending') {
          const { state: updatedState } = await todoService.update(state, todo.id, { status: data.targetStatus });
          state = updatedState;
        }
      }

      return state;
    }

    it('should list all todos', async () => {
      const state = await createTestState();
      const { todos, total } = todoService.list(state);

      expect(total).toBe(5);
      expect(todos.length).toBe(5);
    });

    it('should filter by status', async () => {
      const state = await createTestState();
      
      const { todos: pending } = todoService.list(state, { status: 'pending' });
      expect(pending.length).toBe(2);
      expect(pending.every(t => t.status === 'pending')).toBe(true);

      const { todos: completed } = todoService.list(state, { status: 'completed' });
      expect(completed.length).toBe(1);
    });

    it('should filter by priority', async () => {
      const state = await createTestState();
      
      const { todos: urgent } = todoService.list(state, { priority: 'urgent' });
      expect(urgent.length).toBe(1);
      expect(urgent[0].priority).toBe('urgent');
    });

    it('should respect limit', async () => {
      const state = await createTestState();
      
      const { todos, total } = todoService.list(state, { limit: 2 });
      expect(todos.length).toBe(2);
      expect(total).toBe(5); // Total is still 5
    });

    it('should sort by priority (urgent first)', async () => {
      const state = await createTestState();
      
      const { todos } = todoService.list(state);
      expect(todos[0].priority).toBe('urgent');
    });

    it('should sort by due date within same priority', async () => {
      let state = storage.createInitialState('org-1');
      
      const now = Date.now();
      const { state: s1 } = await todoService.create(state, { 
        title: 'Later', priority: 'high', dueDate: now + 200000, createdBy: 'test' 
      });
      const { state: s2 } = await todoService.create(s1, { 
        title: 'Sooner', priority: 'high', dueDate: now + 100000, createdBy: 'test' 
      });

      const { todos } = todoService.list(s2);
      expect(todos[0].title).toBe('Sooner');
      expect(todos[1].title).toBe('Later');
    });
  });

  describe('Get Stats', () => {
    it('should return empty stats for new org', () => {
      const state = storage.createInitialState('org-1');
      const stats = todoService.getStats(state);

      expect(stats.total).toBe(0);
      expect(stats.pending).toBe(0);
      expect(stats.inProgress).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.cancelled).toBe(0);
      expect(stats.overdue).toBe(0);
    });

    it('should count todos by status', async () => {
      let state = storage.createInitialState('org-1');
      
      const { state: s1 } = await todoService.create(state, { title: 'Pending', createdBy: 'test' });
      const { state: s2 } = await todoService.create(s1, { title: 'Another Pending', createdBy: 'test' });
      const { todo: t3, state: s3 } = await todoService.create(s2, { title: 'In Progress', createdBy: 'test' });
      const { state: s4 } = await todoService.update(s3, t3.id, { status: 'in_progress' });

      const stats = todoService.getStats(s4);

      expect(stats.total).toBe(3);
      expect(stats.pending).toBe(2);
      expect(stats.inProgress).toBe(1);
    });

    it('should count overdue todos', async () => {
      let state = storage.createInitialState('org-1');
      
      // Past due date
      const { state: s1 } = await todoService.create(state, { 
        title: 'Overdue', 
        dueDate: Date.now() - 86400000, // Yesterday
        createdBy: 'test' 
      });
      
      // Future due date
      const { state: s2 } = await todoService.create(s1, { 
        title: 'Not Overdue', 
        dueDate: Date.now() + 86400000, // Tomorrow
        createdBy: 'test' 
      });

      const stats = todoService.getStats(s2);
      expect(stats.overdue).toBe(1);
    });

    it('should not count completed todos as overdue', async () => {
      let state = storage.createInitialState('org-1');
      
      const { todo, state: s1 } = await todoService.create(state, { 
        title: 'Was Overdue', 
        dueDate: Date.now() - 86400000,
        createdBy: 'test' 
      });
      
      const { state: s2 } = await todoService.complete(s1, todo.id);

      const stats = todoService.getStats(s2);
      expect(stats.overdue).toBe(0);
    });
  });
});
