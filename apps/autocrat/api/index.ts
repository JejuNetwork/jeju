/**
 * Network Council - AI DAO Governance
 *
 * DECENTRALIZED ARCHITECTURE:
 * 1. CovenantSQL (CQL) required for state persistence
 *    - Set CQL_BLOCK_PRODUCER_ENDPOINT or start: docker compose up -d
 *
 * 2. DWS Compute required for AI inference
 *    - Automatically configured per network (JEJU_NETWORK=localnet|testnet|mainnet)
 *
 * 3. Contract deployment is OPTIONAL:
 *    - ERC8004 registries (identity, reputation, validation) return empty when not deployed
 *    - Futarchy (council, predictionMarket) returns empty arrays when not deployed
 *    - Set addresses to 0x0 to explicitly disable
 *
 * 4. Security:
 *    - OPERATOR_KEY or PRIVATE_KEY required for blockchain transactions
 *    - TEE mode determined by environment (disabled/simulation/hardware)
 *
 * 5. Service ports:
 *    - Council API: PORT (default: 8010)
 *    - CEO Server: CEO_PORT (default: 8004, separate process)
 */

import { cors } from '@elysiajs/cors'
import {
  CORE_PORTS,
  getChainId,
  getContract,
  getNetworkName,
  getRpcUrl,
} from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { expectValid } from '@jejunetwork/types'
import {
  type CouncilConfig,
  CasualProposalCategorySchema,
  ProposalTypeSchema,
} from '../lib'
import { createAutocratA2AServer } from './a2a-server'
import { autocratAgentRuntime } from './agents/runtime'
import { getBlockchain } from './blockchain'
import {
  getComputeTriggerClient,
  type OrchestratorTriggerResult,
  registerAutocratTriggers,
  startLocalCron,
} from './compute-trigger'
import { createDAOService, type DAOService } from './dao-service'
import { type ERC8004Config, getERC8004Client } from './erc8004'
import { type FundingOracle, getFundingOracle } from './funding-oracle'
import { type FutarchyConfig, getFutarchyClient } from './futarchy'
import { initLocalServices } from './local-services'
import { createAutocratMCPServer } from './mcp-server'
import {
  expectFlagType,
  getModerationSystem,
  initModeration,
} from './moderation'
import { type AutocratOrchestrator, createOrchestrator } from './orchestrator'
import type { CasualSubmission, ProposalDraft } from './proposal-assistant'
import { getProposalAssistant } from './proposal-assistant'
import {
  getRegistryIntegrationClient,
  type RegistryIntegrationConfig,
} from './registry-integration'
import { getResearchAgent } from './research-agent'
import { getTEEMode } from './tee'

/**
 * Transform raw request body to ProposalDraft
 */
function toProposalDraft(raw: {
  daoId: string
  title: string
  summary: string
  description: string
  proposalType: number
  casualCategory?: string
  targetContract?: `0x${string}`
  calldata?: `0x${string}`
  value?: string
  tags?: string[]
  linkedPackageId?: string
  linkedRepoId?: string
}): ProposalDraft {
  return {
    daoId: raw.daoId,
    title: raw.title,
    summary: raw.summary,
    description: raw.description,
    proposalType: expectValid(
      ProposalTypeSchema,
      raw.proposalType,
      'proposal type',
    ),
    casualCategory: raw.casualCategory
      ? expectValid(
          CasualProposalCategorySchema,
          raw.casualCategory,
          'casual category',
        )
      : undefined,
    targetContract: raw.targetContract,
    callData: raw.calldata,
    value: raw.value,
    tags: raw.tags,
    linkedPackageId: raw.linkedPackageId,
    linkedRepoId: raw.linkedRepoId,
  }
}

import { expect, ZERO_ADDRESS } from '@jejunetwork/types'
import { z } from 'zod'
import {
  A2AJsonRpcResponseSchema,
  AgentFeedbackRequestSchema,
  AgentRegisterRequestSchema,
  AssessProposalRequestSchema,
  CasualAssessRequestSchema,
  CasualHelpRequestSchema,
  extractA2AData,
  FactCheckRequestSchema,
  FutarchyEscalateRequestSchema,
  FutarchyExecuteRequestSchema,
  FutarchyResolveRequestSchema,
  GenerateProposalRequestSchema,
  ImproveProposalRequestSchema,
  ModerationFlagRequestSchema,
  ModerationResolveRequestSchema,
  ModerationVoteRequestSchema,
  OrchestratorActiveRequestSchema,
  PaginationQuerySchema,
  ProposalDraftSchema,
  ProposalIdSchema,
  RegistryProfilesRequestSchema,
  ResearchRequestSchema,
  toAddress,
} from '../lib'
import { parseBigInt } from './validation'

// Helper to safely get contract addresses - uses config with env override
const getContractAddr = (category: string, name: string) => {
  try {
    return toAddress(
      getContract(
        category as
          | 'governance'
          | 'registry'
          | 'tokens'
          | 'moderation'
          | 'defi'
          | 'oif'
          | 'eil'
          | 'payments'
          | 'nodeStaking'
          | 'jns'
          | 'security',
        name,
      ),
    )
  } catch {
    return ZERO_ADDRESS
  }
}

