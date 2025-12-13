/**
 * Autocrat A2A & MCP Server
 * 
 * Agent-to-agent and Model Context Protocol interfaces for
 * the Autocrat autonomous governance system.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

// ============================================================================
// Configuration
// ============================================================================

const AGENT_CARD = {
  protocolVersion: '0.3.0',
  name: 'Jeju Autocrat',
  description: 'Autonomous governance and decision-making system',
  url: '/a2a',
  preferredTransport: 'http',
  provider: { organization: 'Jeju Network', url: 'https://jeju.network' },
  version: '1.0.0',
  capabilities: { streaming: false, pushNotifications: true, stateTransitionHistory: true },
  defaultInputModes: ['text', 'data'],
  defaultOutputModes: ['text', 'data'],
  skills: [
    // Proposal Skills
    { id: 'create-proposal', name: 'Create Proposal', description: 'Create a new governance proposal', tags: ['action', 'proposal'] },
    { id: 'get-proposal', name: 'Get Proposal', description: 'Get proposal details', tags: ['query', 'proposal'] },
    { id: 'list-proposals', name: 'List Proposals', description: 'List all proposals', tags: ['query', 'proposals'] },
    { id: 'vote-on-proposal', name: 'Vote on Proposal', description: 'Cast vote on a proposal', tags: ['action', 'vote'] },
    { id: 'execute-proposal', name: 'Execute Proposal', description: 'Execute a passed proposal', tags: ['action', 'execute'] },
    
    // Delegation Skills
    { id: 'delegate-voting', name: 'Delegate Voting', description: 'Delegate voting power', tags: ['action', 'delegate'] },
    { id: 'get-delegates', name: 'Get Delegates', description: 'Get delegation info', tags: ['query', 'delegate'] },
    
    // DAO Skills
    { id: 'get-dao-info', name: 'Get DAO Info', description: 'Get DAO configuration and stats', tags: ['query', 'dao'] },
    { id: 'get-treasury', name: 'Get Treasury', description: 'Get treasury balance and history', tags: ['query', 'treasury'] },
    
    // Autonomous Skills
    { id: 'analyze-proposal', name: 'Analyze Proposal', description: 'AI analysis of proposal impact', tags: ['action', 'analysis'] },
    { id: 'recommend-vote', name: 'Recommend Vote', description: 'Get voting recommendation', tags: ['query', 'recommendation'] },
    { id: 'simulate-execution', name: 'Simulate Execution', description: 'Simulate proposal execution', tags: ['action', 'simulation'] },
  ],
};

const MCP_SERVER_INFO = {
  name: 'jeju-autocrat',
  version: '1.0.0',
  description: 'Autonomous governance and decision-making system',
  capabilities: { resources: true, tools: true, prompts: true },
};

const MCP_RESOURCES = [
  { uri: 'autocrat://proposals', name: 'Proposals', description: 'All governance proposals', mimeType: 'application/json' },
  { uri: 'autocrat://proposals/active', name: 'Active Proposals', description: 'Active proposals', mimeType: 'application/json' },
  { uri: 'autocrat://dao', name: 'DAO Info', description: 'DAO configuration', mimeType: 'application/json' },
  { uri: 'autocrat://treasury', name: 'Treasury', description: 'Treasury balance', mimeType: 'application/json' },
  { uri: 'autocrat://delegates', name: 'Delegates', description: 'Top delegates', mimeType: 'application/json' },
];

const MCP_TOOLS = [
  {
    name: 'create_proposal',
    description: 'Create a new governance proposal',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Proposal title' },
        description: { type: 'string', description: 'Proposal description' },
        actions: { type: 'array', description: 'Actions to execute' },
        votingPeriod: { type: 'number', description: 'Voting period in days' },
      },
      required: ['title', 'description', 'actions'],
    },
  },
  {
    name: 'vote',
    description: 'Cast a vote on a proposal',
    inputSchema: {
      type: 'object',
      properties: {
        proposalId: { type: 'string', description: 'Proposal ID' },
        support: { type: 'boolean', description: 'Vote for (true) or against (false)' },
        reason: { type: 'string', description: 'Reason for vote (optional)' },
      },
      required: ['proposalId', 'support'],
    },
  },
  {
    name: 'delegate',
    description: 'Delegate voting power to another address',
    inputSchema: {
      type: 'object',
      properties: {
        delegatee: { type: 'string', description: 'Address to delegate to' },
      },
      required: ['delegatee'],
    },
  },
  {
    name: 'analyze_proposal',
    description: 'Analyze a proposal with AI',
    inputSchema: {
      type: 'object',
      properties: {
        proposalId: { type: 'string', description: 'Proposal ID' },
      },
      required: ['proposalId'],
    },
  },
];

// ============================================================================
// Server Implementation
// ============================================================================

export function createAutocratA2AServer(): Hono {
  const app = new Hono();
  app.use('/*', cors());

  app.get('/.well-known/agent-card.json', (c) => c.json(AGENT_CARD));

  app.post('/', async (c) => {
    const body = await c.req.json() as { id: unknown; method: string; params?: { message?: { parts?: Array<{ kind: string; data?: Record<string, unknown> }>; messageId?: string } } };
    
    if (body.method !== 'message/send') {
      return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } });
    }

    const dataPart = body.params?.message?.parts?.find((p) => p.kind === 'data');
    const skillId = dataPart?.data?.skillId as string;
    const result = await executeSkill(skillId, dataPart?.data ?? {});

    return c.json({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        role: 'agent',
        parts: [{ kind: 'text', text: result.message }, { kind: 'data', data: result.data }],
        messageId: body.params?.message?.messageId,
        kind: 'message',
      },
    });
  });

  return app;
}

async function executeSkill(skillId: string, params: Record<string, unknown>): Promise<{ message: string; data: Record<string, unknown> }> {
  switch (skillId) {
    case 'list-proposals':
      return { message: 'Proposals list', data: { proposals: [] } };
    case 'get-proposal':
      return { message: `Proposal ${params.proposalId}`, data: { proposal: null } };
    case 'create-proposal':
      return { message: 'Proposal created', data: { proposalId: crypto.randomUUID() } };
    case 'vote-on-proposal':
      return { message: 'Vote cast', data: { success: true } };
    case 'get-dao-info':
      return { message: 'DAO info', data: { name: 'Jeju DAO', members: 0 } };
    case 'analyze-proposal':
      return { message: 'Analysis complete', data: { recommendation: 'neutral', confidence: 0.7 } };
    default:
      return { message: 'Unknown skill', data: { error: 'Skill not found' } };
  }
}

export function createAutocratMCPServer(): Hono {
  const app = new Hono();
  app.use('/*', cors());

  app.post('/initialize', (c) => c.json({
    protocolVersion: '2024-11-05',
    serverInfo: MCP_SERVER_INFO,
    capabilities: MCP_SERVER_INFO.capabilities,
  }));

  app.post('/resources/list', (c) => c.json({ resources: MCP_RESOURCES }));

  app.post('/resources/read', async (c) => {
    const { uri } = await c.req.json() as { uri: string };
    let contents: unknown = {};

    switch (uri) {
      case 'autocrat://proposals': contents = { proposals: [] }; break;
      case 'autocrat://proposals/active': contents = { proposals: [] }; break;
      case 'autocrat://dao': contents = { name: 'Jeju DAO', votingPeriod: 7 }; break;
      case 'autocrat://treasury': contents = { balance: '0', history: [] }; break;
      default: return c.json({ error: 'Resource not found' }, 404);
    }

    return c.json({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(contents) }] });
  });

  app.post('/tools/list', (c) => c.json({ tools: MCP_TOOLS }));

  app.post('/tools/call', async (c) => {
    const { name, arguments: args } = await c.req.json() as { name: string; arguments: Record<string, unknown> };
    let result: unknown = {};

    switch (name) {
      case 'create_proposal':
        result = { proposalId: crypto.randomUUID(), status: 'pending' };
        break;
      case 'vote':
        result = { success: true, proposalId: args.proposalId };
        break;
      case 'delegate':
        result = { success: true, delegatee: args.delegatee };
        break;
      case 'analyze_proposal':
        result = { recommendation: 'for', confidence: 0.85, reasons: [] };
        break;
      default:
        return c.json({ content: [{ type: 'text', text: 'Tool not found' }], isError: true });
    }

    return c.json({ content: [{ type: 'text', text: JSON.stringify(result) }], isError: false });
  });

  app.get('/', (c) => c.json({ ...MCP_SERVER_INFO, resources: MCP_RESOURCES, tools: MCP_TOOLS }));

  return app;
}

export function createAutocratServer(): Hono {
  const app = new Hono();
  app.route('/a2a', createAutocratA2AServer());
  app.route('/mcp', createAutocratMCPServer());
  app.get('/', (c) => c.json({ name: 'Jeju Autocrat', version: '1.0.0', endpoints: { a2a: '/a2a', mcp: '/mcp' } }));
  return app;
}

