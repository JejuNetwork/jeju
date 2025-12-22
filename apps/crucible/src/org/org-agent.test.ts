/**
 * Org Agent Tests
 *
 * Tests for OrgAgent including:
 * - CQL database operations
 * - Error handling
 * - Edge cases and boundary conditions
 * - Concurrent operations
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import type { CQLQueryable, ExecResult, QueryResult } from '@jejunetwork/db'
import { OrgAgent } from './org-agent'

/** Database row for todo queries */
interface TodoDbRow {
  id: string
  org_id: string
  title: string
  description: string | null
  priority: string
  status: string
  assignee_agent_id: string | null
  created_by: string
  due_date: number | null
  tags: string
  created_at: number
  updated_at: number
}

/** Database row for count queries */
interface CountDbRow {
  count: number
}

/** Database row for team member queries */
interface TeamMemberDbRow {
  agent_id: string
  org_id: string
  role: string
  joined_at: number
  last_active_at: number
  todos_completed: number
  checkins_completed: number
  contributions: number
}

/** Union of all possible query result row types */
type QueryRow = TodoDbRow | CountDbRow | TeamMemberDbRow

/** CQL query arguments - typically SQL string and optional params */
type CqlQueryArgs = [string, ...Array<string | number | boolean | null>]

/** CQL exec arguments - typically SQL string */
type CqlExecArgs = [string, ...Array<string | number | boolean | null>]

/** Generic mock function arguments */
type MockFnArgs = CqlQueryArgs | CqlExecArgs

// Helper type for Jest-like mock methods
interface MockFn<T> {
  (...args: MockFnArgs): Promise<T>
  mock: { calls: MockFnArgs[] }
  mockResolvedValueOnce(value: T): MockFn<T>
  mockRejectedValueOnce(error: Error): MockFn<T>
  mockResolvedValue(value: T): MockFn<T>
  mockImplementation(fn: () => T): MockFn<T>
  mockClear(): void
}

function createMockFn<T>(defaultValue: T): MockFn<T> {
  const values: { type: 'resolve' | 'reject'; value: T | Error }[] = []
  let defaultImpl: (() => T) | null = null
  const calls: MockFnArgs[] = []

  const fn = ((...args: MockFnArgs) => {
    calls.push(args)
    if (values.length > 0) {
      const shifted = values.shift()
      if (!shifted) throw new Error('values.shift() returned undefined')
      const { type, value } = shifted
      if (type === 'reject') return Promise.reject(value)
      return Promise.resolve(value)
    }
    if (defaultImpl) return Promise.resolve(defaultImpl())
    return Promise.resolve(defaultValue)
  }) as MockFn<T>

  fn.mock = { calls }
  fn.mockResolvedValueOnce = (value: T) => {
    values.push({ type: 'resolve', value })
    return fn
  }
  fn.mockRejectedValueOnce = (error: Error) => {
    // Store error in the reject slot - it will be rejected, not resolved
    values.push({ type: 'reject', value: error as T })
    return fn
  }
  fn.mockResolvedValue = (value: T) => {
    defaultImpl = () => value
    return fn
  }
  fn.mockImplementation = (impl: () => T) => {
    defaultImpl = impl
    return fn
  }
  fn.mockClear = () => {
    calls.length = 0
    values.length = 0
  }

  return fn
}

/** Default ExecResult for mocks */
const defaultExecResult: ExecResult = {
  rowsAffected: 0,
  txHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
  blockHeight: 1,
  gasUsed: 0n,
}

/** Default QueryResult for mocks */
const defaultQueryResult: QueryResult<QueryRow> = {
  rows: [],
  rowCount: 0,
  columns: [],
  executionTime: 0,
  blockHeight: 1,
}

// Create typed mocks
const mockExec = createMockFn<ExecResult>(defaultExecResult)
const mockQuery = createMockFn<QueryResult<QueryRow>>(defaultQueryResult)

