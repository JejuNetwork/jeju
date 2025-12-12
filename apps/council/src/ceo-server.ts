/**
 * CEO Agent Server
 * 
 * Dedicated ElizaOS-powered CEO agent exposed on port 8004.
 * Provides A2A and MCP interfaces for AI CEO governance.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { AgentRuntime, type Character, type Plugin, type UUID } from '@elizaos/core';
import { ceoAgent } from './agents/templates';
import { ceoPlugin } from './agents/ceo-plugin';
import { makeTEEDecision, getTEEMode } from './tee';

// ============================================================================
// Configuration
// ============================================================================

const CEO_PORT = parseInt(process.env.CEO_PORT ?? '8004', 10);
const COUNCIL_A2A_URL = process.env.COUNCIL_A2A_URL ?? 'http://localhost:8010/a2a';
const COUNCIL_MCP_URL = process.env.COUNCIL_MCP_URL ?? 'http://localhost:8010/mcp';

// Model settings
function getModelSettings(): Record<string, string> {
  const settings: Record<string, string> = {};
  if (process.env.ANTHROPIC_API_KEY) {
    settings.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    settings.ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
  }
  if (process.env.OPENAI_API_KEY) {
    settings.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  }
  if (process.env.GROQ_API_KEY) {
    settings.GROQ_API_KEY = process.env.GROQ_API_KEY;
    settings.LARGE_GROQ_MODEL = 'llama-3.3-70b-versatile';
  }
  return settings;
}

// ============================================================================
// CEO Runtime
// ============================================================================

let ceoRuntime: AgentRuntime | null = null;

async function initializeCEORuntime(): Promise<AgentRuntime> {
  if (ceoRuntime) return ceoRuntime;

  const character: Character = {
    ...ceoAgent.character,
    settings: {
      ...ceoAgent.character.settings,
      ...getModelSettings(),
    },
  };

  const plugins: Plugin[] = [ceoPlugin];

  const runtime = new AgentRuntime({
    character,
    agentId: 'eliza-ceo' as UUID,
    plugins,
  });

  // Configure logger
  const customLogger = {
    log: (msg: string) => console.log(`[CEO] ${msg}`),
    info: (msg: string) => console.log(`[CEO] ${msg}`),
    warn: (msg: string) => console.warn(`[CEO] ${msg}`),
    error: (msg: string) => console.error(`[CEO] ${msg}`),
    debug: (msg: string) => console.debug(`[CEO] ${msg}`),
    success: (msg: string) => console.log(`[CEO] ✓ ${msg}`),
    notice: (msg: string) => console.log(`[CEO] ${msg}`),
    level: 'info' as const,
    trace: (msg: string) => console.debug(`[CEO] ${msg}`),
    fatal: (msg: string) => console.error(`[CEO] FATAL: ${msg}`),
    progress: (msg: string) => console.log(`[CEO] ${msg}`),
    clear: () => undefined,
    child: () => customLogger,
  };
  runtime.logger = customLogger as typeof runtime.logger;

  // Register plugins
  for (const plugin of plugins) {
    await runtime.registerPlugin(plugin);
  }

  ceoRuntime = runtime;
  console.log('[CEO] Runtime initialized with ElizaOS');
  return runtime;
}

// ============================================================================
// A2A Server
// ============================================================================

const app = new Hono();
app.use('/*', cors());

// Agent Card (A2A Discovery)
app.get('/.well-known/agent-card.json', (c) => c.json({
  protocolVersion: '0.3.0',
  name: 'Eliza - AI CEO',
  description: 'AI CEO of Jeju DAO. Makes final decisions on proposals with TEE attestation.',
  url: '/a2a',
  preferredTransport: 'http',
  provider: { organization: 'Jeju Network', url: 'https://jeju.network' },
  version: '1.0.0',
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  defaultInputModes: ['text', 'data'],
  defaultOutputModes: ['text', 'data'],
  skills: [
    { id: 'make-decision', name: 'Make Decision', description: 'Make final CEO decision on a proposal', tags: ['decision', 'governance'] },
    { id: 'get-dashboard', name: 'Get Dashboard', description: 'Get CEO governance dashboard', tags: ['query', 'governance'] },
    { id: 'get-active-proposals', name: 'Get Active Proposals', description: 'List proposals awaiting action', tags: ['query', 'proposals'] },
    { id: 'get-council-votes', name: 'Get Council Votes', description: 'Get council deliberation for a proposal', tags: ['query', 'council'] },
    { id: 'request-research', name: 'Request Research', description: 'Request deep research on a proposal', tags: ['action', 'research'] },
    { id: 'chat', name: 'Chat', description: 'Chat with the AI CEO', tags: ['chat'] },
  ],
}));

// A2A Message Handler
app.post('/a2a', async (c) => {
  const body = await c.req.json() as {
    jsonrpc: string;
    id: number;
    method: string;
    params?: {
      message?: {
        messageId: string;
        parts?: Array<{ kind: string; text?: string; data?: { skillId?: string; params?: Record<string, unknown> } }>;
      };
    };
  };

  if (body.method !== 'message/send') {
    return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } });
  }

  const message = body.params?.message;
  const textPart = message?.parts?.find(p => p.kind === 'text');
  const dataPart = message?.parts?.find(p => p.kind === 'data');

  const runtime = await initializeCEORuntime();

  // Handle skill-based requests
  if (dataPart?.data?.skillId) {
    const result = await executeSkill(runtime, dataPart.data.skillId, dataPart.data.params ?? {});
    return c.json({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        role: 'agent',
        parts: [{ kind: 'text', text: result.text }, { kind: 'data', data: result.data }],
        messageId: message?.messageId ?? `ceo-${Date.now()}`,
        kind: 'message',
      },
    });
  }

  // Handle chat/text requests
  if (textPart?.text) {
    const response = await processCEOMessage(runtime, textPart.text);
    return c.json({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        role: 'agent',
        parts: [{ kind: 'text', text: response }],
        messageId: message?.messageId ?? `ceo-${Date.now()}`,
        kind: 'message',
      },
    });
  }

  return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Invalid params' } });
});

// ============================================================================
// MCP Server
// ============================================================================

// MCP Discovery
app.get('/mcp/discover', (c) => c.json({
  name: 'Eliza CEO MCP',
  version: '1.0.0',
  description: 'MCP interface for AI CEO governance',
}));

app.post('/mcp/initialize', async (c) => {
  await initializeCEORuntime();
  return c.json({
    protocolVersion: '2024-11-05',
    serverInfo: { name: 'eliza-ceo-mcp', version: '1.0.0' },
    capabilities: {
      tools: { listChanged: false },
      resources: { subscribe: false, listChanged: false },
    },
  });
});

// MCP Tools List
app.get('/mcp/tools', (c) => c.json({
  tools: [
    {
      name: 'make_ceo_decision',
      description: 'Make a final CEO decision on a proposal',
      inputSchema: {
        type: 'object',
        properties: {
          proposalId: { type: 'string', description: 'The proposal ID (0x...)' },
          councilVotes: { type: 'array', description: 'Array of council votes' },
        },
        required: ['proposalId'],
      },
    },
    {
      name: 'get_governance_dashboard',
      description: 'Get comprehensive CEO governance dashboard',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_active_proposals',
      description: 'List active proposals awaiting CEO action',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_council_deliberation',
      description: 'Get council votes for a specific proposal',
      inputSchema: {
        type: 'object',
        properties: {
          proposalId: { type: 'string', description: 'The proposal ID' },
        },
        required: ['proposalId'],
      },
    },
    {
      name: 'request_deep_research',
      description: 'Request comprehensive research on a proposal',
      inputSchema: {
        type: 'object',
        properties: {
          proposalId: { type: 'string', description: 'The proposal ID' },
        },
        required: ['proposalId'],
      },
    },
  ],
}));

// MCP Tool Execution
app.post('/mcp/tools/call', async (c) => {
  const body = await c.req.json() as {
    params: { name: string; arguments?: Record<string, unknown> };
  };
  const runtime = await initializeCEORuntime();

  const toolName = body.params.name;
  const args = body.params.arguments ?? {};

  const result = await executeMCPTool(runtime, toolName, args);

  return c.json({
    content: [{ type: 'text', text: result }],
  });
});

// MCP Resources
app.get('/mcp/resources', (c) => c.json({
  resources: [
    { uri: 'council://agents', name: 'Council Agents', description: 'List of council agent roles' },
    { uri: 'council://stats', name: 'Governance Stats', description: 'Current governance statistics' },
    { uri: 'council://treasury', name: 'Treasury', description: 'Treasury balance and allocations' },
  ],
}));

app.post('/mcp/resources/read', async (c) => {
  const body = await c.req.json() as { params: { uri: string } };
  const uri = body.params.uri;

  let content = '';
  
  if (uri === 'council://agents') {
    content = `Council Agents:
- Treasury Agent: Financial assessment
- Code Agent: Technical review
- Community Agent: Stakeholder impact
- Security Agent: Risk analysis
- Legal Agent: Compliance review`;
  } else if (uri === 'council://stats') {
    // Fetch from council A2A
    const response = await fetch(COUNCIL_A2A_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: { message: { messageId: 'mcp', parts: [{ kind: 'data', data: { skillId: 'get-governance-stats' } }] } },
      }),
    });
    const data = await response.json() as { result?: { parts?: Array<{ kind: string; data?: Record<string, unknown> }> } };
    content = JSON.stringify(data.result?.parts?.find(p => p.kind === 'data')?.data ?? {}, null, 2);
  } else if (uri === 'council://treasury') {
    content = 'Treasury data available via get_governance_dashboard tool.';
  }

  return c.json({
    contents: [{ uri, mimeType: 'text/plain', text: content }],
  });
});

// ============================================================================
// Skill Execution
// ============================================================================

async function executeSkill(
  runtime: AgentRuntime,
  skillId: string,
  params: Record<string, unknown>
): Promise<{ text: string; data: Record<string, unknown> }> {
  switch (skillId) {
    case 'make-decision':
      return await makeDecision(runtime, params.proposalId as string, params.councilVotes as Array<{ role: string; vote: string; reasoning: string }> ?? []);
    
    case 'get-dashboard':
      return await getDashboard();
    
    case 'get-active-proposals':
      return await getActiveProposals();
    
    case 'get-council-votes':
      return await getCouncilVotes(params.proposalId as string);
    
    case 'request-research':
      return {
        text: `Research requested for proposal ${params.proposalId}`,
        data: { proposalId: params.proposalId, status: 'requested' },
      };
    
    case 'chat':
      const response = await processCEOMessage(runtime, params.message as string ?? '');
      return { text: response, data: {} };
    
    default:
      return { text: `Unknown skill: ${skillId}`, data: { error: 'unknown_skill' } };
  }
}

async function makeDecision(
  _runtime: AgentRuntime,
  proposalId: string,
  councilVotes: Array<{ role: string; vote: string; reasoning: string }>
): Promise<{ text: string; data: Record<string, unknown> }> {
  const decision = await makeTEEDecision({
    proposalId,
    councilVotes,
  });

  return {
    text: `CEO Decision: ${decision.approved ? 'APPROVED' : 'REJECTED'}\n${decision.publicReasoning}`,
    data: {
      proposalId,
      approved: decision.approved,
      reasoning: decision.publicReasoning,
      confidence: decision.confidenceScore,
      alignment: decision.alignmentScore,
      recommendations: decision.recommendations,
      attestation: {
        provider: decision.attestation?.provider,
        verified: decision.attestation?.verified,
      },
    },
  };
}

async function getDashboard(): Promise<{ text: string; data: Record<string, unknown> }> {
  const response = await fetch(COUNCIL_A2A_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: { message: { messageId: 'ceo', parts: [{ kind: 'data', data: { skillId: 'get-governance-stats' } }] } },
    }),
  });
  const result = await response.json() as { result?: { parts?: Array<{ kind: string; data?: Record<string, unknown> }> } };
  const data = result.result?.parts?.find(p => p.kind === 'data')?.data ?? {};

  return {
    text: 'CEO Governance Dashboard',
    data,
  };
}

async function getActiveProposals(): Promise<{ text: string; data: Record<string, unknown> }> {
  const response = await fetch(COUNCIL_A2A_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: { message: { messageId: 'ceo', parts: [{ kind: 'data', data: { skillId: 'list-proposals', params: { activeOnly: true } } }] } },
    }),
  });
  const result = await response.json() as { result?: { parts?: Array<{ kind: string; data?: Record<string, unknown> }> } };
  const data = result.result?.parts?.find(p => p.kind === 'data')?.data ?? {};

  return {
    text: `Active proposals: ${(data as { total?: number }).total ?? 0}`,
    data,
  };
}

async function getCouncilVotes(proposalId: string): Promise<{ text: string; data: Record<string, unknown> }> {
  const response = await fetch(COUNCIL_A2A_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: { message: { messageId: 'ceo', parts: [{ kind: 'data', data: { skillId: 'get-council-votes', params: { proposalId } } }] } },
    }),
  });
  const result = await response.json() as { result?: { parts?: Array<{ kind: string; data?: Record<string, unknown> }> } };
  const data = result.result?.parts?.find(p => p.kind === 'data')?.data ?? {};

  return {
    text: `Council votes for ${proposalId.slice(0, 10)}...`,
    data,
  };
}

// ============================================================================
// MCP Tool Execution
// ============================================================================

async function executeMCPTool(
  runtime: AgentRuntime,
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (toolName) {
    case 'make_ceo_decision': {
      const result = await makeDecision(
        runtime,
        args.proposalId as string,
        args.councilVotes as Array<{ role: string; vote: string; reasoning: string }> ?? []
      );
      return result.text;
    }
    case 'get_governance_dashboard': {
      const result = await getDashboard();
      return JSON.stringify(result.data, null, 2);
    }
    case 'get_active_proposals': {
      const result = await getActiveProposals();
      return JSON.stringify(result.data, null, 2);
    }
    case 'get_council_deliberation': {
      const result = await getCouncilVotes(args.proposalId as string);
      return JSON.stringify(result.data, null, 2);
    }
    case 'request_deep_research': {
      return `Research requested for proposal ${args.proposalId}. Check back later for results.`;
    }
    default:
      return `Unknown tool: ${toolName}`;
  }
}

// ============================================================================
// Chat Processing
// ============================================================================

async function processCEOMessage(runtime: AgentRuntime, text: string): Promise<string> {
  // Check for proposal ID in message
  const proposalMatch = text.match(/0x[a-fA-F0-9]{64}/);
  
  // Check for decision keywords
  if (text.toLowerCase().includes('decide') || text.toLowerCase().includes('approve') || text.toLowerCase().includes('reject')) {
    if (proposalMatch) {
      const result = await makeDecision(runtime, proposalMatch[0], []);
      return result.text;
    }
    return 'Please provide a proposal ID (0x...) for me to make a decision.';
  }

  // Check for dashboard request
  if (text.toLowerCase().includes('dashboard') || text.toLowerCase().includes('status') || text.toLowerCase().includes('overview')) {
    const result = await getDashboard();
    return `Here's my governance dashboard:\n\n${JSON.stringify(result.data, null, 2)}`;
  }

  // Check for proposals request
  if (text.toLowerCase().includes('proposal') && (text.toLowerCase().includes('list') || text.toLowerCase().includes('active') || text.toLowerCase().includes('pending'))) {
    const result = await getActiveProposals();
    return `Active proposals:\n\n${JSON.stringify(result.data, null, 2)}`;
  }

  // Check for council votes request
  if (proposalMatch && (text.toLowerCase().includes('council') || text.toLowerCase().includes('vote'))) {
    const result = await getCouncilVotes(proposalMatch[0]);
    return `Council votes for ${proposalMatch[0].slice(0, 12)}...:\n\n${JSON.stringify(result.data, null, 2)}`;
  }

  // Default response
  return `I am Eliza, the AI CEO of Jeju DAO. I can help you with:

• Make decisions on proposals (provide proposal ID)
• View governance dashboard
• List active proposals
• Review council deliberations
• Request research on proposals

What would you like to do?`;
}

// ============================================================================
// Health & Info
// ============================================================================

app.get('/health', async (c) => {
  const runtime = ceoRuntime ? 'initialized' : 'not_initialized';
  return c.json({
    status: 'ok',
    service: 'eliza-ceo',
    version: '1.0.0',
    runtime,
    tee: getTEEMode(),
    endpoints: {
      a2a: '/a2a',
      mcp: '/mcp',
      agentCard: '/.well-known/agent-card.json',
    },
    upstream: {
      council: COUNCIL_A2A_URL,
      councilMcp: COUNCIL_MCP_URL,
    },
  });
});

app.get('/', (c) => c.json({
  name: 'Eliza - AI CEO',
  version: '1.0.0',
  description: 'AI CEO of Jeju DAO with ElizaOS runtime',
  endpoints: {
    a2a: '/a2a',
    mcp: '/mcp',
    agentCard: '/.well-known/agent-card.json',
    health: '/health',
  },
}));

// ============================================================================
// Server Start
// ============================================================================

async function start() {
  await initializeCEORuntime();

  const teeMode = getTEEMode();
  const teeLabel = teeMode === 'hardware' ? 'Hardware TEE' : 'Simulated';

  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                     ELIZA - AI CEO                              ║
║                                                                 ║
║  ElizaOS-Powered Governance Agent                               ║
║  • Runtime: ElizaOS AgentRuntime                                ║
║  • Providers: Governance, Treasury, Council, Proposals          ║
║  • Actions: Decision, Research, Deliberation                    ║
║  • TEE: ${teeLabel.padEnd(49)}║
║                                                                 ║
║  Endpoints:                                                     ║
║  • A2A:  http://localhost:${CEO_PORT}/a2a                              ║
║  • MCP:  http://localhost:${CEO_PORT}/mcp                              ║
║                                                                 ║
║  Upstream:                                                      ║
║  • Council: ${COUNCIL_A2A_URL.padEnd(42)}║
║                                                                 ║
╚═══════════════════════════════════════════════════════════════╝
`);
}

start();

export default { port: CEO_PORT, fetch: app.fetch };
export { app, ceoRuntime };
