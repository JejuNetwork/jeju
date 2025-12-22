/**
 * Session Management Hooks
 * Shared session business logic
 */

import { expectValid } from '@jejunetwork/types'
import type { Address } from 'viem'
import { ChatMessageSchema } from '../schemas'
import { type ChatSession, getStateManager } from '../services/state'
import type { ChatMessage } from '../types'

// Chat message history per session (ephemeral, not persisted)
const sessionMessages = new Map<string, ChatMessage[]>()

/**
 * Create a new chat session
 */
export function createChatSession(walletAddress?: Address): {
  sessionId: string
  messages: ChatMessage[]
} {
  const session = getStateManager().createSession(walletAddress)

  const welcome: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: walletAddress
      ? `Connected. Ready to trade. Try: \`swap 1 ETH to USDC\``
      : `Otto here. Type \`help\` or \`connect\` to start.`,
    timestamp: Date.now(),
  }

  const validatedWelcome = expectValid(
    ChatMessageSchema,
    welcome,
    'welcome message',
  )
  sessionMessages.set(session.sessionId, [validatedWelcome])

  return {
    sessionId: session.sessionId,
    messages: [validatedWelcome],
  }
}

/**
 * Get session messages
 */
export function getSessionMessages(sessionId: string): ChatMessage[] {
  if (!sessionId) {
    throw new Error('Session ID is required')
  }

  const messages = sessionMessages.get(sessionId)
  if (!messages) {
    throw new Error(`Session not found: ${sessionId}`)
  }
  return messages.map((msg) =>
    expectValid(ChatMessageSchema, msg, `message ${msg.id}`),
  )
}

/**
 * Add message to session
 */
export function addSessionMessage(
  sessionId: string,
  message: ChatMessage,
): void {
  if (!sessionId) {
    throw new Error('Session ID is required')
  }

  const validatedMessage = expectValid(
    ChatMessageSchema,
    message,
    'session message',
  )
  const messages = sessionMessages.get(sessionId) ?? []
  messages.push(validatedMessage)
  sessionMessages.set(sessionId, messages)
}

/**
 * Get or create session
 */
export function getOrCreateSession(
  sessionId: string | undefined,
  walletAddress?: Address,
): { sessionId: string; session: ChatSession } {
  const stateManager = getStateManager()
  let session = sessionId ? stateManager.getSession(sessionId) : null

  if (!session) {
    const newSession = createChatSession(walletAddress)
    session = stateManager.getSession(newSession.sessionId)
    if (!session) {
      throw new Error('Failed to create session')
    }
    return { sessionId: newSession.sessionId, session }
  }

  if (!sessionId) {
    throw new Error('Session ID required but was undefined')
  }

  return { sessionId, session }
}
