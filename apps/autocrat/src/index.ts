/**
 * Network Council - AI DAO Governance
 *
 * DECENTRALIZED ARCHITECTURE - NO FALLBACKS:
 * 1. CovenantSQL (CQL) required for state persistence
 *    - Set CQL_BLOCK_PRODUCER_ENDPOINT or start: docker compose up -d
 *
 * 2. DWS Compute required for AI inference
 *    - Set DWS_URL or start: docker compose up -d
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

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getNetworkName } from '@jejunetwork/config';
import { createAutocratA2AServer } from './a2a-server';
import { createAutocratMCPServer } from './mcp-server';
import { getBlockchain } from './blockchain';
import { createOrchestrator, type AutocratOrchestrator } from './orchestrator';
import { initLocalServices } from './local-services';
import { getTEEMode } from './tee';
import { autocratAgentRuntime } from './agents';
import { registerAutocratTriggers, startLocalCron, getComputeTriggerClient, type OrchestratorTriggerResult } from './compute-trigger';
import { getProposalAssistant, type ProposalDraft, type QualityAssessment } from './proposal-assistant';
import { getResearchAgent, type ResearchRequest } from './research-agent';
import { getERC8004Client, type ERC8004Config } from './erc8004';
import { getFutarchyClient, type FutarchyConfig } from './futarchy';
import { getModerationSystem, initModeration, FlagType } from './moderation';
import { getRegistryIntegrationClient, type RegistryIntegrationConfig } from './registry-integration';
import type { CouncilConfig } from './types';
import { DAOService, createDAOService } from './dao-service';
import { getFundingOracle, type FundingOracle } from './funding-oracle';
import type { CasualSubmission, CasualProposalCategory } from './proposal-assistant';

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`;
const addr = (key: string) => (process.env[key] ?? ZERO_ADDR) as `0x${string}`;
const agent = (id: string, name: string, prompt: string) => ({ id, name, model: 'local', endpoint: 'local', systemPrompt: prompt });

function getConfig(): CouncilConfig {
  return {
    rpcUrl: process.env.RPC_URL ?? process.env.JEJU_RPC_URL ?? 'http://localhost:8545',
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
      proposalAgent: agent('proposal-agent', 'Proposal Assistant', 'Help craft proposals'),
      researchAgent: agent('research-agent', 'Researcher', 'Deep research'),
      fundingAgent: agent('funding-agent', 'Funding Oracle', 'Deep funding analysis'),
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
  };
}

async function callA2AInternal(app: Hono, skillId: string, params: Record<string, unknown> = {}) {
  const response = await app.request('/a2a', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: { message: { messageId: `rest-${Date.now()}`, parts: [{ kind: 'data', data: { skillId, params } }] } },
    }),
  });
  const result = await response.json();
  return result.result?.parts?.find((p: { kind: string }) => p.kind === 'data')?.data ?? { error: 'Failed' };
}

const config = getConfig();
const blockchain = getBlockchain(config);
const app = new Hono();

app.use('/*', cors());

const a2aServer = createAutocratA2AServer(config, blockchain);
const mcpServer = createAutocratMCPServer(config, blockchain);
app.route('/a2a', a2aServer.getRouter());
app.route('/mcp', mcpServer.getRouter());
app.get('/.well-known/agent-card.json', (c) => c.redirect('/a2a/.well-known/agent-card.json'));

app.get('/api/v1/proposals', async (c) => c.json(await callA2AInternal(app, 'list-proposals', { activeOnly: c.req.query('active') === 'true' })));
app.get('/api/v1/proposals/:id', async (c) => c.json(await callA2AInternal(app, 'get-proposal', { proposalId: c.req.param('id') })));
app.get('/api/v1/ceo', async (c) => c.json(await callA2AInternal(app, 'get-ceo-status')));
app.get('/api/v1/governance/stats', async (c) => c.json(await callA2AInternal(app, 'get-governance-stats')));

// CEO Model candidates and decisions
app.get('/api/v1/ceo/models', async (c) => {
  const models = await blockchain.getModelCandidates();
  return c.json({ models });
});

app.get('/api/v1/ceo/decisions', async (c) => {
  const limit = parseInt(c.req.query('limit') ?? '10', 10);
  const decisions = await blockchain.getRecentDecisions(limit);
  return c.json({ decisions });
});

let orchestrator: AutocratOrchestrator | null = null;

app.post('/api/v1/orchestrator/start', async (c) => {
  if (orchestrator?.getStatus().running) return c.json({ error: 'Already running' }, 400);
  orchestrator = createOrchestrator(config, blockchain);
  await orchestrator.start();
  return c.json({ status: 'started', ...orchestrator.getStatus() });
});

app.post('/api/v1/orchestrator/stop', async (c) => {
  if (!orchestrator?.getStatus().running) return c.json({ error: 'Not running' }, 400);
  await orchestrator.stop();
  return c.json({ status: 'stopped' });
});

app.get('/api/v1/orchestrator/status', (c) => c.json(orchestrator?.getStatus() ?? { running: false, cycleCount: 0 }));

app.post('/trigger/orchestrator', async (c) => {
  await c.req.json().catch(() => ({}));
  const result = await runOrchestratorCycle();
  return c.json({ success: true, executionId: `exec-${Date.now()}`, ...result });
});

app.get('/api/v1/triggers', async (c) => {
  const client = getComputeTriggerClient();
  if (!await client.isAvailable()) return c.json({ mode: 'local', message: 'Using local cron', triggers: [] });
  return c.json({ mode: 'compute', triggers: await client.list({ active: true }) });
});

app.get('/api/v1/triggers/history', async (c) => {
  const client = getComputeTriggerClient();
  if (!await client.isAvailable()) return c.json({ mode: 'local', executions: [] });
  return c.json({ mode: 'compute', executions: await client.getHistory(undefined, parseInt(c.req.query('limit') ?? '50', 10)) });
});

app.post('/api/v1/triggers/execute', async (c) => c.json(await runOrchestratorCycle()));

// Proposal Assistant API
const proposalAssistant = getProposalAssistant(blockchain);

app.post('/api/v1/proposals/assess', async (c) => {
  try {
    const draft = await c.req.json() as ProposalDraft;
    if (!draft.title || !draft.description) {
      return c.json({ error: 'title and description are required' }, 400);
    }
    const assessment = await proposalAssistant.assessQuality(draft);
    return c.json(assessment);
  } catch (error) {
    console.error('[Assess] Error:', error);
    const message = error instanceof Error ? error.message : 'Assessment failed';
    return c.json({ error: message }, 500);
  }
});

app.post('/api/v1/proposals/check-duplicates', async (c) => {
  const draft = await c.req.json() as ProposalDraft;
  const duplicates = await proposalAssistant.checkDuplicates(draft);
  return c.json({ duplicates });
});

app.post('/api/v1/proposals/improve', async (c) => {
  const body = await c.req.json() as { draft: ProposalDraft; criterion: string };
  if (!body.draft || !body.criterion) {
    return c.json({ error: 'draft and criterion are required' }, 400);
  }
  const improved = await proposalAssistant.improveProposal(body.draft, body.criterion as keyof QualityAssessment['criteria']);
  return c.json({ improved });
});

app.post('/api/v1/proposals/generate', async (c) => {
  const body = await c.req.json() as { idea: string; proposalType: number };
  if (!body.idea) {
    return c.json({ error: 'idea is required' }, 400);
  }
  const draft = await proposalAssistant.generateProposal(body.idea, body.proposalType ?? 0);
  return c.json(draft);
});

app.post('/api/v1/proposals/quick-score', async (c) => {
  const draft = await c.req.json() as ProposalDraft;
  const score = proposalAssistant.quickScore(draft);
  const contentHash = proposalAssistant.getContentHash(draft);
  return c.json({ score, contentHash, readyForFullAssessment: score >= 60 });
});

// Research Agent API
const researchAgent = getResearchAgent();

app.post('/api/v1/research/conduct', async (c) => {
  const request = await c.req.json() as ResearchRequest;
  if (!request.proposalId || !request.title || !request.description) {
    return c.json({ error: 'proposalId, title, and description are required' }, 400);
  }
  const report = await researchAgent.conductResearch(request);
  return c.json(report);
});

app.post('/api/v1/research/quick-screen', async (c) => {
  const request = await c.req.json() as ResearchRequest;
  const result = await researchAgent.quickScreen(request);
  return c.json(result);
});

app.post('/api/v1/research/fact-check', async (c) => {
  const body = await c.req.json() as { claim: string; context: string };
  if (!body.claim) {
    return c.json({ error: 'claim is required' }, 400);
  }
  const result = await researchAgent.factCheck(body.claim, body.context ?? '');
  return c.json(result);
});

// ERC-8004 Agent Registry API
const erc8004Config: ERC8004Config = {
  rpcUrl: config.rpcUrl,
  identityRegistry: config.contracts.identityRegistry as string,
  reputationRegistry: config.contracts.reputationRegistry as string,
  validationRegistry: process.env.VALIDATION_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000',
  operatorKey: process.env.OPERATOR_KEY ?? process.env.PRIVATE_KEY,
};
const erc8004 = getERC8004Client(erc8004Config);

app.get('/api/v1/agents/count', async (c) => {
  const count = await erc8004.getTotalAgents();
  return c.json({ count });
});

app.get('/api/v1/agents/:id', async (c) => {
  const agentId = BigInt(c.req.param('id'));
  const identity = await erc8004.getAgentIdentity(agentId);
  if (!identity) return c.json({ error: 'Agent not found' }, 404);
  const reputation = await erc8004.getAgentReputation(agentId);
  const validation = await erc8004.getValidationSummary(agentId);
  return c.json({ ...identity, reputation, validation });
});

app.post('/api/v1/agents/register', async (c) => {
  const body = await c.req.json() as { name: string; role: string; a2aEndpoint: string; mcpEndpoint: string };
  if (!body.name || !body.role) return c.json({ error: 'name and role are required' }, 400);

  try {
    const agentId = await erc8004.registerAgent(body.name, body.role, body.a2aEndpoint ?? '', body.mcpEndpoint ?? '');
    return c.json({ agentId: agentId.toString(), registered: agentId > 0n });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Registration failed', registered: false }, 400);
  }
});

app.post('/api/v1/agents/:id/feedback', async (c) => {
  const agentId = BigInt(c.req.param('id'));
  const body = await c.req.json() as { score: number; tag: string; details?: string };
  if (body.score === undefined || !body.tag) return c.json({ error: 'score and tag are required' }, 400);

  try {
    const txHash = await erc8004.submitFeedback(agentId, body.score, body.tag, body.details);
    return c.json({ success: true, txHash });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Feedback failed', success: false }, 400);
  }
});

// Futarchy API
const futarchyConfig: FutarchyConfig = {
  rpcUrl: config.rpcUrl,
  councilAddress: config.contracts.council as string,
  predimarketAddress: config.contracts.predimarket as string,
  operatorKey: process.env.OPERATOR_KEY ?? process.env.PRIVATE_KEY,
};
const futarchy = getFutarchyClient(futarchyConfig);

app.get('/api/v1/futarchy/vetoed', async (c) => {
  const proposals = await futarchy.getVetoedProposals();
  return c.json({ proposals });
});

app.get('/api/v1/futarchy/pending', async (c) => {
  const proposals = await futarchy.getPendingFutarchyProposals();
  return c.json({ proposals });
});

app.get('/api/v1/futarchy/market/:proposalId', async (c) => {
  const market = await futarchy.getFutarchyMarket(c.req.param('proposalId'));
  if (!market) return c.json({ error: 'No futarchy market for this proposal' }, 404);
  return c.json(market);
});

app.post('/api/v1/futarchy/escalate', async (c) => {
  const body = await c.req.json() as { proposalId: string };
  if (!body.proposalId) return c.json({ error: 'proposalId is required' }, 400);
  const result = await futarchy.escalateToFutarchy(body.proposalId);
  return c.json(result);
});

app.post('/api/v1/futarchy/resolve', async (c) => {
  const body = await c.req.json() as { proposalId: string };
  if (!body.proposalId) return c.json({ error: 'proposalId is required' }, 400);
  const result = await futarchy.resolveFutarchy(body.proposalId);
  return c.json(result);
});

app.post('/api/v1/futarchy/execute', async (c) => {
  const body = await c.req.json() as { proposalId: string };
  if (!body.proposalId) return c.json({ error: 'proposalId is required' }, 400);
  const result = await futarchy.executeFutarchyApproved(body.proposalId);
  return c.json(result);
});

app.get('/api/v1/futarchy/sentiment/:proposalId', async (c) => {
  const sentiment = await futarchy.getMarketSentiment(c.req.param('proposalId'));
  if (!sentiment) return c.json({ error: 'No market for this proposal' }, 404);
  return c.json(sentiment);
});

app.get('/api/v1/futarchy/parameters', async (c) => {
  const params = await futarchy.getFutarchyParameters();
  if (!params) return c.json({ error: 'Futarchy not deployed' }, 404);
  return c.json(params);
});

// Moderation API
const moderation = getModerationSystem();

app.post('/api/v1/moderation/flag', async (c) => {
  const body = await c.req.json() as { proposalId: string; flagger: string; flagType: string; reason: string; stake: number; evidence?: string };
  if (!body.proposalId || !body.flagger || !body.flagType || !body.reason) {
    return c.json({ error: 'proposalId, flagger, flagType, and reason are required' }, 400);
  }
  if (!Object.values(FlagType).includes(body.flagType as FlagType)) {
    return c.json({ error: `Invalid flagType. Must be one of: ${Object.values(FlagType).join(', ')}` }, 400);
  }
  try {
    const flag = moderation.submitFlag(body.proposalId, body.flagger, body.flagType as FlagType, body.reason, body.stake ?? 10, body.evidence);
    return c.json(flag);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Failed to submit flag' }, 400);
  }
});

app.post('/api/v1/moderation/vote', async (c) => {
  const body = await c.req.json() as { flagId: string; voter: string; upvote: boolean };
  if (!body.flagId || !body.voter || body.upvote === undefined) {
    return c.json({ error: 'flagId, voter, and upvote are required' }, 400);
  }
  moderation.voteOnFlag(body.flagId, body.voter, body.upvote);
  return c.json({ success: true });
});

app.post('/api/v1/moderation/resolve', async (c) => {
  const body = await c.req.json() as { flagId: string; upheld: boolean };
  if (!body.flagId || body.upheld === undefined) {
    return c.json({ error: 'flagId and upheld are required' }, 400);
  }
  moderation.resolveFlag(body.flagId, body.upheld);
  return c.json({ success: true });
});

app.get('/api/v1/moderation/score/:proposalId', (c) => {
  const score = moderation.getProposalModerationScore(c.req.param('proposalId'));
  return c.json(score);
});

app.get('/api/v1/moderation/flags/:proposalId', (c) => {
  const flags = moderation.getProposalFlags(c.req.param('proposalId'));
  return c.json({ flags });
});

app.get('/api/v1/moderation/active-flags', (c) => {
  const flags = moderation.getActiveFlags();
  return c.json({ flags });
});

app.get('/api/v1/moderation/leaderboard', (c) => {
  const limit = parseInt(c.req.query('limit') ?? '10', 10);
  const moderators = moderation.getTopModerators(limit);
  return c.json({ moderators });
});

app.get('/api/v1/moderation/moderator/:address', (c) => {
  const stats = moderation.getModeratorStats(c.req.param('address'));
  return c.json(stats);
});

app.get('/api/v1/moderation/should-reject/:proposalId', (c) => {
  const result = moderation.shouldAutoReject(c.req.param('proposalId'));
  return c.json(result);
});

// DAO Registry API - Multi-tenant DAO management
let daoService: DAOService | null = null;
let fundingOracle: FundingOracle | null = null;

const initDAOService = () => {
  if (!daoService && config.contracts.daoRegistry !== ZERO_ADDR) {
    daoService = createDAOService({
      rpcUrl: config.rpcUrl,
      chainId: parseInt(process.env.CHAIN_ID ?? '31337', 10),
      daoRegistryAddress: config.contracts.daoRegistry,
      daoFundingAddress: config.contracts.daoFunding,
      privateKey: process.env.OPERATOR_KEY ?? process.env.PRIVATE_KEY,
    });
    fundingOracle = getFundingOracle();
  }
  return daoService;
};

app.get('/api/v1/dao/list', async (c) => {
  const service = initDAOService();
  if (!service) return c.json({ error: 'DAO Registry not deployed' }, 503);
  const daoIds = await service.getAllDAOs();
  const daos = await Promise.all(daoIds.map(id => service.getDAO(id)));
  return c.json({ daos });
});

app.get('/api/v1/dao/active', async (c) => {
  const service = initDAOService();
  if (!service) return c.json({ error: 'DAO Registry not deployed' }, 503);
  const daoIds = await service.getActiveDAOs();
  const daos = await Promise.all(daoIds.map(id => service.getDAOFull(id)));
  return c.json({ daos });
});

app.get('/api/v1/dao/:daoId', async (c) => {
  const service = initDAOService();
  if (!service) return c.json({ error: 'DAO Registry not deployed' }, 503);
  const daoId = c.req.param('daoId');
  const exists = await service.daoExists(daoId);
  if (!exists) return c.json({ error: 'DAO not found' }, 404);
  const dao = await service.getDAOFull(daoId);
  return c.json(dao);
});

app.get('/api/v1/dao/:daoId/persona', async (c) => {
  const service = initDAOService();
  if (!service) return c.json({ error: 'DAO Registry not deployed' }, 503);
  const persona = await service.getCEOPersona(c.req.param('daoId'));
  return c.json(persona);
});

app.get('/api/v1/dao/:daoId/council', async (c) => {
  const service = initDAOService();
  if (!service) return c.json({ error: 'DAO Registry not deployed' }, 503);
  const members = await service.getCouncilMembers(c.req.param('daoId'));
  return c.json({ members });
});

app.get('/api/v1/dao/:daoId/packages', async (c) => {
  const service = initDAOService();
  if (!service) return c.json({ error: 'DAO Registry not deployed' }, 503);
  const packages = await service.getLinkedPackages(c.req.param('daoId'));
  return c.json({ packages });
});

app.get('/api/v1/dao/:daoId/repos', async (c) => {
  const service = initDAOService();
  if (!service) return c.json({ error: 'DAO Registry not deployed' }, 503);
  const repos = await service.getLinkedRepos(c.req.param('daoId'));
  return c.json({ repos });
});

// DAO Funding API
app.get('/api/v1/dao/:daoId/funding/epoch', async (c) => {
  const service = initDAOService();
  if (!service) return c.json({ error: 'DAO Registry not deployed' }, 503);
  const epoch = await service.getCurrentEpoch(c.req.param('daoId'));
  return c.json({ epoch });
});

app.get('/api/v1/dao/:daoId/funding/projects', async (c) => {
  const service = initDAOService();
  if (!service) return c.json({ error: 'DAO Registry not deployed' }, 503);
  const projects = await service.getActiveProjects(c.req.param('daoId'));
  return c.json({ projects });
});

app.get('/api/v1/dao/:daoId/funding/allocations', async (c) => {
  const service = initDAOService();
  if (!service) return c.json({ error: 'DAO Registry not deployed' }, 503);
  const allocations = await service.getFundingAllocations(c.req.param('daoId'));
  return c.json({ allocations });
});

app.get('/api/v1/dao/:daoId/funding/summary', async (c) => {
  initDAOService();
  if (!fundingOracle) return c.json({ error: 'DAO Registry not deployed' }, 503);
  const summary = await fundingOracle.getEpochSummary(c.req.param('daoId'));
  return c.json(summary);
});

app.get('/api/v1/dao/:daoId/funding/recommendations', async (c) => {
  initDAOService();
  if (!fundingOracle) return c.json({ error: 'DAO Registry not deployed' }, 503);
  const recommendations = await fundingOracle.generateCEORecommendations(c.req.param('daoId'));
  return c.json(recommendations);
});

app.get('/api/v1/dao/:daoId/funding/knobs', async (c) => {
  initDAOService();
  if (!fundingOracle) return c.json({ error: 'DAO Registry not deployed' }, 503);
  const knobs = await fundingOracle.getKnobs(c.req.param('daoId'));
  return c.json(knobs);
});

// Casual Proposal API
app.post('/api/v1/dao/:daoId/casual/assess', async (c) => {
  const daoId = c.req.param('daoId');
  const body = await c.req.json() as { category: CasualProposalCategory; title: string; content: string };
  if (!body.category || !body.title || !body.content) {
    return c.json({ error: 'category, title, and content are required' }, 400);
  }
  const submission: CasualSubmission = {
    daoId,
    category: body.category,
    title: body.title,
    content: body.content,
  };
  const assessment = await proposalAssistant.assessCasualSubmission(submission);
  return c.json(assessment);
});

app.post('/api/v1/dao/:daoId/casual/help', async (c) => {
  const daoId = c.req.param('daoId');
  const body = await c.req.json() as { category: CasualProposalCategory; content: string };
  if (!body.category) {
    return c.json({ error: 'category is required' }, 400);
  }
  const help = await proposalAssistant.helpCraftSubmission(body.category, body.content ?? '', daoId);
  return c.json(help);
});

app.get('/api/v1/casual/categories', (c) => {
  const categories = proposalAssistant.getAllCategories();
  return c.json({ categories });
});

// Orchestrator DAO status
app.get('/api/v1/orchestrator/dao/:daoId', (c) => {
  if (!orchestrator) return c.json({ error: 'Orchestrator not running' }, 503);
  const status = orchestrator.getDAOStatus(c.req.param('daoId'));
  if (!status) return c.json({ error: 'DAO not tracked' }, 404);
  return c.json(status);
});

app.post('/api/v1/orchestrator/dao/:daoId/refresh', async (c) => {
  if (!orchestrator) return c.json({ error: 'Orchestrator not running' }, 503);
  await orchestrator.refreshDAO(c.req.param('daoId'));
  return c.json({ success: true });
});

app.post('/api/v1/orchestrator/dao/:daoId/active', async (c) => {
  if (!orchestrator) return c.json({ error: 'Orchestrator not running' }, 503);
  const body = await c.req.json() as { active: boolean };
  orchestrator.setDAOActive(c.req.param('daoId'), body.active ?? true);
  return c.json({ success: true });
});

// Registry Integration API - Deep AI DAO integration
const registryConfig: RegistryIntegrationConfig = {
  rpcUrl: config.rpcUrl,
  integrationContract: process.env.REGISTRY_INTEGRATION_ADDRESS,
  identityRegistry: config.contracts.identityRegistry as string,
  reputationRegistry: config.contracts.reputationRegistry as string,
  delegationRegistry: process.env.DELEGATION_REGISTRY_ADDRESS,
};
const registryIntegration = getRegistryIntegrationClient(registryConfig);

// Get comprehensive agent profile with composite score
app.get('/api/v1/registry/profile/:agentId', async (c) => {
  const agentId = BigInt(c.req.param('agentId'));
  const profile = await registryIntegration.getAgentProfile(agentId);
  if (!profile) return c.json({ error: 'Agent not found' }, 404);
  return c.json({
    ...profile,
    agentId: profile.agentId.toString(),
    stakedAmount: profile.stakedAmount.toString(),
  });
});

// Get multiple agent profiles
app.post('/api/v1/registry/profiles', async (c) => {
  const body = await c.req.json() as { agentIds: string[] };
  if (!body.agentIds?.length) return c.json({ error: 'agentIds required' }, 400);
  const profiles = await registryIntegration.getAgentProfiles(body.agentIds.map(id => BigInt(id)));
  return c.json({
    profiles: profiles.map(p => ({
      ...p,
      agentId: p.agentId.toString(),
      stakedAmount: p.stakedAmount.toString(),
    })),
  });
});

// Get voting power for an address
app.get('/api/v1/registry/voting-power/:address', async (c) => {
  const address = c.req.param('address');
  const agentId = BigInt(c.req.query('agentId') ?? '0');
  const baseVotes = BigInt(c.req.query('baseVotes') ?? '1000000000000000000'); // Default 1 token
  const power = await registryIntegration.getVotingPower(address, agentId, baseVotes);
  return c.json({
    ...power,
    baseVotes: power.baseVotes.toString(),
    effectiveVotes: power.effectiveVotes.toString(),
  });
});

// Search agents by tag
app.get('/api/v1/registry/search/tag/:tag', async (c) => {
  const tag = c.req.param('tag');
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const limit = parseInt(c.req.query('limit') ?? '50', 10);
  const result = await registryIntegration.searchByTag(tag, offset, limit);
  return c.json({
    ...result,
    agentIds: result.agentIds.map(id => id.toString()),
  });
});

// Get agents by minimum score
app.get('/api/v1/registry/search/score', async (c) => {
  const minScore = parseInt(c.req.query('minScore') ?? '50', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const limit = parseInt(c.req.query('limit') ?? '50', 10);
  const result = await registryIntegration.getAgentsByScore(minScore, offset, limit);
  return c.json({
    agentIds: result.agentIds.map(id => id.toString()),
    scores: result.scores,
  });
});

// Get top agents by composite score
app.get('/api/v1/registry/top-agents', async (c) => {
  const count = parseInt(c.req.query('count') ?? '10', 10);
  const profiles = await registryIntegration.getTopAgents(count);
  return c.json({
    agents: profiles.map(p => ({
      ...p,
      agentId: p.agentId.toString(),
      stakedAmount: p.stakedAmount.toString(),
    })),
  });
});

// Get all active agents
app.get('/api/v1/registry/active-agents', async (c) => {
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const limit = parseInt(c.req.query('limit') ?? '100', 10);
  const agentIds = await registryIntegration.getActiveAgents(offset, limit);
  return c.json({
    agentIds: agentIds.map(id => id.toString()),
    total: await registryIntegration.getTotalAgents(),
    offset,
    limit,
  });
});

// Get provider reputations with weighting
app.get('/api/v1/registry/providers', async (c) => {
  const providers = await registryIntegration.getAllProviderReputations();
  return c.json({
    providers: providers.map(p => ({
      ...p,
      providerAgentId: p.providerAgentId.toString(),
      stakeAmount: p.stakeAmount.toString(),
    })),
  });
});

// Get weighted reputation for an agent (across all providers)
app.get('/api/v1/registry/weighted-reputation/:agentId', async (c) => {
  const agentId = BigInt(c.req.param('agentId'));
  const result = await registryIntegration.getWeightedAgentReputation(agentId);
  return c.json(result);
});

// Check eligibility for various actions
app.get('/api/v1/registry/eligibility/:agentId', async (c) => {
  const agentId = BigInt(c.req.param('agentId'));
  const [proposal, vote, research] = await Promise.all([
    registryIntegration.canSubmitProposal(agentId),
    registryIntegration.canVote(agentId),
    registryIntegration.canConductResearch(agentId),
  ]);
  return c.json({
    agentId: agentId.toString(),
    canSubmitProposal: proposal,
    canVote: vote,
    canConductResearch: research,
  });
});

// Delegation endpoints
app.get('/api/v1/registry/delegate/:address', async (c) => {
  const delegate = await registryIntegration.getDelegate(c.req.param('address'));
  if (!delegate) return c.json({ error: 'Not a registered delegate' }, 404);
  return c.json({
    ...delegate,
    agentId: delegate.agentId.toString(),
    totalDelegated: delegate.totalDelegated.toString(),
  });
});

app.get('/api/v1/registry/top-delegates', async (c) => {
  const limit = parseInt(c.req.query('limit') ?? '10', 10);
  const delegates = await registryIntegration.getTopDelegates(limit);
  return c.json({
    delegates: delegates.map((d: { delegate: string; agentId: bigint; name: string; totalDelegated: bigint; delegatorCount: number; isActive: boolean }) => ({
      ...d,
      agentId: d.agentId.toString(),
      totalDelegated: d.totalDelegated.toString(),
    })),
  });
});

app.get('/api/v1/registry/security-council', async (c) => {
  const council = await registryIntegration.getSecurityCouncil();
  return c.json({
    members: council.map((m: { member: string; agentId: bigint; combinedScore: number; electedAt: number }) => ({
      ...m,
      agentId: m.agentId.toString(),
    })),
  });
});

app.get('/api/v1/registry/is-council-member/:address', async (c) => {
  const isMember = await registryIntegration.isSecurityCouncilMember(c.req.param('address'));
  return c.json({ isMember });
});

async function runOrchestratorCycle(): Promise<OrchestratorTriggerResult> {
  const start = Date.now();
  if (!orchestrator) {
    orchestrator = createOrchestrator(config, blockchain);
    await orchestrator.start();
  }
  const status = orchestrator.getStatus();
  return { cycleCount: status.cycleCount, processedProposals: status.processedProposals, duration: Date.now() - start };
}

app.get('/health', (c) => c.json({
  status: 'ok',
  service: 'jeju-council',
  version: '3.0.0',
  mode: 'multi-tenant',
  tee: getTEEMode(),
  orchestrator: orchestrator?.getStatus().running ?? false,
  daoCount: orchestrator?.getStatus().daoCount ?? 0,
  daoRegistry: config.contracts.daoRegistry !== ZERO_ADDR,
  daoFunding: config.contracts.daoFunding !== ZERO_ADDR,
  erc8004: { identity: erc8004.identityDeployed, reputation: erc8004.reputationDeployed, validation: erc8004.validationDeployed },
  futarchy: { council: futarchy.councilDeployed, predimarket: futarchy.predimarketDeployed },
  registry: { integration: !!registryConfig.integrationContract, delegation: !!registryConfig.delegationRegistry },
  endpoints: { a2a: '/a2a', mcp: '/mcp', rest: '/api/v1', dao: '/api/v1/dao', agents: '/api/v1/agents', futarchy: '/api/v1/futarchy', moderation: '/api/v1/moderation', registry: '/api/v1/registry' },
}));

// Prometheus metrics (excludes /metrics and /health from request count)
const metricsData = { requests: 0, errors: 0, startTime: Date.now() };
app.use('*', async (c, next) => {
  const path = c.req.path;
  if (path !== '/metrics' && path !== '/health') metricsData.requests++;
  await next();
});
app.onError((err, c) => {
  metricsData.errors++;
  console.error(`[Error] ${c.req.method} ${c.req.path}:`, err.message);
  return c.json({ error: err.message }, 500);
});

app.get('/metrics', () => {
  const mem = process.memoryUsage();
  const uptime = (Date.now() - metricsData.startTime) / 1000;
  const orch = orchestrator?.getStatus();
  const activeFlags = moderation.getActiveFlags().length;
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
    `council_proposals_processed ${orch?.processedProposals ?? 0}`,
    '# HELP council_moderation_flags_active Active moderation flags',
    '# TYPE council_moderation_flags_active gauge',
    `council_moderation_flags_active ${activeFlags}`,
  ];
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain' } });
});

app.get('/', (c) => c.json({
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
}));

const port = parseInt(process.env.PORT ?? '8010', 10);
const autoStart = process.env.AUTO_START_ORCHESTRATOR !== 'false';
const useCompute = process.env.USE_COMPUTE_TRIGGER !== 'false';

async function start() {
  await initLocalServices();
  await initModeration();
  await autocratAgentRuntime.initialize();

  const computeClient = getComputeTriggerClient();
  const computeAvailable = await computeClient.isAvailable();
  let triggerMode = 'local';

  if (computeAvailable && useCompute) {
    await registerAutocratTriggers();
    triggerMode = 'compute';
  }

  console.log(`
[Council] Started on port ${port}
  TEE: ${getTEEMode()}
  Trigger: ${triggerMode}
  Endpoints: /a2a, /mcp, /api/v1
`);

  if (autoStart && blockchain.councilDeployed) {
    orchestrator = createOrchestrator(config, blockchain);
    await orchestrator.start();
    if (triggerMode === 'local') startLocalCron(runOrchestratorCycle);
  }
}

start();

export default { port, fetch: app.fetch };
export { app, config };
export type { CouncilConfig, CEOPersona, GovernanceParams, FundingConfig } from './types';
export { createAutocratA2AServer } from './a2a-server';
export { createAutocratMCPServer } from './mcp-server';
export { getBlockchain, AutocratBlockchain } from './blockchain';
export { createOrchestrator, type AutocratOrchestrator } from './orchestrator';
export { DAOService, createDAOService, getDAOService, type DAO, type DAOFull, type FundingProject, type FundingEpoch, type FundingAllocation } from './dao-service';
export { getFundingOracle, type FundingOracle, type FundingAnalysis, type EpochSummary, type CEOFundingRecommendation } from './funding-oracle';
export { initLocalServices, store, retrieve, storeVote, getVotes } from './local-services';
export { getTEEMode, makeTEEDecision, decryptReasoning } from './tee';
export { getComputeTriggerClient, registerAutocratTriggers, startLocalCron } from './compute-trigger';
export { autocratAgentRuntime, autocratAgentTemplates, getAgentByRole, type AgentVote, type DeliberationRequest, type CEODecisionRequest } from './agents';
export { getProposalAssistant, ProposalAssistant, type ProposalDraft, type QualityAssessment, type SimilarProposal, type CasualSubmission, type CasualAssessment, type CasualProposalCategory } from './proposal-assistant';
export { getResearchAgent, ResearchAgent, generateResearchReport, quickScreenProposal, type ResearchRequest, type ResearchReport, type ResearchSection } from './research-agent';
export { getERC8004Client, ERC8004Client, type ERC8004Config, type AgentIdentity, type AgentReputation } from './erc8004';
export { getFutarchyClient, FutarchyClient, type FutarchyConfig, type FutarchyMarket } from './futarchy';
export { getModerationSystem, ModerationSystem, FlagType, type ProposalFlag, type TrustRelation, type ModerationScore, type ModeratorStats } from './moderation';
export { getRegistryIntegrationClient, RegistryIntegrationClient, resetRegistryIntegrationClient, type RegistryIntegrationConfig, type AgentProfile, type ProviderReputation, type VotingPower, type SearchResult, type EligibilityResult } from './registry-integration';
