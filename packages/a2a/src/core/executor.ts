/**
 * Base Agent Executor Interface
 *
 * Abstract interface for A2A agent executors. Applications should implement
 * this interface to handle A2A message/send protocol operations.
 *
 * @public
 */

import type { JsonValue } from '@jejunetwork/types'
import { v4 as uuidv4 } from 'uuid'
import type {
  AgentExecutor,
  ExecutionEventBus,
  Message,
  RequestContext,
  Task,
  TaskArtifactUpdateEvent,
  TaskStatusUpdateEvent,
} from '../types/server'

/**
 * Command structure for executor operations
 */
export interface ExecutorCommand {
  operation: string
  params: Record<string, JsonValue>
}

/**
 * Base result type for executor operations
 */
export type ExecutorResult = JsonValue

/**
 * Abstract base class for A2A agent executors
 *
 * Provides the common scaffolding for processing A2A messages:
 * - Task state management (submitted → working → completed)
 * - Event bus publishing
 * - Command parsing helpers
 *
 * Subclasses should implement:
 * - `parseCommand()` - Parse user message into command structure
 * - `executeOperation()` - Execute the operation and return result
 *
 * @example
 * ```typescript
 * class MyAgentExecutor extends BaseAgentExecutor {
 *   protected parseCommand(message: Message): ExecutorCommand {
 *     // Parse message into command
 *   }
 *
 *   protected async executeOperation(
 *     command: ExecutorCommand,
 *     context: RequestContext
 *   ): Promise<ExecutorResult> {
 *     // Execute command and return result
 *   }
 * }
 * ```
 */
export abstract class BaseAgentExecutor implements AgentExecutor {
  /**
   * Main execution entry point called by the A2A server
   */
  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const { taskId, task, userMessage } = requestContext
    // Compute contextId once to ensure consistency across all events
    const contextId = requestContext.contextId || uuidv4()

    // Create initial task if needed
    if (!task) {
      const initialTask: Task = {
        kind: 'task',
        id: taskId,
        contextId,
        status: {
          state: 'submitted',
          timestamp: new Date().toISOString(),
        },
        history: [userMessage],
      }
      eventBus.publish(initialTask)
    }

    // Update to working state
    const workingUpdate: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId,
      contextId,
      status: {
        state: 'working',
        timestamp: new Date().toISOString(),
      },
      final: false,
    }
    eventBus.publish(workingUpdate)

    // Parse and execute
    const command = this.parseCommand(userMessage)
    const result = await this.executeOperation(command, requestContext)

    // Create artifact with result - ensure result is a valid JsonValue record
    const resultData: Record<string, JsonValue> =
      result !== null && typeof result === 'object' && !Array.isArray(result)
        ? (result as Record<string, JsonValue>)
        : { value: result ?? null }

    const artifactUpdate: TaskArtifactUpdateEvent = {
      kind: 'artifact-update',
      taskId,
      contextId,
      artifact: {
        artifactId: uuidv4(),
        name: 'result.json',
        parts: [
          {
            kind: 'data',
            data: resultData,
          },
        ],
      },
    }
    eventBus.publish(artifactUpdate)

    // Mark completed
    const completedUpdate: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId,
      contextId,
      status: {
        state: 'completed',
        timestamp: new Date().toISOString(),
      },
      final: true,
    }
    eventBus.publish(completedUpdate)
    eventBus.finished()
  }

  /**
   * Handle task cancellation
   */
  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    const cancelUpdate: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId,
      contextId: '',
      status: {
        state: 'canceled',
        timestamp: new Date().toISOString(),
      },
      final: true,
    }
    eventBus.publish(cancelUpdate)
    eventBus.finished()
  }

  /**
   * Parse user message into a command structure
   * Subclasses must implement this method
   */
  protected abstract parseCommand(message: Message): ExecutorCommand

  /**
   * Execute the operation and return a result
   * Subclasses must implement this method
   */
  protected abstract executeOperation(
    command: ExecutorCommand,
    context: RequestContext,
  ): Promise<ExecutorResult>
}
