/**
 * ElizaOS Public Worker
 *
 * A pre-built DWS worker that runs ElizaOS agents.
 * Deployed once, used by all agents with different character configs.
 *
 * This worker:
 * 1. Loads character from request or CQL
 * 2. Runs ElizaOS runtime
 * 3. Calls DWS inference (internal)
 * 4. Stores memories in CQL
 * 5. Returns response
 */

import type {
  AgentCharacter,
  AgentMemory,
  AgentMessage,
  AgentResponse,
} from '../types'

// ============================================================================
// Bindings (Injected by DWS)
// ============================================================================

interface Env {
  // DWS Internal Services
  DWS_INFERENCE_URL: string
  DWS_KMS_URL: string
  DWS_CQL_URL: string

  // Agent-specific bindings
  AGENT_ID: string
  AGENT_CHARACTER?: string // JSON-encoded character (optional, can load from CQL)
  MEMORIES_DB_ID?: string
  SECRETS_KEY_ID?: string

  // Plugin cache
  LOADED_PLUGINS?: string // Comma-separated plugin names
}

// ============================================================================
// Request/Response Types
// ============================================================================

interface InvokeRequest {
  type: 'chat' | 'think' | 'cron'
  message?: AgentMessage
  cronAction?: string
  cronPayload?: Record<string, unknown>
}

interface InvokeResponse {
  success: boolean
  response?: AgentResponse
  error?: string
  metadata?: {
    latencyMs: number
    model?: string
    tokensUsed?: number
  }
}

// ============================================================================
// ElizaOS Runtime (Simplified for Worker)
// ============================================================================

class ElizaWorkerRuntime {
  private env: Env
  private character: AgentCharacter
  private conversationHistory: Map<
    string,
    Array<{ role: string; content: string }>
  > = new Map()

  constructor(env: Env, character: AgentCharacter) {
    this.env = env
    this.character = character
  }

  async processMessage(message: AgentMessage): Promise<AgentResponse> {
    const startTime = Date.now()

    // Get conversation history for this room
    const roomKey = `${message.userId}:${message.roomId}`
    const history = this.conversationHistory.get(roomKey) ?? []

    // Build system prompt from character
    const systemPrompt = this.buildSystemPrompt()

    // Build messages for inference
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-10), // Last 10 messages for context
      { role: 'user', content: message.content.text },
    ]

    // Call DWS inference
    const inferenceResult = await this.callInference(messages)

    // Update conversation history
    history.push({ role: 'user', content: message.content.text })
    history.push({ role: 'assistant', content: inferenceResult.text })

    // Keep last 20 messages
    if (history.length > 20) {
      history.splice(0, history.length - 20)
    }
    this.conversationHistory.set(roomKey, history)

    // Store memory in CQL
    await this.storeMemory(message, inferenceResult.text)

    // Extract actions from response
    const actions = this.extractActions(inferenceResult.text)

    return {
      id: crypto.randomUUID(),
      agentId: this.env.AGENT_ID,
      text: inferenceResult.text,
      actions,
      metadata: {
        model: inferenceResult.model,
        tokensUsed: inferenceResult.tokensUsed,
        latencyMs: Date.now() - startTime,
      },
    }
  }

  async think(): Promise<AgentResponse> {
    // Autonomous thinking - generate a thought based on recent memories
    const memories = await this.getRecentMemories(5)

    const systemPrompt = this.buildSystemPrompt()
    const thinkPrompt = `Based on your recent interactions and memories, generate a thought or reflection.

Recent memories:
${memories.map((m) => `- ${m.content}`).join('\n')}

Generate a brief internal thought or reflection about your recent experiences.`

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: thinkPrompt },
    ]

    const result = await this.callInference(messages)

    // Store as reflection memory
    await this.storeMemory(
      {
        id: crypto.randomUUID(),
        userId: 'system',
        roomId: 'internal',
        content: { text: thinkPrompt },
        createdAt: Date.now(),
      },
      result.text,
      'reflection',
    )

    return {
      id: crypto.randomUUID(),
      agentId: this.env.AGENT_ID,
      text: result.text,
      metadata: {
        model: result.model,
        tokensUsed: result.tokensUsed,
      },
    }
  }

  private buildSystemPrompt(): string {
    const char = this.character
    const parts = [char.system]

    if (char.bio?.length) {
      parts.push('\n\nBackground:', char.bio.join('\n'))
    }
    if (char.style?.all?.length) {
      parts.push('\n\nStyle guidelines:', char.style.all.join('\n'))
    }
    if (char.topics?.length) {
      parts.push('\n\nTopics of expertise:', char.topics.join(', '))
    }
    if (char.knowledge?.length) {
      parts.push('\n\nKnowledge:', char.knowledge.join('\n'))
    }

    return parts.join('\n')
  }

  private async callInference(
    messages: Array<{ role: string; content: string }>,
  ): Promise<{
    text: string
    model?: string
    tokensUsed?: number
  }> {
    const response = await fetch(
      `${this.env.DWS_INFERENCE_URL}/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          max_tokens: 1000,
          temperature: 0.7,
        }),
      },
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`DWS inference failed: ${error}`)
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content: string } }>
      content?: string
      model?: string
      usage?: { total_tokens: number }
    }

    return {
      text: data.choices?.[0]?.message?.content ?? data.content ?? '',
      model: data.model,
      tokensUsed: data.usage?.total_tokens,
    }
  }

  private async storeMemory(
    message: AgentMessage,
    response: string,
    type: 'message' | 'reflection' = 'message',
  ): Promise<void> {
    if (!this.env.MEMORIES_DB_ID || !this.env.DWS_CQL_URL) {
      return // No memory storage configured
    }

    const memory: AgentMemory = {
      id: crypto.randomUUID(),
      agentId: this.env.AGENT_ID,
      userId: message.userId,
      roomId: message.roomId,
      content: `User: ${message.content.text}\nAgent: ${response}`,
      type,
      importance: 0.5,
      createdAt: Date.now(),
    }

    await fetch(`${this.env.DWS_CQL_URL}/v1/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        database: this.env.MEMORIES_DB_ID,
        sql: `INSERT INTO agent_memories (id, agent_id, user_id, room_id, content, type, importance, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          memory.id,
          memory.agentId,
          memory.userId,
          memory.roomId,
          memory.content,
          memory.type,
          memory.importance,
          memory.createdAt,
        ],
      }),
    }).catch((err) => {
      console.error('[ElizaWorker] Failed to store memory:', err)
    })
  }

  private async getRecentMemories(limit: number): Promise<AgentMemory[]> {
    if (!this.env.MEMORIES_DB_ID || !this.env.DWS_CQL_URL) {
      return []
    }

    const response = await fetch(`${this.env.DWS_CQL_URL}/v1/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        database: this.env.MEMORIES_DB_ID,
        sql: `SELECT * FROM agent_memories WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`,
        params: [this.env.AGENT_ID, limit],
      }),
    }).catch(() => null)

    if (!response?.ok) {
      return []
    }

    const data = (await response.json()) as { rows?: AgentMemory[] }
    return data.rows ?? []
  }

  private extractActions(
    text: string,
  ): Array<{ name: string; params: Record<string, string> }> {
    const actions: Array<{ name: string; params: Record<string, string> }> = []
    const actionRegex = /\[ACTION:\s*(\w+)\s*\|([^\]]+)\]/g

    let match: RegExpExecArray | null
    match = actionRegex.exec(text)
    while (match !== null) {
      const name = match[1]
      const paramsStr = match[2]
      const params: Record<string, string> = {}

      const paramPairs = paramsStr.split(',').map((p) => p.trim())
      for (const pair of paramPairs) {
        const [key, ...valueParts] = pair.split('=')
        if (key && valueParts.length) {
          params[key.trim()] = valueParts.join('=').trim()
        }
      }

      actions.push({ name, params })
      match = actionRegex.exec(text)
    }

    return actions
  }
}

