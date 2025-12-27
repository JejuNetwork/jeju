/**
 * ExtendedTaskStore Tests
 *
 * Tests for task storage with list functionality
 * Requires EQLite to be running
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { hasInfra } from '@jejunetwork/tests/shared/live-infrastructure'
import { ExtendedTaskStore } from '../core/task-store'
import type { Task } from '../types/server'

// Check if EQLite is available
const EQLITE_AVAILABLE = await hasInfra(['eqlite'])

// Only run tests if EQLite is available
const describeIfEqlite = EQLITE_AVAILABLE ? describe : describe.skip

function createTask(
  id: string,
  contextId: string,
  state: string,
  timestamp?: string,
): Task {
  return {
    kind: 'task',
    id,
    contextId,
    status: {
      state: state as Task['status']['state'],
      timestamp: timestamp ?? new Date().toISOString(),
    },
    history: [],
  }
}

describeIfEqlite('ExtendedTaskStore', () => {
  let store: ExtendedTaskStore

  beforeEach(async () => {
    store = new ExtendedTaskStore()
    // Clear any leftover data from previous tests - EQLite database is shared
    await store.clear()
  })

  describe('save', () => {
    it('should save task to store', async () => {
      const task = createTask('task-1', 'ctx-1', 'submitted')

      await store.save(task)

      const loaded = await store.load('task-1')
      expect(loaded).toEqual(task)
    })

    it('should overwrite existing task with same ID', async () => {
      const task1 = createTask('task-1', 'ctx-1', 'submitted')
      const task2 = createTask('task-1', 'ctx-1', 'completed')

      await store.save(task1)
      await store.save(task2)

      const loaded = await store.load('task-1')
      expect(loaded?.status.state).toBe('completed')
    })
  })

  describe('load', () => {
    it('should return undefined for non-existent task', async () => {
      const loaded = await store.load('non-existent')

      expect(loaded).toBeUndefined()
    })

    it('should return saved task', async () => {
      const task = createTask('task-1', 'ctx-1', 'working')

      await store.save(task)
      const loaded = await store.load('task-1')

      expect(loaded).toEqual(task)
    })
  })

  describe('list', () => {
    // Track when each task is saved for sorting/filter tests
    let taskSaveTimes: Record<string, number>

    beforeEach(async () => {
      taskSaveTimes = {}

      // Create test data - save order determines updated_at order
      // Note: status.timestamp is metadata, updated_at is actual save time
      const now = Date.now()

      taskSaveTimes['task-1'] = Date.now()
      await store.save(
        createTask(
          'task-1',
          'ctx-a',
          'completed',
          new Date(now - 3000).toISOString(),
        ),
      )

      // Small delay to ensure different updated_at values
      await new Promise((r) => setTimeout(r, 5))

      taskSaveTimes['task-2'] = Date.now()
      await store.save(
        createTask(
          'task-2',
          'ctx-a',
          'working',
          new Date(now - 2000).toISOString(),
        ),
      )

      await new Promise((r) => setTimeout(r, 5))

      taskSaveTimes['task-3'] = Date.now()
      await store.save(
        createTask(
          'task-3',
          'ctx-b',
          'submitted',
          new Date(now - 1000).toISOString(),
        ),
      )

      await new Promise((r) => setTimeout(r, 5))

      taskSaveTimes['task-4'] = Date.now()
      await store.save(
        createTask('task-4', 'ctx-b', 'failed', new Date(now).toISOString()),
      )
    })

    it('should return all tasks with empty params', async () => {
      const result = await store.list({})

      expect(result.tasks).toHaveLength(4)
      expect(result.totalSize).toBe(4)
    })

    it('should filter by contextId', async () => {
      const result = await store.list({ contextId: 'ctx-a' })

      expect(result.tasks).toHaveLength(2)
      expect(result.tasks.every((t) => t.contextId === 'ctx-a')).toBe(true)
    })

    it('should filter by status', async () => {
      const result = await store.list({ status: 'working' })

      expect(result.tasks).toHaveLength(1)
      expect(result.tasks[0].id).toBe('task-2')
    })

    it('should combine filters', async () => {
      const result = await store.list({ contextId: 'ctx-a', status: 'working' })

      expect(result.tasks).toHaveLength(1)
      expect(result.tasks[0].id).toBe('task-2')
    })

    it('should paginate results', async () => {
      const page1 = await store.list({ pageSize: 2 })

      expect(page1.tasks).toHaveLength(2)
      expect(page1.nextPageToken).toBe('2')

      const page2 = await store.list({ pageSize: 2, pageToken: '2' })

      expect(page2.tasks).toHaveLength(2)
      expect(page2.nextPageToken).toBe('')

      // Ensure no duplicates
      const allIds = [...page1.tasks, ...page2.tasks].map((t) => t.id)
      expect(new Set(allIds).size).toBe(4)
    })

    it('should sort by timestamp descending (most recent first)', async () => {
      const result = await store.list({})

      // Most recent task (task-4) should be first
      expect(result.tasks[0].id).toBe('task-4')
    })

    it('should enforce max page size of 100', async () => {
      const result = await store.list({ pageSize: 1000 })

      expect(result.pageSize).toBe(100)
    })

    it('should filter by lastUpdatedAfter', async () => {
      // Use the save time of task-3 to filter - should get task-3 and task-4
      const task3SaveTime = taskSaveTimes['task-3']
      expect(task3SaveTime).toBeDefined()
      const cutoffTime = task3SaveTime - 1 // Just before task-3 was saved
      const result = await store.list({ lastUpdatedAfter: cutoffTime })

      // Should include task-3 and task-4 (saved after cutoff)
      expect(result.tasks.length).toBe(2)
      const taskIds = result.tasks.map((t) => t.id)
      expect(taskIds).toContain('task-3')
      expect(taskIds).toContain('task-4')
    })

    it('should trim history when historyLength is specified', async () => {
      // Create task with history
      const taskWithHistory: Task = {
        kind: 'task',
        id: 'task-with-history',
        contextId: 'ctx-c',
        status: { state: 'completed', timestamp: new Date().toISOString() },
        history: [
          { kind: 'message', role: 'user', messageId: 'm1', parts: [] },
          { kind: 'message', role: 'agent', messageId: 'm2', parts: [] },
          { kind: 'message', role: 'user', messageId: 'm3', parts: [] },
          { kind: 'message', role: 'agent', messageId: 'm4', parts: [] },
        ],
      }
      await store.save(taskWithHistory)

      const result = await store.list({
        contextId: 'ctx-c',
        historyLength: 2,
      })

      expect(result.tasks[0].history).toHaveLength(2)
      // Should keep last 2 messages
      expect(result.tasks[0].history?.[0].messageId).toBe('m3')
      expect(result.tasks[0].history?.[1].messageId).toBe('m4')
    })

    it('should exclude artifacts when includeArtifacts is false', async () => {
      // Create task with artifacts
      const taskWithArtifacts: Task = {
        kind: 'task',
        id: 'task-with-artifacts',
        contextId: 'ctx-d',
        status: { state: 'completed', timestamp: new Date().toISOString() },
        artifacts: [
          {
            artifactId: 'art-1',
            name: 'result.json',
            parts: [{ kind: 'data', data: { result: 'success' } }],
          },
        ],
      }
      await store.save(taskWithArtifacts)

      const result = await store.list({
        contextId: 'ctx-d',
        includeArtifacts: false,
      })

      expect(result.tasks[0].artifacts).toBeUndefined()
    })

    it('should include artifacts by default', async () => {
      const taskWithArtifacts: Task = {
        kind: 'task',
        id: 'task-with-artifacts-2',
        contextId: 'ctx-e',
        status: { state: 'completed', timestamp: new Date().toISOString() },
        artifacts: [
          {
            artifactId: 'art-1',
            name: 'result.json',
            parts: [{ kind: 'data', data: { result: 'success' } }],
          },
        ],
      }
      await store.save(taskWithArtifacts)

      const result = await store.list({ contextId: 'ctx-e' })

      expect(result.tasks[0].artifacts).toBeDefined()
      expect(result.tasks[0].artifacts).toHaveLength(1)
    })
  })

  describe('getAllTasks', () => {
    it('should return all tasks', async () => {
      await store.save(createTask('task-1', 'ctx-1', 'submitted'))
      await store.save(createTask('task-2', 'ctx-2', 'working'))

      const allTasks = await store.getAllTasks()

      expect(allTasks).toHaveLength(2)
    })

    it('should return empty array when no tasks', async () => {
      const allTasks = await store.getAllTasks()

      expect(allTasks).toEqual([])
    })
  })

  describe('clear', () => {
    it('should remove all tasks', async () => {
      await store.save(createTask('task-1', 'ctx-1', 'submitted'))
      await store.save(createTask('task-2', 'ctx-2', 'working'))

      await store.clear()

      const allTasks = await store.getAllTasks()
      expect(allTasks).toEqual([])
    })
  })
})
