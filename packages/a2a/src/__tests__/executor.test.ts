/**
 * BaseAgentExecutor Integration Tests
 *
 * Tests the A2A executor lifecycle: task creation, state transitions, completion
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import {
  BaseAgentExecutor,
  type ExecutorCommand,
  type ExecutorResult,
} from '../core/executor'
import type {
  ExecutionEventBus,
  Message,
  RequestContext,
  Task,
} from '../types/server'

/**
 * Concrete implementation for testing
 */
class TestExecutor extends BaseAgentExecutor {
  public executedCommands: ExecutorCommand[] = []
  public operationResult: ExecutorResult = { success: true }

  protected parseCommand(message: Message): ExecutorCommand {
    const parts = message.parts
    if (!parts || parts.length === 0) {
      return { operation: 'test', params: { message: '' } }
    }
    const content = parts[0]
    const text = content.kind === 'text' ? content.text : ''
    return {
      operation: 'test',
      params: { message: text },
    }
  }

  protected async executeOperation(
    command: ExecutorCommand,
    _context: RequestContext,
  ): Promise<ExecutorResult> {
    this.executedCommands.push(command)
    return this.operationResult
  }
}

/** Event types that can be published to the event bus */
interface StatusUpdateEvent {
  kind: 'status-update'
  status: { state: string; timestamp: string }
  final?: boolean
}

interface ArtifactUpdateEvent {
  kind: 'artifact-update'
  artifact: { parts: Array<{ kind: string; data: Record<string, unknown> }> }
}

type ExecutorEvent = Task | StatusUpdateEvent | ArtifactUpdateEvent

/**
 * Mock event bus for capturing published events
 */
function isExecutorEvent(
  event: Task | Record<string, unknown>,
): event is ExecutorEvent {
  if ('kind' in event) {
    const kind = event.kind
    return (
      kind === 'task' || kind === 'status-update' || kind === 'artifact-update'
    )
  }
  return false
}

function createMockEventBus(): ExecutionEventBus & {
  events: ExecutorEvent[]
} {
  const events: ExecutorEvent[] = []
  return {
    events,
    publish(event: Task | Record<string, unknown>) {
      if (isExecutorEvent(event)) {
        events.push(event)
      }
    },
    finished() {
      // no-op for testing
    },
  }
}

