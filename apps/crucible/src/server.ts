/**
 * Crucible API Server
 * REST API for agent management, room coordination, and execution.
 *
 * Fully decentralized - all AI inference goes through DWS compute network.
 * Uses @jejunetwork/eliza-plugin for 60+ network actions.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { localhost, mainnet, sepolia } from 'viem/chains'
import { z } from 'zod'
import { BotInitializer } from './bots/initializer'
import type { TradingBot } from './bots/trading-bot'
import { characters, getCharacter, listCharacters } from './characters'
import { banCheckMiddleware } from './middleware/ban-check'
import {
  AddMemoryRequestSchema,
  AgentIdParamSchema,
  AgentSearchQuerySchema,
  BotIdParamSchema,
  CreateRoomRequestSchema,
  ExecuteRequestSchema,
  expect,
  FundAgentRequestSchema,
  JoinRoomRequestSchema,
  LeaveRoomRequestSchema,
  PostMessageRequestSchema,
  parseOrThrow,
  RegisterAgentRequestSchema,
  RoomIdParamSchema,
  SetPhaseRequestSchema,
} from './schemas'
import { createAgentSDK } from './sdk/agent'
import { createCompute } from './sdk/compute'
import {
  checkDWSHealth,
  type RuntimeMessage,
  runtimeManager,
} from './sdk/eliza-runtime'
import { createExecutorSDK } from './sdk/executor'
import { createLogger } from './sdk/logger'
import { createRoomSDK } from './sdk/room'
import { createStorage } from './sdk/storage'
import type { CrucibleConfig, ExecutionRequest } from './types'

const log = createLogger('Server')

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns true only if both strings are identical.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to avoid timing leak on length check
    let xor = 0
    for (let i = 0; i < a.length; i++) {
      xor |= a.charCodeAt(i) ^ (b.charCodeAt(i % b.length) || 0)
    }
    return xor === 0 && false // Always false for length mismatch, but use xor to prevent optimization
  }
  let xor = 0
  for (let i = 0; i < a.length; i++) {
    xor |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return xor === 0
}

// Metrics tracking
const metrics = {
  requests: { total: 0, success: 0, error: 0 },
  agents: { registered: 0, executions: 0 },
  rooms: { created: 0, messages: 0 },
  latency: { sum: 0, count: 0 },
  startTime: Date.now(),
}

// Rate limiting configuration
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute
const RATE_LIMIT_MAX_REQUESTS = parseInt(
  process.env.RATE_LIMIT_MAX_REQUESTS ?? '100',
  10,
)

// CORS configuration - restrict to allowed origins
const ALLOWED_ORIGINS = (
  process.env.CORS_ALLOWED_ORIGINS ??
  'http://localhost:3000,http://localhost:4000'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

// API key for authenticated endpoints
const API_KEY = process.env.API_KEY
const REQUIRE_AUTH = process.env.REQUIRE_AUTH === 'true'

// Paths that don't require authentication
const PUBLIC_PATHS = ['/health', '/metrics', '/.well-known']

// Paths that don't require rate limiting
const RATE_LIMIT_EXEMPT_PATHS = ['/health', '/metrics']

function getRequiredEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`)
  }
  return value
}

function getRequiredAddress(key: string): `0x${string}` {
  const value = getRequiredEnv(key)
  if (!value.startsWith('0x') || value.length !== 42) {
    throw new Error(
      `Environment variable ${key} must be a valid Ethereum address`,
    )
  }
  return value as `0x${string}`
}

function getNetwork(): 'localnet' | 'testnet' | 'mainnet' {
  const network = process.env.NETWORK
  if (!network) {
    throw new Error(
      'NETWORK environment variable is required (localnet, testnet, or mainnet)',
    )
  }
  if (
    network !== 'localnet' &&
    network !== 'testnet' &&
    network !== 'mainnet'
  ) {
    throw new Error(
      `Invalid NETWORK: ${network}. Must be one of: localnet, testnet, mainnet`,
    )
  }
  return network
}

const config: CrucibleConfig = {
  rpcUrl: getRequiredEnv('RPC_URL'),
  privateKey: process.env.PRIVATE_KEY,
  contracts: {
    agentVault: getRequiredAddress('AGENT_VAULT_ADDRESS'),
    roomRegistry: getRequiredAddress('ROOM_REGISTRY_ADDRESS'),
    triggerRegistry: getRequiredAddress('TRIGGER_REGISTRY_ADDRESS'),
    identityRegistry: getRequiredAddress('IDENTITY_REGISTRY_ADDRESS'),
    serviceRegistry: getRequiredAddress('SERVICE_REGISTRY_ADDRESS'),
    autocratTreasury: process.env.AUTOCRAT_TREASURY_ADDRESS as
      | `0x${string}`
      | undefined,
  },
  services: {
    computeMarketplace: getRequiredEnv('COMPUTE_MARKETPLACE_URL'),
    storageApi: getRequiredEnv('STORAGE_API_URL'),
    ipfsGateway: getRequiredEnv('IPFS_GATEWAY'),
    indexerGraphql: getRequiredEnv('INDEXER_GRAPHQL_URL'),
    cqlEndpoint: process.env.CQL_ENDPOINT,
    dexCacheUrl: process.env.DEX_CACHE_URL,
  },
  network: getNetwork(),
}

const chain =
  config.network === 'mainnet'
    ? mainnet
    : config.network === 'testnet'
      ? sepolia
      : localhost

const publicClient = createPublicClient({
  chain,
  transport: http(config.rpcUrl),
})

const account = config.privateKey
  ? privateKeyToAccount(config.privateKey as `0x${string}`)
  : undefined

const walletClient = account
  ? createWalletClient({
      account,
      chain,
      transport: http(config.rpcUrl),
    })
  : undefined

const storage = createStorage({
  apiUrl: config.services.storageApi,
  ipfsGateway: config.services.ipfsGateway,
})

const compute = createCompute({
  marketplaceUrl: config.services.computeMarketplace,
  rpcUrl: config.rpcUrl,
  defaultModel: 'llama-3.1-8b',
})

const agentSdk = createAgentSDK({
  crucibleConfig: config,
  storage,
  compute,
  publicClient,
  walletClient,
})

const roomSdk = createRoomSDK({
  crucibleConfig: config,
  storage,
  publicClient,
  walletClient,
})

// Bot initialization
let botInitializer: BotInitializer | null = null
let tradingBots: Map<bigint, TradingBot> = new Map()

if (config.privateKey && walletClient) {
  botInitializer = new BotInitializer({
    crucibleConfig: config,
    agentSdk,
    publicClient,
    walletClient,
    treasuryAddress: config.contracts.autocratTreasury,
  })

  if (process.env.BOTS_ENABLED !== 'false') {
    botInitializer
      .initializeDefaultBots()
      .then((bots) => {
        tradingBots = bots
        log.info('Default bots initialized', { count: bots.size })
      })
      .catch((err) =>
        log.error('Failed to initialize default bots', { error: String(err) }),
      )
  }
}

const app = new Hono()

// Middleware
// CORS - restrict to configured origins in production
// SECURITY: Wildcard '*' is ONLY honored in localnet to prevent misconfiguration
app.use(
  '*',
  cors({
    origin: (origin) => {
      // In development (localnet), allow all origins including wildcard
      if (config.network === 'localnet') return origin
      // In production/testnet, NEVER allow wildcard - explicit origins only
      if (!origin) return null
      if (ALLOWED_ORIGINS.includes(origin)) return origin
      // Log rejected origins for debugging (but don't expose in response)
      if (origin && !ALLOWED_ORIGINS.includes('*')) {
        log.debug('CORS rejected origin', { origin, allowed: ALLOWED_ORIGINS })
      }
      return null
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-Wallet-Address',
    ],
    maxAge: 86400,
  }),
)

app.use('*', logger())

// Rate limiting middleware with atomic increment pattern
app.use('*', async (c, next) => {
  const path = c.req.path

  // Skip rate limiting for exempt paths
  if (RATE_LIMIT_EXEMPT_PATHS.some((p) => path.startsWith(p))) {
    return next()
  }

  // Use IP or wallet address as rate limit key
  const clientIp =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    'unknown'
  const walletAddress = c.req.header('x-wallet-address') ?? ''
  const key = walletAddress || clientIp

  const now = Date.now()

  // Clean up old entries periodically (limit cleanup frequency)
  if (rateLimitStore.size > 10000) {
    const keysToDelete: string[] = []
    for (const [k, v] of rateLimitStore) {
      if (v.resetAt < now) keysToDelete.push(k)
      if (keysToDelete.length >= 5000) break // Limit cleanup batch size
    }
    for (const k of keysToDelete) {
      rateLimitStore.delete(k)
    }
  }

  // Atomic check-and-increment pattern
  let record = rateLimitStore.get(key)

  if (!record || record.resetAt < now) {
    // Create new record atomically
    record = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS }
    rateLimitStore.set(key, record)
  } else {
    // Increment count atomically before checking limit
    record.count++

    if (record.count > RATE_LIMIT_MAX_REQUESTS) {
      c.header('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS.toString())
      c.header('X-RateLimit-Remaining', '0')
      c.header('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000).toString())
      return c.json({ error: 'Rate limit exceeded' }, 429)
    }
  }

  c.header('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS.toString())
  c.header(
    'X-RateLimit-Remaining',
    Math.max(0, RATE_LIMIT_MAX_REQUESTS - record.count).toString(),
  )
  c.header('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000).toString())

  return next()
})

// API Key authentication middleware (when enabled)
app.use('*', async (c, next) => {
  const path = c.req.path

  // Skip auth for public paths
  if (PUBLIC_PATHS.some((p) => path.startsWith(p))) {
    return next()
  }

  // Skip auth if not required
  if (!REQUIRE_AUTH || !API_KEY) {
    return next()
  }

  const providedKey =
    c.req.header('x-api-key') ??
    c.req.header('authorization')?.replace('Bearer ', '')

  if (!providedKey || !constantTimeCompare(providedKey, API_KEY)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  return next()
})

app.use('*', banCheckMiddleware()) // Ban check - blocks banned users
app.use('*', async (c, next) => {
  const start = Date.now()
  metrics.requests.total++
  await next()
  const duration = Date.now() - start
  metrics.latency.sum += duration
  metrics.latency.count++
  if (c.res.status >= 400) metrics.requests.error++
  else metrics.requests.success++
})

// Health & Info
app.get('/health', (c) =>
  c.json({
    status: 'healthy',
    service: 'crucible',
    network: config.network,
    timestamp: new Date().toISOString(),
  }),
)

app.get('/info', async (c) => {
  const dwsAvailable = await checkDWSHealth()

  // Check if request is authenticated (has valid API key)
  const providedKey =
    c.req.header('x-api-key') ??
    c.req.header('authorization')?.replace('Bearer ', '')
  const isAuthenticated = API_KEY && providedKey === API_KEY

  // Basic info for unauthenticated requests
  const basicInfo = {
    service: 'crucible',
    version: '1.0.0',
    network: config.network,
    hasWallet: !!walletClient,
    dwsAvailable,
    runtimes: runtimeManager.getAllRuntimes().length,
  }

  // Return full info only for authenticated requests
  if (isAuthenticated) {
    return c.json({
      ...basicInfo,
      contracts: config.contracts,
      services: config.services,
    })
  }

  return c.json(basicInfo)
})

// ============================================================================
// Agent Chat API - ElizaOS + @jejunetwork/eliza-plugin (60+ actions)
// ============================================================================

// Chat with an agent
app.post('/api/v1/chat/:characterId', async (c) => {
  const characterId = c.req.param('characterId')
  const character = getCharacter(characterId)

  if (!character) {
    return c.json({ error: `Character not found: ${characterId}` }, 404)
  }

  const body = (await c.req.json()) as {
    text: string
    userId?: string
    roomId?: string
  }

  if (!body.text) {
    return c.json({ error: 'Missing text field' }, 400)
  }

  // Get or create runtime for this character
  let runtime = runtimeManager.getRuntime(characterId)
  if (!runtime) {
    runtime = await runtimeManager.createRuntime({
      agentId: characterId,
      character,
    })
  }

  const message: RuntimeMessage = {
    id: crypto.randomUUID(),
    userId: body.userId ?? 'anonymous',
    roomId: body.roomId ?? 'default',
    content: { text: body.text, source: 'api' },
    createdAt: Date.now(),
  }

  const response = await runtime.processMessage(message)
  metrics.agents.executions++

  return c.json({
    text: response.text,
    action: response.action,
    actions: response.actions,
    character: characterId,
  })
})

// List available characters with runtime status
app.get('/api/v1/chat/characters', async (c) => {
  const characterList = listCharacters().map((id) => {
    const char = getCharacter(id)
    const runtime = runtimeManager.getRuntime(id)
    return {
      id,
      name: char?.name,
      description: char?.description,
      hasRuntime: !!runtime,
    }
  })
  return c.json({ characters: characterList })
})

// Initialize all character runtimes
app.post('/api/v1/chat/init', async (c) => {
  const results: Record<string, { success: boolean; error?: string }> = {}

  for (const [id, character] of Object.entries(characters)) {
    try {
      await runtimeManager.createRuntime({
        agentId: id,
        character,
      })
      results[id] = { success: true }
    } catch (e) {
      results[id] = {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  }

  return c.json({
    initialized: Object.values(results).filter((r) => r.success).length,
    total: Object.keys(characters).length,
    results,
  })
})

// Prometheus Metrics
app.get('/metrics', (c) => {
  const uptimeSeconds = Math.floor((Date.now() - metrics.startTime) / 1000)
  const avgLatency =
    metrics.latency.count > 0 ? metrics.latency.sum / metrics.latency.count : 0

  const lines = [
    '# HELP crucible_requests_total Total HTTP requests',
    '# TYPE crucible_requests_total counter',
    `crucible_requests_total{status="success"} ${metrics.requests.success}`,
    `crucible_requests_total{status="error"} ${metrics.requests.error}`,
    '',
    '# HELP crucible_agents_registered_total Total agents registered',
    '# TYPE crucible_agents_registered_total counter',
    `crucible_agents_registered_total ${metrics.agents.registered}`,
    '',
    '# HELP crucible_agent_executions_total Total agent executions',
    '# TYPE crucible_agent_executions_total counter',
    `crucible_agent_executions_total ${metrics.agents.executions}`,
    '',
    '# HELP crucible_rooms_created_total Total rooms created',
    '# TYPE crucible_rooms_created_total counter',
    `crucible_rooms_created_total ${metrics.rooms.created}`,
    '',
    '# HELP crucible_room_messages_total Total room messages',
    '# TYPE crucible_room_messages_total counter',
    `crucible_room_messages_total ${metrics.rooms.messages}`,
    '',
    '# HELP crucible_request_latency_avg_ms Average request latency in milliseconds',
    '# TYPE crucible_request_latency_avg_ms gauge',
    `crucible_request_latency_avg_ms ${avgLatency.toFixed(2)}`,
    '',
    '# HELP crucible_uptime_seconds Server uptime in seconds',
    '# TYPE crucible_uptime_seconds gauge',
    `crucible_uptime_seconds ${uptimeSeconds}`,
    '',
    '# HELP crucible_info Service info',
    '# TYPE crucible_info gauge',
    `crucible_info{version="1.0.0",network="${config.network}"} 1`,
    '',
  ]

  c.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  return c.text(lines.join('\n'))
})

// Character Templates
app.get('/api/v1/characters', (c) => {
  const characterList = listCharacters()
    .map((id) => {
      const char = getCharacter(id)
      return char
        ? { id: char.id, name: char.name, description: char.description }
        : null
    })
    .filter(Boolean)
  return c.json({ characters: characterList })
})

app.get('/api/v1/characters/:id', (c) => {
  const id = c.req.param('id')
  expect(id, 'Character ID is required')
  const character = expect(getCharacter(id), `Character not found: ${id}`)
  return c.json({ character })
})

// Agent Management
app.post('/api/v1/agents', async (c) => {
  const rawBody = await c.req.json()
  const body = parseOrThrow(
    RegisterAgentRequestSchema,
    rawBody,
    'Register agent request',
  )
  log.info('Registering agent', { name: body.character.name })

  const result = await agentSdk.registerAgent(body.character, {
    initialFunding: body.initialFunding
      ? BigInt(body.initialFunding)
      : undefined,
  })
  metrics.agents.registered++

  return c.json({
    agentId: result.agentId.toString(),
    vaultAddress: result.vaultAddress,
    characterCid: result.characterCid,
    stateCid: result.stateCid,
  })
})

app.get('/api/v1/agents/:agentId', async (c) => {
  const params = parseOrThrow(
    AgentIdParamSchema,
    c.req.param(),
    'Agent ID parameter',
  )
  const agentId = BigInt(params.agentId)
  const agent = await agentSdk.getAgent(agentId)
  const validAgent = expect(agent, `Agent not found: ${params.agentId}`)
  return c.json({
    agent: { ...validAgent, agentId: validAgent.agentId.toString() },
  })
})

app.get('/api/v1/agents/:agentId/character', async (c) => {
  const params = parseOrThrow(
    AgentIdParamSchema,
    c.req.param(),
    'Agent ID parameter',
  )
  try {
    const character = await agentSdk.loadCharacter(BigInt(params.agentId))
    return c.json({ character })
  } catch (error) {
    return c.json({ error: String(error) }, 404)
  }
})

app.get('/api/v1/agents/:agentId/state', async (c) => {
  const params = parseOrThrow(
    AgentIdParamSchema,
    c.req.param(),
    'Agent ID parameter',
  )
  const state = await agentSdk.loadState(BigInt(params.agentId))
  return c.json({ state })
})

app.get('/api/v1/agents/:agentId/balance', async (c) => {
  const params = parseOrThrow(
    AgentIdParamSchema,
    c.req.param(),
    'Agent ID parameter',
  )
  const balance = await agentSdk.getVaultBalance(BigInt(params.agentId))
  return c.json({ balance: balance.toString() })
})

app.post('/api/v1/agents/:agentId/fund', async (c) => {
  const params = parseOrThrow(
    AgentIdParamSchema,
    c.req.param(),
    'Agent ID parameter',
  )
  const rawBody = await c.req.json()
  const body = parseOrThrow(
    FundAgentRequestSchema,
    rawBody,
    'Fund agent request',
  )
  const agentId = BigInt(params.agentId)
  try {
    const txHash = await agentSdk.fundVault(agentId, BigInt(body.amount))
    return c.json({ txHash })
  } catch (error) {
    return c.json({ error: String(error) }, 400)
  }
})

app.post('/api/v1/agents/:agentId/memory', async (c) => {
  const params = parseOrThrow(
    AgentIdParamSchema,
    c.req.param(),
    'Agent ID parameter',
  )
  const rawBody = await c.req.json()
  const body = parseOrThrow(
    AddMemoryRequestSchema,
    rawBody,
    'Add memory request',
  )
  const agentId = BigInt(params.agentId)
  const memory = await agentSdk.addMemory(agentId, body.content, {
    importance: body.importance,
    roomId: body.roomId,
    userId: body.userId,
  })
  return c.json({ memory })
})

// Room Management
app.post('/api/v1/rooms', async (c) => {
  const rawBody = await c.req.json()
  const body = parseOrThrow(
    CreateRoomRequestSchema,
    rawBody,
    'Create room request',
  )
  log.info('Creating room', { name: body.name, roomType: body.roomType })

  const result = await roomSdk.createRoom(
    body.name,
    body.description,
    body.roomType,
    {
      maxMembers: body.config?.maxMembers ?? 10,
      turnBased: body.config?.turnBased ?? false,
      turnTimeout: body.config?.turnTimeout ?? 300,
      visibility: 'public' as const,
    },
  )
  metrics.rooms.created++

  return c.json({ roomId: result.roomId.toString(), stateCid: result.stateCid })
})

app.get('/api/v1/rooms/:roomId', async (c) => {
  const params = parseOrThrow(
    RoomIdParamSchema,
    c.req.param(),
    'Room ID parameter',
  )
  const room = await roomSdk.getRoom(BigInt(params.roomId))
  const validRoom = expect(room, `Room not found: ${params.roomId}`)
  return c.json({
    room: {
      ...validRoom,
      roomId: validRoom.roomId.toString(),
      members: validRoom.members.map((m) => ({
        ...m,
        agentId: m.agentId.toString(),
      })),
    },
  })
})

app.post('/api/v1/rooms/:roomId/join', async (c) => {
  const params = parseOrThrow(
    RoomIdParamSchema,
    c.req.param(),
    'Room ID parameter',
  )
  const rawBody = await c.req.json()
  const body = parseOrThrow(JoinRoomRequestSchema, rawBody, 'Join room request')
  await roomSdk.joinRoom(BigInt(params.roomId), BigInt(body.agentId), body.role)
  return c.json({ success: true })
})

app.post('/api/v1/rooms/:roomId/leave', async (c) => {
  const params = parseOrThrow(
    RoomIdParamSchema,
    c.req.param(),
    'Room ID parameter',
  )
  const rawBody = await c.req.json()
  const body = parseOrThrow(
    LeaveRoomRequestSchema,
    rawBody,
    'Leave room request',
  )
  await roomSdk.leaveRoom(BigInt(params.roomId), BigInt(body.agentId))
  return c.json({ success: true })
})

app.post('/api/v1/rooms/:roomId/message', async (c) => {
  const params = parseOrThrow(
    RoomIdParamSchema,
    c.req.param(),
    'Room ID parameter',
  )
  const rawBody = await c.req.json()
  const body = parseOrThrow(
    PostMessageRequestSchema,
    rawBody,
    'Post message request',
  )
  const message = await roomSdk.postMessage(
    BigInt(params.roomId),
    BigInt(body.agentId),
    body.content,
    body.action,
  )
  metrics.rooms.messages++
  return c.json({ message })
})

app.get('/api/v1/rooms/:roomId/messages', async (c) => {
  const params = parseOrThrow(
    RoomIdParamSchema,
    c.req.param(),
    'Room ID parameter',
  )
  const limitStr = c.req.query('limit')
  const limit = limitStr
    ? parseOrThrow(
        z.number().int().min(1).max(1000),
        parseInt(limitStr, 10),
        'Limit query parameter',
      )
    : 50
  try {
    const messages = await roomSdk.getMessages(BigInt(params.roomId), limit)
    return c.json({ messages })
  } catch (error) {
    return c.json({ error: String(error) }, 404)
  }
})

app.post('/api/v1/rooms/:roomId/phase', async (c) => {
  const params = parseOrThrow(
    RoomIdParamSchema,
    c.req.param(),
    'Room ID parameter',
  )
  const rawBody = await c.req.json()
  const body = parseOrThrow(SetPhaseRequestSchema, rawBody, 'Set phase request')
  await roomSdk.setPhase(BigInt(params.roomId), body.phase)
  return c.json({ success: true })
})

// Execution
app.post('/api/v1/execute', async (c) => {
  expect(
    walletClient && account,
    'Executor not configured - missing private key',
  )

  const rawBody = await c.req.json()
  const body = parseOrThrow(ExecuteRequestSchema, rawBody, 'Execute request')

  log.info('Executing agent', { agentId: body.agentId })

  const executorSdk = createExecutorSDK({
    crucibleConfig: config,
    storage,
    compute,
    agentSdk,
    roomSdk,
    publicClient,
    walletClient: expect(walletClient, 'Wallet client is required'),
    executorAddress: expect(account, 'Account is required').address,
  })

  const request: ExecutionRequest = {
    agentId: BigInt(body.agentId),
    triggerId: body.triggerId,
    input: body.input,
    options: body.options
      ? {
          ...body.options,
          maxCost: body.options.maxCost
            ? BigInt(body.options.maxCost)
            : undefined,
        }
      : undefined,
  }

  const result = await executorSdk.execute(request)
  metrics.agents.executions++

  return c.json({
    result: {
      ...result,
      agentId: result.agentId.toString(),
      cost: {
        ...result.cost,
        total: result.cost.total.toString(),
        inference: result.cost.inference.toString(),
        storage: result.cost.storage.toString(),
        executionFee: result.cost.executionFee.toString(),
      },
    },
  })
})

// Bot Management
app.get('/api/v1/bots', async (c) => {
  const bots = Array.from(tradingBots.entries()).map(([agentId, bot]) => ({
    agentId: agentId.toString(),
    metrics: bot.getMetrics(),
    healthy: bot.isHealthy(),
  }))
  return c.json({ bots })
})

app.get('/api/v1/bots/:agentId/metrics', async (c) => {
  const params = parseOrThrow(
    BotIdParamSchema,
    c.req.param(),
    'Bot ID parameter',
  )
  const agentId = BigInt(params.agentId)
  const bot = expect(
    tradingBots.get(agentId),
    `Bot not found: ${params.agentId}`,
  )
  return c.json({ metrics: bot.getMetrics() })
})

app.post('/api/v1/bots/:agentId/stop', async (c) => {
  const params = parseOrThrow(
    BotIdParamSchema,
    c.req.param(),
    'Bot ID parameter',
  )
  const agentId = BigInt(params.agentId)
  const bot = expect(
    tradingBots.get(agentId),
    `Bot not found: ${params.agentId}`,
  )
  await bot.stop()
  tradingBots.delete(agentId)
  return c.json({ success: true })
})

app.post('/api/v1/bots/:agentId/start', async (c) => {
  const params = parseOrThrow(
    BotIdParamSchema,
    c.req.param(),
    'Bot ID parameter',
  )
  const agentId = BigInt(params.agentId)
  const bot = expect(
    tradingBots.get(agentId),
    `Bot not found: ${params.agentId}`,
  )
  await bot.start()
  return c.json({ success: true })
})

// ============================================================================
// Autonomous Agents API
// ============================================================================

import { type AutonomousAgentRunner, createAgentRunner } from './autonomous'

// Global autonomous runner (started if AUTONOMOUS_ENABLED=true)
let autonomousRunner: AutonomousAgentRunner | null = null

if (process.env.AUTONOMOUS_ENABLED === 'true') {
  autonomousRunner = createAgentRunner({
    enableBuiltinCharacters: process.env.ENABLE_BUILTIN_CHARACTERS !== 'false',
    defaultTickIntervalMs: Number(process.env.TICK_INTERVAL_MS ?? 60_000),
    maxConcurrentAgents: Number(process.env.MAX_CONCURRENT_AGENTS ?? 10),
  })
  autonomousRunner
    .start()
    .then(() => {
      log.info('Autonomous agent runner started')
    })
    .catch((err) => {
      log.error('Failed to start autonomous runner', { error: String(err) })
    })
}

// Get autonomous runner status
app.get('/api/v1/autonomous/status', (c) => {
  if (!autonomousRunner) {
    return c.json({
      enabled: false,
      message:
        'Autonomous mode not enabled. Set AUTONOMOUS_ENABLED=true to enable.',
    })
  }
  return c.json({
    enabled: true,
    ...autonomousRunner.getStatus(),
  })
})

// Start autonomous runner (if not already running)
app.post('/api/v1/autonomous/start', async (c) => {
  if (!autonomousRunner) {
    autonomousRunner = createAgentRunner()
  }
  await autonomousRunner.start()
  return c.json({ success: true, status: autonomousRunner.getStatus() })
})

// Stop autonomous runner
app.post('/api/v1/autonomous/stop', async (c) => {
  if (!autonomousRunner) {
    return c.json({ success: false, message: 'Runner not started' }, 400)
  }
  await autonomousRunner.stop()
  return c.json({ success: true })
})

// Register an agent for autonomous mode
app.post('/api/v1/autonomous/agents', async (c) => {
  if (!autonomousRunner) {
    return c.json({ error: 'Autonomous runner not started' }, 400)
  }

  const body = (await c.req.json()) as {
    characterId: string
    tickIntervalMs?: number
    capabilities?: Record<string, boolean>
  }

  const character = getCharacter(body.characterId)
  if (!character) {
    return c.json({ error: `Character not found: ${body.characterId}` }, 404)
  }

  const { DEFAULT_AUTONOMOUS_CONFIG } = await import('./autonomous/types')

  await autonomousRunner.registerAgent({
    ...DEFAULT_AUTONOMOUS_CONFIG,
    agentId: `autonomous-${body.characterId}`,
    character,
    tickIntervalMs:
      body.tickIntervalMs ?? DEFAULT_AUTONOMOUS_CONFIG.tickIntervalMs,
    capabilities: body.capabilities
      ? {
          ...DEFAULT_AUTONOMOUS_CONFIG.capabilities,
          ...body.capabilities,
        }
      : DEFAULT_AUTONOMOUS_CONFIG.capabilities,
  })

  return c.json({ success: true, agentId: `autonomous-${body.characterId}` })
})

// Remove an agent from autonomous mode
app.delete('/api/v1/autonomous/agents/:agentId', (c) => {
  if (!autonomousRunner) {
    return c.json({ error: 'Autonomous runner not started' }, 400)
  }
  const agentId = c.req.param('agentId')
  autonomousRunner.unregisterAgent(agentId)
  return c.json({ success: true })
})

// Search
app.get('/api/v1/search/agents', async (c) => {
  try {
    const rawQuery = c.req.query()
    const parsedQuery = AgentSearchQuerySchema.parse(rawQuery)
    const result = await agentSdk.searchAgents({
      name: parsedQuery.name,
      owner: parsedQuery.owner as `0x${string}` | undefined,
      active: parsedQuery.active,
      limit: parsedQuery.limit ?? 20,
    })
    return c.json({
      agents: result.items.map((a) => ({
        ...a,
        agentId: a.agentId.toString(),
      })),
      total: result.total,
      hasMore: result.hasMore,
    })
  } catch (error) {
    return c.json({ error: String(error) }, 400)
  }
})

const portStr = process.env.PORT
if (!portStr) {
  throw new Error('PORT environment variable is required')
}
const port = parseInt(portStr, 10)
if (Number.isNaN(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT: ${portStr}. Must be a valid port number`)
}

// Mask wallet address in logs (show first 6 and last 4 chars)
const maskedWallet = account?.address
  ? `${account.address.slice(0, 6)}...${account.address.slice(-4)}`
  : 'not configured'
log.info('Starting server', {
  port,
  network: config.network,
  wallet: maskedWallet,
})

export default { port, fetch: app.fetch }
