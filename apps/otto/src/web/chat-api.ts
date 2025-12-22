/**
 * Otto Chat API
 * REST API for web-based chat - uses ElizaOS runtime via plugin actions
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Address } from 'viem'
import { isAddress, verifyMessage } from 'viem'
import { z } from 'zod'
import { getConfig } from '../config'
import { processMessage } from '../eliza/runtime'
import {
  AuthMessageResponseSchema,
  AuthVerifyRequestSchema,
  ChatMessageSchema,
  ChatRequestSchema,
  ChatResponseSchema,
  expectValid,
} from '../schemas'
import { getStateManager } from '../services/state'
import { getWalletService } from '../services/wallet'
import type { PlatformMessage } from '../types'

const walletService = getWalletService()
const stateManager = getStateManager()

// Chat message history per session - bounded to prevent memory leaks
const MAX_SESSIONS = 10000
const MAX_MESSAGES_PER_SESSION = 100
const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

const sessionMessages = new Map<
  string,
  Array<{
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: number
  }>
>()
const sessionCreatedAt = new Map<string, number>()

// Cleanup expired sessions periodically
setInterval(
  () => {
    const now = Date.now()
    for (const [sessionId, createdAt] of sessionCreatedAt.entries()) {
      if (now - createdAt > SESSION_TTL_MS) {
        sessionMessages.delete(sessionId)
        sessionCreatedAt.delete(sessionId)
      }
    }
  },
  60 * 60 * 1000,
) // Run every hour

// ============================================================================
// Session helpers
// ============================================================================

function createChatSession(walletAddress?: Address): {
  sessionId: string
  messages: Array<{
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: number
  }>
} {
  // Enforce max sessions limit to prevent memory exhaustion
  if (sessionMessages.size >= MAX_SESSIONS) {
    // Remove oldest session
    const oldestSessionId = sessionCreatedAt.entries().next().value
    if (oldestSessionId) {
      sessionMessages.delete(oldestSessionId[0])
      sessionCreatedAt.delete(oldestSessionId[0])
    }
  }

  // Use the state manager's createSession method
  const session = stateManager.createSession(walletAddress)
  const messages: Array<{
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: number
  }> = []
  sessionMessages.set(session.sessionId, messages)
  sessionCreatedAt.set(session.sessionId, Date.now())

  return { sessionId: session.sessionId, messages }
}

function getSessionMessages(sessionId: string): Array<{
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}> {
  return sessionMessages.get(sessionId) ?? []
}

function addSessionMessage(
  sessionId: string,
  msg: {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: number
  },
): void {
  const messages = sessionMessages.get(sessionId) ?? []
  messages.push(msg)

  // Enforce max messages per session to prevent memory exhaustion
  if (messages.length > MAX_MESSAGES_PER_SESSION) {
    messages.splice(0, messages.length - MAX_MESSAGES_PER_SESSION)
  }

  sessionMessages.set(sessionId, messages)
}

function getOrCreateSession(
  sessionId?: string,
  walletAddress?: Address,
): { sessionId: string; session: { userId: string } } {
  if (sessionId) {
    const session = stateManager.getSession(sessionId)
    if (session) {
      return { sessionId, session: { userId: session.userId } }
    }
  }
  const { sessionId: newSessionId } = createChatSession(walletAddress)
  return {
    sessionId: newSessionId,
    session: { userId: walletAddress ?? newSessionId },
  }
}

// ============================================================================
// Auth helpers
// ============================================================================

function generateAuthMessage(address: Address): {
  message: string
  nonce: string
} {
  const nonce = crypto.randomUUID()
  const message = `Sign this message to connect your wallet to Otto.\n\nAddress: ${address}\nNonce: ${nonce}\nTimestamp: ${Date.now()}`
  return { message, nonce }
}

async function verifyAndConnectWallet(
  address: string,
  message: string,
  signature: string,
  sessionId: string,
  platform: string,
): Promise<{ success: boolean; error?: string }> {
  const valid = await verifyMessage({
    address: address as Address,
    message,
    signature: signature as `0x${string}`,
  })

  if (!valid) {
    return { success: false, error: 'Invalid signature' }
  }

  // Connect via verifyAndConnect - this stores the user
  await walletService.verifyAndConnect(
    platform as 'web',
    sessionId,
    sessionId, // username
    address as Address,
    signature as `0x${string}`,
    crypto.randomUUID(), // nonce
  )

  return { success: true }
}

// ============================================================================
// Validation helpers
// ============================================================================

function validateAddress(address: string): Address {
  if (!isAddress(address)) {
    throw new Error(`Invalid address: ${address}`)
  }
  return address
}

function validateSessionId(sessionId: string): string {
  const result = z.string().uuid().safeParse(sessionId)
  if (!result.success) {
    throw new Error('Invalid session ID')
  }
  return result.data
}

// ============================================================================
// API Routes
// ============================================================================

export const chatApi = new Hono()

// CORS Configuration - inherits from parent server configuration
// In production, set OTTO_ALLOWED_ORIGINS to restrict cross-origin access
const chatAllowedOrigins = process.env.OTTO_ALLOWED_ORIGINS?.split(',') ?? []
const chatCorsOrigin =
  chatAllowedOrigins.length > 0
    ? (origin: string) =>
        chatAllowedOrigins.includes(origin) ? origin : chatAllowedOrigins[0]
    : '*' // Development: allow all origins

chatApi.use(
  '/*',
  cors({
    origin: chatCorsOrigin,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Session-Id',
      'X-Wallet-Address',
    ],
  }),
)

// Create session
chatApi.post('/session', async (c) => {
  const rawBody = await c.req.json().catch(() => ({}))
  const SessionCreateSchema = z.object({
    walletAddress: z
      .string()
      .refine((val) => !val || isAddress(val), { message: 'Invalid address' })
      .optional(),
  })
  const body = expectValid(SessionCreateSchema, rawBody, 'create session')

  const walletAddress = body.walletAddress
    ? (validateAddress(body.walletAddress) as Address)
    : undefined
  const { sessionId, messages } = createChatSession(walletAddress)

  return c.json({ sessionId, messages })
})

// Get session
chatApi.get('/session/:id', (c) => {
  const sessionIdParam = c.req.param('id')
  const sessionId = validateSessionId(sessionIdParam)

  const session = stateManager.getSession(sessionId)

  if (!session) {
    return c.json({ error: 'Session not found' }, 404)
  }

  const messages = getSessionMessages(sessionId)

  return c.json({
    sessionId: session.sessionId,
    messages,
    userId: session.userId,
  })
})

// Send message
chatApi.post('/chat', async (c) => {
  const rawBody = await c.req.json()
  const body = expectValid(ChatRequestSchema, rawBody, 'chat request')

  const walletAddressHeader = c.req.header('X-Wallet-Address')
  const walletAddress = walletAddressHeader
    ? (validateAddress(walletAddressHeader) as Address)
    : undefined

  const { sessionId, session } = getOrCreateSession(
    body.sessionId ?? c.req.header('X-Session-Id'),
    walletAddress,
  )

  // Add user message
  const userMsg = {
    id: crypto.randomUUID(),
    role: 'user' as const,
    content: body.message,
    timestamp: Date.now(),
  }
  const validatedUserMsg = expectValid(
    ChatMessageSchema,
    userMsg,
    'user message',
  )
  addSessionMessage(sessionId, validatedUserMsg)

  stateManager.updateSession(sessionId, {})

  // Process message
  const platformMessage: PlatformMessage = {
    platform: 'web',
    messageId: validatedUserMsg.id,
    channelId: sessionId,
    userId: session.userId,
    content: body.message.trim(),
    timestamp: Date.now(),
    isCommand: true,
  }

  const result = await processMessage(platformMessage)

  // Create response
  const assistantMsg = {
    id: crypto.randomUUID(),
    role: 'assistant' as const,
    content: result.message,
    timestamp: Date.now(),
  }
  const validatedAssistantMsg = expectValid(
    ChatMessageSchema,
    assistantMsg,
    'assistant message',
  )
  addSessionMessage(sessionId, validatedAssistantMsg)

  const requiresAuth =
    !walletAddress && result.message.toLowerCase().includes('connect')
  const config = getConfig()

  const response = {
    sessionId,
    message: validatedAssistantMsg,
    requiresAuth,
    authUrl: requiresAuth ? `${config.baseUrl}/auth/connect` : undefined,
  }

  return c.json(expectValid(ChatResponseSchema, response, 'chat response'))
})

// Auth message for signing
chatApi.get('/auth/message', (c) => {
  const addressParam = c.req.query('address')
  if (!addressParam) {
    return c.json({ error: 'Address required' }, 400)
  }

  const address = validateAddress(addressParam) as Address
  const { message, nonce } = generateAuthMessage(address)
  const response = { message, nonce }

  return c.json(
    expectValid(AuthMessageResponseSchema, response, 'auth message response'),
  )
})

// Verify signature
chatApi.post('/auth/verify', async (c) => {
  const rawBody = await c.req.json()
  const body = expectValid(
    AuthVerifyRequestSchema,
    rawBody,
    'auth verify request',
  )

  const result = await verifyAndConnectWallet(
    body.address,
    body.message,
    body.signature,
    body.sessionId,
    'web',
  )

  if (!result.success) {
    return c.json({ error: result.error ?? 'Verification failed' }, 401)
  }

  return c.json({ success: true, address: body.address })
})

export default chatApi
