import { existsSync } from 'node:fs'
import { join } from 'node:path'
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
import { bugBountyRoutes } from './routes/bug-bounty'
import { casualRoutes } from './routes/casual'
import { daoRoutes } from './routes/dao'
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

const PORT = CORE_PORTS.AUTOCRAT_API.get()
const network = getCurrentNetwork()

/** Static file serving - auto-detect if dist/ exists */
const STATIC_DIR = join(import.meta.dir, '..', 'dist')
const hasStaticFiles = existsSync(join(STATIC_DIR, 'index.html'))

/** MIME type mapping for static files */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

function getMimeType(path: string): string {
  const ext = path.substring(path.lastIndexOf('.'))
  return MIME_TYPES[ext] ?? 'application/octet-stream'
}

// Network-aware CORS - strict in production, flexible in development
const ALLOWED_ORIGINS =
  network === 'mainnet'
    ? ['https://autocrat.jejunetwork.org', 'https://jejunetwork.org']
    : network === 'testnet'
      ? (() => {
          const host = getLocalhostHost()
          return [
            'https://autocrat.testnet.jejunetwork.org',
            'https://testnet.jejunetwork.org',
            `http://${host}:3000`,
            `http://${host}:5173`,
            `http://${host}:4042`,
          ]
        })()
      : true // localnet allows all origins for development

const app = new Elysia()
  .use(
    cors({
      origin: ALLOWED_ORIGINS,
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
  // Root route - serve SPA if static files exist, otherwise return API info
  .get('/', ({ request }) => {
    // If static files exist, serve index.html for the root
    if (hasStaticFiles) {
      const indexFile = Bun.file(join(STATIC_DIR, 'index.html'))
      return new Response(indexFile, {
        headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' },
      })
    }
    // Otherwise return API info (useful for API-only mode)
    return {
      name: `${getNetworkName()} Autocrat`,
      version: '3.0.0',
      description: 'Multi-tenant DAO governance with AI CEOs and deep funding',
      features: [
        'Multi-DAO support (Jeju DAO, custom DAOs)',
        'CEO personas with unique personalities',
        'Casual proposal flow (opinions, suggestions, applications)',
        'Deep funding with quadratic matching',
        'Package and repo funding integration',
      ],
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
        ceo: '/api/v1/agents/ceo',
        bugBounty: '/api/v1/bug-bounty',
        rlaif: '/rlaif',
        health: '/health',
      },
    }
  })
  // Metrics middleware
  .onBeforeHandle(({ path }) => {
    if (path !== '/metrics' && path !== '/health') {
      metricsData.requests++
    }
  })
  .onError(({ code, error, path, set, request }) => {
    // Handle static file serving for production builds
    if (code === 'NOT_FOUND' && hasStaticFiles) {
      const url = new URL(request.url)
      const pathname = url.pathname

      // Check if this looks like a static file request (has extension)
      const hasExtension = /\.[a-zA-Z0-9]+$/.test(pathname)
      if (hasExtension) {
        // Serve from dist/ directory (handles both /web/... and other paths)
        const filePath = join(STATIC_DIR, pathname)
        if (existsSync(filePath)) {
          // Use immutable caching for hashed assets
          const isHashedAsset = /\.[a-f0-9]{8,}\.[a-z]+$/.test(pathname)
          return new Response(Bun.file(filePath), {
            headers: {
              'Content-Type': getMimeType(pathname),
              'Cache-Control': isHashedAsset
                ? 'public, max-age=31536000, immutable'
                : 'public, max-age=3600',
            },
          })
        }
        set.status = 404
        return { error: 'File not found' }
      }

      // SPA fallback - serve index.html for routes without extensions
      const indexFile = Bun.file(join(STATIC_DIR, 'index.html'))
      return new Response(indexFile, {
        headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' },
      })
    }

    metricsData.errors++
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[Error] ${path}:`, message)
    return { error: message }
  })

async function start() {
  await initLocalServices()
  await initModeration()
  await autocratAgentRuntime.initialize()

  const computeClient = getComputeTriggerClient()
  const computeAvailable = await computeClient.isAvailable()
  let triggerMode = 'local'

  if (computeAvailable) {
    await registerAutocratTriggers()
    triggerMode = 'compute'
  }

  const host = getLocalhostHost()
  app.listen(PORT, () => {
    console.log(
      `[Council] port=${PORT} tee=${getTEEMode()} trigger=${triggerMode}`,
    )
    console.log(`[Council] API: http://${host}:${PORT}`)
    if (hasStaticFiles) {
      console.log(`[Council] Serving static files from ${STATIC_DIR}`)
    }
  })

  const hasDAOContracts =
    config.contracts.daoRegistry !== ZERO_ADDRESS &&
    config.contracts.daoFunding !== ZERO_ADDRESS

  if (blockchain.councilDeployed && hasDAOContracts) {
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
    orchestrator
      .start()
      .then(() => {
        setOrchestrator(orchestrator)
        if (triggerMode === 'local') startLocalCron(runOrchestratorCycle)
      })
      .catch((err) => {
        console.error('[Orchestrator]', err.message)
      })
  }
}

start()

export { app }
export type App = typeof app
