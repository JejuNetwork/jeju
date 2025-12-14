/**
 * Org A2A & MCP Server
 * 
 * Agent-to-agent and Model Context Protocol interfaces for
 * organization management and multi-sig operations.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

// ============================================================================
// Configuration
// ============================================================================

const AGENT_CARD = {
  protocolVersion: '0.3.0',
  name: 'Jeju Org',
  description: 'Organization management with multi-sig and role-based access',
  url: '/a2a',
  preferredTransport: 'http',
  provider: { organization: 'Jeju Network', url: 'https://jeju.network' },
  version: '1.0.0',
  capabilities: { streaming: false, pushNotifications: true, stateTransitionHistory: true },
  defaultInputModes: ['text', 'data'],
  defaultOutputModes: ['text', 'data'],
  skills: [
    // Org Management
    { id: 'create-org', name: 'Create Org', description: 'Create a new organization', tags: ['action', 'org'] },
    { id: 'get-org', name: 'Get Org', description: 'Get organization details', tags: ['query', 'org'] },
    { id: 'list-orgs', name: 'List Orgs', description: 'List all organizations', tags: ['query', 'orgs'] },
    { id: 'add-member', name: 'Add Member', description: 'Add member to org', tags: ['action', 'member'] },
    { id: 'remove-member', name: 'Remove Member', description: 'Remove member from org', tags: ['action', 'member'] },
    { id: 'set-role', name: 'Set Role', description: 'Set member role', tags: ['action', 'role'] },
    
    // Multi-sig
    { id: 'create-multisig', name: 'Create Multisig', description: 'Create multi-sig wallet', tags: ['action', 'multisig'] },
    { id: 'propose-transaction', name: 'Propose Transaction', description: 'Propose a multi-sig transaction', tags: ['action', 'transaction'] },
    { id: 'approve-transaction', name: 'Approve Transaction', description: 'Approve pending transaction', tags: ['action', 'approve'] },
    { id: 'execute-transaction', name: 'Execute Transaction', description: 'Execute approved transaction', tags: ['action', 'execute'] },
    { id: 'get-pending-transactions', name: 'Get Pending', description: 'Get pending transactions', tags: ['query', 'pending'] },
    
    // MPC Custody (using @jeju/shared/crypto)
    { id: 'create-mpc-key', name: 'Create MPC Key', description: 'Create distributed key', tags: ['action', 'mpc'] },
    { id: 'request-signature', name: 'Request Signature', description: 'Request threshold signature', tags: ['action', 'signature'] },
    { id: 'rotate-key', name: 'Rotate Key', description: 'Rotate MPC key shares', tags: ['action', 'rotation'] },
  ],
};

const MCP_SERVER_INFO = {
  name: 'jeju-org',
  version: '1.0.0',
  description: 'Organization management with multi-sig and MPC custody',
  capabilities: { resources: true, tools: true, prompts: false },
};

const MCP_RESOURCES = [
  { uri: 'org://organizations', name: 'Organizations', description: 'All organizations', mimeType: 'application/json' },
  { uri: 'org://multisigs', name: 'Multi-sigs', description: 'All multi-sig wallets', mimeType: 'application/json' },
  { uri: 'org://pending', name: 'Pending Transactions', description: 'Pending multi-sig transactions', mimeType: 'application/json' },
  { uri: 'org://mpc-keys', name: 'MPC Keys', description: 'Distributed keys', mimeType: 'application/json' },
];

const MCP_TOOLS = [
  {
    name: 'create_org',
    description: 'Create a new organization',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Organization name' },
        members: { type: 'array', description: 'Initial members' },
        multisigThreshold: { type: 'number', description: 'Multi-sig threshold' },
      },
      required: ['name'],
    },
  },
  {
    name: 'propose_transaction',
    description: 'Propose a multi-sig transaction',
    inputSchema: {
      type: 'object',
      properties: {
        multisigId: { type: 'string', description: 'Multi-sig wallet ID' },
        to: { type: 'string', description: 'Destination address' },
        value: { type: 'string', description: 'ETH value' },
        data: { type: 'string', description: 'Transaction data' },
      },
      required: ['multisigId', 'to'],
    },
  },
  {
    name: 'approve_transaction',
    description: 'Approve a pending transaction',
    inputSchema: {
      type: 'object',
      properties: {
        transactionId: { type: 'string', description: 'Transaction ID' },
      },
      required: ['transactionId'],
    },
  },
  {
    name: 'create_mpc_key',
    description: 'Create a new distributed MPC key',
    inputSchema: {
      type: 'object',
      properties: {
        keyId: { type: 'string', description: 'Key identifier' },
        holders: { type: 'array', description: 'Key share holders' },
        threshold: { type: 'number', description: 'Signature threshold' },
      },
      required: ['keyId', 'holders', 'threshold'],
    },
  },
  {
    name: 'request_mpc_signature',
    description: 'Request a threshold signature',
    inputSchema: {
      type: 'object',
      properties: {
        keyId: { type: 'string', description: 'Key ID' },
        message: { type: 'string', description: 'Message to sign' },
      },
      required: ['keyId', 'message'],
    },
  },
];

// ============================================================================
// Server Implementation
// ============================================================================

export function createOrgA2AServer(): Hono {
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
    case 'create-org':
      return { message: 'Organization created', data: { orgId: crypto.randomUUID() } };
    case 'get-org':
      return { message: `Organization ${params.orgId}`, data: { org: null } };
    case 'list-orgs':
      return { message: 'Organizations', data: { orgs: [] } };
    case 'create-multisig':
      return { message: 'Multi-sig created', data: { multisigId: crypto.randomUUID() } };
    case 'propose-transaction':
      return { message: 'Transaction proposed', data: { txId: crypto.randomUUID() } };
    case 'create-mpc-key':
      return { message: 'MPC key created', data: { keyId: params.keyId, shares: params.holders } };
    case 'request-signature':
      return { message: 'Signature request submitted', data: { requestId: crypto.randomUUID() } };
    default:
      return { message: 'Unknown skill', data: { error: 'Skill not found' } };
  }
}

export function createOrgMCPServer(): Hono {
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
      case 'org://organizations': contents = { organizations: [] }; break;
      case 'org://multisigs': contents = { multisigs: [] }; break;
      case 'org://pending': contents = { transactions: [] }; break;
      case 'org://mpc-keys': contents = { keys: [] }; break;
      default: return c.json({ error: 'Resource not found' }, 404);
    }

    return c.json({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(contents) }] });
  });

  app.post('/tools/list', (c) => c.json({ tools: MCP_TOOLS }));

  app.post('/tools/call', async (c) => {
    const { name, arguments: args } = await c.req.json() as { name: string; arguments: Record<string, unknown> };
    let result: unknown = {};

    switch (name) {
      case 'create_org':
        result = { orgId: crypto.randomUUID(), name: args.name };
        break;
      case 'propose_transaction':
        result = { transactionId: crypto.randomUUID(), status: 'pending' };
        break;
      case 'approve_transaction':
        result = { success: true, approvals: 1 };
        break;
      case 'create_mpc_key':
        result = { keyId: args.keyId, address: '0x...', shares: (args.holders as string[]).length };
        break;
      case 'request_mpc_signature':
        result = { requestId: crypto.randomUUID(), status: 'pending' };
        break;
      default:
        return c.json({ content: [{ type: 'text', text: 'Tool not found' }], isError: true });
    }

    return c.json({ content: [{ type: 'text', text: JSON.stringify(result) }], isError: false });
  });

  app.get('/', (c) => c.json({ ...MCP_SERVER_INFO, resources: MCP_RESOURCES, tools: MCP_TOOLS }));

  return app;
}

export function createOrgServer(): Hono {
  const app = new Hono();
  app.route('/a2a', createOrgA2AServer());
  app.route('/mcp', createOrgMCPServer());
  app.get('/', (c) => c.json({ name: 'Jeju Org', version: '1.0.0', endpoints: { a2a: '/a2a', mcp: '/mcp' } }));
  return app;
}

