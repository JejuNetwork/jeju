/**
 * Unified Protocol Server - REST, A2A, and MCP
 *
 * Creates a single Hono app that exposes:
 * - REST API at /api/*
 * - A2A protocol at /a2a
 * - MCP protocol at /mcp
 *
 * Supports both server mode (Bun.serve) and serverless mode (export fetch handler).
 */

import { type Context, Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Address } from 'viem'
import { z } from 'zod'
import { getProviderInfo, getServiceName } from '../chains'
import type { ProtocolData, ProtocolValue } from '../types'
import {
  configureProtocolMiddleware,
  erc8004Middleware,
  type PaymentRequirement,
  type ProtocolMiddlewareConfig,
  type SkillResult,
} from './middleware'

// Zod schema for recursive ProtocolValue type
const ProtocolValueSchema: z.ZodType<ProtocolValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(ProtocolValueSchema),
    z.record(z.string(), ProtocolValueSchema),
  ]),
)

const A2AMessagePartSchema = z.object({
  kind: z.string(),
  text: z.string().optional(),
  data: z.record(z.string(), ProtocolValueSchema).optional(),
})

const A2ARequestSchema = z.object({
  jsonrpc: z.string(),
  method: z.string(),
  params: z
    .object({
      message: z
        .object({
          messageId: z.string(),
          parts: z.array(A2AMessagePartSchema),
        })
        .optional(),
    })
    .optional(),
  id: z.union([z.number(), z.string(), z.null()]),
})

const MCPResourceReadSchema = z.object({
  uri: z.string(),
})

const MCPToolCallSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), ProtocolValueSchema),
})

const MCPPromptGetSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.string()),
})

// Type-safe context variable mapping for Hono context
// Defines the specific keys and their types that we use in middleware
type ContextVarTypes = {
  userAddress: Address
  agentInfo: AgentInfo
  paymentVerified: boolean
}

type ContextKey = keyof ContextVarTypes

function getContextVar<K extends ContextKey>(
  c: Context,
  key: K,
): ContextVarTypes[K] | undefined {
  // Hono's context.get returns the value or undefined
  // We cast to the specific type based on the key
  return c.get(key as string) as ContextVarTypes[K] | undefined
}

// ============================================================================
// Types
// ============================================================================

export interface A2ASkill {
  id: string
  name: string
  description: string
  tags: string[]
  examples?: string[]
  inputSchema?: {
    type: string
    properties: Record<
      string,
      { type: string; description?: string; enum?: string[] }
    >
    required?: string[]
  }
}

// Note: For AgentCard type, import from './a2a' or use the re-export from protocols/index

export interface MCPResource {
  uri: string
  name: string
  description: string
  mimeType?: string
}

export interface MCPTool {
  name: string
  description: string
  inputSchema: {
    type: string
    properties: Record<
      string,
      { type: string; description?: string; enum?: string[] }
    >
    required?: string[]
  }
}

export interface MCPPrompt {
  name: string
  description: string
  arguments: Array<{ name: string; description: string; required?: boolean }>
}

export interface UnifiedServerConfig {
  name: string
  description: string
  version?: string
  port?: number

  // Protocol configurations
  skills: A2ASkill[]
  resources?: MCPResource[]
  tools?: MCPTool[]
  prompts?: MCPPrompt[]

  // Handlers
  executeSkill: (
    skillId: string,
    params: ProtocolData,
    context: SkillContext,
  ) => Promise<SkillResult>
  readResource?: (uri: string, context: SkillContext) => Promise<ProtocolValue>
  callTool?: (
    name: string,
    args: ProtocolData,
    context: SkillContext,
  ) => Promise<{ result: ProtocolValue; isError: boolean }>
  getPrompt?: (
    name: string,
    args: Record<string, string>,
    context: SkillContext,
  ) => Promise<MCPPromptResult>

  // REST routes (optional)
  setupREST?: (app: Hono) => void

  // Middleware configuration
  middleware?: ProtocolMiddlewareConfig

  // Server mode
  mode?: 'server' | 'serverless' | 'auto'
}

export interface SkillContext {
  address: Address | null
  agentInfo: AgentInfo | null
  paymentHeader: string | null
  paymentVerified: boolean
}

interface AgentInfo {
  agentId: bigint
  owner: Address
  name: string
  active: boolean
  banned: boolean
}

interface MCPPromptResult {
  messages: Array<{ role: string; content: { type: string; text: string } }>
}

// ============================================================================
// Server Factory
// ============================================================================

