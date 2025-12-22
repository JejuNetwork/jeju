/**
 * Protocol Server - REST, A2A, and MCP
 *
 * Creates a single Elysia app that exposes:
 * - REST API at /api/*
 * - A2A protocol at /a2a
 * - MCP protocol at /mcp
 *
 * Supports both server mode (Bun.serve) and serverless mode (export fetch handler).
 */

import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import { z } from 'zod'
import { getProviderInfo, getServiceName } from '../chains'
import { rateLimitMiddleware, securityMiddleware } from '../security-middleware'
import type { ProtocolData, ProtocolValue } from '../types'
import {
  type AgentInfo,
  configureProtocolMiddleware,
  configureX402,
  type ProtocolMiddlewareConfig,
  type SkillResult,
  skillError,
  skillRequiresPayment,
  skillSuccess,
  verifyERC8004Identity,
} from './middleware'

// Re-export helpers for convenience
export { configureX402, skillError, skillRequiresPayment, skillSuccess }

// Default allowed origins for CORS
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:4000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4000',
  'http://127.0.0.1:5173',
]

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

export interface ServerConfig {
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
  setupREST?: (app: Elysia) => void

  // Middleware configuration
  middleware?: ProtocolMiddlewareConfig

  // Server mode
  mode?: 'server' | 'serverless' | 'auto'

  // Security configuration
  security?: {
    /** Allowed CORS origins (default: localhost only in dev, none in prod) */
    allowedOrigins?: string[]
    /** Rate limit config (default: 100 requests per minute) */
    rateLimit?: { max: number; windowMs: number }
    /** Disable security headers (not recommended) */
    disableSecurityHeaders?: boolean
  }
}

export interface SkillContext {
  address: Address | null
  agentInfo: AgentInfo | null
  paymentHeader: string | null
  paymentVerified: boolean
}

interface MCPPromptResult {
  messages: Array<{ role: string; content: { type: string; text: string } }>
}

// ============================================================================
// Server Factory
// ============================================================================