const agent = (id: string, name: string, prompt: string) => ({
  id,
  name,
  model: 'local',
  endpoint: 'local',
  systemPrompt: prompt,
})

function getConfig(): CouncilConfig {
  return {
    rpcUrl: getRpcUrl(),
    daoId: process.env.DEFAULT_DAO ?? 'jeju',
    contracts: {
      council: getContractAddr('governance', 'council'),
      ceoAgent: getContractAddr('governance', 'ceoAgent'),
      treasury: getContractAddr('governance', 'treasury'),
      feeConfig: getContractAddr('payments', 'feeConfig'),
      daoRegistry: getContractAddr('governance', 'daoRegistry'),
      daoFunding: getContractAddr('governance', 'daoFunding'),
      identityRegistry: getContractAddr('registry', 'identity'),
      reputationRegistry: getContractAddr('registry', 'reputation'),
      packageRegistry: getContractAddr('registry', 'package'),
      repoRegistry: getContractAddr('registry', 'repo'),
      modelRegistry: getContractAddr('registry', 'model'),
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

const config = getConfig()
const blockchain = getBlockchain(config)
const a2aServer = createAutocratA2AServer(config, blockchain)
const mcpServer = createAutocratMCPServer(config, blockchain)

async function callA2AInternal(
  skillId: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const response = await a2aServer.getRouter().fetch(
    new Request('http://localhost/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            messageId: `rest-${Date.now()}`,
            parts: [{ kind: 'data', data: { skillId, params } }],
          },
        },
      }),
    }),
  )
  const result = expectValid(
    A2AJsonRpcResponseSchema,
    await response.json(),
    `A2A call for skill '${skillId}'`,
  )
  return extractA2AData<Record<string, unknown>>(
    result,
    `A2A call for skill '${skillId}'`,
  )
}

let orchestrator: AutocratOrchestrator | null = null

// Proposal Assistant API
const proposalAssistant = getProposalAssistant()

// Research Agent API
const researchAgent = getResearchAgent()

// ERC-8004 Agent Registry API
const erc8004Config: ERC8004Config = {
  rpcUrl: config.rpcUrl,
  identityRegistry: config.contracts.identityRegistry,
  reputationRegistry: config.contracts.reputationRegistry,
  validationRegistry: getContractAddr('registry', 'validation'),
  operatorKey: process.env.OPERATOR_KEY ?? process.env.PRIVATE_KEY,
}
const erc8004 = getERC8004Client(erc8004Config)

// Futarchy API
const predictionMarketAddr =
  'predictionMarket' in config.contracts
    ? config.contracts.predictionMarket
    : undefined
const futarchyConfig: FutarchyConfig = {
  rpcUrl: config.rpcUrl,
  councilAddress: toAddress(config.contracts.council),
  predictionMarketAddress:
    typeof predictionMarketAddr === 'string'
      ? toAddress(predictionMarketAddr)
      : ZERO_ADDRESS,
  operatorKey: process.env.OPERATOR_KEY ?? process.env.PRIVATE_KEY,
}
const futarchy = getFutarchyClient(futarchyConfig)

// Moderation API
const moderation = getModerationSystem()

// DAO Registry API - Multi-tenant DAO management
let daoService: DAOService | null = null
let fundingOracle: FundingOracle | null = null

const initDAOService = () => {
  if (!daoService && config.contracts.daoRegistry !== ZERO_ADDRESS) {
    daoService = createDAOService({
      rpcUrl: config.rpcUrl,
      chainId: getChainId(),
      daoRegistryAddress: config.contracts.daoRegistry,
      daoFundingAddress: config.contracts.daoFunding,
      privateKey: process.env.OPERATOR_KEY ?? process.env.PRIVATE_KEY,
    })
    fundingOracle = getFundingOracle()
  }
  return daoService
}

// Registry Integration API - Deep AI DAO integration
const registryConfig: RegistryIntegrationConfig = {
  rpcUrl: config.rpcUrl,
  integrationContract: getContractAddr('governance', 'registryIntegration'),
  identityRegistry: config.contracts.identityRegistry,
  reputationRegistry: config.contracts.reputationRegistry,
  delegationRegistry: getContractAddr('governance', 'delegationRegistry'),
}
const registryIntegration = getRegistryIntegrationClient(registryConfig)

// Prometheus metrics
const metricsData = { requests: 0, errors: 0, startTime: Date.now() }

