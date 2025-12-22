/**
 * BaseAgentExecutor Integration Tests
 *
 * Tests the A2A executor lifecycle: task creation, state transitions, completion
 */

import type { Message, Task } from '@a2a-js/sdk'
import type { ExecutionEventBus, RequestContext } from '@a2a-js/sdk/server'
import { describe, expect, it, beforeEach } from 'bun:test'
import { BaseAgentExecutor, type ExecutorCommand, type ExecutorResult } from '../core/executor'

/**
 * Concrete implementation for testing
 */
class TestExecutor extends BaseAgentExecutor {
  public executedCommands: ExecutorCommand[] = []
  public operationResult: ExecutorResult = { success: true }

  protected parseCommand(message: Message): ExecutorCommand {
    const content = message.parts?.[0]
    const text = content?.kind === 'text' ? content.text : ''
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

/**
 * Mock event bus for capturing published events
 */
function createMockEventBus(): ExecutionEventBus & { events: Array<Task | object> } {
  const events: Array<Task | object> = []
  return {
    events,
    publish(event: Task | object) {
      events.push(event)
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

      const initialTask = eventBus.events[0] as Task
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
      expect(executor.executedCommands[0].params.message).toBe('Test command content')
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
        (e): e is { kind: 'artifact-update'; artifact: { parts: Array<{ data: object }> } } =>
          (e as { kind?: string }).kind === 'artifact-update',
      )

      expect(artifactEvent).toBeDefined()
      expect(artifactEvent?.artifact.parts[0].data).toEqual({
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
      const firstEvent = eventBus.events[0] as { kind?: string }
      expect(firstEvent.kind).toBe('status-update')
    })
  })

  describe('cancelTask', () => {
    it('should publish canceled status', async () => {
      await executor.cancelTask('task-123', eventBus)

      expect(eventBus.events).toHaveLength(1)
      const cancelEvent = eventBus.events[0] as { status: { state: string }; final: boolean }
      expect(cancelEvent.status.state).toBe('canceled')
      expect(cancelEvent.final).toBe(true)
    })
  })
})

