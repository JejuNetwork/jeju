/**
 * Autocrat API Server - Elysia
 *
 * AI-powered DAO governance with multi-tenant support.
 * Fully decentralized: CovenantSQL for state, DWS for compute, dstack for TEE.
 */

import { cors } from '@elysiajs/cors'
import { swagger } from '@elysiajs/swagger'
import { getNetworkName } from '@jejunetwork/config'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import { autocratAgentRuntime } from './agents'
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
import { casualRoutes } from './routes/casual'
import { daoRoutes } from './routes/dao'
import { fundingRoutes } from './routes/funding'
import { futarchyRoutes } from './routes/futarchy'
import { healthRoutes } from './routes/health'
import { mcpRoutes } from './routes/mcp'
import { moderationRoutes } from './routes/moderation'
import { orchestratorRoutes } from './routes/orchestrator'
import { proposalsRoutes } from './routes/proposals'
import { registryRoutes } from './routes/registry'
import { researchRoutes } from './routes/research'
import { triggersRoutes } from './routes/triggers'
import {
  blockchain,
  config,
  metricsData,
  runOrchestratorCycle,
  setOrchestrator,
} from './shared-state'
import { getTEEMode } from './tee'

const PORT = parseInt(process.env.PORT || '8010', 10)
const isDev = process.env.NODE_ENV !== 'production'

const app = new Elysia()
  .use(cors({ origin: isDev ? '*' : 'https://autocrat.jejunetwork.org' }))
  .use(
    swagger({
      documentation: {
        info: {
          title: 'Autocrat API',
          version: '3.0.0',
          description:
            'AI-powered DAO governance with multi-tenant support, futarchy, and deep research',
        },
        tags: [
          { name: 'health', description: 'Health and metrics' },
          { name: 'proposals', description: 'Proposal management' },
          { name: 'dao', description: 'Multi-tenant DAO management' },
          { name: 'futarchy', description: 'Prediction market governance' },
          { name: 'agents', description: 'ERC-8004 agent registry' },
          { name: 'moderation', description: 'Content moderation' },
          { name: 'research', description: 'AI research agent' },
          { name: 'registry', description: 'Registry integration' },
          { name: 'orchestrator', description: 'DAO orchestration' },
          { name: 'triggers', description: 'DWS compute triggers' },
          { name: 'casual', description: 'Casual proposal flow' },
          { name: 'funding', description: 'Deep funding' },
          { name: 'a2a', description: 'Agent-to-Agent protocol' },
          { name: 'mcp', description: 'Model Context Protocol' },
        ],
      },
    }),
  )
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
  .use(a2aRoutes)
  .use(mcpRoutes)
  // Root info
  .get('/', () => ({
    name: `${getNetworkName()} Autocrat`,
    version: '3.0.0',
    description: 'Multi-tenant DAO governance with AI CEOs and deep funding',
    features: [
      'Multi-DAO support (Jeju DAO, Babylon DAO, custom DAOs)',
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
      research: '/api/v1/research',
      agents: '/api/v1/agents',
      futarchy: '/api/v1/futarchy',
      moderation: '/api/v1/moderation',
      registry: '/api/v1/registry',
      ceo: '/api/v1/ceo',
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
    console.error(`[Error] ${path}:`, error.message)
    return { error: error.message }
  })

const autoStart = process.env.AUTO_START_ORCHESTRATOR !== 'false'
const useCompute = process.env.USE_COMPUTE_TRIGGER !== 'false'

async function start() {
  await initLocalServices()
  await initModeration()
  await autocratAgentRuntime.initialize()

  const computeClient = getComputeTriggerClient()
  const computeAvailable = await computeClient.isAvailable()
  let triggerMode = 'local'

  if (computeAvailable && useCompute) {
    await registerAutocratTriggers()
    triggerMode = 'compute'
  }

  app.listen(PORT, () => {
    console.log(`
[Council] Started on port ${PORT}
  TEE: ${getTEEMode()}
  Trigger: ${triggerMode}
  Endpoints: /a2a, /mcp, /api/v1
  Swagger: http://localhost:${PORT}/swagger
`)
  })

  if (autoStart && blockchain.councilDeployed) {
    const orchestratorConfig = {
      rpcUrl: config.rpcUrl,
      daoRegistry: config.contracts.daoRegistry as Address,
      daoFunding: config.contracts.daoFunding as Address,
      contracts: {
        daoRegistry: config.contracts.daoRegistry as Address,
        daoFunding: config.contracts.daoFunding as Address,
      },
    }
    const orchestrator = createOrchestrator(orchestratorConfig, blockchain)
    await orchestrator.start()
    setOrchestrator(orchestrator)
    if (triggerMode === 'local') startLocalCron(runOrchestratorCycle)
  }
}

start()

export { app }
export type App = typeof app

// Re-export shared state for backwards compatibility
export {
  blockchain,
  config,
  getOrchestrator,
  metricsData,
  runOrchestratorCycle,
  setOrchestrator,
} from './shared-state'