async function runOrchestratorCycle(): Promise<OrchestratorTriggerResult> {
  const start = Date.now()
  if (!orchestrator) {
    const orchestratorConfig: import('./orchestrator').AutocratConfig = {
      rpcUrl: config.rpcUrl,
      daoRegistry: config.contracts.daoRegistry,
      daoFunding: config.contracts.daoFunding,
      contracts: {
        daoRegistry: config.contracts.daoRegistry,
        daoFunding: config.contracts.daoFunding,
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

const app = new Elysia()
  .use(cors())
  .onRequest(({ request }) => {
    const path = new URL(request.url).pathname
    if (path !== '/metrics' && path !== '/health') metricsData.requests++
  })
  .onError(({ error, request }) => {
    metricsData.errors++
    const path = new URL(request.url).pathname
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`[Error] ${request.method} ${path}:`, errorMessage)
    return { error: errorMessage }
  })
  .mount('/a2a', a2aServer.getRouter().fetch)
  .mount('/mcp', mcpServer.getRouter().fetch)
  .get('/.well-known/agent-card.json', ({ redirect }) =>
    redirect('/a2a/.well-known/agent-card.json'),
  )
  .get('/api/v1/proposals', async ({ query }) => {
    const active = query.active === 'true'
    const result = await callA2AInternal('list-proposals', {
      activeOnly: active,
    })
    return result
  })
  .get('/api/v1/proposals/:id', async ({ params }) => {
    const proposalId = ProposalIdSchema.parse(params.id)
    const result = await callA2AInternal('get-proposal', { proposalId })
    return result
  })
  .get('/api/v1/ceo', async () => callA2AInternal('get-ceo-status'))
  .get('/api/v1/governance/stats', async () =>
    callA2AInternal('get-governance-stats'),
  )
  .get('/api/v1/ceo/models', async () => {
    const models = await blockchain.getModelCandidates()
    return { models }
  })
  .get('/api/v1/ceo/decisions', async ({ query }) => {
    const limitSchema = z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(100))
      .optional()
    const limit = limitSchema.parse(query.limit) ?? 10
    const decisions = await blockchain.getRecentDecisions(limit)
    return { decisions }
  })
  .post('/api/v1/orchestrator/start', async () => {
    expect(
      orchestrator === null || orchestrator.getStatus().running !== true,
      'Orchestrator already running',
    )
    const orchestratorConfig: import('./orchestrator').AutocratConfig = {
      rpcUrl: config.rpcUrl,
      daoRegistry: config.contracts.daoRegistry,
      daoFunding: config.contracts.daoFunding,
      contracts: {
        daoRegistry: config.contracts.daoRegistry,
        daoFunding: config.contracts.daoFunding,
      },
    }
    orchestrator = createOrchestrator(orchestratorConfig, blockchain)
    await orchestrator.start()
    expect(orchestrator !== null, 'Failed to create orchestrator')
    return { status: 'started', ...orchestrator.getStatus() }
  })
  .post('/api/v1/orchestrator/stop', async () => {
    if (!orchestrator) {
      throw new Error('Orchestrator not running')
    }
    expect(
      orchestrator.getStatus().running === true,
      'Orchestrator not running',
    )
    await orchestrator.stop()
    return { status: 'stopped' }
  })
  .get('/api/v1/orchestrator/status', () => {
    if (!orchestrator) {
      return {
        running: false,
        cycleCount: 0,
        message: 'Orchestrator not initialized',
      }
    }
    return orchestrator.getStatus()
  })
  .post('/trigger/orchestrator', async () => {
    const result = await runOrchestratorCycle()
    return { success: true, executionId: `exec-${Date.now()}`, ...result }
  })
  .get('/api/v1/triggers', async () => {
    const client = getComputeTriggerClient()
    if (!(await client.isAvailable()))
      return { mode: 'local', message: 'Using local cron', triggers: [] }
    return {
      mode: 'compute',
      triggers: await client.list({ active: true }),
    }
  })
  .get('/api/v1/triggers/history', async ({ query }) => {
    const client = getComputeTriggerClient()
    if (!(await client.isAvailable())) return { mode: 'local', executions: [] }
    const limitSchema = z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(1000))
      .optional()
    const limit = limitSchema.parse(query.limit) ?? 50
    return {
      mode: 'compute',
      executions: await client.getHistory(undefined, limit),
    }
  })
  .post('/api/v1/triggers/execute', async () => runOrchestratorCycle())
  .post('/api/v1/proposals/assess', async ({ body }) => {
    const draftRaw = AssessProposalRequestSchema.parse(body)
    const draft = toProposalDraft(draftRaw)
    const assessment = await proposalAssistant.assessQuality(draft)
    return assessment
  })
  .post('/api/v1/proposals/check-duplicates', async ({ body }) => {
    const draftRaw = ProposalDraftSchema.parse(body)
    const draft = toProposalDraft(draftRaw)
    const duplicates = await proposalAssistant.checkDuplicates(draft)
    return { duplicates }
  })
  .post('/api/v1/proposals/improve', async ({ body }) => {
    const parsed = ImproveProposalRequestSchema.parse(body)
    const draft = toProposalDraft(parsed.draft)
    const improved = await proposalAssistant.improveProposal(
      draft,
      parsed.criterion,
    )
    return { improved }
  })
  .post('/api/v1/proposals/generate', async ({ body }) => {
    const parsed = GenerateProposalRequestSchema.parse(body)
    const draft = await proposalAssistant.generateProposal(
      parsed.idea,
      parsed.proposalType ?? 0,
    )
    return draft
  })
  .post('/api/v1/proposals/quick-score', async ({ body }) => {
    const draftRaw = ProposalDraftSchema.parse(body)
    const draft = toProposalDraft(draftRaw)
    const score = proposalAssistant.quickScore(draft)
    const contentHash = proposalAssistant.getContentHash(draft)
    return {
      score,
      contentHash,
      readyForFullAssessment: score >= 60,
    }
  })
  .post('/api/v1/research/conduct', async ({ body }) => {
    const request = ResearchRequestSchema.parse(body)
    const report = await researchAgent.conductResearch(request)
    return report
  })
  .post('/api/v1/research/quick-screen', async ({ body }) => {
    const request = ResearchRequestSchema.parse(body)
    const result = await researchAgent.quickScreen(request)
    return result
  })
  .post('/api/v1/research/fact-check', async ({ body }) => {
    const parsed = FactCheckRequestSchema.parse(body)
    const result = await researchAgent.factCheck(
      parsed.claim,
      parsed.context ?? '',
    )
    return result
  })
  .get('/api/v1/agents/count', async () => {
    const count = await erc8004.getTotalAgents()
    return { count }
  })
  .get('/api/v1/agents/:id', async ({ params }) => {
    const idParam = z.string().min(1).parse(params.id)
    const agentId = parseBigInt(idParam, 'Agent ID')
    const identity = await erc8004.getAgentIdentity(agentId)
    expect(identity !== null, 'Agent not found')
    const reputation = await erc8004.getAgentReputation(agentId)
    const validation = await erc8004.getValidationSummary(agentId)
    return { ...identity, reputation, validation }
  })
  .post('/api/v1/agents/register', async ({ body }) => {
    const parsed = AgentRegisterRequestSchema.parse(body)
    const agentId = await erc8004.registerAgent(
      parsed.name,
      parsed.role,
      parsed.a2aEndpoint ?? '',
      parsed.mcpEndpoint ?? '',
    )
    expect(agentId > 0n, 'Agent registration failed')
    return { agentId: agentId.toString(), registered: true }
  })
  .post('/api/v1/agents/:id/feedback', async ({ params, body }) => {
    const idParam = z.string().min(1).parse(params.id)
    const agentId = parseBigInt(idParam, 'Agent ID')
    const parsed = AgentFeedbackRequestSchema.parse(body)
    const txHash = await erc8004.submitFeedback(
      agentId,
      parsed.score,
      parsed.tag,
      parsed.details,
    )
    return { success: true, txHash }
  })
  .get('/api/v1/futarchy/vetoed', async () => {
    const proposals = await futarchy.getVetoedProposals()
    return { proposals }
  })
  .get('/api/v1/futarchy/pending', async () => {
    const proposals = await futarchy.getPendingFutarchyProposals()
    return { proposals }
  })
  .get('/api/v1/futarchy/market/:proposalId', async ({ params }) => {
    const proposalId = ProposalIdSchema.parse(params.proposalId)
    const market = await futarchy.getFutarchyMarket(proposalId)
    expect(market !== null, 'No futarchy market for this proposal')
    return market
  })
  .post('/api/v1/futarchy/escalate', async ({ body }) => {
    const parsed = FutarchyEscalateRequestSchema.parse(body)
    const result = await futarchy.escalateToFutarchy(parsed.proposalId)
    return result
  })
  .post('/api/v1/futarchy/resolve', async ({ body }) => {
    const parsed = FutarchyResolveRequestSchema.parse(body)
    const result = await futarchy.resolveFutarchy(parsed.proposalId)
    return result
  })
  .post('/api/v1/futarchy/execute', async ({ body }) => {
    const parsed = FutarchyExecuteRequestSchema.parse(body)
    const result = await futarchy.executeFutarchyApproved(parsed.proposalId)
    return result
  })
  .get('/api/v1/futarchy/sentiment/:proposalId', async ({ params }) => {
    const proposalId = ProposalIdSchema.parse(params.proposalId)
    const sentiment = await futarchy.getMarketSentiment(proposalId)
    expect(sentiment !== null, 'No market for this proposal')
    return sentiment
  })
  .get('/api/v1/futarchy/parameters', async ({ set }) => {
    const params = await futarchy.getFutarchyParameters()
    if (!params) {
      set.status = 404
      return { error: 'Futarchy not deployed' }
    }
    return params
  })
  .post('/api/v1/moderation/flag', async ({ body }) => {
    const parsed = ModerationFlagRequestSchema.parse(body)
    const flag = await moderation.submitFlag(
      parsed.proposalId,
      parsed.flagger,
      expectFlagType(parsed.flagType),
      parsed.reason,
      parsed.stake ?? 10,
      parsed.evidence,
    )
    return flag
  })
  .post('/api/v1/moderation/vote', async ({ body }) => {
    const parsed = ModerationVoteRequestSchema.parse(body)
    await moderation.voteOnFlag(parsed.flagId, parsed.voter, parsed.upvote)
    return { success: true }
  })
  .post('/api/v1/moderation/resolve', async ({ body }) => {
    const parsed = ModerationResolveRequestSchema.parse(body)
    await moderation.resolveFlag(parsed.flagId, parsed.upheld)
    return { success: true }
  })
  .get('/api/v1/moderation/score/:proposalId', async ({ params }) => {
    const proposalId = ProposalIdSchema.parse(params.proposalId)
    const score = await moderation.getProposalModerationScore(proposalId)
    return score
  })
  .get('/api/v1/moderation/flags/:proposalId', async ({ params }) => {
    const proposalId = ProposalIdSchema.parse(params.proposalId)
    const flags = await moderation.getProposalFlags(proposalId)
    return { flags }
  })
  .get('/api/v1/moderation/active-flags', async () => {
    const flags = await moderation.getActiveFlags()
    return { flags }
  })
  .get('/api/v1/moderation/leaderboard', async ({ query }) => {
    const limitSchema = z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(100))
      .optional()
    const limit = limitSchema.parse(query.limit) ?? 10
    const moderators = await moderation.getTopModerators(limit)
    return { moderators }
  })
  .get('/api/v1/moderation/moderator/:address', async ({ params }) => {
    const address = z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .parse(params.address)
    const stats = await moderation.getModeratorStats(toAddress(address))
    return stats
  })
  .get('/api/v1/moderation/should-reject/:proposalId', async ({ params }) => {
    const proposalId = ProposalIdSchema.parse(params.proposalId)
    const result = await moderation.shouldAutoReject(proposalId)
    return result
  })
  .get('/api/v1/dao/list', async ({ set }) => {
    const service = initDAOService()
    if (!service) {
      set.status = 503
      return { error: 'DAO Registry not deployed' }
    }
    const daoIds = await service.getAllDAOs()
    const daos = await Promise.all(daoIds.map((id) => service.getDAO(id)))
    return { daos }
  })
  .get('/api/v1/dao/active', async ({ set }) => {
    const service = initDAOService()
    if (!service) {
      set.status = 503
      return { error: 'DAO Registry not deployed' }
    }
    const daoIds = await service.getActiveDAOs()
    const daos = await Promise.all(daoIds.map((id) => service.getDAOFull(id)))
    return { daos }
  })
  .get('/api/v1/dao/:daoId', async ({ params }) => {
    const service = initDAOService()
    if (!service) {
      throw new Error('DAO Registry not deployed')
    }
    const daoId = z.string().min(1).max(100).parse(params.daoId)
    const exists = await service.daoExists(daoId)
    expect(exists, 'DAO not found')
    const dao = await service.getDAOFull(daoId)
    return dao
  })
  .get('/api/v1/dao/:daoId/persona', async ({ params, set }) => {
    const service = initDAOService()
    if (!service) {
      set.status = 503
      return { error: 'DAO Registry not deployed' }
    }
    const persona = await service.getCEOPersona(params.daoId)
    return persona
  })
  .get('/api/v1/dao/:daoId/council', async ({ params, set }) => {
    const service = initDAOService()
    if (!service) {
      set.status = 503
      return { error: 'DAO Registry not deployed' }
    }
    const members = await service.getCouncilMembers(params.daoId)
    return { members }
  })
  .get('/api/v1/dao/:daoId/packages', async ({ params, set }) => {
    const service = initDAOService()
    if (!service) {
      set.status = 503
      return { error: 'DAO Registry not deployed' }
    }
    const packages = await service.getLinkedPackages(params.daoId)
    return { packages }
  })
  .get('/api/v1/dao/:daoId/repos', async ({ params, set }) => {
    const service = initDAOService()
    if (!service) {
      set.status = 503
      return { error: 'DAO Registry not deployed' }
    }
    const repos = await service.getLinkedRepos(params.daoId)
    return { repos }
  })
  .get('/api/v1/dao/:daoId/funding/epoch', async ({ params, set }) => {
    const service = initDAOService()
    if (!service) {
      set.status = 503
      return { error: 'DAO Registry not deployed' }
    }
    const epoch = await service.getCurrentEpoch(params.daoId)
    return { epoch }
  })
  .get('/api/v1/dao/:daoId/funding/projects', async ({ params, set }) => {
    const service = initDAOService()
    if (!service) {
      set.status = 503
      return { error: 'DAO Registry not deployed' }
    }
    const projects = await service.getActiveProjects(params.daoId)
    return { projects }
  })
  .get('/api/v1/dao/:daoId/funding/allocations', async ({ params, set }) => {
    const service = initDAOService()
    if (!service) {
      set.status = 503
      return { error: 'DAO Registry not deployed' }
    }
    const allocations = await service.getFundingAllocations(params.daoId)
    return { allocations }
  })
  .get('/api/v1/dao/:daoId/funding/summary', async ({ params, set }) => {
    initDAOService()
    if (!fundingOracle) {
      set.status = 503
      return { error: 'DAO Registry not deployed' }
    }
    const summary = await fundingOracle.getEpochSummary(params.daoId)
    return summary
  })
  .get(
    '/api/v1/dao/:daoId/funding/recommendations',
    async ({ params, set }) => {
      initDAOService()
      if (!fundingOracle) {
        set.status = 503
        return { error: 'DAO Registry not deployed' }
      }
      const recommendations = await fundingOracle.generateCEORecommendations(
        params.daoId,
      )
      return recommendations
    },
  )
  .get('/api/v1/dao/:daoId/funding/knobs', async ({ params, set }) => {
    initDAOService()
    if (!fundingOracle) {
      set.status = 503
      return { error: 'DAO Registry not deployed' }
    }
    const knobs = await fundingOracle.getKnobs(params.daoId)
    return knobs
  })
  .post('/api/v1/dao/:daoId/casual/assess', async ({ params, body }) => {
    const daoId = z.string().min(1).max(100).parse(params.daoId)
    const parsed = CasualAssessRequestSchema.parse(body)
    const submission: CasualSubmission = {
      daoId,
      category: parsed.category,
      title: parsed.title,
      content: parsed.content,
    }
    const assessment =
      await proposalAssistant.assessCasualSubmission(submission)
    return assessment
  })
  .post('/api/v1/dao/:daoId/casual/help', async ({ params, body }) => {
    const daoId = z.string().min(1).max(100).parse(params.daoId)
    const parsed = CasualHelpRequestSchema.parse(body)
    const help = await proposalAssistant.helpCraftSubmission(
      parsed.category,
      parsed.content ?? '',
      daoId,
    )
    return help
  })
  .get('/api/v1/casual/categories', () => {
    const categories = proposalAssistant.getAllCategories()
    return { categories }
  })
  .get('/api/v1/orchestrator/dao/:daoId', ({ params, set }) => {
    if (!orchestrator) {
      throw new Error('Orchestrator not running')
    }
    const status = orchestrator.getDAOStatus(params.daoId)
    if (!status) {
      set.status = 404
      return { error: 'DAO not tracked' }
    }
    return status
  })
  .post('/api/v1/orchestrator/dao/:daoId/refresh', async ({ params, set }) => {
    if (!orchestrator) {
      set.status = 503
      return { error: 'Orchestrator not running' }
    }
    await orchestrator.refreshDAO(params.daoId)
    return { success: true }
  })
  .post('/api/v1/orchestrator/dao/:daoId/active', async ({ params, body }) => {
    if (!orchestrator) {
      throw new Error('Orchestrator not running')
    }
    const daoId = z.string().min(1).max(100).parse(params.daoId)
    const parsed = OrchestratorActiveRequestSchema.parse(body)
    orchestrator.setDAOActive(daoId, parsed.active)
    return { success: true }
  })
  .get('/api/v1/registry/profile/:agentId', async ({ params }) => {
    const idParam = z.string().min(1).parse(params.agentId)
    const agentId = parseBigInt(idParam, 'Agent ID')
    const profile = await registryIntegration.getAgentProfile(agentId)
    if (!profile) {
      throw new Error('Agent not found')
    }
    return {
      ...profile,
      agentId: profile.agentId.toString(),
      stakedAmount: profile.stakedAmount.toString(),
    }
  })
  .post('/api/v1/registry/profiles', async ({ body }) => {
    const parsed = RegistryProfilesRequestSchema.parse(body)
    const profiles = await registryIntegration.getAgentProfiles(
      parsed.agentIds.map((id) => BigInt(id)),
    )
    return {
      profiles: profiles.map((p) => ({
        ...p,
        agentId: p.agentId.toString(),
        stakedAmount: p.stakedAmount.toString(),
      })),
    }
  })
  .get('/api/v1/registry/voting-power/:address', async ({ params, query }) => {
    const address = z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .parse(params.address)
    const agentIdParam = query.agentId
    const baseVotesParam = query.baseVotes
    const agentId = agentIdParam ? BigInt(agentIdParam) : 0n
    const baseVotes = baseVotesParam
      ? BigInt(baseVotesParam)
      : BigInt('1000000000000000000')
    const power = await registryIntegration.getVotingPower(
      toAddress(address),
      agentId,
      baseVotes,
    )
    return {
      ...power,
      baseVotes: power.baseVotes.toString(),
      effectiveVotes: power.effectiveVotes.toString(),
    }
  })
  .get('/api/v1/registry/search/tag/:tag', async ({ params, query }) => {
    const tag = z.string().min(1).max(50).parse(params.tag)
    const parsed = PaginationQuerySchema.parse(query)
    const offset = parsed.offset ?? 0
    const limit = parsed.limit ?? 50
    const result = await registryIntegration.searchByTag(tag, offset, limit)
    return {
      ...result,
      agentIds: result.agentIds.map((id) => id.toString()),
    }
  })
  .get('/api/v1/registry/search/score', async ({ query }) => {
    const minScore = parseInt(query.minScore ?? '50', 10)
    const offset = parseInt(query.offset ?? '0', 10)
    const limit = parseInt(query.limit ?? '50', 10)
    const result = await registryIntegration.getAgentsByScore(
      minScore,
      offset,
      limit,
    )
    return {
      agentIds: result.agentIds.map((id) => id.toString()),
      scores: result.scores,
    }
  })
  .get('/api/v1/registry/top-agents', async ({ query }) => {
    const count = parseInt(query.count ?? '10', 10)
    const profiles = await registryIntegration.getTopAgents(count)
    return {
      agents: profiles.map((p) => ({
        ...p,
        agentId: p.agentId.toString(),
        stakedAmount: p.stakedAmount.toString(),
      })),
    }
  })
  .get('/api/v1/registry/active-agents', async ({ query }) => {
    const offset = parseInt(query.offset ?? '0', 10)
    const limit = parseInt(query.limit ?? '100', 10)
    const agentIds = await registryIntegration.getActiveAgents(offset, limit)
    return {
      agentIds: agentIds.map((id) => id.toString()),
      total: await registryIntegration.getTotalAgents(),
      offset,
      limit,
    }
  })
  .get('/api/v1/registry/providers', async () => {
    const providers = await registryIntegration.getAllProviderReputations()
    return {
      providers: providers.map((p) => ({
        ...p,
        providerAgentId: p.providerAgentId.toString(),
        stakeAmount: p.stakeAmount.toString(),
      })),
    }
  })
  .get('/api/v1/registry/weighted-reputation/:agentId', async ({ params }) => {
    const agentId = BigInt(params.agentId)
    const result = await registryIntegration.getWeightedAgentReputation(agentId)
    return result
  })
  .get('/api/v1/registry/eligibility/:agentId', async ({ params }) => {
    const agentId = BigInt(params.agentId)
    const [proposal, vote, research] = await Promise.all([
      registryIntegration.canSubmitProposal(agentId),
      registryIntegration.canVote(agentId),
      registryIntegration.canConductResearch(agentId),
    ])
    return {
      agentId: agentId.toString(),
      canSubmitProposal: proposal,
      canVote: vote,
      canConductResearch: research,
    }
  })
  .get('/api/v1/registry/delegate/:address', async ({ params, set }) => {
    const addressParam = z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .parse(params.address)
    const delegate = await registryIntegration.getDelegate(
      toAddress(addressParam),
    )
    if (!delegate) {
      set.status = 404
      return { error: 'Not a registered delegate' }
    }
    return {
      ...delegate,
      agentId: delegate.agentId.toString(),
      totalDelegated: delegate.totalDelegated.toString(),
    }
  })
  .get('/api/v1/registry/top-delegates', async ({ query }) => {
    const limit = parseInt(query.limit ?? '10', 10)
    const delegates = await registryIntegration.getTopDelegates(limit)
    return {
      delegates: delegates.map(
        (d: {
          delegate: string
          agentId: bigint
          name: string
          totalDelegated: bigint
          delegatorCount: number
          isActive: boolean
        }) => ({
          ...d,
          agentId: d.agentId.toString(),
          totalDelegated: d.totalDelegated.toString(),
        }),
      ),
    }
  })
  .get('/api/v1/registry/security-council', async () => {
    const council = await registryIntegration.getSecurityCouncil()
    return {
      members: council.map(
        (m: {
          member: string
          agentId: bigint
          combinedScore: number
          electedAt: number
        }) => ({
          ...m,
          agentId: m.agentId.toString(),
        }),
      ),
    }
  })
  .get('/api/v1/registry/is-council-member/:address', async ({ params }) => {
    const addressParam = z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .parse(params.address)
    const isMember = await registryIntegration.isSecurityCouncilMember(
      toAddress(addressParam),
    )
    return { isMember }
  })
  .get('/health', () => ({
    status: 'ok',
    service: 'jeju-council',
    version: '3.0.0',
    mode: 'multi-tenant',
    tee: getTEEMode(),
    orchestrator: orchestrator?.getStatus().running ?? false,
    daoCount: orchestrator?.getStatus().daoCount ?? 0,
    daoRegistry: config.contracts.daoRegistry !== ZERO_ADDRESS,
    daoFunding: config.contracts.daoFunding !== ZERO_ADDRESS,
    erc8004: {
      identity: erc8004.identityDeployed,
      reputation: erc8004.reputationDeployed,
      validation: erc8004.validationDeployed,
    },
    futarchy: {
      council: futarchy.councilDeployed,
      predictionMarket: futarchy.predictionMarketDeployed,
    },
    registry: {
      integration: !!registryConfig.integrationContract,
      delegation: !!registryConfig.delegationRegistry,
    },
    endpoints: {
      a2a: '/a2a',
      mcp: '/mcp',
      rest: '/api/v1',
      dao: '/api/v1/dao',
      agents: '/api/v1/agents',
      futarchy: '/api/v1/futarchy',
      moderation: '/api/v1/moderation',
      registry: '/api/v1/registry',
    },
  }))
  .get('/metrics', async () => {
    const mem = process.memoryUsage()
    const uptime = (Date.now() - metricsData.startTime) / 1000
    const orch = orchestrator?.getStatus()
    const activeFlags = (await moderation.getActiveFlags()).length
    const lines = [
      '# HELP council_requests_total Total HTTP requests',
      '# TYPE council_requests_total counter',
      `council_requests_total ${metricsData.requests}`,
      '# HELP council_errors_total Total errors',
      '# TYPE council_errors_total counter',
      `council_errors_total ${metricsData.errors}`,
      '# HELP council_uptime_seconds Service uptime',
      '# TYPE council_uptime_seconds gauge',
      `council_uptime_seconds ${uptime.toFixed(0)}`,
      '# HELP council_memory_bytes Memory usage',
      '# TYPE council_memory_bytes gauge',
      `council_memory_bytes{type="heap"} ${mem.heapUsed}`,
      `council_memory_bytes{type="rss"} ${mem.rss}`,
      '# HELP council_orchestrator_cycles Total orchestrator cycles',
      '# TYPE council_orchestrator_cycles counter',
      `council_orchestrator_cycles ${orch?.cycleCount ?? 0}`,
      '# HELP council_proposals_processed Total proposals processed',
      '# TYPE council_proposals_processed counter',
      `council_proposals_processed ${orch?.totalProcessed ?? 0}`,
      '# HELP council_moderation_flags_active Active moderation flags',
      '# TYPE council_moderation_flags_active gauge',
      `council_moderation_flags_active ${activeFlags}`,
    ]
    return new Response(lines.join('\n'), {
      headers: { 'Content-Type': 'text/plain' },
    })
  })
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
      research: '/api/v1/research',
      agents: '/api/v1/agents',
      futarchy: '/api/v1/futarchy',
      moderation: '/api/v1/moderation',
      registry: '/api/v1/registry',
      ceo: '/api/v1/ceo',
      health: '/health',
    },
  }))

