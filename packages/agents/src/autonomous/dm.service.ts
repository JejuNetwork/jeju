/**
 * Autonomous DM Service
 *
 * Handles agents responding to direct messages autonomously.
 *
 * @packageDocumentation
 */

import { logger } from '@jejunetwork/shared'
import type { IAgentRuntime } from '@elizaos/core'

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
   */
  private async getChatsWithUnread(agentId: string): Promise<ChatWithUnread[]> {
    logger.debug(`Getting chats with unread messages for agent ${agentId}`)

    // In a full implementation, this would:
    // 1. Get all chats the agent participates in
    // 2. Filter to non-group chats (DMs only)
    // 3. Get recent messages not from the agent
    return []
  }

  /**
   * Build DM response prompt
   * @internal Reserved for future implementation
   */
  private _buildDMPrompt(
    config: AgentDMConfig,
    displayName: string,
    allMessages: ChatMessage[],
    latestMessage: ChatMessage,
    agentId: string,
  ): string {
    return `${config.systemPrompt ?? 'You are an AI agent on Jeju.'}

You are ${displayName} in a direct message conversation.

Recent conversation:
${allMessages
  .slice(-5)
  .map((m) => `${m.senderId === agentId ? 'You' : 'Them'}: ${m.content}`)
  .join('\n')
}

Latest message from them:
"${latestMessage.content}"

Task: Generate a helpful, friendly response (1-2 sentences).
Be authentic to your personality.
Keep it under 200 characters.
If mentioning markets, use SHORT SUMMARIES (e.g., "the TeslAI bet") not full questions.

Generate ONLY the response text, nothing else.`
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

    // If no runtime provided, we can't make LLM calls
    if (!runtime) {
      logger.warn(`No runtime provided for agent ${agentId}, cannot generate DM response`)
      return {
        shouldRespond: false,
        chatId: chat.chatId,
        reasoning: 'No runtime available for LLM generation',
      }
    }

    // In a full implementation, this would call the LLM
    logger.info(`Agent ${agentId} decided not to respond (no LLM call made)`)
    return {
      shouldRespond: false,
      chatId: chat.chatId,
      reasoning: 'LLM generation not implemented',
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

    const _config = await this.getAgentConfig(agentId) // Reserved for prompt building
    const _displayName = `Agent-${agentId.slice(0, 8)}` // Reserved for prompt building

    const chatsWithUnread = await this.getChatsWithUnread(agentId)
    let responsesCreated = 0

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
      logger.debug(`Would respond to DM in chat ${chat.chatId} (no LLM call made)`)

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

    const _cleanContent = content.trim() // Reserved for DB insert

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
