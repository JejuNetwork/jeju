/**
 * Autocrat API Worker
 *
 * DWS-deployable worker using Elysia.
 * Compatible with workerd runtime and DWS infrastructure.
 */

import { cors } from '@elysiajs/cors'
import {
  CORE_PORTS,
  getCurrentNetwork,
  getLocalhostHost,
  getNetworkName,
} from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import { autocratAgentRuntime } from './agents/runtime'
import {
  getComputeTriggerClient,
  registerAutocratTriggers,
  startLocalCron,
} from './compute-trigger'
import { initLocalServices } from './local-services'
import { initModeration } from './moderation'
import { createOrchestrator } from './orchestrator'
import { a2aRoutes } from './routes/a2a'
import { agentsRoutes } from './routes/agents'
import { appsRoutes } from './routes/apps'
import { bugBountyRoutes } from './routes/bug-bounty'
import { casualRoutes } from './routes/casual'
import { daoRoutes, directorRoutes } from './routes/dao'
import { feesRoutes } from './routes/fees'
import { fundingRoutes } from './routes/funding'
import { futarchyRoutes } from './routes/futarchy'
import { healthRoutes } from './routes/health'
import { mcpRoutes } from './routes/mcp'
import { moderationRoutes } from './routes/moderation'
import { orchestratorRoutes } from './routes/orchestrator'
import { proposalsRoutes } from './routes/proposals'
import { registryRoutes } from './routes/registry'
import { researchRoutes } from './routes/research'
import { rlaifRoutes } from './routes/rlaif'
import { safeRoutes } from './routes/safe'
import { triggersRoutes } from './routes/triggers'
import { securityMiddleware } from './security'
import {
  blockchain,
  config,
  metricsData,
  runOrchestratorCycle,
  setOrchestrator,
} from './shared-state'
import { getTEEMode } from './tee'

function ensureKmsServiceUrl(): void {
  if (process.env.KMS_SERVICE_URL || process.env.JEJU_KMS_SERVICE_URL) {
    return
  }
  const dwsUrl = process.env.DWS_URL
  if (!dwsUrl) {
    return
  }
  const baseUrl = dwsUrl.endsWith('/') ? dwsUrl.slice(0, -1) : dwsUrl
  const kmsUrl = baseUrl.endsWith('/kms') ? baseUrl : `${baseUrl}/kms`
  process.env.KMS_SERVICE_URL = kmsUrl
  if (!process.env.KMS_DEFAULT_PROVIDER) {
    process.env.KMS_DEFAULT_PROVIDER = 'mpc'
  }
}

ensureKmsServiceUrl()

// ============================================================================
// Types
// ============================================================================

export type AutocratNetwork = 'localnet' | 'testnet' | 'mainnet'

export interface AutocratEnv {
  // Standard worker bindings
  NETWORK?: AutocratNetwork
  RPC_URL?: string

  // DWS services
  DWS_URL?: string
  GATEWAY_URL?: string
  INDEXER_URL?: string

  // SQLit config (DWS-managed)
  SQLIT_NODES?: string
  SQLIT_DATABASE_ID?: string

