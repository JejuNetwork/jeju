/**
 * Autonomous Group Chat Service
 *
 * Handles agents participating in group chats autonomously.
 *
 * @packageDocumentation
 */

import type { IAgentRuntime } from '@elizaos/core'
import { logger } from '@jejunetwork/shared'

/**
 * Group chat decision
 */
export interface GroupChatDecision {
  shouldRespond: boolean
  chatId?: string
  content?: string
  reasoning: string
}

/**
 * Group chat result
 */
export interface GroupChatResult {
  success: boolean
  messageId?: string
  error?: string
}

/**
 * Group chat message
 */
export interface GroupMessage {
  id: string
  chatId: string
  senderId: string
  senderName?: string
  content: string
  createdAt: Date
}

/**
 * Group chat with activity
 */
export interface GroupChatWithActivity {
  chatId: string
  chatName?: string
  messages: GroupMessage[]
  memberCount: number
}

/**
 * Agent group chat configuration
 */
interface AgentGroupChatConfig {
  systemPrompt?: string
  personality?: string
  username?: string
  displayName?: string
}

/**
 * Autonomous Group Chat Service
 */
export class AutonomousGroupChatService {
  /**
   * Get agent configuration
   */
  private async getAgentConfig(agentId: string): Promise<AgentGroupChatConfig> {
    logger.debug(`Getting group chat config for agent ${agentId}`)

    // In a full implementation, this would fetch from database
    return {
      systemPrompt: 'You are an AI agent on Jeju Network.',
      personality: 'engaging and helpful',
      username: `agent-${agentId.slice(0, 8)}`,
      displayName: `Agent ${agentId.slice(0, 8)}`,
    }
  }

  /**
   * Get group chats the agent is part of with recent activity
   */
  private async getGroupChatsWithActivity(
    agentId: string,
  ): Promise<GroupChatWithActivity[]> {
    logger.debug(`Getting group chats with activity for agent ${agentId}`)

    // In a full implementation, this would:
    // 1. Get all chats the agent participates in
    // 2. Filter to group chats only
    // 3. Get recent messages (last hour)
    return []
  }

  /**
   * Check if agent was mentioned in messages
   */
  private wasAgentMentioned(
    messages: GroupMessage[],
    username: string,
    displayName: string,
  ): boolean {
    return messages.some((m) => {
      const content = m.content.toLowerCase()
      return (
        content.includes(username.toLowerCase()) ||
        content.includes(displayName.toLowerCase())
      )
    })
  }

  /**
   * Decide whether to participate in group chat
   */
  async decideGroupChatResponse(
    agentId: string,
    _context: Record<string, unknown>,
    runtime?: IAgentRuntime,
  ): Promise<GroupChatDecision> {
    logger.debug(`Deciding on group chat response for agent ${agentId}`)

    const groupChats = await this.getGroupChatsWithActivity(agentId)

    if (groupChats.length === 0) {
      return {
        shouldRespond: false,
        reasoning: 'No group chats with recent activity',
      }
    }

    const config = await this.getAgentConfig(agentId)

    for (const chat of groupChats) {
      if (!chat || chat.messages.length === 0) continue

      // Check if agent was mentioned
      const username = config.username ?? `agent-${agentId.slice(0, 8)}`
      const displayName = config.displayName ?? `Agent ${agentId.slice(0, 8)}`
      const wasMentioned = this.wasAgentMentioned(
        chat.messages,
        username,
        displayName,
      )

      // Check if agent already responded recently
      const agentLastMessage = chat.messages.find((m) => m.senderId === agentId)

      // Only respond if mentioned or hasn't responded yet
      if (!wasMentioned && agentLastMessage) {
        continue
      }

      // If no runtime provided, we can't make LLM calls
      if (!runtime) {
        logger.warn(
          `No runtime provided for agent ${agentId}, cannot generate group chat response`,
        )
        return {
          shouldRespond: false,
          chatId: chat.chatId,
          reasoning: 'No runtime available for LLM generation',
        }
      }

      // In a full implementation, this would call the LLM
      logger.info(
        `Agent ${agentId} would respond to group chat ${chat.chatId} (no LLM call made)`,
      )
      return {
        shouldRespond: false,
        chatId: chat.chatId,
        reasoning: 'LLM generation not implemented',
      }
    }

    return {
      shouldRespond: false,
      reasoning: 'No appropriate group chats to respond to',
    }
  }

  /**
   * Participate in group chats for an agent
   */
  async participateInGroupChats(
    agentId: string,
    runtime?: IAgentRuntime,
  ): Promise<number> {
    logger.debug(`Participating in group chats for agent ${agentId}`)

    const config = await this.getAgentConfig(agentId)
    const displayName = config.displayName ?? `Agent-${agentId.slice(0, 8)}`
    const username = config.username ?? `agent-${agentId.slice(0, 8)}`

    const groupChats = await this.getGroupChatsWithActivity(agentId)
    const messagesCreated = 0

    for (const chat of groupChats) {
      if (!chat) continue

      // Check if agent was mentioned or should respond
      const wasMentioned = this.wasAgentMentioned(
        chat.messages,
        username,
        displayName,
      )
      const agentLastMessage = chat.messages.find((m) => m.senderId === agentId)

      // Don't spam - only respond if mentioned or if it's been a while
      if (!wasMentioned && agentLastMessage) {
        continue
      }

      // If no runtime, skip LLM generation
      if (!runtime) {
        logger.warn(
          `No runtime for agent ${agentId}, skipping group chat response`,
        )
        continue
      }

      // In a full implementation, this would call the LLM
      logger.debug(
        `Would respond to group chat ${chat.chatId} (no LLM call made)`,
      )

      // Only respond to one group per tick to avoid spam
      break
    }

    return messagesCreated
  }

  /**
   * Send a group chat message
   */
  async sendGroupMessage(
    agentId: string,
    chatId: string,
    content: string,
  ): Promise<GroupChatResult> {
    logger.debug(`Sending group message for agent ${agentId} in chat ${chatId}`)

    if (!content || content.trim().length < 3) {
      return { success: false, error: 'Content too short' }
    }

    if (content.trim() === 'SKIP') {
      return { success: false, error: 'Agent chose to skip' }
    }

    // In a full implementation, this would:
    // 1. Verify the chat exists and is a group chat
    // 2. Insert the message into the database
    const messageId = `msg-${Date.now()}`

    logger.info(`Group message sent: ${messageId}`)
    return { success: true, messageId }
  }
}

/** Singleton instance */
export const autonomousGroupChatService = new AutonomousGroupChatService()
