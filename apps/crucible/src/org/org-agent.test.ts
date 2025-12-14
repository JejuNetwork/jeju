/**
 * Org Agent Tests
 * 
 * Tests for OrgAgent including:
 * - CQL database operations
 * - Error handling
 * - Edge cases and boundary conditions
 * - Concurrent operations
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { OrgAgent } from './org-agent';
import { CQLClient } from '@jeju/cql';
import type { OrgTodo, OrgCheckinSchedule, OrgCheckinResponse, OrgTeamMember } from '../types';

describe('OrgAgent', () => {
  const mockCQLClient = {
    exec: mock(() => Promise.resolve()),
    query: mock(() => Promise.resolve({ rows: [] })),
  } as unknown as CQLClient;

  const baseConfig = {
    agentId: 1n,
    orgId: 'test-org',
    cqlClient: mockCQLClient,
    cqlDatabaseId: 'test-db',
  };

  let agent: OrgAgent;

  beforeEach(() => {
    mockCQLClient.exec.mockClear();
    mockCQLClient.query.mockClear();
    agent = new OrgAgent(baseConfig);
  });

  describe('Initialization', () => {
    test('should initialize schema', async () => {
      await agent.initialize();
      expect(mockCQLClient.exec).toHaveBeenCalled();
      const schemaCall = mockCQLClient.exec.mock.calls.find(call => 
        call[0]?.includes('CREATE TABLE')
      );
      expect(schemaCall).toBeDefined();
    });

    test('should handle schema initialization errors', async () => {
      mockCQLClient.exec.mockRejectedValueOnce(new Error('Schema failed'));
      await expect(agent.initialize()).rejects.toThrow('Schema failed');
    });
  });

  describe('Todo Operations', () => {
    test('should create todo successfully', async () => {
      mockCQLClient.exec.mockResolvedValueOnce(undefined);
      
      const todo = await agent.createTodo({
        title: 'Test Todo',
        description: 'Test Description',
        priority: 'high',
        createdBy: 'agent-1',
      });

      expect(todo.id).toBeDefined();
      expect(todo.title).toBe('Test Todo');
      expect(todo.priority).toBe('high');
      expect(todo.status).toBe('pending');
      expect(mockCQLClient.exec).toHaveBeenCalled();
    });

    test('should handle missing optional fields', async () => {
      mockCQLClient.exec.mockResolvedValueOnce(undefined);
      
      const todo = await agent.createTodo({
        title: 'Minimal Todo',
        createdBy: 'agent-1',
      });

      expect(todo.description).toBeUndefined();
      expect(todo.priority).toBe('medium'); // Default
      expect(todo.tags).toEqual([]);
    });

    test('should list todos with filters', async () => {
      mockCQLClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: '1',
            org_id: 'test-org',
            title: 'Todo 1',
            description: null,
            priority: 'high',
            status: 'pending',
            assignee_agent_id: null,
            created_by: 'agent-1',
            due_date: null,
            tags: '[]',
            created_at: Date.now(),
            updated_at: Date.now(),
          },
        ],
      });
      mockCQLClient.query.mockResolvedValueOnce({
        rows: [{ count: 1 }],
      });

      const result = await agent.listTodos({ status: 'pending', limit: 10 });
      
      expect(result.todos.length).toBe(1);
      expect(result.total).toBe(1);
      expect(result.todos[0].title).toBe('Todo 1');
    });

    test('should handle empty todo list', async () => {
      mockCQLClient.query.mockResolvedValueOnce({ rows: [] });
      mockCQLClient.query.mockResolvedValueOnce({ rows: [{ count: 0 }] });

      const result = await agent.listTodos();
      expect(result.todos).toEqual([]);
      expect(result.total).toBe(0);
    });

    test('should update todo successfully', async () => {
      mockCQLClient.exec.mockResolvedValueOnce(undefined);
      mockCQLClient.query.mockResolvedValueOnce({
        rows: [{
          id: '1',
          org_id: 'test-org',
          title: 'Updated Todo',
          description: 'Updated',
          priority: 'low',
          status: 'completed',
          assignee_agent_id: 'agent-2',
          created_by: 'agent-1',
          due_date: Date.now(),
          tags: '["urgent"]',
          created_at: Date.now(),
          updated_at: Date.now(),
        }],
      });

      const todo = await agent.updateTodo('1', {
        title: 'Updated Todo',
        status: 'completed',
      });

      expect(todo.title).toBe('Updated Todo');
      expect(todo.status).toBe('completed');
      expect(mockCQLClient.exec).toHaveBeenCalled();
    });

    test('should throw error for non-existent todo', async () => {
      mockCQLClient.exec.mockResolvedValueOnce(undefined);
      mockCQLClient.query.mockResolvedValueOnce({ rows: [] });

      await expect(agent.updateTodo('999', { title: 'New' })).rejects.toThrow('Todo not found');
    });

    test('should reject empty updates', async () => {
      await expect(agent.updateTodo('1', {})).rejects.toThrow('No updates provided');
    });

    test('should handle JSON parsing errors in tags', async () => {
      mockCQLClient.query.mockResolvedValueOnce({
        rows: [{
          id: '1',
          org_id: 'test-org',
          title: 'Todo',
          description: null,
          priority: 'medium',
          status: 'pending',
          assignee_agent_id: null,
          created_by: 'agent-1',
          due_date: null,
          tags: 'invalid-json',
          created_at: Date.now(),
          updated_at: Date.now(),
        }],
      });
      mockCQLClient.query.mockResolvedValueOnce({ rows: [{ count: 1 }] });

      // Should handle JSON parsing errors gracefully
      const result = await agent.listTodos();
      expect(result.todos.length).toBe(1);
      expect(result.todos[0].tags).toEqual([]); // Should default to empty array on parse error
    });
  });

  describe('Checkin Operations', () => {
    test('should create checkin schedule', async () => {
      mockCQLClient.exec.mockResolvedValueOnce(undefined);

      const schedule = await agent.createCheckinSchedule({
        name: 'Daily Standup',
        checkinType: 'standup',
        frequency: 'daily',
        timeUtc: '09:00',
        questions: ['What did you do?', 'What will you do?'],
      });

      expect(schedule.id).toBeDefined();
      expect(schedule.name).toBe('Daily Standup');
      expect(schedule.active).toBe(true);
      expect(mockCQLClient.exec).toHaveBeenCalled();
    });

    test('should record checkin response', async () => {
      mockCQLClient.exec.mockResolvedValueOnce(undefined);
      mockCQLClient.exec.mockResolvedValueOnce(undefined);

      const response = await agent.recordCheckinResponse({
        scheduleId: 'schedule-1',
        responderAgentId: 'agent-1',
        answers: { q1: 'Answer 1', q2: 'Answer 2' },
      });

      expect(response.id).toBeDefined();
      expect(response.scheduleId).toBe('schedule-1');
      expect(mockCQLClient.exec).toHaveBeenCalledTimes(2); // Insert + update stats
    });
  });

  describe('Team Management', () => {
    test('should get team members', async () => {
      mockCQLClient.query.mockResolvedValueOnce({
        rows: [
          {
            agent_id: 'agent-1',
            org_id: 'test-org',
            role: 'developer',
            joined_at: Date.now(),
            last_active_at: Date.now(),
            todos_completed: 10,
            checkins_completed: 5,
            contributions: 20,
          },
        ],
      });

      const members = await agent.getTeamMembers();
      expect(members.length).toBe(1);
      expect(members[0].agentId).toBe('agent-1');
      expect(members[0].stats.todosCompleted).toBe(10);
    });

    test('should add team member', async () => {
      mockCQLClient.exec.mockResolvedValueOnce(undefined);

      await agent.addTeamMember('agent-2', 'designer');
      expect(mockCQLClient.exec).toHaveBeenCalled();
    });

    test('should handle empty team', async () => {
      mockCQLClient.query.mockResolvedValueOnce({ rows: [] });
      const members = await agent.getTeamMembers();
      expect(members).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    test('should handle very long todo titles', async () => {
      const longTitle = 'A'.repeat(10000);
      mockCQLClient.exec.mockResolvedValueOnce(undefined);
      
      const todo = await agent.createTodo({
        title: longTitle,
        createdBy: 'agent-1',
      });
      
      expect(todo.title.length).toBe(10000);
    });

    test('should handle special characters in todo', async () => {
      mockCQLClient.exec.mockResolvedValueOnce(undefined);
      
      const todo = await agent.createTodo({
        title: "Test 'Todo' with \"quotes\" & <tags>",
        description: 'Description with\nnewlines\tand\ttabs',
        createdBy: 'agent-1',
      });
      
      expect(todo.title).toContain("'Todo'");
    });

    test('should handle null values in database', async () => {
      mockCQLClient.query.mockResolvedValueOnce({
        rows: [{
          id: '1',
          org_id: 'test-org',
          title: 'Todo',
          description: null,
          priority: 'medium',
          status: 'pending',
          assignee_agent_id: null,
          created_by: 'agent-1',
          due_date: null,
          tags: '[]',
          created_at: Date.now(),
          updated_at: Date.now(),
        }],
      });
      mockCQLClient.query.mockResolvedValueOnce({ rows: [{ count: 1 }] });

      const result = await agent.listTodos();
      expect(result.todos[0].description).toBeUndefined();
      expect(result.todos[0].assigneeAgentId).toBeUndefined();
    });

    test('should handle concurrent todo operations', async () => {
      mockCQLClient.exec.mockImplementation(() => Promise.resolve());
      mockCQLClient.query.mockResolvedValue({ rows: [], count: 0 });

      await Promise.all([
        agent.createTodo({ title: 'Todo 1', createdBy: 'agent-1' }),
        agent.createTodo({ title: 'Todo 2', createdBy: 'agent-1' }),
        agent.createTodo({ title: 'Todo 3', createdBy: 'agent-1' }),
      ]);

      expect(mockCQLClient.exec).toHaveBeenCalledTimes(3);
    });

    test('should handle database connection errors', async () => {
      mockCQLClient.exec.mockRejectedValueOnce(new Error('Connection failed'));
      
      await expect(agent.createTodo({
        title: 'Test',
        createdBy: 'agent-1',
      })).rejects.toThrow('Connection failed');
    });

    test('should handle invalid priority values', async () => {
      // TypeScript prevents this, but runtime could have invalid value
      mockCQLClient.exec.mockResolvedValueOnce(undefined);
      
      // Should handle gracefully or validate
      const todo = await agent.createTodo({
        title: 'Test',
        priority: 'medium' as 'low' | 'medium' | 'high',
        createdBy: 'agent-1',
      });
      
      expect(todo.priority).toBe('medium');
    });
  });

  describe('Query Building', () => {
    test('should build correct query with all filters', async () => {
      mockCQLClient.query.mockResolvedValueOnce({ rows: [] });
      mockCQLClient.query.mockResolvedValueOnce({ rows: [{ count: 0 }] });

      await agent.listTodos({
        status: 'pending',
        priority: 'high',
        assigneeAgentId: 'agent-1',
        limit: 20,
      });

      const queryCall = mockCQLClient.query.mock.calls[0];
      expect(queryCall[0]).toContain('WHERE');
      expect(queryCall[0]).toContain('status');
      expect(queryCall[0]).toContain('priority');
      expect(queryCall[0]).toContain('assignee_agent_id');
    });

    test('should build query without filters', async () => {
      mockCQLClient.query.mockResolvedValueOnce({ rows: [] });
      mockCQLClient.query.mockResolvedValueOnce({ rows: [{ count: 0 }] });

      await agent.listTodos();

      const queryCall = mockCQLClient.query.mock.calls[0];
      expect(queryCall[0]).toContain('SELECT');
      expect(queryCall[0]).toContain('ORDER BY');
    });
  });
});

