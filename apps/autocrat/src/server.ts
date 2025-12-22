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
import { getBlockchain } from './blockchain'
import {
  getComputeTriggerClient,
  registerAutocratTriggers,
  startLocalCron,
} from './compute-trigger'
import { initLocalServices } from './local-services'
import { initModeration } from './moderation'
import { type AutocratOrchestrator, createOrchestrator } from './orchestrator'
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
import { getTEEMode } from './tee'
import type { CouncilConfig } from './types'

const PORT = parseInt(process.env.PORT || '8010', 10)
const isDev = process.env.NODE_ENV !== 'production'
const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`

const addr = (key: string) => (process.env[key] ?? ZERO_ADDR) as `0x${string}`
const agent = (id: string, name: string, prompt: string) => ({
  id,
  name,
  model: 'local',
  endpoint: 'local',
  systemPrompt: prompt,
})

export function getConfig(): CouncilConfig {
  return {
    rpcUrl:
      process.env.RPC_URL ??
      process.env.JEJU_RPC_URL ??
      'http://localhost:9545',
    daoId: process.env.DEFAULT_DAO ?? 'jeju',
    contracts: {
      council: addr('COUNCIL_ADDRESS'),
      ceoAgent: addr('CEO_AGENT_ADDRESS'),
      treasury: addr('TREASURY_ADDRESS'),
      feeConfig: addr('FEE_CONFIG_ADDRESS'),
      daoRegistry: addr('DAO_REGISTRY_ADDRESS'),
      daoFunding: addr('DAO_FUNDING_ADDRESS'),
      identityRegistry: addr('IDENTITY_REGISTRY_ADDRESS'),
      reputationRegistry: addr('REPUTATION_REGISTRY_ADDRESS'),
      packageRegistry: addr('PACKAGE_REGISTRY_ADDRESS'),
      repoRegistry: addr('REPO_REGISTRY_ADDRESS'),
      modelRegistry: addr('MODEL_REGISTRY_ADDRESS'),
    },
    agents: {
      ceo: agent('eliza-ceo', 'Eliza', 'AI CEO of Network DAO'),
      council: [
        agent('council-treasury', 'Treasury', 'Financial review'),
        agent('council-code', 'Code', 'Technical review'),
        agent('council-community', 'Community', 'Community impact'),
        agent('council-security', 'Security', 'Security review'),
      ],
      proposalAgent: agent(
        'proposal-agent',
        'Proposal Assistant',
        'Help craft proposals',
      ),
      researchAgent: agent('research-agent', 'Researcher', 'Deep research'),
      fundingAgent: agent(
        'funding-agent',
        'Funding Oracle',
        'Deep funding analysis',
      ),
    },
    parameters: {
      minQualityScore: 70,
      councilVotingPeriod: 259200,
      gracePeriod: 86400,
      minProposalStake: BigInt('10000000000000000'),
      quorumBps: 5000,
    },
    ceoPersona: {
      name: 'CEO',
      pfpCid: '',
      description: 'AI governance leader',
      personality: 'Professional and analytical',
      traits: ['decisive', 'fair', 'strategic'],
      voiceStyle: 'Clear and professional',
      communicationTone: 'professional',
      specialties: ['governance', 'strategy'],
    },
    fundingConfig: {
      minStake: BigInt('1000000000000000'),
      maxStake: BigInt('100000000000000000000'),
      epochDuration: 2592000,
      cooldownPeriod: 604800,
      matchingMultiplier: 10000,
      quadraticEnabled: true,
      ceoWeightCap: 5000,
    },
    cloudEndpoint: 'local',
    computeEndpoint: 'local',
    storageEndpoint: 'local',
  }
}

export const config = getConfig()
export const blockchain = getBlockchain(config)
export let orchestrator: AutocratOrchestrator | null = null

export function setOrchestrator(o: AutocratOrchestrator | null): void {
  orchestrator = o
}

export function getOrchestrator(): AutocratOrchestrator | null {
  return orchestrator
}

// Metrics for Prometheus
export const metricsData = { requests: 0, errors: 0, startTime: Date.now() }

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
  // Metrics middleware (count requests, skip /metrics and /health)
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

async function runOrchestratorCycle() {
  const start = Date.now()
  if (!orchestrator) {
    const orchestratorConfig = {
      rpcUrl: config.rpcUrl,
      daoRegistry: config.contracts.daoRegistry as Address,
      daoFunding: config.contracts.daoFunding as Address,
      contracts: {
        daoRegistry: config.contracts.daoRegistry as Address,
        daoFunding: config.contracts.daoFunding as Address,
      },
    }
    orchestrator = createOrchestrator(orchestratorConfig, blockchain)
    await orchestrator.start()
  }
  const status = orchestrator.getStatus()
  return {
    cycleCount: status.cycleCount,
    processedProposals: status.totalProcessed,
    duration: Date.now() - start,
  }
}

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
    orchestrator = createOrchestrator(orchestratorConfig, blockchain)
    await orchestrator.start()
    if (triggerMode === 'local') startLocalCron(runOrchestratorCycle)
  }
}

start()

export { app, runOrchestratorCycle }
export type App = typeof app