  // TEE hints (non-secret)
  TEE_MODE?: 'real' | 'simulated' | 'dstack' | 'local'
  TEE_PLATFORM?: string
  TEE_REGION?: string
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

type TriggerMode = 'compute' | 'local'

// ============================================================================
// App Factory
// ============================================================================

function computeAllowedOrigins(network: AutocratNetwork): true | string[] {
  if (network === 'mainnet') {
    return ['https://autocrat.jejunetwork.org', 'https://jejunetwork.org']
  }

  if (network === 'testnet') {
    const host = getLocalhostHost()
    return [
      'https://autocrat.testnet.jejunetwork.org',
      'https://testnet.jejunetwork.org',
      `http://${host}:3000`,
      `http://${host}:5173`,
      `http://${host}:${CORE_PORTS.AUTOCRAT_WEB.get()}`,
    ]
  }

  // localnet allows all origins for development
  return true
}

/** Type alias for the Autocrat Elysia app instance (for Eden Treaty) */
export type App = ReturnType<typeof createAutocratApp>

export function createAutocratApp(env?: Partial<AutocratEnv>) {
  const network = (env?.NETWORK ?? getCurrentNetwork()) as AutocratNetwork

  const app = new Elysia()
    .use(
      cors({
        origin: computeAllowedOrigins(network),
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
        credentials: true,
      }),
    )
    // Security middleware: rate limiting, API key validation, audit logging, security headers
    .use(securityMiddleware)
    // Mount all routes
    .use(healthRoutes)
    .use(proposalsRoutes)
    .use(daoRoutes)
    .use(directorRoutes)
    .use(futarchyRoutes)
    .use(agentsRoutes)
    .use(moderationRoutes)
    .use(researchRoutes)
    .use(registryRoutes)
    .use(orchestratorRoutes)
    .use(triggersRoutes)
    .use(casualRoutes)
    .use(fundingRoutes)
    .use(feesRoutes)
    .use(a2aRoutes)
    .use(mcpRoutes)
    .use(rlaifRoutes)
    .use(bugBountyRoutes)
    .use(safeRoutes)
    .use(appsRoutes)
    // Root route - API info
    .get('/', () => ({
      name: `${getNetworkName()} Autocrat`,
      version: '3.0.0',
      description:
        'Multi-tenant DAO governance with AI Directors and deep funding',
      endpoints: {
        a2a: '/a2a',
        mcp: '/mcp',
        rest: '/api/v1',
        dao: '/api/v1/dao',
        orchestrator: '/api/v1/orchestrator',
        proposals: '/api/v1/proposals',
        casual: '/api/v1/dao/:daoId/casual',
        funding: '/api/v1/dao/:daoId/funding',
        fees: '/fees',
        research: '/api/v1/research',
        agents: '/api/v1/agents',
        futarchy: '/api/v1/futarchy',
        moderation: '/api/v1/moderation',
        registry: '/api/v1/registry',
        director: '/api/v1/agents/director',
        bugBounty: '/api/v1/bug-bounty',
        rlaif: '/rlaif',
        health: '/health',
      },
    }))
    // Metrics middleware
    .onBeforeHandle(({ path }) => {
      if (path !== '/metrics' && path !== '/health') {
        metricsData.requests++
      }
    })
    .onError(({ code, error, path, set }) => {
      metricsData.errors++
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[Autocrat Error] ${path}:`, message)

      if (code === 'NOT_FOUND') set.status = 404
      else if (code === 'VALIDATION') set.status = 422
      else if (code === 'PARSE') set.status = 400
      else set.status = 500

      return { error: message, path, code }
    })

  return app
}

// ============================================================================
// Initialization (shared for worker + standalone server)
// ============================================================================

let initPromise: Promise<{ triggerMode: TriggerMode }> | null = null
let cronTimer: NodeJS.Timer | null = null

async function initializeAutocrat(): Promise<{ triggerMode: TriggerMode }> {
  await initLocalServices()
  await initModeration()
  await autocratAgentRuntime.initialize()

  const computeClient = getComputeTriggerClient()
  const computeAvailable = await computeClient.isAvailable()
  const triggerMode: TriggerMode = computeAvailable ? 'compute' : 'local'

  if (computeAvailable) {
    await registerAutocratTriggers()
  }

  const hasDAOContracts =
    config.contracts.daoRegistry !== ZERO_ADDRESS &&
    config.contracts.daoFunding !== ZERO_ADDRESS

  if (blockchain.boardDeployed && hasDAOContracts) {
    const orchestratorConfig = {
      rpcUrl: config.rpcUrl,
      daoRegistry: config.contracts.daoRegistry,
      daoFunding: config.contracts.daoFunding,
      contracts: {
        daoRegistry: config.contracts.daoRegistry,
        daoFunding: config.contracts.daoFunding,
      },
    }

    const orchestrator = createOrchestrator(orchestratorConfig, blockchain)
    await orchestrator.start()
    setOrchestrator(orchestrator)

    if (triggerMode === 'local' && !cronTimer) {
      cronTimer = startLocalCron(runOrchestratorCycle)
    }
  }

  return { triggerMode }
}

async function ensureInitialized(): Promise<{ triggerMode: TriggerMode }> {
  if (!initPromise) {
    initPromise = initializeAutocrat()
  }
  return initPromise
}

// ============================================================================
// Worker Export (for DWS/workerd)
// ============================================================================

let cachedApp: ReturnType<typeof createAutocratApp> | null = null
let cachedEnvHash: string | null = null

function getAppForEnv(env: AutocratEnv): ReturnType<typeof createAutocratApp> {
  const network = env.NETWORK ?? (getCurrentNetwork() as AutocratNetwork)
  const teeMode = env.TEE_MODE ?? getTEEMode()
  const envHash = `${network}-${teeMode}`

  if (cachedApp && cachedEnvHash === envHash) {
    return cachedApp
  }

  cachedApp = createAutocratApp(env).compile()
  cachedEnvHash = envHash
  return cachedApp
}

export default {
  async fetch(
    request: Request,
    env: AutocratEnv,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url)

    // Health check bypasses initialization for fast response
    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          service: 'jeju-board',
          version: '1.0.0',
          runtime: 'workerd',
          network: env.NETWORK ?? 'testnet',
          features: ['dao', 'governance', 'voting'],
          timestamp: new Date().toISOString(),
        }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }

    await ensureInitialized()
    const app = getAppForEnv(env)
    return app.handle(request)
  },
}

// ============================================================================
// Standalone Server (for local dev / jeju dev worker process)
// ============================================================================

export async function startAutocratServer(): Promise<void> {
  const port = Number(process.env.PORT ?? CORE_PORTS.AUTOCRAT_API.get())
  const host = getLocalhostHost()

  const { triggerMode } = await ensureInitialized()

  const app = createAutocratApp({
    NETWORK: getCurrentNetwork() as AutocratNetwork,
    TEE_MODE: getTEEMode(),
  })

  console.log(
    `[Autocrat] API port=${port} tee=${getTEEMode()} trigger=${triggerMode}`,
  )
  console.log(`[Autocrat] API: http://${host}:${port}`)

  // Use Bun.serve() directly so Bun doesn't auto-serve default export
  Bun.serve({
    port,
    hostname: host,
    fetch: app.fetch,
  })
}

const isMainModule = typeof Bun !== 'undefined' && import.meta.main
if (isMainModule) {
  startAutocratServer().catch((err: Error) => {
    console.error('[Autocrat] Failed to start:', err.message)
    process.exit(1)
  })
}