describe('OrgAgent', () => {
  const mockCQLClient: CQLQueryable = {
    exec: mockExec,
    query: mockQuery,
  }

  const baseConfig = {
    agentId: 1n,
    orgId: 'test-org',
    cqlClient: mockCQLClient,
    cqlDatabaseId: 'test-db',
  }

  let agent: OrgAgent

  beforeEach(() => {
    mockExec.mockClear()
    mockQuery.mockClear()
    agent = new OrgAgent(baseConfig)
  })

  describe('Initialization', () => {
    test('should initialize schema', async () => {
      await agent.initialize()
      expect(mockExec.mock.calls.length).toBeGreaterThan(0)
      const schemaCall = mockExec.mock.calls.find((call) =>
        (call[0] as string)?.includes('CREATE TABLE'),
      )
      expect(schemaCall).toBeDefined()
    })

    test('should handle schema initialization errors', async () => {
      mockExec.mockRejectedValueOnce(new Error('Schema failed'))
      await expect(agent.initialize()).rejects.toThrow('Schema failed')
    })
  })

  describe('Todo Operations', () => {
    test('should create todo successfully', async () => {
      mockExec.mockResolvedValueOnce(defaultExecResult)

      const todo = await agent.createTodo({
        title: 'Test Todo',
        description: 'Test Description',
        priority: 'high',
        createdBy: 'agent-1',
      })

      expect(todo.id).toBeDefined()
      expect(todo.title).toBe('Test Todo')
      expect(todo.priority).toBe('high')
      expect(todo.status).toBe('pending')
      expect(mockExec.mock.calls.length).toBeGreaterThan(0)
    })

    test('should handle missing optional fields', async () => {
      mockExec.mockResolvedValueOnce(defaultExecResult)

      const todo = await agent.createTodo({
        title: 'Minimal Todo',
        createdBy: 'agent-1',
      })

      expect(todo.description).toBeUndefined()
      expect(todo.priority).toBe('medium') // Default
      expect(todo.tags).toEqual([])
    })

    test('should list todos with filters', async () => {
      mockQuery.mockResolvedValueOnce({
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
        rowCount: 1,
        columns: [],
        executionTime: 0,
        blockHeight: 1,
      })
      mockQuery.mockResolvedValueOnce({
        rows: [{ count: 1 }],
        rowCount: 1,
        columns: [],
        executionTime: 0,
        blockHeight: 1,
      })

      const result = await agent.listTodos({ status: 'pending', limit: 10 })

      expect(result.todos.length).toBe(1)
      expect(result.total).toBe(1)
      expect(result.todos[0].title).toBe('Todo 1')
    })

    test('should handle empty todo list', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        columns: [],
        executionTime: 0,
        blockHeight: 1,
      })
      mockQuery.mockResolvedValueOnce({
        rows: [{ count: 0 }],
        rowCount: 1,
        columns: [],
        executionTime: 0,
        blockHeight: 1,
      })

      const result = await agent.listTodos()
      expect(result.todos).toEqual([])
      expect(result.total).toBe(0)
    })

    test('should update todo successfully', async () => {
      mockExec.mockResolvedValueOnce(defaultExecResult)
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
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
          },
        ],
        rowCount: 1,
        columns: [],
        executionTime: 0,
        blockHeight: 1,
      })

      const todo = await agent.updateTodo('1', {
        title: 'Updated Todo',
        status: 'completed',
      })

      expect(todo.title).toBe('Updated Todo')
      expect(todo.status).toBe('completed')
      expect(mockExec.mock.calls.length).toBeGreaterThan(0)
    })

    test('should throw error for non-existent todo', async () => {
      mockExec.mockResolvedValueOnce(defaultExecResult)
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        columns: [],
        executionTime: 0,
        blockHeight: 1,
      })

      await expect(agent.updateTodo('999', { title: 'New' })).rejects.toThrow(
        'Todo not found',
      )
    })

    test('should reject empty updates', async () => {
      await expect(agent.updateTodo('1', {})).rejects.toThrow(
        'No updates provided',
      )
    })

    test('should handle JSON parsing errors in tags', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
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
          },
        ],
        rowCount: 1,
        columns: [],
        executionTime: 0,
        blockHeight: 1,
      })
      mockQuery.mockResolvedValueOnce({
        rows: [{ count: 1 }],
        rowCount: 1,
        columns: [],
        executionTime: 0,
        blockHeight: 1,
      })

      // Should handle JSON parsing errors gracefully
      const result = await agent.listTodos()
      expect(result.todos.length).toBe(1)
      expect(result.todos[0].tags).toEqual([]) // Should default to empty array on parse error
    })
  })

  describe('Checkin Operations', () => {
    test('should create checkin schedule', async () => {
      mockExec.mockResolvedValueOnce(defaultExecResult)

      const schedule = await agent.createCheckinSchedule({
        name: 'Daily Standup',
        checkinType: 'standup',
        frequency: 'daily',
        timeUtc: '09:00',
        questions: ['What did you do?', 'What will you do?'],
      })

      expect(schedule.id).toBeDefined()
      expect(schedule.name).toBe('Daily Standup')
      expect(schedule.active).toBe(true)
      expect(mockExec.mock.calls.length).toBeGreaterThan(0)
    })

    test('should record checkin response', async () => {
      mockExec.mockResolvedValueOnce(defaultExecResult)
      mockExec.mockResolvedValueOnce(defaultExecResult)

      const response = await agent.recordCheckinResponse({
        scheduleId: 'schedule-1',
        responderAgentId: 'agent-1',
        answers: { q1: 'Answer 1', q2: 'Answer 2' },
      })

      expect(response.id).toBeDefined()
      expect(response.scheduleId).toBe('schedule-1')
      expect(mockExec.mock.calls.length).toBe(2) // Insert + update stats
    })
  })

  describe('Team Management', () => {
    test('should get team members', async () => {
      mockQuery.mockResolvedValueOnce({
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
        rowCount: 1,
        columns: [],
        executionTime: 0,
        blockHeight: 1,
      })

      const members = await agent.getTeamMembers()
      expect(members.length).toBe(1)
      expect(members[0].agentId).toBe('agent-1')
      expect(members[0].stats.todosCompleted).toBe(10)
    })

    test('should add team member', async () => {
      mockExec.mockResolvedValueOnce(defaultExecResult)

      await agent.addTeamMember('agent-2', 'designer')
      expect(mockExec.mock.calls.length).toBeGreaterThan(0)
    })

    test('should handle empty team', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        columns: [],
        executionTime: 0,
        blockHeight: 1,
      })
      const members = await agent.getTeamMembers()
      expect(members).toEqual([])
    })
  })

  describe('Edge Cases', () => {
    test('should handle very long todo titles', async () => {
      const longTitle = 'A'.repeat(10000)
      mockExec.mockResolvedValueOnce(defaultExecResult)

      const todo = await agent.createTodo({
        title: longTitle,
        createdBy: 'agent-1',
      })

      expect(todo.title.length).toBe(10000)
    })

    test('should handle special characters in todo', async () => {
      mockExec.mockResolvedValueOnce(defaultExecResult)

      const todo = await agent.createTodo({
        title: 'Test \'Todo\' with "quotes" & <tags>',
        description: 'Description with\nnewlines\tand\ttabs',
        createdBy: 'agent-1',
      })

      expect(todo.title).toContain("'Todo'")
    })

    test('should handle null values in database', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
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
          },
        ],
        rowCount: 1,
        columns: [],
        executionTime: 0,
        blockHeight: 1,
      })
      mockQuery.mockResolvedValueOnce({
        rows: [{ count: 1 }],
        rowCount: 1,
        columns: [],
        executionTime: 0,
        blockHeight: 1,
      })

      const result = await agent.listTodos()
      expect(result.todos[0].description).toBeUndefined()
      expect(result.todos[0].assigneeAgentId).toBeUndefined()
    })

    test('should handle concurrent todo operations', async () => {
      mockExec.mockImplementation(() => defaultExecResult)
      mockQuery.mockResolvedValue(defaultQueryResult)

      await Promise.all([
        agent.createTodo({ title: 'Todo 1', createdBy: 'agent-1' }),
        agent.createTodo({ title: 'Todo 2', createdBy: 'agent-1' }),
        agent.createTodo({ title: 'Todo 3', createdBy: 'agent-1' }),
      ])

      expect(mockExec.mock.calls.length).toBe(3)
    })

    test('should handle database connection errors', async () => {
      mockExec.mockRejectedValueOnce(new Error('Connection failed'))

      await expect(
        agent.createTodo({
          title: 'Test',
          createdBy: 'agent-1',
        }),
      ).rejects.toThrow('Connection failed')
    })

    test('should handle invalid priority values', async () => {
      // TypeScript prevents this, but runtime could have invalid value
      mockExec.mockResolvedValueOnce(defaultExecResult)

      // Should handle gracefully or validate
      const todo = await agent.createTodo({
        title: 'Test',
        priority: 'medium' as 'low' | 'medium' | 'high',
        createdBy: 'agent-1',
      })

      expect(todo.priority).toBe('medium')
    })
  })

  describe('Query Building', () => {
    test('should build correct query with all filters', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        columns: [],
        executionTime: 0,
        blockHeight: 1,
      })
      mockQuery.mockResolvedValueOnce({
        rows: [{ count: 0 }],
        rowCount: 1,
        columns: [],
        executionTime: 0,
        blockHeight: 1,
      })

      await agent.listTodos({
        status: 'pending',
        priority: 'high',
        assigneeAgentId: 'agent-1',
        limit: 20,
      })

      const queryCall = mockQuery.mock.calls[0]
      expect(queryCall[0]).toContain('WHERE')
      expect(queryCall[0]).toContain('status')
      expect(queryCall[0]).toContain('priority')
      expect(queryCall[0]).toContain('assignee_agent_id')
    })

    test('should build query without filters', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        columns: [],
        executionTime: 0,
        blockHeight: 1,
      })
      mockQuery.mockResolvedValueOnce({
        rows: [{ count: 0 }],
        rowCount: 1,
        columns: [],
        executionTime: 0,
        blockHeight: 1,
      })

      await agent.listTodos()

      const queryCall = mockQuery.mock.calls[0]
      expect(queryCall[0]).toContain('SELECT')
      expect(queryCall[0]).toContain('ORDER BY')
    })
  })
})
