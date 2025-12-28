/**
 * Autocrat API Server - Elysia
 *
 * AI-powered DAO governance with multi-tenant support.
 * Fully decentralized: EQLite for state, DWS for compute, dstack for TEE.
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

// Network-aware CORS - strict in production, flexible in development
const ALLOWED_ORIGINS =
  network === 'mainnet'
    ? ['https://autocrat.jejunetwork.org', 'https://jeju.network']
    : network === 'testnet'
      ? (() => {
          const host = getLocalhostHost()
          return [
            'https://testnet.autocrat.jejunetwork.org',
            'https://testnet.jeju.network',
            `http://${host}:3000`,
            `http://${host}:5173`,
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
  // Root info
  .get('/', () => ({
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
  }))
  // Metrics middleware
  .onBeforeHandle(({ path }) => {
    if (path !== '/metrics' && path !== '/health') {
      metricsData.requests++
    }
  })
  .onError(({ error, path }) => {
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

  app.listen(PORT, () => {
    console.log(
      `[Council] port=${PORT} tee=${getTEEMode()} trigger=${triggerMode}`,
    )
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
