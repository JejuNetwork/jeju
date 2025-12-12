/**
 * Jeju Council - AI DAO Governance
 * 
 * Main entry point. Runs A2A, MCP, REST servers and orchestrator.
 * All services run locally by default - no external dependencies.
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
import { 
  registerCouncilTriggers, 
  startLocalCron, 
  getComputeTriggerClient,
  type OrchestratorTriggerResult 
} from './compute-trigger';
import type { CouncilConfig } from './types';

// Configuration
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
      ceo: agent('eliza-ceo', 'Eliza', 'AI CEO of Jeju DAO. Make final decisions on proposals.'),
      council: [
        agent('council-treasury', 'Treasury Guardian', 'Review proposals for financial impact.'),
        agent('council-code', 'Code Guardian', 'Review proposals for technical feasibility.'),
        agent('council-community', 'Community Guardian', 'Review proposals for community impact.'),
        agent('council-security', 'Security Guardian', 'Review proposals for security implications.'),
      ],
      proposalAgent: agent('proposal-agent', 'Proposal Assistant', 'Help users craft quality proposals.'),
      researchAgent: agent('research-agent', 'Deep Researcher', 'Conduct research on proposals.'),
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

// ============================================================================
// REST API Helper
// ============================================================================

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

// ============================================================================
// Application
// ============================================================================

const config = getConfig();
const blockchain = getBlockchain(config);
const app = new Hono();

app.use('/*', cors());

// Mount servers
const a2aServer = createCouncilA2AServer(config, blockchain);
const mcpServer = createCouncilMCPServer(config, blockchain);
app.route('/a2a', a2aServer.getRouter());
app.route('/mcp', mcpServer.getRouter());
app.get('/.well-known/agent-card.json', (c) => c.redirect('/a2a/.well-known/agent-card.json'));

// REST API
app.get('/api/v1/proposals', async (c) => c.json(await callA2AInternal(app, 'list-proposals', { activeOnly: c.req.query('active') === 'true' })));
app.get('/api/v1/proposals/:id', async (c) => c.json(await callA2AInternal(app, 'get-proposal', { proposalId: c.req.param('id') })));
app.get('/api/v1/ceo', async (c) => c.json(await callA2AInternal(app, 'get-ceo-status')));
app.get('/api/v1/governance/stats', async (c) => c.json(await callA2AInternal(app, 'get-governance-stats')));

// Orchestrator
let orchestrator: CouncilOrchestrator | null = null;

app.post('/api/v1/orchestrator/start', async (c) => {
  if (orchestrator?.getStatus().running) {
    return c.json({ error: 'Already running' }, 400);
  }
  orchestrator = createOrchestrator(config, blockchain);
  await orchestrator.start();
  return c.json({ status: 'started', ...orchestrator.getStatus() });
});

app.post('/api/v1/orchestrator/stop', async (c) => {
  if (!orchestrator?.getStatus().running) {
    return c.json({ error: 'Not running' }, 400);
  }
  await orchestrator.stop();
  return c.json({ status: 'stopped' });
});

app.get('/api/v1/orchestrator/status', (c) => {
  return c.json(orchestrator?.getStatus() ?? { running: false, cycleCount: 0 });
});

// ============================================================================
// Compute Trigger Endpoints
// ============================================================================

// Trigger endpoint for compute service to call
app.post('/trigger/orchestrator', async (c) => {
  // Parse payload (optional, for event data)
  await c.req.json().catch(() => ({}));
  const startTime = Date.now();
  
  // Run orchestrator cycle
  const result = await runOrchestratorCycle();
  
  return c.json({
    success: true,
    executionId: `exec-${startTime}`,
    ...result,
  });
});

// Get registered triggers
app.get('/api/v1/triggers', async (c) => {
  const client = getComputeTriggerClient();
  const available = await client.isAvailable();
  
  if (!available) {
    return c.json({
      mode: 'local',
      message: 'Compute service not available, using local cron',
      triggers: [],
    });
  }
  
  const triggers = await client.list({ active: true });
  return c.json({ mode: 'compute', triggers });
});

// Trigger execution history
app.get('/api/v1/triggers/history', async (c) => {
  const client = getComputeTriggerClient();
  const available = await client.isAvailable();
  
  if (!available) {
    return c.json({ mode: 'local', executions: [] });
  }
  
  const limit = parseInt(c.req.query('limit') ?? '50', 10);
  const executions = await client.getHistory(undefined, limit);
  return c.json({ mode: 'compute', executions });
});

// Manual trigger execution
app.post('/api/v1/triggers/execute', async (c) => {
  const result = await runOrchestratorCycle();
  return c.json(result);
});

// Helper to run orchestrator cycle
async function runOrchestratorCycle(): Promise<OrchestratorTriggerResult> {
  const startTime = Date.now();
  
  if (!orchestrator) {
    orchestrator = createOrchestrator(config, blockchain);
    await orchestrator.start();
  }
  
  // The orchestrator runs its own cycle, we just report status
  const status = orchestrator.getStatus();
  
  return {
    cycleCount: status.cycleCount,
    processedProposals: status.processedProposals,
    duration: Date.now() - startTime,
  };
}

// Health & info
app.get('/health', (c) => c.json({
  status: 'ok',
  service: 'jeju-council',
  version: '1.0.0',
  mode: 'local',
  tee: getTEEMode(),
  orchestrator: orchestrator?.getStatus().running ?? false,
  endpoints: { a2a: '/a2a', mcp: '/mcp', rest: '/api/v1' },
}));

app.get('/', (c) => c.json({
  name: 'Jeju AI Council',
  version: '1.0.0',
  mode: 'local',
  description: 'AI-governed DAO with local services (no external dependencies)',
  endpoints: {
    a2a: '/a2a',
    mcp: '/mcp',
    rest: '/api/v1',
    orchestrator: '/api/v1/orchestrator',
    agentCard: '/.well-known/agent-card.json',
    health: '/health',
  },
}));

// ============================================================================
// Server
// ============================================================================

const port = parseInt(process.env.PORT ?? '8010', 10);
const autoStartOrchestrator = process.env.AUTO_START_ORCHESTRATOR !== 'false';
const useComputeTrigger = process.env.USE_COMPUTE_TRIGGER !== 'false';

// Initialize and start
async function start() {
  // Initialize local services
  await initLocalServices();
  
  // Initialize ElizaOS council agents
  await councilAgentRuntime.initialize();
  
  const teeMode = getTEEMode();
  const teeLabel = teeMode === 'hardware' ? 'Hardware TEE (production)' : 'Simulated (local dev)';
  
  // Try to register with compute service
  const computeClient = getComputeTriggerClient();
  const computeAvailable = await computeClient.isAvailable();
  let triggerMode = 'local';
  
  if (computeAvailable && useComputeTrigger) {
    await registerCouncilTriggers();
    triggerMode = 'compute';
  }
  
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                     JEJU AI COUNCIL                            ║
║                                                                 ║
║  AI-Governed DAO powered by ElizaOS                             ║
║  • Agents: Treasury, Code, Community, Security, Legal, CEO      ║
║  • Storage: Local (file-based)                                  ║
║  • Inference: Local (heuristic) / Cloud (if API keys set)       ║
║  • TEE: ${teeLabel.padEnd(43)}║
║  • Trigger: ${(triggerMode === 'compute' ? 'Compute Service' : 'Local Cron').padEnd(41)}║
║                                                                 ║
║  Endpoints:                                                     ║
║  • A2A:  http://localhost:${port}/a2a                              ║
║  • MCP:  http://localhost:${port}/mcp                              ║
║  • REST: http://localhost:${port}/api/v1                           ║
║  • Trigger: http://localhost:${port}/trigger/orchestrator          ║
║                                                                 ║
╚═══════════════════════════════════════════════════════════════╝
`);

  // Start orchestrator based on mode
  if (autoStartOrchestrator && blockchain.councilDeployed) {
    console.log('[Council] Auto-starting orchestrator...');
    orchestrator = createOrchestrator(config, blockchain);
    await orchestrator.start();
    
    // If compute service not available, use local cron as fallback
    if (triggerMode === 'local') {
      console.log('[Council] Using local cron for orchestrator cycles');
      startLocalCron(runOrchestratorCycle);
    } else {
      console.log('[Council] Compute service will trigger orchestrator cycles');
    }
  } else if (!blockchain.councilDeployed) {
    console.log('[Council] No contracts deployed - orchestrator will start when triggered');
    console.log('[Council] POST /api/v1/orchestrator/start or /trigger/orchestrator to start');
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
export { initLocalServices, store, retrieve } from './local-services';
export { getTEEMode, makeTEEDecision, decryptReasoning } from './tee';
export { getComputeTriggerClient, registerCouncilTriggers, startLocalCron } from './compute-trigger';
export { 
  councilAgentRuntime, 
  councilAgentTemplates,
  getAgentByRole,
  type AgentVote, 
  type DeliberationRequest,
  type CEODecisionRequest,
} from './agents';