// ============================================================================
// Worker Export (Cloudflare Workers / Workerd Format)
// ============================================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Health check
    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          status: 'healthy',
          worker: 'eliza-runtime',
          agentId: env.AGENT_ID,
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    // Invoke endpoint
    if (url.pathname === '/invoke' && request.method === 'POST') {
      const startTime = Date.now()

      try {
        const body = (await request.json()) as InvokeRequest

        // Load character
        let character: AgentCharacter
        if (env.AGENT_CHARACTER) {
          character = JSON.parse(env.AGENT_CHARACTER)
        } else {
          // Load from CQL
          character = await loadCharacterFromCQL(env)
        }

        // Create runtime
        const runtime = new ElizaWorkerRuntime(env, character)

        let response: AgentResponse

        switch (body.type) {
          case 'chat':
            if (!body.message) {
              return new Response(
                JSON.stringify({
                  success: false,
                  error: 'Missing message for chat invocation',
                }),
                {
                  status: 400,
                  headers: { 'Content-Type': 'application/json' },
                },
              )
            }
            response = await runtime.processMessage(body.message)
            break

          case 'think':
            response = await runtime.think()
            break

          case 'cron':
            // Handle cron-triggered actions
            if (body.cronAction === 'think') {
              response = await runtime.think()
            } else {
              response = await runtime.think() // Default to think
            }
            break

          default:
            return new Response(
              JSON.stringify({
                success: false,
                error: `Unknown invocation type: ${body.type}`,
              }),
              {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
              },
            )
        }

        const result: InvokeResponse = {
          success: true,
          response,
          metadata: {
            latencyMs: Date.now() - startTime,
            model: response.metadata?.model,
            tokensUsed: response.metadata?.tokensUsed,
          },
        }

        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        const result: InvokeResponse = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          metadata: {
            latencyMs: Date.now() - startTime,
          },
        }

        return new Response(JSON.stringify(result), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    return new Response('Not Found', { status: 404 })
  },
}

// ============================================================================
// Helpers
// ============================================================================

async function loadCharacterFromCQL(env: Env): Promise<AgentCharacter> {
  if (!env.DWS_CQL_URL) {
    throw new Error('No character provided and CQL not configured')
  }

  const response = await fetch(`${env.DWS_CQL_URL}/v1/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      database: 'agents',
      sql: 'SELECT character FROM agents WHERE id = ?',
      params: [env.AGENT_ID],
    }),
  })

  if (!response.ok) {
    throw new Error('Failed to load character from CQL')
  }

  const data = (await response.json()) as {
    rows?: Array<{ character: string }>
  }
  if (!data.rows?.length) {
    throw new Error(`Agent ${env.AGENT_ID} not found in CQL`)
  }

  return JSON.parse(data.rows[0].character)
}

// Export for bundling
export { ElizaWorkerRuntime }
