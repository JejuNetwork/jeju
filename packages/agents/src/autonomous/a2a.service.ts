/**
 * Autonomous A2A Service
 *
 * Handles autonomous agent-to-agent communication using the @jejunetwork/a2a package.
 *
 * @packageDocumentation
 */

import {
  AgentCardGenerator,
  BaseAgentExecutor,
  type ExecutorCommand,
  type ExecutorResult,
} from '@jejunetwork/a2a'
import { getAgentsConfig, getCurrentNetwork } from '@jejunetwork/config'
import { logger } from '@jejunetwork/shared'
import type { JsonValue } from '@jejunetwork/types'
import { agentDiscoveryService } from '../agent0/discovery'
import type {
  A2AMessageResponse,
  A2AMessage as BaseA2AMessage,
} from '../communication/a2a'

/**
 * A2A message for autonomous service
 * Extends base A2A message with autonomous-specific fields
 */
export interface A2AMessage
  extends Omit<BaseA2AMessage, 'id' | 'payload' | 'signature'> {
  content: BaseA2AMessage['payload']
}

/**
 * A2A response
 */
export interface A2AResponse
  extends Pick<A2AMessageResponse, 'success' | 'error'> {
  response?: A2AMessageResponse['response']
}

/**
 * Agent executor for handling A2A messages
 */
class AutonomousAgentExecutor extends BaseAgentExecutor {
  private agentId: string
  private messageHandler: (
    message: A2AMessage,
  ) => Promise<Record<string, JsonValue>>

  constructor(
    agentId: string,
    messageHandler: (message: A2AMessage) => Promise<Record<string, JsonValue>>,
  ) {
    super()
    this.agentId = agentId
    this.messageHandler = messageHandler
  }

  protected parseCommand(message: {
    role: string
    parts: Array<{ kind: string; text?: string }>
  }): ExecutorCommand {
    const textPart = message.parts.find((p) => p.kind === 'text')
    const text = textPart?.text ?? ''

    // Parse JSON if it looks like JSON, otherwise treat as plain text
    let params: Record<string, JsonValue> = {}
    if (text.startsWith('{')) {
      try {
        params = JSON.parse(text) as Record<string, JsonValue>
      } catch {
        params = { text }
      }
    } else {
      params = { text }
    }

    return {
      operation: 'message',
      params,
    }
  }

  protected async executeOperation(
    command: ExecutorCommand,
  ): Promise<ExecutorResult> {
    const a2aMessage: A2AMessage = {
      type: 'task_request',
      from: 'external',
      to: this.agentId,
      timestamp: new Date(),
      content: {
        type: 'task_request',
        data: command.params,
      },
    }

    const result = await this.messageHandler(a2aMessage)
    return result
  }
}

/**
 * Autonomous A2A Service
 */
export class AutonomousA2AService {
  private cardGenerator: AgentCardGenerator
  private executors: Map<string, AutonomousAgentExecutor> = new Map()
  private messageHandlers: Map<
    string,
    (message: A2AMessage) => Promise<Record<string, JsonValue>>
  > = new Map()

  constructor() {
    // Get agents API base URL from config
    const network = getCurrentNetwork()
    const agentsConfig = getAgentsConfig(network)

    this.cardGenerator = new AgentCardGenerator({
      baseUrl: agentsConfig.api,
      organization: 'Jeju Network',
      organizationUrl: 'https://jejunetwork.org',
    })
  }

  /**
   * Register a message handler for an agent
   */
  registerHandler(
    agentId: string,
    handler: (message: A2AMessage) => Promise<Record<string, JsonValue>>,
  ): void {
    this.messageHandlers.set(agentId, handler)
    this.executors.set(agentId, new AutonomousAgentExecutor(agentId, handler))
    logger.info(`Registered A2A handler for agent ${agentId}`)
  }

  /**
   * Unregister a message handler
   */
  unregisterHandler(agentId: string): void {
    this.messageHandlers.delete(agentId)
    this.executors.delete(agentId)
    logger.info(`Unregistered A2A handler for agent ${agentId}`)
  }

  /**
   * Generate agent card for A2A discovery
   */
  generateAgentCard(
    agentId: string,
    name: string,
    description: string,
    skills: string[] = [],
  ) {
    return this.cardGenerator.generate({
      id: agentId,
      name,
      description,
      skills: skills.map((s) => ({
        id: s,
        name: s,
        description: s,
        tags: [],
        examples: [],
        inputModes: ['text'],
        outputModes: ['text'],
      })),
    })
  }

  /**
   * Send a message to another agent
   */
  async sendMessage(
    fromAgentId: string,
    toAgentId: string,
    message: Record<string, JsonValue>,
  ): Promise<A2AResponse> {
    logger.debug(`Sending A2A message from ${fromAgentId} to ${toAgentId}`)

    // Look up the target agent
    const targetAgent = await agentDiscoveryService.getAgent(toAgentId)
    if (!targetAgent) {
      return {
        success: false,
        error: `Agent not found: ${toAgentId}`,
      }
    }

    // Check if agent has an A2A endpoint
    const endpoint = targetAgent.endpoint
    if (!endpoint) {
      return {
        success: false,
        error: `Agent ${toAgentId} has no A2A endpoint`,
      }
    }

    // Send message via HTTP to the target agent's A2A endpoint
    try {
      const response = await fetch(`${endpoint}/message/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Id': fromAgentId,
        },
        body: JSON.stringify({
          message: {
            role: 'user',
            parts: [
              {
                kind: 'text',
                text: JSON.stringify(message),
              },
            ],
          },
        }),
      })

      if (!response.ok) {
        return {
          success: false,
          error: `A2A request failed: ${response.status}`,
        }
      }

      const responseData = (await response.json()) as {
        result?: Record<string, JsonValue>
      }

      return {
        success: true,
        response: {
          type: 'task_response',
          data: responseData.result,
        },
      }
    } catch (error) {
      logger.error('A2A message send failed', {
        fromAgentId,
        toAgentId,
        error: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Handle incoming A2A message
   */
  async handleMessage(
    agentId: string,
    message: A2AMessage,
  ): Promise<A2AResponse> {
    logger.debug(`Handling A2A message for agent ${agentId}`)

    const handler = this.messageHandlers.get(agentId)
    if (!handler) {
      return {
        success: false,
        error: `No handler registered for agent ${agentId}`,
      }
    }

    try {
      const result = await handler(message)
      return {
        success: true,
        response: {
          type: 'task_response',
          data: result,
        },
      }
    } catch (error) {
      logger.error('A2A message handling failed', {
        agentId,
        error: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Discover agents for collaboration
   */
  async discoverAgents(
    agentId: string,
    criteria: { skills?: string[]; minReputation?: number },
  ): Promise<string[]> {
    logger.debug(`Agent ${agentId} discovering agents`, { criteria })

    const discovered = await agentDiscoveryService.discoverAgents({
      skills: criteria.skills,
      minReputation: criteria.minReputation,
      a2a: true, // Only discover agents with A2A support
    })

    return discovered.items
      .filter((a) => a.agentId !== agentId) // Exclude self
      .map((a) => a.agentId)
  }

  /**
   * Get executor for an agent
   */
  getExecutor(agentId: string): AutonomousAgentExecutor | undefined {
    return this.executors.get(agentId)
  }
}

/** Singleton instance */
export const autonomousA2AService = new AutonomousA2AService()