export function createUnifiedServer(config: UnifiedServerConfig): Hono {
  const app = new Hono()

  // Configure middleware if provided
  if (config.middleware) {
    configureProtocolMiddleware(config.middleware)
  }

  // CORS
  app.use(
    '/*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowHeaders: [
        'Content-Type',
        'Authorization',
        'X-Payment',
        'x-jeju-address',
        'x-jeju-timestamp',
        'x-jeju-signature',
      ],
    }),
  )

  // ========== A2A Protocol ==========

  const agentCard = createAgentCard(config)

  app.get('/.well-known/agent-card.json', (c) => c.json(agentCard))
  app.get('/a2a/.well-known/agent-card.json', (c) => c.json(agentCard))

  app.post('/a2a', erc8004Middleware(), async (c) => {
    const rawBody = await c.req.json()
    const parseResult = A2ARequestSchema.safeParse(rawBody)

    if (!parseResult.success) {
      return c.json(
        {
          jsonrpc: '2.0',
          id: 0,
          error: { code: -32600, message: 'Invalid request format' },
        },
        400,
      )
    }

    const body = parseResult.data

    if (body.method !== 'message/send') {
      return c.json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32601, message: 'Method not found' },
      })
    }

    const message = body.params?.message
    if (!message?.parts) {
      return c.json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32602, message: 'Invalid params' },
      })
    }

    const dataPart = message.parts.find((p) => p.kind === 'data')
    if (!dataPart?.data) {
      return c.json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32602, message: 'No data part found' },
      })
    }

    const skillId = dataPart.data.skillId as string
    if (!skillId) {
      return c.json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32602, message: 'No skillId specified' },
      })
    }

    const context: SkillContext = {
      address: getContextVar(c, 'userAddress') ?? null,
      agentInfo: getContextVar(c, 'agentInfo') ?? null,
      paymentHeader: c.req.header('x-payment') || null,
      paymentVerified: Boolean(getContextVar(c, 'paymentVerified')),
    }

    const result = await config.executeSkill(skillId, dataPart.data, context)

    if (result.requiresPayment) {
      return c.json(
        {
          jsonrpc: '2.0',
          id: body.id,
          error: {
            code: 402,
            message: 'Payment Required',
            data: result.requiresPayment,
          },
        },
        402,
      )
    }

    return c.json({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        role: 'agent',
        parts: [
          { kind: 'text', text: result.message },
          { kind: 'data', data: result.data },
        ],
        messageId: message.messageId,
        kind: 'message',
      },
    })
  })

  // ========== MCP Protocol ==========

  const mcpServerInfo = {
    name: config.name,
    version: config.version || '1.0.0',
    description: config.description,
    capabilities: {
      resources: (config.resources?.length ?? 0) > 0,
      tools: (config.tools?.length ?? 0) > 0,
      prompts: (config.prompts?.length ?? 0) > 0,
    },
  }

  app.post('/mcp/initialize', (c) =>
    c.json({
      protocolVersion: '2024-11-05',
      serverInfo: mcpServerInfo,
      capabilities: mcpServerInfo.capabilities,
    }),
  )

  app.post('/mcp/resources/list', (c) =>
    c.json({
      resources: config.resources ?? [],
    }),
  )

  app.post('/mcp/resources/read', erc8004Middleware(), async (c) => {
    if (!config.readResource) {
      return c.json({ error: 'Resources not supported' }, 404)
    }

    const rawBody = await c.req.json()
    const parseResult = MCPResourceReadSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return c.json({ error: 'Invalid request: uri required' }, 400)
    }

    const { uri } = parseResult.data
    const context: SkillContext = {
      address: getContextVar(c, 'userAddress') ?? null,
      agentInfo: getContextVar(c, 'agentInfo') ?? null,
      paymentHeader: c.req.header('x-payment') || null,
      paymentVerified: Boolean(getContextVar(c, 'paymentVerified')),
    }

    const contents = await config.readResource(uri, context)
    const resource = config.resources?.find((r) => r.uri === uri)

    return c.json({
      contents: [
        {
          uri,
          mimeType: resource?.mimeType || 'application/json',
          text: JSON.stringify(contents, null, 2),
        },
      ],
    })
  })

  app.post('/mcp/tools/list', (c) =>
    c.json({
      tools: config.tools ?? [],
    }),
  )

  app.post('/mcp/tools/call', erc8004Middleware(), async (c) => {
    if (!config.callTool) {
      return c.json({
        content: [{ type: 'text', text: 'Tools not supported' }],
        isError: true,
      })
    }

    const rawBody = await c.req.json()
    const parseResult = MCPToolCallSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return c.json(
        {
          content: [
            {
              type: 'text',
              text: 'Invalid request: name and arguments required',
            },
          ],
          isError: true,
        },
        400,
      )
    }

    const { name, arguments: args } = parseResult.data
    const context: SkillContext = {
      address: getContextVar(c, 'userAddress') ?? null,
      agentInfo: getContextVar(c, 'agentInfo') ?? null,
      paymentHeader: c.req.header('x-payment') || null,
      paymentVerified: Boolean(getContextVar(c, 'paymentVerified')),
    }

    const { result, isError } = await config.callTool(name, args, context)

    return c.json({
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError,
    })
  })

  if (config.prompts?.length) {
    app.post('/mcp/prompts/list', (c) =>
      c.json({
        prompts: config.prompts,
      }),
    )

    app.post('/mcp/prompts/get', erc8004Middleware(), async (c) => {
      if (!config.getPrompt) {
        return c.json({ error: 'Prompts not configured' }, 404)
      }

      const rawBody = await c.req.json()
      const parseResult = MCPPromptGetSchema.safeParse(rawBody)
      if (!parseResult.success) {
        return c.json(
          { error: 'Invalid request: name and arguments required' },
          400,
        )
      }

      const { name, arguments: args } = parseResult.data
      const context: SkillContext = {
        address: getContextVar(c, 'userAddress') ?? null,
        agentInfo: getContextVar(c, 'agentInfo') ?? null,
        paymentHeader: c.req.header('x-payment') || null,
        paymentVerified: Boolean(getContextVar(c, 'paymentVerified')),
      }

      const result = await config.getPrompt(name, args, context)
      return c.json(result)
    })
  }

  // MCP info endpoint
  app.get('/mcp', (c) =>
    c.json({
      server: mcpServerInfo.name,
      version: mcpServerInfo.version,
      description: mcpServerInfo.description,
      resources: config.resources ?? [],
      tools: config.tools ?? [],
      prompts: config.prompts ?? [],
      capabilities: mcpServerInfo.capabilities,
    }),
  )

  // ========== REST API ==========

  if (config.setupREST) {
    const apiRouter = new Hono()
    config.setupREST(apiRouter)
    app.route('/api', apiRouter)
  }

  // ========== Health & Info ==========

  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      service: config.name,
      version: config.version || '1.0.0',
      timestamp: Date.now(),
    }),
  )

  app.get('/', (c) =>
    c.json({
      name: getServiceName(config.name),
      description: config.description,
      version: config.version || '1.0.0',
      endpoints: {
        a2a: '/a2a',
        mcp: '/mcp',
        api: config.setupREST ? '/api' : undefined,
        health: '/health',
        agentCard: '/.well-known/agent-card.json',
      },
      skills: config.skills.map((s) => s.id),
      resources: config.resources?.map((r) => r.uri),
      tools: config.tools?.map((t) => t.name),
    }),
  )

  return app
}

