/**
 * Jeju Council - AI DAO Governance
 *
 * PRODUCTION ASSUMPTIONS:
 * 1. Ollama must be running at OLLAMA_URL (default: localhost:11434)
 *    - Required model: OLLAMA_MODEL (default: llama3.2:3b)
 *    - Without Ollama, AI features fall back to keyword-based heuristics
 *
 * 2. Contract deployment is OPTIONAL:
 *    - ERC8004 registries (identity, reputation, validation) return empty when not deployed
 *    - Futarchy (council, predimarket) returns empty arrays when not deployed
 *    - Set addresses to 0x0 to explicitly disable
 *
 * 3. Data persistence:
 *    - Moderation flags/trust/stats are IN-MEMORY (lost on restart)
 *    - Research cache is IN-MEMORY with 1000 entry limit
 *    - Vote storage persists to .council-storage/ directory
 *
 * 4. Security:
 *    - OPERATOR_KEY or PRIVATE_KEY required for blockchain transactions
 *    - TEE mode determined by environment (disabled/simulation/hardware)
 *
 * 5. Service ports:
 *    - Council API: PORT (default: 8010)
 *    - CEO Server: CEO_PORT (default: 8004, separate process)
 *    - Ollama: OLLAMA_URL (default: localhost:11434)
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createCouncilA2AServer } from './a2a-server';
import { createCouncilMCPServer } from './mcp-server';
import { getBlockchain } from './blockchain';
import { createOrchestrator, type CouncilOrchestrator } from './orchestrator';
import { initLocalServices } from './local-services';
import { getTEEMode } from './tee';
import { councilAgentRuntime } from './agents';
import { registerCouncilTriggers, startLocalCron, getComputeTriggerClient, type OrchestratorTriggerResult } from './compute-trigger';
import { getProposalAssistant, type ProposalDraft, type QualityAssessment } from './proposal-assistant';
import { getResearchAgent, type ResearchRequest } from './research-agent';
import { getERC8004Client, type ERC8004Config } from './erc8004';
import { getFutarchyClient, type FutarchyConfig } from './futarchy';
import { getModerationSystem, initModeration, FlagType } from './moderation';
import { getRegistryIntegrationClient, type RegistryIntegrationConfig } from './registry-integration';
import type { CouncilConfig } from './types';

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`;
const addr = (key: string) => (process.env[key] ?? ZERO_ADDR) as `0x${string}`;
const agent = (id: string, name: string, prompt: string) => ({ id, name, model: 'local', endpoint: 'local', systemPrompt: prompt });

function getConfig(): CouncilConfig {
  return {
    rpcUrl: process.env.RPC_URL ?? process.env.JEJU_RPC_URL ?? 'http://localhost:8545',
    contracts: {
      council: addr('COUNCIL_ADDRESS'),
      proposalRegistry: addr('PROPOSAL_REGISTRY_ADDRESS'),
      ceoAgent: addr('CEO_AGENT_ADDRESS'),
      identityRegistry: addr('IDENTITY_REGISTRY_ADDRESS'),
      reputationRegistry: addr('REPUTATION_REGISTRY_ADDRESS'),
      stakingManager: addr('STAKING_MANAGER_ADDRESS'),
      predimarket: addr('PREDIMARKET_ADDRESS'),
    },
    agents: {
      ceo: agent('eliza-ceo', 'Eliza', 'AI CEO of Jeju DAO'),
      council: [
        agent('council-treasury', 'Treasury', 'Financial review'),
        agent('council-code', 'Code', 'Technical review'),
        agent('council-community', 'Community', 'Community impact'),
        agent('council-security', 'Security', 'Security review'),
      ],
      proposalAgent: agent('proposal-agent', 'Proposal Assistant', 'Help craft proposals'),
      researchAgent: agent('research-agent', 'Researcher', 'Deep research'),
    },
    parameters: {
      minQualityScore: 90,
      councilVotingPeriod: 3 * 24 * 60 * 60,
      gracePeriod: 24 * 60 * 60,
      minBackers: 0,
      minStakeForVeto: BigInt('10000000000000000'),
      vetoThreshold: 30,
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

const a2aServer = createCouncilA2AServer(config, blockchain);
const mcpServer = createCouncilMCPServer(config, blockchain);
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

let orchestrator: CouncilOrchestrator | null = null;

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
  const draft = await c.req.json() as ProposalDraft;
  if (!draft.title || !draft.description) {
    return c.json({ error: 'title and description are required' }, 400);
  }
  const assessment = await proposalAssistant.assessQuality(draft);
  return c.json(assessment);
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
  version: '2.0.0',
  mode: 'local',
  tee: getTEEMode(),
  orchestrator: orchestrator?.getStatus().running ?? false,
  erc8004: { identity: erc8004.identityDeployed, reputation: erc8004.reputationDeployed, validation: erc8004.validationDeployed },
  futarchy: { council: futarchy.councilDeployed, predimarket: futarchy.predimarketDeployed },
  endpoints: { a2a: '/a2a', mcp: '/mcp', rest: '/api/v1', agents: '/api/v1/agents', futarchy: '/api/v1/futarchy', moderation: '/api/v1/moderation' },
}));

app.get('/', (c) => c.json({
  name: 'Jeju AI Council',
  version: '2.0.0',
  description: 'Fully autonomous reputation-based DAO with AI CEO',
  endpoints: {
    a2a: '/a2a',
    mcp: '/mcp',
    rest: '/api/v1',
    orchestrator: '/api/v1/orchestrator',
    proposals: '/api/v1/proposals',
    research: '/api/v1/research',
    agents: '/api/v1/agents',
    futarchy: '/api/v1/futarchy',
    moderation: '/api/v1/moderation',
    health: '/health',
  },
}));

const port = parseInt(process.env.PORT ?? '8010', 10);
const autoStart = process.env.AUTO_START_ORCHESTRATOR !== 'false';
const useCompute = process.env.USE_COMPUTE_TRIGGER !== 'false';

async function start() {
  await initLocalServices();
  await initModeration();
  await councilAgentRuntime.initialize();

  const computeClient = getComputeTriggerClient();
  const computeAvailable = await computeClient.isAvailable();
  let triggerMode = 'local';

  if (computeAvailable && useCompute) {
    await registerCouncilTriggers();
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
export type { CouncilConfig } from './types';
export { createCouncilA2AServer } from './a2a-server';
export { createCouncilMCPServer } from './mcp-server';
export { getBlockchain, CouncilBlockchain } from './blockchain';
export { createOrchestrator, type CouncilOrchestrator } from './orchestrator';
export { initLocalServices, store, retrieve, storeVote, getVotes } from './local-services';
export { getTEEMode, makeTEEDecision, decryptReasoning } from './tee';
export { getComputeTriggerClient, registerCouncilTriggers, startLocalCron } from './compute-trigger';
export { councilAgentRuntime, councilAgentTemplates, getAgentByRole, type AgentVote, type DeliberationRequest, type CEODecisionRequest } from './agents';
export { getProposalAssistant, ProposalAssistant, type ProposalDraft, type QualityAssessment, type SimilarProposal } from './proposal-assistant';
export { getResearchAgent, ResearchAgent, generateResearchReport, quickScreenProposal, type ResearchRequest, type ResearchReport, type ResearchSection } from './research-agent';
export { getERC8004Client, ERC8004Client, type ERC8004Config, type AgentIdentity, type AgentReputation } from './erc8004';
export { getFutarchyClient, FutarchyClient, type FutarchyConfig, type FutarchyMarket } from './futarchy';
export { getModerationSystem, ModerationSystem, FlagType, type ProposalFlag, type TrustRelation, type ModerationScore, type ModeratorStats } from './moderation';
