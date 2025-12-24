import { cors } from '@elysiajs/cors'
import { getProviderInfo } from '@jejunetwork/shared'
import { Elysia } from 'elysia'
import { getChainName, IS_TESTNET, JEJU_CHAIN_ID } from '../lib/config/networks'

// Types for the worker environment bindings
interface KVNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string; limit?: number }): Promise<{
    keys: Array<{ name: string }>
    list_complete: boolean
  }>
}

export interface GatewayEnv {
  // KV Bindings
  GATEWAY_CACHE?: KVNamespace

  // Secrets
  PRIVATE_KEY?: string
  RPC_URL?: string
  DATABASE_URL?: string
  GATEWAY_PAYMENT_RECIPIENT?: string

  // Config
  NODE_ENV?: string
  CORS_ORIGINS?: string
  NETWORK?: 'testnet' | 'mainnet' | 'localnet'
  DWS_URL?: string
  INDEXER_URL?: string

  // TEE mode (simulated/dstack/phala)
  TEE_MODE?: string
  TEE_PLATFORM?: string
  TEE_REGION?: string
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

function getAgentCard(port = 4003) {
  return {
    protocolVersion: '0.3.0',
    name: 'Gateway - Protocol Infrastructure Hub',
    description:
      'Multi-token paymaster system, node staking, app registry, cross-chain intents, and protocol infrastructure',
    url: `http://localhost:${port}/a2a`,
    preferredTransport: 'http',
    provider: getProviderInfo(),
    version: '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text', 'data'],
    defaultOutputModes: ['text', 'data'],
    skills: [
      {
        id: 'list-protocol-tokens',
        name: 'List Protocol Tokens',
        description: 'Get all tokens with deployed paymasters',
        tags: ['query', 'tokens', 'paymaster'],
      },
      {
        id: 'get-node-stats',
        name: 'Get Node Statistics',
        description: 'Get network node statistics and health',
        tags: ['query', 'nodes', 'network'],
      },
      {
        id: 'create-intent',
        name: 'Create Cross-Chain Intent',
        description: 'Create a new intent for cross-chain swap/transfer',
        tags: ['intents', 'create', 'swap', 'bridge'],
      },
      {
        id: 'get-quote',
        name: 'Get Intent Quote',
        description: 'Get best price quote for an intent',
        tags: ['quote', 'pricing', 'intents'],
      },
    ],
  }
}

export function createGatewayApp(env: Partial<GatewayEnv> = {}) {
  const isProduction = env.NODE_ENV === 'production'
  const corsOrigins = env.CORS_ORIGINS?.split(',').filter(Boolean)
  const app = new Elysia({ prefix: '' })
    .use(
      cors(isProduction && corsOrigins?.length ? { origin: corsOrigins } : {}),
    )
    .get('/health', () => ({
      status: 'ok',
      service: 'gateway-worker',
      version: '1.0.0',
      runtime: 'workerd',
      network: env.NETWORK || 'testnet',
      teeMode: env.TEE_MODE || 'simulated',
      timestamp: new Date().toISOString(),
    }))
    .get('/.well-known/agent-card.json', () => getAgentCard())
    .get('/api/info', () => ({
      name: 'Gateway',
      version: '1.0.0',
      chain: getChainName(JEJU_CHAIN_ID),
      isTestnet: IS_TESTNET,
      runtime: 'workerd',
    }))
    .post('/a2a', async ({ body: _body, request: _request }) => {
      return {
        jsonrpc: '2.0',
        id: 1,
        result: {
          status: 'ok',
          message: 'Gateway A2A worker endpoint',
          runtime: 'workerd',
        },
      }
    })
    .post('/mcp', async ({ body: _body }) => ({
      jsonrpc: '2.0',
      id: 1,
      result: {
        status: 'ok',
        message: 'Gateway MCP worker endpoint',
      },
    }))

  return app
}

let cachedApp: ReturnType<typeof createGatewayApp> | null = null
let cachedEnvHash: string | null = null

function getAppForEnv(env: GatewayEnv): ReturnType<typeof createGatewayApp> {
  const envHash = `${env.NETWORK}-${env.TEE_MODE}`

  if (cachedApp && cachedEnvHash === envHash) {
    return cachedApp
  }

  cachedApp = createGatewayApp(env).compile()
  cachedEnvHash = envHash
  return cachedApp
}

export default {
  async fetch(
    request: Request,
    env: GatewayEnv,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const app = getAppForEnv(env)
    return app.handle(request)
  },
}

if (typeof Bun !== 'undefined' && (import.meta as { main?: boolean }).main) {
  const PORT = process.env.PORT || 4003

  const app = createGatewayApp({
    NODE_ENV: process.env.NODE_ENV,
    CORS_ORIGINS: process.env.CORS_ORIGINS,
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    RPC_URL: process.env.RPC_URL,
    NETWORK:
      (process.env.NETWORK as 'testnet' | 'mainnet' | 'localnet') || 'testnet',
    TEE_MODE: 'simulated',
  })

  app.listen(Number(PORT), () => {
    console.log(`🌉 Gateway Worker running on http://localhost:${PORT}`)
    console.log(`   Runtime: Bun (local dev)`)
    console.log(`   Network: ${process.env.NETWORK || 'testnet'}`)
  })
}
