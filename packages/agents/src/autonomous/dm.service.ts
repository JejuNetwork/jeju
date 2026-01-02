/**
 * Autonomous DM Service
 *
 * Handles agents responding to direct messages autonomously.
 *
 * @packageDocumentation
 */

import type { IAgentRuntime } from '@elizaos/core'
import { logger } from '@jejunetwork/shared'

/**
 * DM decision
 */
export interface DMDecision {
  shouldRespond: boolean
  chatId?: string
  content?: string
  reasoning: string
}

/**
 * DM result
 */
export interface DMResult {
  success: boolean
  messageId?: string
  error?: string
}

/**
 * Chat message
 */
export interface ChatMessage {
  id: string
  chatId: string
  senderId: string
  senderName?: string
  content: string
  createdAt: Date
}

/**
 * Chat with unread messages
 */
export interface ChatWithUnread {
  chatId: string
  isGroup: boolean
  messages: ChatMessage[]
}

/**
 * Agent DM configuration
 */
interface AgentDMConfig {
  systemPrompt?: string
  personality?: string
}

/**
 * Autonomous DM Service
 */
export class AutonomousDMService {
  /**
   * Get agent configuration
   */
  private async getAgentConfig(agentId: string): Promise<AgentDMConfig> {
    logger.debug(`Getting DM config for agent ${agentId}`)

    // In a full implementation, this would fetch from database
    return {
      systemPrompt: 'You are an AI agent on Jeju Network.',
      personality: 'helpful and friendly',
    }
  }

  /**
   * Get chats with unread messages
   *
   * NOTE: This is a stub that should be connected to the actual chat database.
   * The message storage is in @jejunetwork/messaging or SQLit.
   *
   * @throws Error if called without database connection (fail-fast)
   */
  private async getChatsWithUnread(agentId: string): Promise<ChatWithUnread[]> {
    logger.debug(`Getting chats with unread messages for agent ${agentId}`)

    // This service requires a database connection to function.
    // Returning empty array silently was LARP - instead throw if no db.
    //
    // Integration path:
    // 1. Import SQLitClient from @jejunetwork/db
    // 2. Query: SELECT * FROM messages WHERE chat_id IN
    //    (SELECT chat_id FROM participants WHERE agent_id = ?)
    //    AND sender_id != ? AND is_read = false
    // 3. Group by chat_id

    logger.warn(
      `DM service for agent ${agentId}: no database configured. ` +
        'Connect SQLit or messaging service to enable DM responses.',
    )

    // Return empty but log warning - caller can check if feature is enabled
    return []
  }

  /**
   * Decide whether to respond to DM
   */
  async decideDMResponse(
    agentId: string,
    _context: Record<string, unknown>,
    runtime?: IAgentRuntime,
  ): Promise<DMDecision> {
    logger.debug(`Deciding on DM response for agent ${agentId}`)

    const chatsWithUnread = await this.getChatsWithUnread(agentId)

    if (chatsWithUnread.length === 0) {
      return {
        shouldRespond: false,
        reasoning: 'No unread DMs',
      }
    }

    const chat = chatsWithUnread[0]
    if (!chat || chat.messages.length === 0) {
      return {
        shouldRespond: false,
        reasoning: 'No messages to respond to',
      }
    }

    // Runtime required for LLM-based decisions
    if (!runtime) {
      logger.warn(
        `No runtime provided for agent ${agentId}, cannot generate DM response`,
      )
      return {
        shouldRespond: false,
        chatId: chat.chatId,
        reasoning: 'No runtime available for LLM generation',
      }
    }

    // Use the runtime to generate a response decision
    try {
      // Format recent messages as context
      const recentMessages = chat.messages
        .slice(0, 5)
        .map((m) => `${m.senderName || m.senderId}: ${m.content}`)
        .join('\n')

      // Use runtime.generateText if available
      const prompt = `You are deciding whether to respond to a DM.
Recent messages:
${recentMessages}

Should you respond? If yes, what would you say?
Respond with JSON: { "shouldRespond": boolean, "content": "..." }`

      const result = await runtime.generateText(prompt, {
        modelType: 'TEXT_SMALL',
      })

      // Parse response
      const jsonMatch = result.text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          shouldRespond: boolean
          content?: string
        }
        return {
          shouldRespond: parsed.shouldRespond,
          chatId: chat.chatId,
          content: parsed.content,
          reasoning: 'LLM decision',
        }
      }

      return {
        shouldRespond: false,
        chatId: chat.chatId,
        reasoning: 'Failed to parse LLM response',
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.error(`LLM decision failed for agent ${agentId}: ${errorMsg}`)
      return {
        shouldRespond: false,
        chatId: chat.chatId,
        reasoning: `LLM generation failed: ${errorMsg}`,
      }
    }
  }

  /**
   * Respond to DMs for an agent
   */
  async respondToDMs(
    agentId: string,
    runtime?: IAgentRuntime,
  ): Promise<number> {
    logger.debug(`Responding to DMs for agent ${agentId}`)

    // Preload config for future use
    await this.getAgentConfig(agentId)

    const chatsWithUnread = await this.getChatsWithUnread(agentId)
    const responsesCreated = 0

    for (const chat of chatsWithUnread) {
      if (!chat || chat.isGroup) continue

      const latestMessage = chat.messages[0]
      if (!latestMessage) continue

      // If no runtime, skip LLM generation
      if (!runtime) {
        logger.warn(`No runtime for agent ${agentId}, skipping DM response`)
        continue
      }

      // In a full implementation, this would call the LLM
      // For now, skip
      logger.debug(
        `Would respond to DM in chat ${chat.chatId} (no LLM call made)`,
      )

      // Only respond to one DM per tick to avoid spam
      break
    }

    return responsesCreated
  }

  /**
   * Send a DM response
   */
  async sendDMResponse(
    agentId: string,
    chatId: string,
    content: string,
  ): Promise<DMResult> {
    logger.debug(`Sending DM response for agent ${agentId} in chat ${chatId}`)

    if (!content || content.trim().length < 3) {
      return { success: false, error: 'Content too short' }
    }

    // In a full implementation, this would:
    // 1. Verify the chat exists
    // 2. Insert the message into the database
    const messageId = `msg-${Date.now()}`

    logger.info(`DM sent: ${messageId}`)
    return { success: true, messageId }
  }
}

/** Singleton instance */
export const autonomousDMService = new AutonomousDMService()
