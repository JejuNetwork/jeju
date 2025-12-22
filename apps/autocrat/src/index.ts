/**
 * Network Council - AI DAO Governance
 *
 * DECENTRALIZED ARCHITECTURE - NO FALLBACKS:
 * 1. CovenantSQL (CQL) required for state persistence
 *    - Set CQL_BLOCK_PRODUCER_ENDPOINT or start: docker compose up -d
 *
 * 2. DWS Compute required for AI inference
 *    - Automatically configured per network (JEJU_NETWORK=localnet|testnet|mainnet)
 *
 * 3. Contract deployment is OPTIONAL:
 *    - ERC8004 registries (identity, reputation, validation) return empty when not deployed
 *    - Futarchy (council, predimarket) returns empty arrays when not deployed
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

import { getNetworkName } from '@jejunetwork/config'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Address } from 'viem'
import { createAutocratA2AServer } from './a2a-server'
import { autocratAgentRuntime } from './agents'
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
  type FlagType,
  getModerationSystem,
  initModeration,
} from './moderation'
import { type AutocratOrchestrator, createOrchestrator } from './orchestrator'
import type {
  CasualProposalCategory,
  CasualSubmission,
  ProposalDraft,
} from './proposal-assistant'
import { getProposalAssistant } from './proposal-assistant'
import {
  getRegistryIntegrationClient,
  type RegistryIntegrationConfig,
} from './registry-integration'
import { getResearchAgent } from './research-agent'
import { getTEEMode } from './tee'
import type { CouncilConfig, ProposalType } from './types'

/**
 * Transform raw request body to ProposalDraft
 * Consolidates the repeated transformation pattern used across multiple endpoints
 */
function toProposalDraft(raw: {
  daoId: string
  title: string
  summary: string
  description: string
  proposalType: ProposalType
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
    proposalType: raw.proposalType,
    casualCategory: raw.casualCategory as CasualProposalCategory | undefined,
    targetContract: raw.targetContract,
    callData: raw.calldata,
    value: raw.value,
    tags: raw.tags,
    linkedPackageId: raw.linkedPackageId,
    linkedRepoId: raw.linkedRepoId,
  }
}