// ============================================================================
// Agent Card Generator
// ============================================================================

interface GeneratedAgentCard {
  protocolVersion: string
  name: string
  description: string
  url: string
  preferredTransport: string
  provider: { organization: string; url: string }
  version: string
  capabilities: {
    streaming: boolean
    pushNotifications: boolean
    stateTransitionHistory: boolean
  }
  defaultInputModes: string[]
  defaultOutputModes: string[]
  skills: A2ASkill[]
}

function createAgentCard(config: UnifiedServerConfig): GeneratedAgentCard {
  const provider = getProviderInfo()

  return {
    protocolVersion: '0.3.0',
    name: getServiceName(config.name),
    description: config.description,
    url: '/a2a',
    preferredTransport: 'http',
    provider,
    version: config.version || '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text', 'data'],
    defaultOutputModes: ['text', 'data'],
    skills: config.skills,
  }
}

// ============================================================================
// Server Starter
// ============================================================================

export interface ServerInstance {
  app: Hono
  port: number
  url: string
  stop: () => void
}

export async function startServer(
  config: UnifiedServerConfig,
): Promise<ServerInstance> {
  const app = createUnifiedServer(config)
  const port = config.port || 4000

  const server = Bun.serve({
    port,
    fetch: app.fetch,
  })

  const url = `http://localhost:${port}`

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  ${getServiceName(config.name).padEnd(56)}  ║
╠══════════════════════════════════════════════════════════════╣
║  A2A:          ${(`${url}/a2a`).padEnd(43)}  ║
║  MCP:          ${(`${url}/mcp`).padEnd(43)}  ║
║  Health:       ${(`${url}/health`).padEnd(43)}  ║
║  Agent Card:   ${(`${url}/.well-known/agent-card.json`).padEnd(43)}  ║
╚══════════════════════════════════════════════════════════════╝
`)

  return {
    app,
    port,
    url,
    stop: () => server.stop(),
  }
}

// ============================================================================
// Serverless Export Helper
// ============================================================================

export function createServerlessHandler(config: UnifiedServerConfig): {
  fetch: (request: Request) => Response | Promise<Response>
} {
  const app = createUnifiedServer(config)
  return { fetch: app.fetch }
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type { SkillResult, PaymentRequirement }
export {
  configureX402,
  skillError,
  skillRequiresPayment,
  skillSuccess,
} from './middleware'