const port = CORE_PORTS.AUTOCRAT_API.get()

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

  console.log(
    `[Council] port=${port} tee=${getTEEMode()} trigger=${triggerMode}`,
  )

  if (blockchain.councilDeployed) {
    const orchestratorConfig: import('./orchestrator').AutocratConfig = {
      rpcUrl: config.rpcUrl,
      daoRegistry: config.contracts.daoRegistry,
      daoFunding: config.contracts.daoFunding,
      contracts: {
        daoRegistry: config.contracts.daoRegistry,
        daoFunding: config.contracts.daoFunding,
      },
    }
    orchestrator = createOrchestrator(orchestratorConfig, blockchain)
    await orchestrator.start()
    if (triggerMode === 'local') startLocalCron(runOrchestratorCycle)
  }

  app.listen(port)
}

start()

export default { port, fetch: app.fetch }
export { app, config }
export type {
  CasualProposalCategory,
  CEOPersona,
  CouncilConfig,
  FundingConfig,
  GovernanceParams,
} from '../lib'
export type {
  DAO,
  DAOFull,
  FundingAllocation,
  FundingEpoch,
  FundingProject,
} from '../lib/types'
export { createAutocratA2AServer } from './a2a-server'
export {
  type AgentVote,
  autocratAgentRuntime,
  type CEODecisionRequest,
  type DeliberationRequest,
} from './agents/runtime'
export { autocratAgentTemplates, getAgentByRole } from './agents/templates'
export { AutocratBlockchain, getBlockchain } from './blockchain'
export {
  getComputeTriggerClient,
  registerAutocratTriggers,
  startLocalCron,
} from './compute-trigger'
export { createDAOService, DAOService, getDAOService } from './dao-service'
export {
  type AgentIdentity,
  type AgentReputation,
  ERC8004Client,
  type ERC8004Config,
  getERC8004Client,
} from './erc8004'
export {
  type CEOFundingRecommendation,
  type EpochSummary,
  type FundingAnalysis,
  type FundingOracle,
  getFundingOracle,
} from './funding-oracle'
export {
  FutarchyClient,
  type FutarchyConfig,
  type FutarchyMarket,
  getFutarchyClient,
} from './futarchy'
export {
  getVotes,
  initLocalServices,
  retrieve,
  store,
  storeVote,
} from './local-services'
export { createAutocratMCPServer } from './mcp-server'
export {
  FlagType,
  getModerationSystem,
  type ModerationScore,
  ModerationSystem,
  type ModeratorStats,
  type ProposalFlag,
  type TrustRelation,
} from './moderation'
export { type AutocratOrchestrator, createOrchestrator } from './orchestrator'
export {
  type CasualAssessment,
  type CasualSubmission,
  getProposalAssistant,
  ProposalAssistant,
  type ProposalDraft,
  type QualityAssessment,
  type SimilarProposal,
} from './proposal-assistant'
export {
  type AgentProfile,
  type EligibilityResult,
  getRegistryIntegrationClient,
  type ProviderReputation,
  RegistryIntegrationClient,
  type RegistryIntegrationConfig,
  resetRegistryIntegrationClient,
  type SearchResult,
  type VotingPower,
} from './registry-integration'
export {
  generateResearchReport,
  getResearchAgent,
  quickScreenProposal,
  ResearchAgent,
  type ResearchReport,
  type ResearchRequest,
  type ResearchSection,
} from './research-agent'
export { decryptReasoning, getTEEMode, makeTEEDecision } from './tee'