export function createServer(config: ServerConfig) {
  // Configure middleware if provided
  if (config.middleware) {
    configureProtocolMiddleware(config.middleware)
  }

  const agentCard = createAgentCard(config)

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

  // Determine allowed origins
  const isProduction = process.env.NODE_ENV === 'production'
  const allowedOrigins =
    config.security?.allowedOrigins ??
    (isProduction ? [] : DEFAULT_ALLOWED_ORIGINS)

  const app = new Elysia()
    // Security middleware (headers, rate limiting)
    .use(
      config.security?.disableSecurityHeaders
        ? new Elysia()
        : securityMiddleware(),
    )
    .use(
      rateLimitMiddleware({
        max: config.security?.rateLimit?.max ?? 100,
        windowMs: config.security?.rateLimit?.windowMs ?? 60000,
      }),
    )
    .use(
      cors({
        origin: (request) => {
          const origin = request.headers.get('origin')
          // Allow requests without origin (same-origin/server-to-server)
          if (!origin) return true
          // Check against allowed origins
          if (allowedOrigins.includes(origin)) return true
          // In development, also allow any localhost
          if (
            !isProduction &&
            (origin.startsWith('http://localhost:') ||
              origin.startsWith('http://127.0.0.1:'))
          ) {
            return true
          }
          return false
        },
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: [
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
    .get('/.well-known/agent-card.json', () => agentCard)
    .get('/a2a/.well-known/agent-card.json', () => agentCard)

    // A2A endpoint
    .post('/a2a', async ({ body, headers, set }) => {
      // Verify ERC-8004 identity
      const identityContext = await verifyERC8004Identity(headers)

      if (identityContext.erc8004Error) {
        set.status = identityContext.userAddress ? 403 : 401
        return identityContext.erc8004Error
      }

      const parseResult = A2ARequestSchema.safeParse(body)

      if (!parseResult.success) {
        set.status = 400
        return {
          jsonrpc: '2.0',
          id: 0,
          error: { code: -32600, message: 'Invalid request format' },
        }
      }

      const requestBody = parseResult.data

      if (requestBody.method !== 'message/send') {
        return {
          jsonrpc: '2.0',
          id: requestBody.id,
          error: { code: -32601, message: 'Method not found' },
        }
      }

      const message = requestBody.params?.message
      if (!message?.parts) {
        return {
          jsonrpc: '2.0',
          id: requestBody.id,
          error: { code: -32602, message: 'Invalid params' },
        }
      }

      const dataPart = message.parts.find((p) => p.kind === 'data')
      if (!dataPart?.data) {
        return {
          jsonrpc: '2.0',
          id: requestBody.id,
          error: { code: -32602, message: 'No data part found' },
        }
      }

      const skillId = dataPart.data.skillId as string
      if (!skillId) {
        return {
          jsonrpc: '2.0',
          id: requestBody.id,
          error: { code: -32602, message: 'No skillId specified' },
        }
      }

      const context: SkillContext = {
        address: identityContext.userAddress,
        agentInfo: identityContext.agentInfo,
        paymentHeader: headers['x-payment'] || null,
        paymentVerified: false,
      }

      const result = await config.executeSkill(skillId, dataPart.data, context)

      if (result.requiresPayment) {
        set.status = 402
        return {
          jsonrpc: '2.0',
          id: requestBody.id,
          error: {
            code: 402,
            message: 'Payment Required',
            data: result.requiresPayment,
          },
        }
      }

      return {
        jsonrpc: '2.0',
        id: requestBody.id,
        result: {
          role: 'agent',
          parts: [
            { kind: 'text', text: result.message },
            { kind: 'data', data: result.data },
          ],
          messageId: message.messageId,
          kind: 'message',
        },
      }
    })

    // ========== MCP Protocol ==========
    .post('/mcp/initialize', () => ({
      protocolVersion: '2024-11-05',
      serverInfo: mcpServerInfo,
      capabilities: mcpServerInfo.capabilities,
    }))

    .post('/mcp/resources/list', () => ({
      resources: config.resources ?? [],
    }))

    .post('/mcp/resources/read', async ({ body, headers, set }) => {
      // Verify ERC-8004 identity
      const identityContext = await verifyERC8004Identity(headers)

      if (identityContext.erc8004Error) {
        set.status = identityContext.userAddress ? 403 : 401
        return identityContext.erc8004Error
      }

      if (!config.readResource) {
        set.status = 404
        return { error: 'Resources not supported' }
      }

      const parseResult = MCPResourceReadSchema.safeParse(body)
      if (!parseResult.success) {
        set.status = 400
        return { error: 'Invalid request: uri required' }
      }

      const { uri } = parseResult.data
      const context: SkillContext = {
        address: identityContext.userAddress,
        agentInfo: identityContext.agentInfo,
        paymentHeader: headers['x-payment'] || null,
        paymentVerified: false,
      }

      const contents = await config.readResource(uri, context)
      const resource = config.resources?.find((r) => r.uri === uri)

      return {
        contents: [
          {
            uri,
            mimeType: resource?.mimeType || 'application/json',
            text: JSON.stringify(contents, null, 2),
          },
        ],
      }
    })

    .post('/mcp/tools/list', () => ({
      tools: config.tools ?? [],
    }))

    .post('/mcp/tools/call', async ({ body, headers, set }) => {
      // Verify ERC-8004 identity
      const identityContext = await verifyERC8004Identity(headers)

      if (identityContext.erc8004Error) {
        set.status = identityContext.userAddress ? 403 : 401
        return identityContext.erc8004Error
      }

      if (!config.callTool) {
        return {
          content: [{ type: 'text', text: 'Tools not supported' }],
          isError: true,
        }
      }

      const parseResult = MCPToolCallSchema.safeParse(body)
      if (!parseResult.success) {
        set.status = 400
        return {
          content: [
            {
              type: 'text',
              text: 'Invalid request: name and arguments required',
            },
          ],
          isError: true,
        }
      }

      const { name, arguments: args } = parseResult.data
      const context: SkillContext = {
        address: identityContext.userAddress,
        agentInfo: identityContext.agentInfo,
        paymentHeader: headers['x-payment'] || null,
        paymentVerified: false,
      }

      const { result, isError } = await config.callTool(name, args, context)

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError,
      }
    })

    .post('/mcp/prompts/list', () => ({
      prompts: config.prompts ?? [],
    }))

    .post('/mcp/prompts/get', async ({ body, headers, set }) => {
      // Verify ERC-8004 identity
      const identityContext = await verifyERC8004Identity(headers)

      if (identityContext.erc8004Error) {
        set.status = identityContext.userAddress ? 403 : 401
        return identityContext.erc8004Error
      }

      if (!config.getPrompt) {
        set.status = 404
        return { error: 'Prompts not configured' }
      }

      const parseResult = MCPPromptGetSchema.safeParse(body)
      if (!parseResult.success) {
        set.status = 400
        return {
          error: 'Invalid request: name and arguments required',
        }
      }

      const { name, arguments: args } = parseResult.data
      const context: SkillContext = {
        address: identityContext.userAddress,
        agentInfo: identityContext.agentInfo,
        paymentHeader: headers['x-payment'] || null,
        paymentVerified: false,
      }

      const result = await config.getPrompt(name, args, context)
      return result
    })

    // MCP info endpoint
    .get('/mcp', () => ({
      server: mcpServerInfo.name,
      version: mcpServerInfo.version,
      description: mcpServerInfo.description,
      resources: config.resources ?? [],
      tools: config.tools ?? [],
      prompts: config.prompts ?? [],
      capabilities: mcpServerInfo.capabilities,
    }))

    // ========== Health & Info ==========
    .get('/health', () => ({
      status: 'ok',
      service: config.name,
      version: config.version || '1.0.0',
      timestamp: Date.now(),
    }))

    .get('/', () => ({
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
    }))

  // ========== REST API ==========
  if (config.setupREST) {
    const apiRouter = new Elysia()
    config.setupREST(apiRouter)
    app.group('/api', () => apiRouter)
  }

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

function createAgentCard(config: ServerConfig): GeneratedAgentCard {
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
  app: ReturnType<typeof createServer>
  port: number
  url: string
  stop: () => void
}

export async function startServer(
  config: ServerConfig,
): Promise<ServerInstance> {
  const app = createServer(config)
  const port = config.port || 4000

  const server = app.listen(port)

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

export function createServerlessHandler(config: ServerConfig): {
  fetch: (request: Request) => Response | Promise<Response>
} {
  const app = createServer(config)
  return { fetch: app.fetch }
}