import { z } from 'zod'
import {
  AgentFeedbackRequestSchema,
  AgentRegisterRequestSchema,
  AssessProposalRequestSchema,
  CasualAssessRequestSchema,
  CasualHelpRequestSchema,
  expect,
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
  ProposalListQuerySchema,
  RegistryProfilesRequestSchema,
  ResearchRequestSchema,
} from './schemas'
import {
  parseAndValidateBody,
  parseAndValidateParam,
  parseAndValidateQuery,
  parseBigInt,
  successResponse,
} from './validation'

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`
const addr = (key: string) => (process.env[key] ?? ZERO_ADDR) as `0x${string}`
const agent = (id: string, name: string, prompt: string) => ({
  id,
  name,
  model: 'local',
  endpoint: 'local',
  systemPrompt: prompt,
})

function getConfig(): CouncilConfig {
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

async function callA2AInternal(
  app: Hono,
  skillId: string,
  params: Record<string, unknown> = {},
) {
  const response = await app.request('/a2a', {
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
  })
  const result = (await response.json()) as {
    result?: { parts?: Array<{ kind: string; data?: Record<string, unknown> }> }
    error?: { message: string }
  }
  if (result.error) {
    throw new Error(
      `A2A call failed for skill '${skillId}': ${result.error.message}`,
    )
  }
  const parts = result.result?.parts
  if (!parts || parts.length === 0) {
    throw new Error(`A2A call for skill '${skillId}' returned no parts`)
  }
  const dataPart = parts.find((p: { kind: string }) => p.kind === 'data')
  if (!dataPart || !dataPart.data) {
    throw new Error(`A2A call for skill '${skillId}' returned no data part`)
  }
  return dataPart.data
}

const config = getConfig()
const blockchain = getBlockchain(config)
const app = new Hono()

app.use('/*', cors())

const a2aServer = createAutocratA2AServer(config, blockchain)
const mcpServer = createAutocratMCPServer(config, blockchain)
app.route('/a2a', a2aServer.getRouter())
app.route('/mcp', mcpServer.getRouter())
app.get('/.well-known/agent-card.json', (c) =>
  c.redirect('/a2a/.well-known/agent-card.json'),
)

app.get('/api/v1/proposals', async (c) => {
  const query = parseAndValidateQuery(
    c,
    ProposalListQuerySchema,
    'Proposals list query',
  )
  const result = await callA2AInternal(app, 'list-proposals', {
    activeOnly: query.active === 'true',
  })
  return successResponse(c, result)
})
app.get('/api/v1/proposals/:id', async (c) => {
  const proposalId = parseAndValidateParam(
    c,
    'id',
    ProposalIdSchema,
    'Proposal ID',
  )
  const result = await callA2AInternal(app, 'get-proposal', { proposalId })
  return successResponse(c, result)
})
app.get('/api/v1/ceo', async (c) =>
  c.json(await callA2AInternal(app, 'get-ceo-status')),
)
app.get('/api/v1/governance/stats', async (c) =>
  c.json(await callA2AInternal(app, 'get-governance-stats')),
)

// CEO Model candidates and decisions
app.get('/api/v1/ceo/models', async (c) => {
  const models = await blockchain.getModelCandidates()
  return c.json({ models })
})

app.get('/api/v1/ceo/decisions', async (c) => {
  const query = parseAndValidateQuery(
    c,
    z.object({
      limit: z
        .string()
        .regex(/^\d+$/)
        .transform(Number)
        .pipe(z.number().int().min(1).max(100))
        .optional(),
    }),
    'CEO decisions query',
  )
  const limit = query.limit ?? 10
  const decisions = await blockchain.getRecentDecisions(limit)
  return successResponse(c, { decisions })
})

let orchestrator: AutocratOrchestrator | null = null

app.post('/api/v1/orchestrator/start', async (c) => {
  expect(
    orchestrator === null || orchestrator.getStatus().running !== true,
    'Orchestrator already running',
  )
  const orchestratorConfig: import('./orchestrator').AutocratConfig = {
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
  expect(orchestrator !== null, 'Failed to create orchestrator')
  return successResponse(c, { status: 'started', ...orchestrator.getStatus() })
})

app.post('/api/v1/orchestrator/stop', async (c) => {
  expect(orchestrator !== null, 'Orchestrator not running')
  expect(orchestrator.getStatus().running === true, 'Orchestrator not running')
  await orchestrator.stop()
  return successResponse(c, { status: 'stopped' })
})

app.get('/api/v1/orchestrator/status', (c) => {
  if (!orchestrator) {
    return c.json({
      running: false,
      cycleCount: 0,
      message: 'Orchestrator not initialized',
    })
  }
  return c.json(orchestrator.getStatus())
})

app.post('/trigger/orchestrator', async (c) => {
  await c.req.json().catch(() => ({}))
  const result = await runOrchestratorCycle()
  return c.json({ success: true, executionId: `exec-${Date.now()}`, ...result })
})

app.get('/api/v1/triggers', async (c) => {
  const client = getComputeTriggerClient()
  if (!(await client.isAvailable()))
    return c.json({ mode: 'local', message: 'Using local cron', triggers: [] })
  return c.json({
    mode: 'compute',
    triggers: await client.list({ active: true }),
  })
})

app.get('/api/v1/triggers/history', async (c) => {
  const client = getComputeTriggerClient()
  if (!(await client.isAvailable()))
    return successResponse(c, { mode: 'local', executions: [] })
  const query = parseAndValidateQuery(
    c,
    z.object({
      limit: z
        .string()
        .regex(/^\d+$/)
        .transform(Number)
        .pipe(z.number().int().min(1).max(1000))
        .optional(),
    }),
    'Triggers history query',
  )
  const limit = query.limit ?? 50
  return successResponse(c, {
    mode: 'compute',
    executions: await client.getHistory(undefined, limit),
  })
})

app.post('/api/v1/triggers/execute', async (c) =>
  c.json(await runOrchestratorCycle()),
)

// Proposal Assistant API
const proposalAssistant = getProposalAssistant()

app.post('/api/v1/proposals/assess', async (c) => {
  const draftRaw = await parseAndValidateBody(
    c,
    AssessProposalRequestSchema,
    'Proposal assessment request',
  )
  const draft = toProposalDraft(draftRaw)
  const assessment = await proposalAssistant.assessQuality(draft)
  return successResponse(c, assessment)
})

app.post('/api/v1/proposals/check-duplicates', async (c) => {
  const draftRaw = await parseAndValidateBody(
    c,
    ProposalDraftSchema,
    'Proposal duplicate check request',
  )
  const draft = toProposalDraft(draftRaw)
  const duplicates = await proposalAssistant.checkDuplicates(draft)
  return successResponse(c, { duplicates })
})

app.post('/api/v1/proposals/improve', async (c) => {
  const body = await parseAndValidateBody(
    c,
    ImproveProposalRequestSchema,
    'Proposal improvement request',
  )
  const draft = toProposalDraft(body.draft)
  const improved = await proposalAssistant.improveProposal(
    draft,
    body.criterion,
  )
  return successResponse(c, { improved })
})

app.post('/api/v1/proposals/generate', async (c) => {
  const body = await parseAndValidateBody(
    c,
    GenerateProposalRequestSchema,
    'Proposal generation request',
  )
  const draft = await proposalAssistant.generateProposal(
    body.idea,
    body.proposalType ?? 0,
  )
  return successResponse(c, draft)
})

app.post('/api/v1/proposals/quick-score', async (c) => {
  const draftRaw = await parseAndValidateBody(
    c,
    ProposalDraftSchema,
    'Proposal quick score request',
  )
  const draft = toProposalDraft(draftRaw)
  const score = proposalAssistant.quickScore(draft)
  const contentHash = proposalAssistant.getContentHash(draft)
  return successResponse(c, {
    score,
    contentHash,
    readyForFullAssessment: score >= 60,
  })
})

// Research Agent API
const researchAgent = getResearchAgent()

app.post('/api/v1/research/conduct', async (c) => {
  const request = await parseAndValidateBody(
    c,
    ResearchRequestSchema,
    'Research conduct request',
  )
  const report = await researchAgent.conductResearch(request)
  return successResponse(c, report)
})

app.post('/api/v1/research/quick-screen', async (c) => {
  const request = await parseAndValidateBody(
    c,
    ResearchRequestSchema,
    'Research quick screen request',
  )
  const result = await researchAgent.quickScreen(request)
  return successResponse(c, result)
})

app.post('/api/v1/research/fact-check', async (c) => {
  const body = await parseAndValidateBody(
    c,
    FactCheckRequestSchema,
    'Fact check request',
  )
  const result = await researchAgent.factCheck(body.claim, body.context ?? '')
  return successResponse(c, result)
})

// ERC-8004 Agent Registry API
const erc8004Config: ERC8004Config = {
  rpcUrl: config.rpcUrl,
  identityRegistry: config.contracts.identityRegistry as string,
  reputationRegistry: config.contracts.reputationRegistry as string,
  validationRegistry:
    process.env.VALIDATION_REGISTRY_ADDRESS ??
    '0x0000000000000000000000000000000000000000',
  operatorKey: process.env.OPERATOR_KEY ?? process.env.PRIVATE_KEY,
}
const erc8004 = getERC8004Client(erc8004Config)

app.get('/api/v1/agents/count', async (c) => {
  const count = await erc8004.getTotalAgents()
  return c.json({ count })
})

app.get('/api/v1/agents/:id', async (c) => {
  const idParam = parseAndValidateParam(c, 'id', z.string().min(1), 'Agent ID')
  const agentId = parseBigInt(idParam, 'Agent ID')
  const identity = await erc8004.getAgentIdentity(agentId)
  expect(identity !== null, 'Agent not found')
  const reputation = await erc8004.getAgentReputation(agentId)
  const validation = await erc8004.getValidationSummary(agentId)
  return successResponse(c, { ...identity, reputation, validation })
})

app.post('/api/v1/agents/register', async (c) => {
  const body = await parseAndValidateBody(
    c,
    AgentRegisterRequestSchema,
    'Agent registration request',
  )
  const agentId = await erc8004.registerAgent(
    body.name,
    body.role,
    body.a2aEndpoint ?? '',
    body.mcpEndpoint ?? '',
  )
  expect(agentId > 0n, 'Agent registration failed')
  return successResponse(c, { agentId: agentId.toString(), registered: true })
})

app.post('/api/v1/agents/:id/feedback', async (c) => {
  const idParam = parseAndValidateParam(c, 'id', z.string().min(1), 'Agent ID')
  const agentId = parseBigInt(idParam, 'Agent ID')
  const body = await parseAndValidateBody(
    c,
    AgentFeedbackRequestSchema,
    'Agent feedback request',
  )
  const txHash = await erc8004.submitFeedback(
    agentId,
    body.score,
    body.tag,
    body.details,
  )
  return successResponse(c, { success: true, txHash })
})

// Futarchy API
const futarchyConfig: FutarchyConfig = {
  rpcUrl: config.rpcUrl,
  councilAddress: config.contracts.council as `0x${string}`,
  predimarketAddress:
    ('predimarket' in config.contracts
      ? (config.contracts as Record<string, Address>).predimarket
      : undefined) ??
    ('0x0000000000000000000000000000000000000000' as `0x${string}`),
  operatorKey: process.env.OPERATOR_KEY ?? process.env.PRIVATE_KEY,
}
const futarchy = getFutarchyClient(futarchyConfig)

app.get('/api/v1/futarchy/vetoed', async (c) => {
  const proposals = await futarchy.getVetoedProposals()
  return c.json({ proposals })
})

app.get('/api/v1/futarchy/pending', async (c) => {
  const proposals = await futarchy.getPendingFutarchyProposals()
  return c.json({ proposals })
})

app.get('/api/v1/futarchy/market/:proposalId', async (c) => {
  const proposalId = parseAndValidateParam(
    c,
    'proposalId',
    ProposalIdSchema,
    'Proposal ID',
  )
  const market = await futarchy.getFutarchyMarket(proposalId)
  expect(market !== null, 'No futarchy market for this proposal')
  return successResponse(c, market)
})

app.post('/api/v1/futarchy/escalate', async (c) => {
  const body = await parseAndValidateBody(
    c,
    FutarchyEscalateRequestSchema,
    'Futarchy escalate request',
  )
  const result = await futarchy.escalateToFutarchy(body.proposalId)
  return successResponse(c, result)
})

app.post('/api/v1/futarchy/resolve', async (c) => {
  const body = await parseAndValidateBody(
    c,
    FutarchyResolveRequestSchema,
    'Futarchy resolve request',
  )
  const result = await futarchy.resolveFutarchy(body.proposalId)
  return successResponse(c, result)
})

app.post('/api/v1/futarchy/execute', async (c) => {
  const body = await parseAndValidateBody(
    c,
    FutarchyExecuteRequestSchema,
    'Futarchy execute request',
  )
  const result = await futarchy.executeFutarchyApproved(body.proposalId)
  return successResponse(c, result)
})

app.get('/api/v1/futarchy/sentiment/:proposalId', async (c) => {
  const proposalId = parseAndValidateParam(
    c,
    'proposalId',
    ProposalIdSchema,
    'Proposal ID',
  )
  const sentiment = await futarchy.getMarketSentiment(proposalId)
  expect(sentiment !== null, 'No market for this proposal')
  return successResponse(c, sentiment)
})

app.get('/api/v1/futarchy/parameters', async (c) => {
  const params = await futarchy.getFutarchyParameters()
  if (!params) return c.json({ error: 'Futarchy not deployed' }, 404)
  return c.json(params)
})

// Moderation API
const moderation = getModerationSystem()

app.post('/api/v1/moderation/flag', async (c) => {
  const body = await parseAndValidateBody(
    c,
    ModerationFlagRequestSchema,
    'Moderation flag request',
  )
  const flag = moderation.submitFlag(
    body.proposalId,
    body.flagger,
    body.flagType as FlagType,
    body.reason,
    body.stake ?? 10,
    body.evidence,
  )
  return successResponse(c, flag)
})

app.post('/api/v1/moderation/vote', async (c) => {
  const body = await parseAndValidateBody(
    c,
    ModerationVoteRequestSchema,
    'Moderation vote request',
  )
  moderation.voteOnFlag(body.flagId, body.voter, body.upvote)
  return successResponse(c, { success: true })
})

app.post('/api/v1/moderation/resolve', async (c) => {
  const body = await parseAndValidateBody(
    c,
    ModerationResolveRequestSchema,
    'Moderation resolve request',
  )
  moderation.resolveFlag(body.flagId, body.upheld)
  return successResponse(c, { success: true })
})

app.get('/api/v1/moderation/score/:proposalId', (c) => {
  const proposalId = parseAndValidateParam(
    c,
    'proposalId',
    ProposalIdSchema,
    'Proposal ID',
  )
  const score = moderation.getProposalModerationScore(proposalId)
  return successResponse(c, score)
})

app.get('/api/v1/moderation/flags/:proposalId', (c) => {
  const proposalId = parseAndValidateParam(
    c,
    'proposalId',
    ProposalIdSchema,
    'Proposal ID',
  )
  const flags = moderation.getProposalFlags(proposalId)
  return successResponse(c, { flags })
})

app.get('/api/v1/moderation/active-flags', (c) => {
  const flags = moderation.getActiveFlags()
  return c.json({ flags })
})

app.get('/api/v1/moderation/leaderboard', (c) => {
  const query = parseAndValidateQuery(
    c,
    z.object({
      limit: z
        .string()
        .regex(/^\d+$/)
        .transform(Number)
        .pipe(z.number().int().min(1).max(100))
        .optional(),
    }),
    'Moderation leaderboard query',
  )
  const limit = query.limit ?? 10
  const moderators = moderation.getTopModerators(limit)
  return successResponse(c, { moderators })
})

app.get('/api/v1/moderation/moderator/:address', (c) => {
  const address = parseAndValidateParam(
    c,
    'address',
    z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    'Moderator address',
  )
  const stats = moderation.getModeratorStats(address as `0x${string}`)
  return successResponse(c, stats)
})

app.get('/api/v1/moderation/should-reject/:proposalId', (c) => {
  const proposalId = parseAndValidateParam(
    c,
    'proposalId',
    ProposalIdSchema,
    'Proposal ID',
  )
  const result = moderation.shouldAutoReject(proposalId)
  return successResponse(c, result)
})

// DAO Registry API - Multi-tenant DAO management
let daoService: DAOService | null = null
let fundingOracle: FundingOracle | null = null

const initDAOService = () => {
  if (!daoService && config.contracts.daoRegistry !== ZERO_ADDR) {
    daoService = createDAOService({
      rpcUrl: config.rpcUrl,
      chainId: parseInt(process.env.CHAIN_ID ?? '31337', 10),
      daoRegistryAddress: config.contracts.daoRegistry,
      daoFundingAddress: config.contracts.daoFunding,
      privateKey: process.env.OPERATOR_KEY ?? process.env.PRIVATE_KEY,
    })
    fundingOracle = getFundingOracle()
  }
  return daoService
}

app.get('/api/v1/dao/list', async (c) => {
  const service = initDAOService()
  if (!service) return c.json({ error: 'DAO Registry not deployed' }, 503)
  const daoIds = await service.getAllDAOs()
  const daos = await Promise.all(daoIds.map((id) => service.getDAO(id)))
  return c.json({ daos })
})

app.get('/api/v1/dao/active', async (c) => {
  const service = initDAOService()
  if (!service) return c.json({ error: 'DAO Registry not deployed' }, 503)
  const daoIds = await service.getActiveDAOs()
  const daos = await Promise.all(daoIds.map((id) => service.getDAOFull(id)))
  return c.json({ daos })
})

app.get('/api/v1/dao/:daoId', async (c) => {
  const service = initDAOService()
  expect(service !== null, 'DAO Registry not deployed')
  const daoId = parseAndValidateParam(
    c,
    'daoId',
    z.string().min(1).max(100),
    'DAO ID',
  )
  const exists = await service.daoExists(daoId)
  expect(exists, 'DAO not found')
  expect(service !== null, 'DAO service not initialized')
  const dao = await service.getDAOFull(daoId)
  return successResponse(c, dao)
})

app.get('/api/v1/dao/:daoId/persona', async (c) => {
  const service = initDAOService()
  if (!service) return c.json({ error: 'DAO Registry not deployed' }, 503)
  const persona = await service.getCEOPersona(c.req.param('daoId'))
  return c.json(persona)
})

app.get('/api/v1/dao/:daoId/council', async (c) => {
  const service = initDAOService()
  if (!service) return c.json({ error: 'DAO Registry not deployed' }, 503)
  const members = await service.getCouncilMembers(c.req.param('daoId'))
  return c.json({ members })
})

app.get('/api/v1/dao/:daoId/packages', async (c) => {
  const service = initDAOService()
  if (!service) return c.json({ error: 'DAO Registry not deployed' }, 503)
  const packages = await service.getLinkedPackages(c.req.param('daoId'))
  return c.json({ packages })
})

app.get('/api/v1/dao/:daoId/repos', async (c) => {
  const service = initDAOService()
  if (!service) return c.json({ error: 'DAO Registry not deployed' }, 503)
  const repos = await service.getLinkedRepos(c.req.param('daoId'))
  return c.json({ repos })
})

// DAO Funding API
app.get('/api/v1/dao/:daoId/funding/epoch', async (c) => {
  const service = initDAOService()
  if (!service) return c.json({ error: 'DAO Registry not deployed' }, 503)
  const epoch = await service.getCurrentEpoch(c.req.param('daoId'))
  return c.json({ epoch })
})

app.get('/api/v1/dao/:daoId/funding/projects', async (c) => {
  const service = initDAOService()
  if (!service) return c.json({ error: 'DAO Registry not deployed' }, 503)
  const projects = await service.getActiveProjects(c.req.param('daoId'))
  return c.json({ projects })
})

app.get('/api/v1/dao/:daoId/funding/allocations', async (c) => {
  const service = initDAOService()
  if (!service) return c.json({ error: 'DAO Registry not deployed' }, 503)
  const allocations = await service.getFundingAllocations(c.req.param('daoId'))
  return c.json({ allocations })
})

app.get('/api/v1/dao/:daoId/funding/summary', async (c) => {
  initDAOService()
  if (!fundingOracle) return c.json({ error: 'DAO Registry not deployed' }, 503)
  const summary = await fundingOracle.getEpochSummary(c.req.param('daoId'))
  return c.json(summary)
})

app.get('/api/v1/dao/:daoId/funding/recommendations', async (c) => {
  initDAOService()
  if (!fundingOracle) return c.json({ error: 'DAO Registry not deployed' }, 503)
  const recommendations = await fundingOracle.generateCEORecommendations(
    c.req.param('daoId'),
  )
  return c.json(recommendations)
})

app.get('/api/v1/dao/:daoId/funding/knobs', async (c) => {
  initDAOService()
  if (!fundingOracle) return c.json({ error: 'DAO Registry not deployed' }, 503)
  const knobs = await fundingOracle.getKnobs(c.req.param('daoId'))
  return c.json(knobs)
})

// Casual Proposal API
app.post('/api/v1/dao/:daoId/casual/assess', async (c) => {
  const daoId = parseAndValidateParam(
    c,
    'daoId',
    z.string().min(1).max(100),
    'DAO ID',
  )
  const body = await parseAndValidateBody(
    c,
    CasualAssessRequestSchema,
    'Casual proposal assessment request',
  )
  const submission: CasualSubmission = {
    daoId,
    category: body.category as CasualProposalCategory,
    title: body.title,
    content: body.content,
  }
  const assessment = await proposalAssistant.assessCasualSubmission(submission)
  return successResponse(c, assessment)
})

app.post('/api/v1/dao/:daoId/casual/help', async (c) => {
  const daoId = parseAndValidateParam(
    c,
    'daoId',
    z.string().min(1).max(100),
    'DAO ID',
  )
  const body = await parseAndValidateBody(
    c,
    CasualHelpRequestSchema,
    'Casual proposal help request',
  )
  const category = body.category as CasualProposalCategory
  const help = await proposalAssistant.helpCraftSubmission(
    category,
    body.content ?? '',
    daoId,
  )
  return successResponse(c, help)
})

app.get('/api/v1/casual/categories', (c) => {
  const categories = proposalAssistant.getAllCategories()
  return c.json({ categories })
})

// Orchestrator DAO status
app.get('/api/v1/orchestrator/dao/:daoId', (c) => {
  expect(orchestrator !== null, 'Orchestrator not running')
  const status = orchestrator.getDAOStatus(c.req.param('daoId'))
  if (!status) return c.json({ error: 'DAO not tracked' }, 404)
  return c.json(status)
})

app.post('/api/v1/orchestrator/dao/:daoId/refresh', async (c) => {
  if (!orchestrator) return c.json({ error: 'Orchestrator not running' }, 503)
  await orchestrator.refreshDAO(c.req.param('daoId'))
  return c.json({ success: true })
})

app.post('/api/v1/orchestrator/dao/:daoId/active', async (c) => {
  expect(orchestrator !== null, 'Orchestrator not running')
  const daoId = parseAndValidateParam(
    c,
    'daoId',
    z.string().min(1).max(100),
    'DAO ID',
  )
  const body = await parseAndValidateBody(
    c,
    OrchestratorActiveRequestSchema,
    'Orchestrator active request',
  )
  orchestrator.setDAOActive(daoId, body.active)
  return successResponse(c, { success: true })
})

// Registry Integration API - Deep AI DAO integration
const registryConfig: RegistryIntegrationConfig = {
  rpcUrl: config.rpcUrl,
  integrationContract: process.env.REGISTRY_INTEGRATION_ADDRESS,
  identityRegistry: config.contracts.identityRegistry as string,
  reputationRegistry: config.contracts.reputationRegistry as string,
  delegationRegistry: process.env.DELEGATION_REGISTRY_ADDRESS,
}
const registryIntegration = getRegistryIntegrationClient(registryConfig)

// Get comprehensive agent profile with composite score
app.get('/api/v1/registry/profile/:agentId', async (c) => {
  const idParam = parseAndValidateParam(
    c,
    'agentId',
    z.string().min(1),
    'Agent ID',
  )
  const agentId = parseBigInt(idParam, 'Agent ID')
  const profile = await registryIntegration.getAgentProfile(agentId)
  expect(profile !== null && profile !== undefined, 'Agent not found')
  return successResponse(c, {
    ...profile,
    agentId: profile.agentId.toString(),
    stakedAmount: profile.stakedAmount.toString(),
  })
})

// Get multiple agent profiles
app.post('/api/v1/registry/profiles', async (c) => {
  const body = await parseAndValidateBody(
    c,
    RegistryProfilesRequestSchema,
    'Registry profiles request',
  )
  const profiles = await registryIntegration.getAgentProfiles(
    body.agentIds.map((id) => BigInt(id)),
  )
  return successResponse(c, {
    profiles: profiles.map((p) => ({
      ...p,
      agentId: p.agentId.toString(),
      stakedAmount: p.stakedAmount.toString(),
    })),
  })
})

// Get voting power for an address
app.get('/api/v1/registry/voting-power/:address', async (c) => {
  const address = parseAndValidateParam(
    c,
    'address',
    z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    'Address',
  )
  const query = parseAndValidateQuery(
    c,
    z.object({
      agentId: z
        .string()
        .regex(/^\d+$/)
        .transform((s) => BigInt(s))
        .optional(),
      baseVotes: z
        .string()
        .regex(/^\d+$/)
        .transform((s) => BigInt(s))
        .optional(),
    }),
    'Voting power query',
  )
  const agentId = query.agentId ?? 0n
  const baseVotes = query.baseVotes ?? BigInt('1000000000000000000')
  const power = await registryIntegration.getVotingPower(
    address as `0x${string}`,
    agentId,
    baseVotes,
  )
  return successResponse(c, {
    ...power,
    baseVotes: power.baseVotes.toString(),
    effectiveVotes: power.effectiveVotes.toString(),
  })
})

// Search agents by tag
app.get('/api/v1/registry/search/tag/:tag', async (c) => {
  const tag = parseAndValidateParam(c, 'tag', z.string().min(1).max(50), 'Tag')
  const query = parseAndValidateQuery(
    c,
    PaginationQuerySchema,
    'Tag search query',
  )
  const offset = query.offset ?? 0
  const limit = query.limit ?? 50
  const result = await registryIntegration.searchByTag(tag, offset, limit)
  return successResponse(c, {
    ...result,
    agentIds: result.agentIds.map((id) => id.toString()),
  })
})

// Get agents by minimum score
app.get('/api/v1/registry/search/score', async (c) => {
  const minScore = parseInt(c.req.query('minScore') ?? '50', 10)
  const offset = parseInt(c.req.query('offset') ?? '0', 10)
  const limit = parseInt(c.req.query('limit') ?? '50', 10)
  const result = await registryIntegration.getAgentsByScore(
    minScore,
    offset,
    limit,
  )
  return c.json({
    agentIds: result.agentIds.map((id) => id.toString()),
    scores: result.scores,
  })
})

// Get top agents by composite score
app.get('/api/v1/registry/top-agents', async (c) => {
  const count = parseInt(c.req.query('count') ?? '10', 10)
  const profiles = await registryIntegration.getTopAgents(count)
  return c.json({
    agents: profiles.map((p) => ({
      ...p,
      agentId: p.agentId.toString(),
      stakedAmount: p.stakedAmount.toString(),
    })),
  })
})

// Get all active agents
app.get('/api/v1/registry/active-agents', async (c) => {
  const offset = parseInt(c.req.query('offset') ?? '0', 10)
  const limit = parseInt(c.req.query('limit') ?? '100', 10)
  const agentIds = await registryIntegration.getActiveAgents(offset, limit)
  return c.json({
    agentIds: agentIds.map((id) => id.toString()),
    total: await registryIntegration.getTotalAgents(),
    offset,
    limit,
  })
})

// Get provider reputations with weighting
app.get('/api/v1/registry/providers', async (c) => {
  const providers = await registryIntegration.getAllProviderReputations()
  return c.json({
    providers: providers.map((p) => ({
      ...p,
      providerAgentId: p.providerAgentId.toString(),
      stakeAmount: p.stakeAmount.toString(),
    })),
  })
})

// Get weighted reputation for an agent (across all providers)
app.get('/api/v1/registry/weighted-reputation/:agentId', async (c) => {
  const agentId = BigInt(c.req.param('agentId'))
  const result = await registryIntegration.getWeightedAgentReputation(agentId)
  return c.json(result)
})

// Check eligibility for various actions
app.get('/api/v1/registry/eligibility/:agentId', async (c) => {
  const agentId = BigInt(c.req.param('agentId'))
  const [proposal, vote, research] = await Promise.all([
    registryIntegration.canSubmitProposal(agentId),
    registryIntegration.canVote(agentId),
    registryIntegration.canConductResearch(agentId),
  ])
  return c.json({
    agentId: agentId.toString(),
    canSubmitProposal: proposal,
    canVote: vote,
    canConductResearch: research,
  })
})

// Delegation endpoints
app.get('/api/v1/registry/delegate/:address', async (c) => {
  const addressParam = parseAndValidateParam(
    c,
    'address',
    z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    'Delegate address',
  )
  const delegate = await registryIntegration.getDelegate(
    addressParam as `0x${string}`,
  )
  if (!delegate) return c.json({ error: 'Not a registered delegate' }, 404)
  return c.json({
    ...delegate,
    agentId: delegate.agentId.toString(),
    totalDelegated: delegate.totalDelegated.toString(),
  })
})

app.get('/api/v1/registry/top-delegates', async (c) => {
  const limit = parseInt(c.req.query('limit') ?? '10', 10)
  const delegates = await registryIntegration.getTopDelegates(limit)
  return c.json({
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
  })
})

app.get('/api/v1/registry/security-council', async (c) => {
  const council = await registryIntegration.getSecurityCouncil()
  return c.json({
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
  })
})

app.get('/api/v1/registry/is-council-member/:address', async (c) => {
  const addressParam = parseAndValidateParam(
    c,
    'address',
    z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    'Council member address',
  )
  const isMember = await registryIntegration.isSecurityCouncilMember(
    addressParam as `0x${string}`,
  )
  return c.json({ isMember })
})

async function runOrchestratorCycle(): Promise<OrchestratorTriggerResult> {
  const start = Date.now()
  if (!orchestrator) {
    const orchestratorConfig: import('./orchestrator').AutocratConfig = {
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

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'jeju-council',
    version: '3.0.0',
    mode: 'multi-tenant',
    tee: getTEEMode(),
    orchestrator: orchestrator?.getStatus().running ?? false,
    daoCount: orchestrator?.getStatus().daoCount ?? 0,
    daoRegistry: config.contracts.daoRegistry !== ZERO_ADDR,
    daoFunding: config.contracts.daoFunding !== ZERO_ADDR,
    erc8004: {
      identity: erc8004.identityDeployed,
      reputation: erc8004.reputationDeployed,
      validation: erc8004.validationDeployed,
    },
    futarchy: {
      council: futarchy.councilDeployed,
      predimarket: futarchy.predimarketDeployed,
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
  }),
)

// Prometheus metrics (excludes /metrics and /health from request count)
const metricsData = { requests: 0, errors: 0, startTime: Date.now() }
app.use('*', async (c, next) => {
  const path = c.req.path
  if (path !== '/metrics' && path !== '/health') metricsData.requests++
  await next()
})
app.onError((err, c) => {
  metricsData.errors++
  console.error(`[Error] ${c.req.method} ${c.req.path}:`, err.message)
  return c.json({ error: err.message }, 500)
})

app.get('/metrics', () => {
  const mem = process.memoryUsage()
  const uptime = (Date.now() - metricsData.startTime) / 1000
  const orch = orchestrator?.getStatus()
  const activeFlags = moderation.getActiveFlags().length
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

app.get('/', (c) =>
  c.json({
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
  }),
)

const port = parseInt(process.env.PORT ?? '8010', 10)
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

  console.log(`
[Council] Started on port ${port}
  TEE: ${getTEEMode()}
  Trigger: ${triggerMode}
  Endpoints: /a2a, /mcp, /api/v1
`)

  if (autoStart && blockchain.councilDeployed) {
    const orchestratorConfig: import('./orchestrator').AutocratConfig = {
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

export default { port, fetch: app.fetch }
export { app, config }
export { createAutocratA2AServer } from './a2a-server'
export {
  type AgentVote,
  autocratAgentRuntime,
  autocratAgentTemplates,
  type CEODecisionRequest,
  type DeliberationRequest,
  getAgentByRole,
} from './agents'
export { AutocratBlockchain, getBlockchain } from './blockchain'
export {
  getComputeTriggerClient,
  registerAutocratTriggers,
  startLocalCron,
} from './compute-trigger'
export {
  createDAOService,
  type DAO,
  type DAOFull,
  DAOService,
  type FundingAllocation,
  type FundingEpoch,
  type FundingProject,
  getDAOService,
} from './dao-service'
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
  type CasualProposalCategory,
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
export type {
  CEOPersona,
  CouncilConfig,
  FundingConfig,
  GovernanceParams,
} from './types'
