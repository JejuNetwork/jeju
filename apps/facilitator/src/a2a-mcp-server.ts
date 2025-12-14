/**
 * Facilitator A2A & MCP Server
 * 
 * Agent-to-agent and Model Context Protocol interfaces for
 * the OIF/EIL facilitator service.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

// ============================================================================
// Configuration
// ============================================================================

const AGENT_CARD = {
  protocolVersion: '0.3.0',
  name: 'Jeju Facilitator',
  description: 'Cross-chain intent facilitation and solver coordination',
  url: '/a2a',
  preferredTransport: 'http',
  provider: { organization: 'Jeju Network', url: 'https://jeju.network' },
  version: '1.0.0',
  capabilities: { streaming: true, pushNotifications: true, stateTransitionHistory: true },
  defaultInputModes: ['text', 'data'],
  defaultOutputModes: ['text', 'data'],
  skills: [
    // Intent Skills
    { id: 'submit-intent', name: 'Submit Intent', description: 'Submit cross-chain intent', tags: ['action', 'intent'] },
    { id: 'get-intent', name: 'Get Intent', description: 'Get intent status', tags: ['query', 'intent'] },
    { id: 'list-intents', name: 'List Intents', description: 'List user intents', tags: ['query', 'intents'] },
    { id: 'cancel-intent', name: 'Cancel Intent', description: 'Cancel pending intent', tags: ['action', 'cancel'] },
    
    // Solver Skills
    { id: 'register-solver', name: 'Register Solver', description: 'Register as solver', tags: ['action', 'solver'] },
    { id: 'get-solver', name: 'Get Solver', description: 'Get solver info', tags: ['query', 'solver'] },
    { id: 'list-solvers', name: 'List Solvers', description: 'List active solvers', tags: ['query', 'solvers'] },
    { id: 'bid-on-intent', name: 'Bid on Intent', description: 'Submit solver bid', tags: ['action', 'bid'] },
    
    // XLP Skills
    { id: 'register-xlp', name: 'Register XLP', description: 'Register liquidity provider', tags: ['action', 'xlp'] },
    { id: 'get-xlp', name: 'Get XLP', description: 'Get XLP info', tags: ['query', 'xlp'] },
    { id: 'add-liquidity', name: 'Add Liquidity', description: 'Add cross-chain liquidity', tags: ['action', 'liquidity'] },
    { id: 'remove-liquidity', name: 'Remove Liquidity', description: 'Remove liquidity', tags: ['action', 'liquidity'] },
    
    // Quote Skills
    { id: 'get-quote', name: 'Get Quote', description: 'Get cross-chain quote', tags: ['query', 'quote'] },
    { id: 'get-routes', name: 'Get Routes', description: 'Get available routes', tags: ['query', 'routes'] },
  ],
};

const MCP_SERVER_INFO = {
  name: 'jeju-facilitator',
  version: '1.0.0',
  description: 'Cross-chain intent facilitation and solver coordination',
  capabilities: { resources: true, tools: true, prompts: false },
};

const MCP_RESOURCES = [
  { uri: 'facilitator://intents/pending', name: 'Pending Intents', description: 'Pending cross-chain intents', mimeType: 'application/json' },
  { uri: 'facilitator://solvers', name: 'Solvers', description: 'Active solvers', mimeType: 'application/json' },
  { uri: 'facilitator://xlps', name: 'XLPs', description: 'Liquidity providers', mimeType: 'application/json' },
  { uri: 'facilitator://routes', name: 'Routes', description: 'Available routes', mimeType: 'application/json' },
  { uri: 'facilitator://stats', name: 'Stats', description: 'Network statistics', mimeType: 'application/json' },
];

const MCP_TOOLS = [
  {
    name: 'submit_intent',
    description: 'Submit a cross-chain intent',
    inputSchema: {
      type: 'object',
      properties: {
        sourceChain: { type: 'number', description: 'Source chain ID' },
        destinationChain: { type: 'number', description: 'Destination chain ID' },
        sourceToken: { type: 'string', description: 'Source token address' },
        destinationToken: { type: 'string', description: 'Destination token address' },
        amount: { type: 'string', description: 'Amount to transfer' },
        recipient: { type: 'string', description: 'Recipient address' },
      },
      required: ['sourceChain', 'destinationChain', 'sourceToken', 'destinationToken', 'amount'],
    },
  },
  {
    name: 'get_quote',
    description: 'Get a quote for cross-chain transfer',
    inputSchema: {
      type: 'object',
      properties: {
        sourceChain: { type: 'number', description: 'Source chain ID' },
        destinationChain: { type: 'number', description: 'Destination chain ID' },
        sourceToken: { type: 'string', description: 'Source token' },
        destinationToken: { type: 'string', description: 'Destination token' },
        amount: { type: 'string', description: 'Amount' },
      },
      required: ['sourceChain', 'destinationChain', 'sourceToken', 'destinationToken', 'amount'],
    },
  },
  {
    name: 'register_solver',
    description: 'Register as a solver',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Solver address' },
        stake: { type: 'string', description: 'Stake amount' },
        supportedChains: { type: 'array', description: 'Supported chain IDs' },
      },
      required: ['address', 'stake', 'supportedChains'],
    },
  },
  {
    name: 'add_liquidity',
    description: 'Add cross-chain liquidity',
    inputSchema: {
      type: 'object',
      properties: {
        chainId: { type: 'number', description: 'Chain ID' },
        token: { type: 'string', description: 'Token address' },
        amount: { type: 'string', description: 'Amount to provide' },
      },
      required: ['chainId', 'token', 'amount'],
    },
  },
];

// ============================================================================
// Server Implementation
// ============================================================================

export function createFacilitatorA2AServer(): Hono {
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
    case 'submit-intent':
      return { message: 'Intent submitted', data: { intentId: crypto.randomUUID(), status: 'pending' } };
    case 'get-intent':
      return { message: `Intent ${params.intentId}`, data: { intent: null } };
    case 'get-quote':
      return { message: 'Quote retrieved', data: { amountOut: '0', fee: '0', estimatedTime: 60 } };
    case 'register-solver':
      return { message: 'Solver registered', data: { solverId: crypto.randomUUID() } };
    case 'list-solvers':
      return { message: 'Active solvers', data: { solvers: [] } };
    case 'add-liquidity':
      return { message: 'Liquidity added', data: { lpTokens: '0' } };
    default:
      return { message: 'Unknown skill', data: { error: 'Skill not found' } };
  }
}

export function createFacilitatorMCPServer(): Hono {
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
      case 'facilitator://intents/pending': contents = { intents: [] }; break;
      case 'facilitator://solvers': contents = { solvers: [] }; break;
      case 'facilitator://xlps': contents = { xlps: [] }; break;
      case 'facilitator://routes': contents = { routes: [] }; break;
      case 'facilitator://stats': contents = { totalIntents: 0, totalVolume: '0' }; break;
      default: return c.json({ error: 'Resource not found' }, 404);
    }

    return c.json({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(contents) }] });
  });

  app.post('/tools/list', (c) => c.json({ tools: MCP_TOOLS }));

  app.post('/tools/call', async (c) => {
    const { name, arguments: args } = await c.req.json() as { name: string; arguments: Record<string, unknown> };
    let result: unknown = {};

    switch (name) {
      case 'submit_intent':
        result = { intentId: crypto.randomUUID(), status: 'pending' };
        break;
      case 'get_quote':
        result = { amountOut: '100', fee: '0.1', route: ['source', 'bridge', 'destination'] };
        break;
      case 'register_solver':
        result = { solverId: crypto.randomUUID(), active: true };
        break;
      case 'add_liquidity':
        result = { lpTokens: '100', poolShare: 0.1 };
        break;
      default:
        return c.json({ content: [{ type: 'text', text: 'Tool not found' }], isError: true });
    }

    return c.json({ content: [{ type: 'text', text: JSON.stringify(result) }], isError: false });
  });

  app.get('/', (c) => c.json({ ...MCP_SERVER_INFO, resources: MCP_RESOURCES, tools: MCP_TOOLS }));

  return app;
}

export function createFacilitatorServer(): Hono {
  const app = new Hono();
  app.route('/a2a', createFacilitatorA2AServer());
  app.route('/mcp', createFacilitatorMCPServer());
  app.get('/', (c) => c.json({ name: 'Jeju Facilitator', version: '1.0.0', endpoints: { a2a: '/a2a', mcp: '/mcp' } }));
  return app;
}

