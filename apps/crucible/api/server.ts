/**
 * Crucible API Server
 * REST API for agent management, room coordination, and execution.
 *
 * All AI inference goes through DWS compute network.
 * Uses @jejunetwork/eliza-plugin for 60+ network actions.
 */

import { cors } from '@elysiajs/cors'
import {
  extractAuthHeaders,
  validateWalletSignatureFromHeaders,
  type WalletSignatureConfig,
} from '@jejunetwork/api'
import type { ContractCategoryName } from '@jejunetwork/config'
import {
  getCurrentNetwork,
  getEnvNumber,
  getEnvVar,
  getRpcUrl,
  getServicesConfig,
  getServiceUrl,
} from '@jejunetwork/config'
import type { JsonObject } from '@jejunetwork/types'
import { isHexString, isValidAddress } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { localhost, mainnet, sepolia } from 'viem/chains'
import { z } from 'zod'
import type {
  AgentCharacter,
  CrucibleConfig,
  ExecutionRequest,
} from '../lib/types'
import { DEFAULT_AUTONOMOUS_CONFIG } from './autonomous/types'
import { BotInitializer } from './bots/initializer'
import type { TradingBot } from './bots/trading-bot'
import { characters, getCharacter, listCharacters } from './characters'
import { checkDWSHealth } from './client/dws'
import { configureCrucible, config as crucibleConfig } from './config'
import { cronRoutes } from './cron'
import { banCheckMiddleware } from './middleware/ban-check'
import {
  AddMemoryRequestSchema,
  AgentIdParamSchema,
  AgentSearchQuerySchema,
  AgentStartRequestSchema,
  BotIdParamSchema,
  ChatRequestSchema,
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
import { type RuntimeMessage, runtimeManager } from './sdk/eliza-runtime'
import { createExecutorSDK } from './sdk/executor'
import { createKMSSigner, type KMSSigner } from './sdk/kms-signer'
import { createLogger } from './sdk/logger'
import { createRoomSDK } from './sdk/room'
import { createStorage } from './sdk/storage'

const log = createLogger('Server')

/**
 * Safely get contract address, returning undefined if not configured.
 * Used for optional contracts that may not be deployed yet.
 */
function getContractSafe(
  category: ContractCategoryName,
  name: string,
  _network: 'localnet' | 'testnet' | 'mainnet',
): `0x${string}` | undefined {
  // Check env var first
  const envKey = `${category.toUpperCase()}_${name.replace(/([A-Z])/g, '_$1').toUpperCase()}`
  const envVal = process.env[envKey]
  if (envVal && /^0x[a-fA-F0-9]{40}$/.test(envVal)) {
    return envVal as `0x${string}`
  }
  return undefined
}

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

// Wallet signature config for ownership verification
const walletSignatureConfig: WalletSignatureConfig = {
  domain: 'crucible.jeju.network',
  validityWindowMs: 5 * 60 * 1000, // 5 minutes
}

/**
 * Verify that the caller owns or controls the specified agent.
 * Requires cryptographic signature verification via x-jeju-* headers.
 * Server's own wallet is also authorized for automated operations.
 */
async function verifyAgentOwnership(
  agentId: bigint,
  request: Request,
  agentSdkInstance: ReturnType<typeof createAgentSDK>,
  serverAccount: { address: `0x${string}` } | null,
): Promise<{ authorized: boolean; reason?: string }> {
  // Extract and validate wallet signature from headers
  const headers = extractAuthHeaders(request.headers)
  const signatureResult = await validateWalletSignatureFromHeaders(
    headers,
    walletSignatureConfig,
  )

  if (!signatureResult.valid) {
    return {
      authorized: false,
      reason:
        signatureResult.error ??
        'Wallet signature verification failed. Required headers: x-jeju-address, x-jeju-timestamp, x-jeju-signature',
    }
  }

  const callerAddress = signatureResult.user?.address
  if (!callerAddress) {
    return {
      authorized: false,
      reason: 'Could not extract address from signature',
    }
  }

  // Get agent from SDK to check ownership
  const agent = await agentSdkInstance.getAgent(agentId)
  if (!agent) {
    return { authorized: false, reason: 'Agent not found' }
  }

  const callerLower = callerAddress.toLowerCase()
  const ownerLower = agent.owner.toLowerCase()

  // Check if caller is the owner
  if (callerLower === ownerLower) {
    return { authorized: true }
  }

  // Also allow the server's own wallet (for automated operations)
  if (serverAccount && callerLower === serverAccount.address.toLowerCase()) {
    return { authorized: true }
  }

  return { authorized: false, reason: 'Not authorized to modify this agent' }
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
const RATE_LIMIT_MAX_REQUESTS = crucibleConfig.rateLimitMaxRequests

// CORS configuration - restrict to allowed origins
const ALLOWED_ORIGINS = crucibleConfig.corsAllowedOrigins
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

// API key for authenticated endpoints
const API_KEY = crucibleConfig.apiKey
// Default to requiring auth on non-localnet (testnet/mainnet)
const NETWORK = crucibleConfig.network
const REQUIRE_AUTH = crucibleConfig.requireAuth

// Paths that don't require authentication
const PUBLIC_PATHS = ['/health', '/metrics', '/.well-known']

// Paths that don't require rate limiting
const RATE_LIMIT_EXEMPT_PATHS = ['/health', '/metrics']

function getRequiredEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`)
  }
  return value
}

/**
 * Get private key from environment.
 * SECURITY WARNING: Only use for localnet development.
 * Production MUST use KMS-backed signing (USE_KMS=true).
 */
function getPrivateKey(): `0x${string}` | undefined {
  const pk = crucibleConfig.privateKey
  if (!pk) return undefined
  if (!isHexString(pk)) {
    throw new Error('PRIVATE_KEY must be a valid hex string starting with 0x')
  }
  // Warn if private key is used in non-localnet
  if (NETWORK !== 'localnet') {
    log.warn(
      'SECURITY: Using in-memory private key in production. Set USE_KMS=true for threshold signing.',
    )
  }
  return pk
}

/**
 * Check if KMS-backed signing should be used.
 * Defaults to true in production environments.
 */
function shouldUseKMS(): boolean {
  const useKms = process.env.USE_KMS
  if (useKms === 'true') return true
  if (useKms === 'false') return false
  // Default: use KMS in production, allow direct signing in localnet
  return NETWORK !== 'localnet'
}

function getOptionalAddress(
  key: string,
  defaultValue: `0x${string}`,
): `0x${string}` {
  // This function is used for contract addresses that may come from env
  // For now, we'll keep it but it should be refactored to use config
  const value = process.env[key]
  if (value && /^0x[a-fA-F0-9]{40}$/.test(value)) {
    return value as `0x${string}`
  }
  return defaultValue
}

function getNetwork(): 'localnet' | 'testnet' | 'mainnet' {
  const network = getCurrentNetwork()
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

// Localnet default addresses - uses env vars or placeholder zeros
const LOCALNET_DEFAULTS = {
  rpcUrl: getRpcUrl('localnet'),
  agentVault:
    getContractSafe('agents', 'vault', 'localnet') ||
    '0x0000000000000000000000000000000000000000',
  roomRegistry:
    getContractSafe('agents', 'roomRegistry', 'localnet') ||
    '0x0000000000000000000000000000000000000000',
  triggerRegistry:
    getContractSafe('agents', 'triggerRegistry', 'localnet') ||
    '0x0000000000000000000000000000000000000000',
  identityRegistry:
    getContractSafe('registry', 'identity', 'localnet') ||
    '0x0000000000000000000000000000000000000000',
  serviceRegistry:
    getContractSafe('registry', 'service', 'localnet') ||
    '0x0000000000000000000000000000000000000000',
  computeMarketplace: getServiceUrl('compute', 'marketplace', 'localnet'),
  storageApi: getServiceUrl('storage', 'api', 'localnet'),
  ipfsGateway: getServiceUrl('storage', 'ipfsGateway', 'localnet'),
  indexerGraphql: getServiceUrl('indexer', 'graphql', 'localnet'),
} as const satisfies {
  rpcUrl: string
  agentVault: `0x${string}`
  roomRegistry: `0x${string}`
  triggerRegistry: `0x${string}`
  identityRegistry: `0x${string}`
  serviceRegistry: `0x${string}`
  computeMarketplace: string
  storageApi: string
  ipfsGateway: string
  indexerGraphql: string
}

const validatedPrivateKey = getPrivateKey()

const config: CrucibleConfig = {
  rpcUrl: getRequiredEnv('RPC_URL', LOCALNET_DEFAULTS.rpcUrl),
  privateKey: validatedPrivateKey,
  contracts: {
    agentVault: getOptionalAddress(
      'AGENT_VAULT_ADDRESS',
      LOCALNET_DEFAULTS.agentVault,
    ),
    roomRegistry: getOptionalAddress(
      'ROOM_REGISTRY_ADDRESS',
      LOCALNET_DEFAULTS.roomRegistry,
    ),
    triggerRegistry: getOptionalAddress(
      'TRIGGER_REGISTRY_ADDRESS',
      LOCALNET_DEFAULTS.triggerRegistry,
    ),
    identityRegistry: getOptionalAddress(
      'IDENTITY_REGISTRY_ADDRESS',
      LOCALNET_DEFAULTS.identityRegistry,
    ),
    serviceRegistry: getOptionalAddress(
      'SERVICE_REGISTRY_ADDRESS',
      LOCALNET_DEFAULTS.serviceRegistry,
    ),
    autocratTreasury:
      crucibleConfig.autocratTreasuryAddress &&
      isValidAddress(crucibleConfig.autocratTreasuryAddress)
        ? crucibleConfig.autocratTreasuryAddress
        : undefined,
  },
  services: (() => {
    const servicesConfig = getServicesConfig()
    return {
      computeMarketplace:
        crucibleConfig.computeMarketplaceUrl ??
        servicesConfig.compute.marketplace,
      storageApi: servicesConfig.storage.api,
      ipfsGateway: servicesConfig.storage.ipfsGateway,
      indexerGraphql: servicesConfig.indexer.graphql,
      eqliteEndpoint:
        crucibleConfig.eqliteEndpoint ?? servicesConfig.eqlite.blockProducer,
      dexCacheUrl: crucibleConfig.dexCacheUrl,
    }
  })(),
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

// KMS signer for threshold signing (production) or legacy wallet (localnet)
let kmsSigner: KMSSigner | null = null
let account: ReturnType<typeof privateKeyToAccount> | undefined
let walletClient: ReturnType<typeof createWalletClient> | undefined

if (shouldUseKMS()) {
  // Production: Use KMS-backed threshold signing
  // Private key is NEVER loaded into this process
  kmsSigner = createKMSSigner(config.rpcUrl, chain.id, {
    threshold: NETWORK === 'mainnet' ? 3 : 2,
    totalParties: NETWORK === 'mainnet' ? 5 : 3,
  })

  // Initialize KMS signer asynchronously
  kmsSigner
    .initialize()
    .then(() => {
      log.info('KMS signer initialized', {
        address: kmsSigner?.getAddress() ?? null,
        keyId: kmsSigner?.getKeyId() ?? null,
      })
    })
    .catch((err) => {
      log.error('Failed to initialize KMS signer', { error: String(err) })
      // Don't throw - server can still serve read-only endpoints
    })
} else if (validatedPrivateKey) {
  // Localnet only: Use in-memory wallet (NOT for production)
  log.warn('Using in-memory wallet - DO NOT USE IN PRODUCTION')
  account = privateKeyToAccount(validatedPrivateKey)
  walletClient = createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  })
}

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
  kmsSigner: kmsSigner ?? undefined,
})

const roomSdk = createRoomSDK({
  crucibleConfig: config,
  storage,
  publicClient,
  walletClient,
  kmsSigner: kmsSigner ?? undefined,
})

// Bot initialization
let botInitializer: BotInitializer | null = null
let tradingBots: Map<bigint, TradingBot> = new Map()

// Seed DWS infrastructure (external chain nodes + bots) on startup
async function seedDWSInfrastructure(): Promise<void> {
  const treasuryAddress =
    config.contracts.autocratTreasury ??
    account?.address ??
    '0x0000000000000000000000000000000000000001'

  try {
    // Dynamic import to avoid circular dependency
    const dws = await import('@jejunetwork/dws')
    const result = await dws.seedInfrastructure(
      treasuryAddress as `0x${string}`,
    )
    log.info('DWS infrastructure seeded', {
      nodesReady: result.nodesReady,
      botsRunning: result.botsRunning,
    })
  } catch (err) {
    // Log but don't fail - infrastructure seeding is optional
    log.warn('DWS infrastructure seeding failed', { error: String(err) })
  }
}

if (config.privateKey && walletClient) {
  botInitializer = new BotInitializer({
    crucibleConfig: config,
    agentSdk,
    publicClient,
    walletClient,
    kmsSigner: kmsSigner ?? undefined,
    treasuryAddress: config.contracts.autocratTreasury,
  })

  // Seed DWS infrastructure, then initialize bots
  seedDWSInfrastructure()
    .then(() => {
      if (crucibleConfig.botsEnabled && botInitializer) {
        return botInitializer.initializeDefaultBots()
      }
      return new Map<bigint, TradingBot>()
    })
    .then((bots) => {
      tradingBots = bots
      log.info('Default bots initialized', { count: bots.size })
    })
    .catch((err) =>
      log.error('Failed to initialize bots', { error: String(err) }),
    )
}

const app = new Elysia()

// CORS - restrict to configured origins in production
// SECURITY: Wildcard '*' is ONLY honored in localnet to prevent misconfiguration
app.use(
  cors({
    origin: (request) => {
      const origin = request.headers.get('origin')
      // In development (localnet), allow all origins including wildcard
      if (config.network === 'localnet') return true
      // In production/testnet, NEVER allow wildcard - explicit origins only
      if (!origin) return false
      if (ALLOWED_ORIGINS.includes(origin)) return true
      // Log rejected origins for debugging (but don't expose in response)
      if (origin && !ALLOWED_ORIGINS.includes('*')) {
        log.debug('CORS rejected origin', { origin, allowed: ALLOWED_ORIGINS })
      }
      return false
    },
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-Jeju-Address',
      'X-Jeju-Timestamp',
      'X-Jeju-Signature',
    ],
    maxAge: 86400,
  }),
)

// Rate limiting middleware with atomic increment pattern
app.onBeforeHandle(({ request, set }): { error: string } | undefined => {
  const url = new URL(request.url)
  const path = url.pathname

  // Skip rate limiting for exempt paths
  if (RATE_LIMIT_EXEMPT_PATHS.some((p) => path.startsWith(p))) {
    return undefined
  }

  // Use IP or wallet address as rate limit key
  // Note: wallet address is not verified here (would be expensive), IP is primary
  const clientIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  const walletAddress = request.headers.get('x-jeju-address') ?? ''
  const key = clientIp || walletAddress || 'unknown'

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
      set.headers['X-RateLimit-Limit'] = RATE_LIMIT_MAX_REQUESTS.toString()
      set.headers['X-RateLimit-Remaining'] = '0'
      set.headers['X-RateLimit-Reset'] = Math.ceil(
        record.resetAt / 1000,
      ).toString()
      set.status = 429
      return { error: 'Rate limit exceeded' }
    }
  }

  set.headers['X-RateLimit-Limit'] = RATE_LIMIT_MAX_REQUESTS.toString()
  set.headers['X-RateLimit-Remaining'] = Math.max(
    0,
    RATE_LIMIT_MAX_REQUESTS - record.count,
  ).toString()
  set.headers['X-RateLimit-Reset'] = Math.ceil(record.resetAt / 1000).toString()
  return undefined
})

// API Key authentication middleware (when enabled)
app.onBeforeHandle(({ request, set }): { error: string } | undefined => {
  const url = new URL(request.url)
  const path = url.pathname

  // Skip auth for public paths
  if (PUBLIC_PATHS.some((p) => path.startsWith(p))) {
    return undefined
  }

  // Skip auth if not required
  if (!REQUIRE_AUTH || !API_KEY) {
    return undefined
  }

  const providedKey =
    request.headers.get('x-api-key') ??
    request.headers.get('authorization')?.replace('Bearer ', '')

  if (!providedKey || !constantTimeCompare(providedKey, API_KEY)) {
    set.status = 401
    return { error: 'Unauthorized' }
  }
  return undefined
})

// Ban check middleware
app.onBeforeHandle(banCheckMiddleware())

// Metrics middleware
app.onBeforeHandle(() => {
  metrics.requests.total++
})

app.onAfterHandle(({ set }) => {
  const statusNum =
    typeof set.status === 'number' ? set.status : Number(set.status) || 200
  if (statusNum >= 400) metrics.requests.error++
  else metrics.requests.success++
})

// Global error handler - prevents stack trace leakage in production
app.onError(({ error, set }) => {
  // Log full error for debugging
  const errorObj = error instanceof Error ? error : new Error(String(error))
  const errorLog: Record<string, string> = {
    message: errorObj.message,
    name: errorObj.name,
  }
  if (NETWORK === 'localnet' && errorObj.stack) {
    errorLog.stack = errorObj.stack
  }
  log.error('Unhandled error', errorLog)

  // Return sanitized error to client
  set.status = 500
  return {
    error: 'Internal server error',
    // Only include message in localnet for debugging
    message: NETWORK === 'localnet' ? errorObj.message : undefined,
  }
})

// Root endpoint - API info
app.get('/', () => ({
  service: 'crucible',
  version: '1.0.0',
  description: 'Decentralized agent orchestration platform',
  docs: '/api/v1',
  endpoints: {
    health: '/health',
    info: '/info',
    metrics: '/metrics',
    characters: '/api/v1/characters',
    chat: '/api/v1/chat/:characterId',
    agents: '/api/v1/agents',
    rooms: '/api/v1/rooms',
    execute: '/api/v1/execute',
    bots: '/api/v1/bots',
    autonomous: '/api/v1/autonomous',
  },
}))

// Health & Info
app.get('/health', () => ({
  status: 'healthy',
  service: 'crucible',
  network: config.network,
  timestamp: new Date().toISOString(),
}))

app.get('/info', async ({ request }) => {
  const dwsAvailable = await checkDWSHealth()

  // Check if request is authenticated (has valid API key)
  const providedKey =
    request.headers.get('x-api-key') ??
    request.headers.get('authorization')?.replace('Bearer ', '')
  const isAuthenticated = !!(
    API_KEY &&
    providedKey &&
    constantTimeCompare(providedKey, API_KEY)
  )

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
    return {
      ...basicInfo,
      contracts: config.contracts,
      services: config.services,
    }
  }

  return basicInfo
})

// Agent Chat API - ElizaOS + @jejunetwork/eliza-plugin (60+ actions)

// Chat with an agent
app.post('/api/v1/chat/:characterId', async ({ params, body }) => {
  const characterId = params.characterId
  const character = getCharacter(characterId)

  if (!character) {
    return { error: `Character not found: ${characterId}` }
  }

  const parsedBody = parseOrThrow(ChatRequestSchema, body, 'Chat request')

  // Get or create runtime for this character
  let runtime = runtimeManager.getRuntime(characterId)
  if (!runtime) {
    runtime = await runtimeManager.createRuntime({
      agentId: characterId,
      character,
    })
  }

  const messageText = parsedBody.text ?? parsedBody.message ?? ''
  const message: RuntimeMessage = {
    id: crypto.randomUUID(),
    userId: parsedBody.userId ?? 'anonymous',
    roomId: parsedBody.roomId ?? 'default',
    content: { text: messageText, source: 'api' },
    createdAt: Date.now(),
  }

  const response = await runtime.processMessage(message)
  metrics.agents.executions++

  return {
    text: response.text,
    action: response.action,
    actions: response.actions,
    character: characterId,
  }
})

// List available characters with runtime status
app.get('/api/v1/chat/characters', () => {
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
  return { characters: characterList }
})

// Initialize all character runtimes
app.post('/api/v1/chat/init', async () => {
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

  return {
    initialized: Object.values(results).filter((r) => r.success).length,
    total: Object.keys(characters).length,
    results,
  }
})

// Prometheus Metrics
app.get('/metrics', ({ set }) => {
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

  set.headers['Content-Type'] = 'text/plain; version=0.0.4; charset=utf-8'
  return lines.join('\n')
})

// Character Templates
app.get('/api/v1/characters', () => {
  const characterList = listCharacters()
    .map((id) => {
      const char = getCharacter(id)
      return char
        ? { id: char.id, name: char.name, description: char.description }
        : null
    })
    .filter(Boolean)
  return { characters: characterList }
})

app.get('/api/v1/characters/:id', ({ params }) => {
  const id = params.id
  expect(id, 'Character ID is required')
  const character = expect(getCharacter(id), `Character not found: ${id}`)
  return { character }
})

// Agent Management
app.post('/api/v1/agents', async ({ body }) => {
  const parsedBody = parseOrThrow(
    RegisterAgentRequestSchema,
    body,
    'Register agent request',
  )
  // Create minimal AgentCharacter from registration data
  const character: AgentCharacter = {
    id: crypto.randomUUID(),
    name: parsedBody.character?.name ?? parsedBody.name,
    description: parsedBody.character?.description ?? '',
    system: '',
    bio: [],
    messageExamples: [],
    topics: [],
    adjectives: [],
    style: { all: [], chat: [], post: [] },
  }
  log.info('Registering agent', { name: character.name })

  const result = await agentSdk.registerAgent(character, {
    initialFunding: parsedBody.initialFunding
      ? BigInt(parsedBody.initialFunding)
      : undefined,
  })
  metrics.agents.registered++

  return {
    agentId: result.agentId.toString(),
    vaultAddress: result.vaultAddress,
    characterCid: result.characterCid,
    stateCid: result.stateCid,
  }
})

app.get('/api/v1/agents/:agentId', async ({ params }) => {
  const parsedParams = parseOrThrow(
    AgentIdParamSchema,
    params,
    'Agent ID parameter',
  )
  const agentId = BigInt(parsedParams.agentId)
  const agent = await agentSdk.getAgent(agentId)
  const validAgent = expect(agent, `Agent not found: ${parsedParams.agentId}`)
  return {
    agent: { ...validAgent, agentId: validAgent.agentId.toString() },
  }
})

app.get('/api/v1/agents/:agentId/character', async ({ params, set }) => {
  const parsedParams = parseOrThrow(
    AgentIdParamSchema,
    params,
    'Agent ID parameter',
  )
  try {
    const character = await agentSdk.loadCharacter(BigInt(parsedParams.agentId))
    return { character }
  } catch (error) {
    set.status = 404
    return { error: String(error) }
  }
})

app.get('/api/v1/agents/:agentId/state', async ({ params }) => {
  const parsedParams = parseOrThrow(
    AgentIdParamSchema,
    params,
    'Agent ID parameter',
  )
  const state = await agentSdk.loadState(BigInt(parsedParams.agentId))
  return { state }
})

app.get('/api/v1/agents/:agentId/balance', async ({ params }) => {
  const parsedParams = parseOrThrow(
    AgentIdParamSchema,
    params,
    'Agent ID parameter',
  )
  const balance = await agentSdk.getVaultBalance(BigInt(parsedParams.agentId))
  return { balance: balance.toString() }
})

app.post('/api/v1/agents/:agentId/fund', async ({ params, body, set }) => {
  const parsedParams = parseOrThrow(
    AgentIdParamSchema,
    params,
    'Agent ID parameter',
  )
  const parsedBody = parseOrThrow(
    FundAgentRequestSchema,
    body,
    'Fund agent request',
  )
  const agentId = BigInt(parsedParams.agentId)
  try {
    const txHash = await agentSdk.fundVault(agentId, BigInt(parsedBody.amount))
    return { txHash }
  } catch (error) {
    set.status = 400
    return { error: String(error) }
  }
})

app.post(
  '/api/v1/agents/:agentId/memory',
  async ({ params, body, request, set }) => {
    const parsedParams = parseOrThrow(
      AgentIdParamSchema,
      params,
      'Agent ID parameter',
    )
    const parsedBody = parseOrThrow(
      AddMemoryRequestSchema,
      body,
      'Add memory request',
    )
    const agentId = BigInt(parsedParams.agentId)

    // SECURITY: Verify caller owns this agent before allowing memory injection
    const authResult = await verifyAgentOwnership(
      agentId,
      request,
      agentSdk,
      account ?? null,
    )
    if (!authResult.authorized) {
      set.status = 403
      return { error: authResult.reason }
    }

    const memory = await agentSdk.addMemory(agentId, parsedBody.content, {
      importance: parsedBody.importance ?? undefined,
      roomId: parsedBody.roomId ?? undefined,
      userId: parsedBody.userId ?? undefined,
    })
    return { memory }
  },
)

// Room Management
app.post('/api/v1/rooms', async ({ body }) => {
  const parsedBody = parseOrThrow(
    CreateRoomRequestSchema,
    body,
    'Create room request',
  )
  log.info('Creating room', {
    name: parsedBody.name,
    roomType: parsedBody.roomType,
  })

  const result = await roomSdk.createRoom(
    parsedBody.name,
    parsedBody.description ?? '',
    parsedBody.roomType,
    {
      maxMembers: parsedBody.config?.maxMembers ?? 10,
      turnBased: parsedBody.config?.turnBased ?? false,
      turnTimeout: parsedBody.config?.turnTimeout ?? 300,
      visibility: 'public' as const,
    },
  )
  metrics.rooms.created++

  return { roomId: result.roomId.toString(), stateCid: result.stateCid }
})

app.get('/api/v1/rooms/:roomId', async ({ params }) => {
  const parsedParams = parseOrThrow(
    RoomIdParamSchema,
    params,
    'Room ID parameter',
  )
  const room = await roomSdk.getRoom(BigInt(parsedParams.roomId))
  const validRoom = expect(room, `Room not found: ${parsedParams.roomId}`)
  return {
    room: {
      ...validRoom,
      roomId: validRoom.roomId.toString(),
      members: validRoom.members.map((m) => ({
        ...m,
        agentId: m.agentId.toString(),
      })),
    },
  }
})

app.post('/api/v1/rooms/:roomId/join', async ({ params, body }) => {
  const parsedParams = parseOrThrow(
    RoomIdParamSchema,
    params,
    'Room ID parameter',
  )
  const parsedBody = parseOrThrow(
    JoinRoomRequestSchema,
    body,
    'Join room request',
  )
  await roomSdk.joinRoom(
    BigInt(parsedParams.roomId),
    BigInt(parsedBody.agentId),
    parsedBody.role,
  )
  return { success: true }
})

app.post('/api/v1/rooms/:roomId/leave', async ({ params, body }) => {
  const parsedParams = parseOrThrow(
    RoomIdParamSchema,
    params,
    'Room ID parameter',
  )
  const parsedBody = parseOrThrow(
    LeaveRoomRequestSchema,
    body,
    'Leave room request',
  )
  await roomSdk.leaveRoom(
    BigInt(parsedParams.roomId),
    BigInt(parsedBody.agentId),
  )
  return { success: true }
})

app.post('/api/v1/rooms/:roomId/message', async ({ params, body }) => {
  const parsedParams = parseOrThrow(
    RoomIdParamSchema,
    params,
    'Room ID parameter',
  )
  const parsedBody = parseOrThrow(
    PostMessageRequestSchema,
    body,
    'Post message request',
  )
  const message = await roomSdk.postMessage(
    BigInt(parsedParams.roomId),
    BigInt(parsedBody.agentId),
    parsedBody.content,
    parsedBody.action ?? undefined,
  )
  metrics.rooms.messages++
  return { message }
})

app.get('/api/v1/rooms/:roomId/messages', async ({ params, query, set }) => {
  const parsedParams = parseOrThrow(
    RoomIdParamSchema,
    params,
    'Room ID parameter',
  )
  const limitStr = query.limit
  const limit = limitStr
    ? parseOrThrow(
        z.number().int().min(1).max(1000),
        parseInt(limitStr, 10),
        'Limit query parameter',
      )
    : 50
  try {
    const messages = await roomSdk.getMessages(
      BigInt(parsedParams.roomId),
      limit,
    )
    return { messages }
  } catch (error) {
    set.status = 404
    return { error: String(error) }
  }
})

app.post('/api/v1/rooms/:roomId/phase', async ({ params, body }) => {
  const parsedParams = parseOrThrow(
    RoomIdParamSchema,
    params,
    'Room ID parameter',
  )
  const parsedBody = parseOrThrow(
    SetPhaseRequestSchema,
    body,
    'Set phase request',
  )
  await roomSdk.setPhase(BigInt(parsedParams.roomId), parsedBody.phase)
  return { success: true }
})

// Execution
app.post('/api/v1/execute', async ({ body }) => {
  expect(
    walletClient && account,
    'Executor not configured - missing private key',
  )

  const parsedBody = parseOrThrow(ExecuteRequestSchema, body, 'Execute request')

  log.info('Executing agent', { agentId: parsedBody.agentId })

  // Get executor address from KMS signer or wallet account
  const executorAddress = kmsSigner?.isInitialized()
    ? kmsSigner.getAddress()
    : account?.address

  if (!executorAddress) {
    throw new Error('No signer configured (KMS or wallet)')
  }

  const executorSdk = createExecutorSDK({
    crucibleConfig: config,
    storage,
    compute,
    agentSdk,
    roomSdk,
    publicClient,
    walletClient,
    kmsSigner: kmsSigner ?? undefined,
    executorAddress,
  })

  const agentId = expect(
    parsedBody.agentId,
    'Agent ID is required for execution',
  )
  const inputContext: JsonObject | null = parsedBody.input.context ?? null
  const request: ExecutionRequest = {
    agentId: BigInt(agentId),
    triggerId: parsedBody.triggerId ?? undefined,
    input: {
      message: parsedBody.input.message ?? null,
      roomId: parsedBody.input.roomId ?? null,
      userId: parsedBody.input.userId ?? null,
      context: inputContext,
    },
    options: parsedBody.options
      ? {
          ...parsedBody.options,
          maxCost: parsedBody.options.maxCost
            ? BigInt(parsedBody.options.maxCost)
            : undefined,
        }
      : undefined,
  }

  const result = await executorSdk.execute(request)
  metrics.agents.executions++

  return {
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
  }
})

// Bot Management
app.get('/api/v1/bots', () => {
  const bots = Array.from(tradingBots.entries()).map(([agentId, bot]) => ({
    agentId: agentId.toString(),
    metrics: bot.getMetrics(),
    healthy: bot.isHealthy(),
  }))
  return { bots }
})

app.get('/api/v1/bots/:botId/metrics', ({ params }) => {
  const parsedParams = parseOrThrow(
    BotIdParamSchema,
    params,
    'Bot ID parameter',
  )
  const agentId = BigInt(parsedParams.botId)
  const bot = expect(
    tradingBots.get(agentId),
    `Bot not found: ${parsedParams.botId}`,
  )
  return { metrics: bot.getMetrics() }
})

app.post('/api/v1/bots/:botId/stop', async ({ params, request, set }) => {
  const parsedParams = parseOrThrow(
    BotIdParamSchema,
    params,
    'Bot ID parameter',
  )
  const agentId = BigInt(parsedParams.botId)

  // SECURITY: Verify caller owns this bot's agent
  const authResult = await verifyAgentOwnership(
    agentId,
    request,
    agentSdk,
    account ?? null,
  )
  if (!authResult.authorized) {
    set.status = 403
    return { error: authResult.reason }
  }

  const bot = expect(
    tradingBots.get(agentId),
    `Bot not found: ${parsedParams.botId}`,
  )
  await bot.stop()
  tradingBots.delete(agentId)
  return { success: true }
})

app.post('/api/v1/bots/:botId/start', async ({ params, request, set }) => {
  const parsedParams = parseOrThrow(
    BotIdParamSchema,
    params,
    'Bot ID parameter',
  )
  const agentId = BigInt(parsedParams.botId)

  // SECURITY: Verify caller owns this bot's agent
  const authResult = await verifyAgentOwnership(
    agentId,
    request,
    agentSdk,
    account ?? null,
  )
  if (!authResult.authorized) {
    set.status = 403
    return { error: authResult.reason }
  }

  const bot = expect(
    tradingBots.get(agentId),
    `Bot not found: ${parsedParams.botId}`,
  )
  await bot.start()
  return { success: true }
})

// Autonomous Agents API

import { type AutonomousAgentRunner, createAgentRunner } from './autonomous'

// Global autonomous runner (started if AUTONOMOUS_ENABLED=true)
let autonomousRunner: AutonomousAgentRunner | null = null

if (crucibleConfig.autonomousEnabled) {
  autonomousRunner = createAgentRunner({
    enableBuiltinCharacters: crucibleConfig.enableBuiltinCharacters,
    defaultTickIntervalMs: crucibleConfig.defaultTickIntervalMs,
    maxConcurrentAgents: crucibleConfig.maxConcurrentAgents,
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
app.get('/api/v1/autonomous/status', () => {
  if (!autonomousRunner) {
    return {
      enabled: false,
      message:
        'Autonomous mode not enabled. Set AUTONOMOUS_ENABLED=true to enable.',
    }
  }
  return {
    enabled: true,
    ...autonomousRunner.getStatus(),
  }
})

// Start autonomous runner (if not already running)
app.post('/api/v1/autonomous/start', async () => {
  if (!autonomousRunner) {
    autonomousRunner = createAgentRunner()
  }
  await autonomousRunner.start()
  return { success: true, status: autonomousRunner.getStatus() }
})

// Stop autonomous runner
app.post('/api/v1/autonomous/stop', async ({ set }) => {
  if (!autonomousRunner) {
    set.status = 400
    return { success: false, message: 'Runner not started' }
  }
  await autonomousRunner.stop()
  return { success: true }
})

// Register an agent for autonomous mode
app.post('/api/v1/autonomous/agents', async ({ body, set }) => {
  if (!autonomousRunner) {
    set.status = 400
    return { error: 'Autonomous runner not started' }
  }

  const parsedBody = parseOrThrow(
    AgentStartRequestSchema,
    body,
    'Agent start request',
  )

  const characterId = parsedBody.characterId ?? parsedBody.characterCid
  if (!characterId) {
    set.status = 400
    return { error: 'characterId or characterCid is required' }
  }

  const character = getCharacter(characterId)
  if (!character) {
    set.status = 404
    return { error: `Character not found: ${characterId}` }
  }

  await autonomousRunner.registerAgent({
    ...DEFAULT_AUTONOMOUS_CONFIG,
    agentId: `autonomous-${characterId}`,
    character,
    tickIntervalMs:
      parsedBody.tickIntervalMs ?? DEFAULT_AUTONOMOUS_CONFIG.tickIntervalMs,
    capabilities: parsedBody.capabilities
      ? {
          ...DEFAULT_AUTONOMOUS_CONFIG.capabilities,
          ...parsedBody.capabilities,
        }
      : DEFAULT_AUTONOMOUS_CONFIG.capabilities,
  })

  return { success: true, agentId: `autonomous-${characterId}` }
})

// Remove an agent from autonomous mode
app.delete('/api/v1/autonomous/agents/:agentId', ({ params, set }) => {
  if (!autonomousRunner) {
    set.status = 400
    return { error: 'Autonomous runner not started' }
  }
  const agentId = params.agentId
  autonomousRunner.unregisterAgent(agentId)
  return { success: true }
})

// Cron routes (for DWS scheduled triggers)
app.use(cronRoutes)

// Search
app.get('/api/v1/search/agents', async ({ query, set }) => {
  try {
    const parsedQuery = AgentSearchQuerySchema.parse(query)
    const ownerAddress =
      parsedQuery.owner && isValidAddress(parsedQuery.owner)
        ? parsedQuery.owner
        : undefined
    const result = await agentSdk.searchAgents({
      name: parsedQuery.name ?? undefined,
      owner: ownerAddress,
      active: parsedQuery.active,
      limit: parsedQuery.limit ?? 20,
    })
    return {
      agents: result.items.map((a) => ({
        ...a,
        agentId: a.agentId.toString(),
      })),
      total: result.total,
      hasMore: result.hasMore,
    }
  } catch (error) {
    set.status = 400
    return { error: String(error) }
  }
})

const port = crucibleConfig.apiPort
if (Number.isNaN(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT: ${port}. Must be a valid port number`)
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

// Initialize config from environment variables at startup
configureCrucible({
  network: getCurrentNetwork(),
  apiKey: getEnvVar('API_KEY'),
  apiPort: getEnvNumber('API_PORT'),
  requireAuth: getEnvVar('REQUIRE_AUTH') === 'true',
  rateLimitMaxRequests: getEnvNumber('RATE_LIMIT_MAX_REQUESTS'),
  corsAllowedOrigins: getEnvVar('CORS_ALLOWED_ORIGINS'),
  privateKey: getEnvVar('PRIVATE_KEY'),
  autocratTreasuryAddress: getEnvVar('AUTOCRAT_TREASURY_ADDRESS'),
  computeMarketplaceUrl: getEnvVar('COMPUTE_MARKETPLACE_URL'),
  eqliteEndpoint: getEnvVar('EQLITE_ENDPOINT'),
  dexCacheUrl: getEnvVar('DEX_CACHE_URL'),
  botsEnabled: getEnvVar('BOTS_ENABLED') !== 'false',
  autonomousEnabled: getEnvVar('AUTONOMOUS_ENABLED') === 'true',
  enableBuiltinCharacters: getEnvVar('ENABLE_BUILTIN_CHARACTERS') !== 'false',
  defaultTickIntervalMs: getEnvNumber('TICK_INTERVAL_MS'),
  maxConcurrentAgents: getEnvNumber('MAX_CONCURRENT_AGENTS'),
  farcasterHubUrl: getEnvVar('FARCASTER_HUB_URL'),
  dwsUrl: getEnvVar('DWS_URL'),
  ipfsGateway: getEnvVar('IPFS_GATEWAY'),
  cronSecret: getEnvVar('CRON_SECRET'),
  banManagerAddress: getEnvVar('MODERATION_BAN_MANAGER'),
  moderationMarketplaceAddress: getEnvVar('MODERATION_MARKETPLACE_ADDRESS'),
})

// Start server - set port on the app object so Bun's auto-serve uses the right port
// Don't call app.listen() directly as Bun will auto-serve the exported default
const server = app.listen(port)

// Export for testing, but don't export as default to avoid Bun auto-serve conflict
export { app, server }