describe('BaseAgentExecutor', () => {
  let executor: TestExecutor
  let eventBus: ReturnType<typeof createMockEventBus>

  beforeEach(() => {
    executor = new TestExecutor()
    eventBus = createMockEventBus()
  })

  describe('execute', () => {
    it('should create initial task when not provided', async () => {
      const context: RequestContext = {
        taskId: 'task-123',
        contextId: 'ctx-456',
        task: undefined,
        userMessage: {
          kind: 'message',
          role: 'user',
          messageId: 'msg-1',
          parts: [{ kind: 'text', text: 'Hello agent' }],
        },
      }

      await executor.execute(context, eventBus)

      const initialTask = eventBus.events[0]
      if (initialTask.kind !== 'task') {
        throw new Error(`Expected task event, got ${initialTask.kind}`)
      }
      expect(initialTask.kind).toBe('task')
      expect(initialTask.id).toBe('task-123')
      expect(initialTask.status.state).toBe('submitted')
    })

    it('should transition through working to completed states', async () => {
      const context: RequestContext = {
        taskId: 'task-123',
        contextId: 'ctx-456',
        task: undefined,
        userMessage: {
          kind: 'message',
          role: 'user',
          messageId: 'msg-1',
          parts: [{ kind: 'text', text: 'Process this' }],
        },
      }

      await executor.execute(context, eventBus)

      // Should have: initial task, working update, artifact, completed update
      expect(eventBus.events.length).toBeGreaterThanOrEqual(4)

      const states = eventBus.events
        .filter((e): e is { status: { state: string } } => 'status' in e)
        .map((e) => e.status.state)

      expect(states).toContain('working')
      expect(states).toContain('completed')
    })

    it('should execute command with parsed message', async () => {
      const context: RequestContext = {
        taskId: 'task-123',
        contextId: 'ctx-456',
        task: undefined,
        userMessage: {
          kind: 'message',
          role: 'user',
          messageId: 'msg-1',
          parts: [{ kind: 'text', text: 'Test command content' }],
        },
      }

      await executor.execute(context, eventBus)

      expect(executor.executedCommands).toHaveLength(1)
      expect(executor.executedCommands[0].operation).toBe('test')
      expect(executor.executedCommands[0].params.message).toBe(
        'Test command content',
      )
    })

    it('should publish artifact with result', async () => {
      executor.operationResult = { data: 'test-result', value: 42 }

      const context: RequestContext = {
        taskId: 'task-123',
        contextId: 'ctx-456',
        task: undefined,
        userMessage: {
          kind: 'message',
          role: 'user',
          messageId: 'msg-1',
          parts: [{ kind: 'text', text: 'Get data' }],
        },
      }

      await executor.execute(context, eventBus)

      const artifactEvent = eventBus.events.find(
        (e): e is ArtifactUpdateEvent => e.kind === 'artifact-update',
      )

      if (!artifactEvent) {
        throw new Error('Expected artifact-update event to be published')
      }
      expect(artifactEvent.artifact.parts[0].data).toEqual({
        data: 'test-result',
        value: 42,
      })
    })

    it('should skip initial task creation when task is provided', async () => {
      const existingTask: Task = {
        kind: 'task',
        id: 'task-123',
        contextId: 'ctx-456',
        status: { state: 'submitted', timestamp: new Date().toISOString() },
        history: [],
      }

      const context: RequestContext = {
        taskId: 'task-123',
        contextId: 'ctx-456',
        task: existingTask,
        userMessage: {
          kind: 'message',
          role: 'user',
          messageId: 'msg-1',
          parts: [{ kind: 'text', text: 'Continue task' }],
        },
      }

      await executor.execute(context, eventBus)

      // First event should be working update, not initial task
      const firstEvent = eventBus.events[0]
      expect(firstEvent.kind).toBe('status-update')
    })

    it('should generate consistent contextId when not provided', async () => {
      const context: RequestContext = {
        taskId: 'task-123',
        contextId: undefined,
        task: undefined,
        userMessage: {
          kind: 'message',
          role: 'user',
          messageId: 'msg-1',
          parts: [{ kind: 'text', text: 'Test' }],
        },
      }

      await executor.execute(context, eventBus)

      // Get contextId from all events
      const contextIds = eventBus.events
        .filter((e): e is { contextId: string } => 'contextId' in e)
        .map((e) => e.contextId)

      // All events should have the same contextId
      const uniqueContextIds = [...new Set(contextIds)]
      expect(uniqueContextIds).toHaveLength(1)
      expect(uniqueContextIds[0]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      )
    })

    it('should handle primitive result values', async () => {
      executor.operationResult = 42

      const context: RequestContext = {
        taskId: 'task-123',
        contextId: 'ctx-456',
        task: undefined,
        userMessage: {
          kind: 'message',
          role: 'user',
          messageId: 'msg-1',
          parts: [{ kind: 'text', text: 'Get number' }],
        },
      }

      await executor.execute(context, eventBus)

      const artifactEvent = eventBus.events.find(
        (e): e is ArtifactUpdateEvent => e.kind === 'artifact-update',
      )

      if (!artifactEvent) {
        throw new Error('Expected artifact-update event to be published')
      }
      expect(artifactEvent.artifact.parts[0].data).toEqual({ value: 42 })
    })

    it('should handle null result values', async () => {
      executor.operationResult = null

      const context: RequestContext = {
        taskId: 'task-123',
        contextId: 'ctx-456',
        task: undefined,
        userMessage: {
          kind: 'message',
          role: 'user',
          messageId: 'msg-1',
          parts: [{ kind: 'text', text: 'Get null' }],
        },
      }

      await executor.execute(context, eventBus)

      const artifactEvent = eventBus.events.find(
        (e): e is ArtifactUpdateEvent => e.kind === 'artifact-update',
      )

      if (!artifactEvent) {
        throw new Error('Expected artifact-update event to be published')
      }
      expect(artifactEvent.artifact.parts[0].data).toEqual({ value: null })
    })

    it('should handle array result values', async () => {
      executor.operationResult = [1, 2, 3]

      const context: RequestContext = {
        taskId: 'task-123',
        contextId: 'ctx-456',
        task: undefined,
        userMessage: {
          kind: 'message',
          role: 'user',
          messageId: 'msg-1',
          parts: [{ kind: 'text', text: 'Get array' }],
        },
      }

      await executor.execute(context, eventBus)

      const artifactEvent = eventBus.events.find(
        (e): e is ArtifactUpdateEvent => e.kind === 'artifact-update',
      )

      if (!artifactEvent) {
        throw new Error('Expected artifact-update event to be published')
      }
      expect(artifactEvent.artifact.parts[0].data).toEqual({ value: [1, 2, 3] })
    })
  })

  describe('cancelTask', () => {
    it('should publish canceled status', async () => {
      await executor.cancelTask('task-123', eventBus)

      expect(eventBus.events).toHaveLength(1)
      const cancelEvent = eventBus.events[0]
      if (cancelEvent.kind !== 'status-update') {
        throw new Error(`Expected status-update event, got ${cancelEvent.kind}`)
      }
      expect(cancelEvent.status.state).toBe('canceled')
      expect(cancelEvent.final).toBe(true)
    })
  })
})
