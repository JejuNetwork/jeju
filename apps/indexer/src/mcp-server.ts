/**
 * Indexer MCP Server
 * 
 * Model Context Protocol interface for blockchain data queries.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

// ============================================================================
// Configuration
// ============================================================================

const SERVER_INFO = {
  name: 'jeju-indexer',
  version: '1.0.0',
  description: 'Blockchain data indexing service with GraphQL access',
  capabilities: { resources: true, tools: true, prompts: true },
};

const RESOURCES = [
  { uri: 'indexer://blocks/latest', name: 'Latest Blocks', description: 'Most recent indexed blocks', mimeType: 'application/json' },
  { uri: 'indexer://transactions/recent', name: 'Recent Transactions', description: 'Recent transactions', mimeType: 'application/json' },
  { uri: 'indexer://agents', name: 'Registered Agents', description: 'All ERC-8004 registered agents', mimeType: 'application/json' },
  { uri: 'indexer://intents/active', name: 'Active Intents', description: 'Active cross-chain intents', mimeType: 'application/json' },
  { uri: 'indexer://proposals/active', name: 'Active Proposals', description: 'Active governance proposals', mimeType: 'application/json' },
  { uri: 'indexer://stats/network', name: 'Network Stats', description: 'Network-wide statistics', mimeType: 'application/json' },
  { uri: 'indexer://stats/defi', name: 'DeFi Stats', description: 'DeFi protocol statistics', mimeType: 'application/json' },
];

const TOOLS = [
  // Query Tools
  {
    name: 'query_graphql',
    description: 'Execute a GraphQL query against the indexer',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'GraphQL query string' },
        variables: { type: 'object', description: 'Query variables' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_block',
    description: 'Get block by number or hash',
    inputSchema: {
      type: 'object',
      properties: {
        blockNumber: { type: 'number', description: 'Block number' },
        blockHash: { type: 'string', description: 'Block hash' },
      },
    },
  },
  {
    name: 'get_transaction',
    description: 'Get transaction by hash',
    inputSchema: {
      type: 'object',
      properties: {
        hash: { type: 'string', description: 'Transaction hash' },
      },
      required: ['hash'],
    },
  },
  {
    name: 'get_account',
    description: 'Get account information',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Account address' },
      },
      required: ['address'],
    },
  },
  {
    name: 'get_token_balances',
    description: 'Get ERC20 token balances for an address',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Account address' },
      },
      required: ['address'],
    },
  },
  {
    name: 'get_agent',
    description: 'Get ERC-8004 registered agent by ID',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'search_agents',
    description: 'Search registered agents',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Filter by role' },
        name: { type: 'string', description: 'Search by name' },
        active: { type: 'boolean', description: 'Only active agents' },
        limit: { type: 'number', description: 'Max results' },
      },
    },
  },
  {
    name: 'get_intent',
    description: 'Get cross-chain intent by ID',
    inputSchema: {
      type: 'object',
      properties: {
        intentId: { type: 'string', description: 'Intent ID' },
      },
      required: ['intentId'],
    },
  },
  {
    name: 'get_proposal',
    description: 'Get governance proposal',
    inputSchema: {
      type: 'object',
      properties: {
        proposalId: { type: 'string', description: 'Proposal ID' },
      },
      required: ['proposalId'],
    },
  },
  {
    name: 'get_contract_events',
    description: 'Get events emitted by a contract',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Contract address' },
        eventName: { type: 'string', description: 'Filter by event name' },
        fromBlock: { type: 'number', description: 'Start block' },
        toBlock: { type: 'number', description: 'End block' },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['address'],
    },
  },
];

const PROMPTS = [
  {
    name: 'analyze_transaction',
    description: 'Analyze a transaction in detail',
    arguments: [
      { name: 'hash', description: 'Transaction hash to analyze', required: true },
    ],
  },
  {
    name: 'summarize_agent_activity',
    description: 'Summarize an agent\'s on-chain activity',
    arguments: [
      { name: 'agentId', description: 'Agent ID to summarize', required: true },
      { name: 'days', description: 'Number of days to look back', required: false },
    ],
  },
  {
    name: 'explain_proposal',
    description: 'Explain a governance proposal',
    arguments: [
      { name: 'proposalId', description: 'Proposal ID to explain', required: true },
    ],
  },
];

// ============================================================================
// MCP Server
// ============================================================================

export function createIndexerMCPServer(): Hono {
  const app = new Hono();

  app.use('/*', cors());

  // Initialize
  app.post('/initialize', (c) => {
    return c.json({
      protocolVersion: '2024-11-05',
      serverInfo: SERVER_INFO,
      capabilities: SERVER_INFO.capabilities,
    });
  });

  // Resources
  app.post('/resources/list', (c) => {
    return c.json({ resources: RESOURCES });
  });

  app.post('/resources/read', async (c) => {
    const { uri } = await c.req.json() as { uri: string };
    let contents: unknown;

    switch (uri) {
      case 'indexer://blocks/latest':
        contents = {
          note: 'Query latest blocks via GraphQL',
          query: 'query { blocks(limit: 10, orderBy: number_DESC) { number hash timestamp } }',
        };
        break;

      case 'indexer://transactions/recent':
        contents = {
          note: 'Query recent transactions via GraphQL',
          query: 'query { transactions(limit: 20, orderBy: timestamp_DESC) { hash from to value } }',
        };
        break;

      case 'indexer://agents':
        contents = {
          note: 'Query registered agents via GraphQL',
          query: 'query { registeredAgents(limit: 100, orderBy: registeredAt_DESC) { agentId name role isActive } }',
        };
        break;

      case 'indexer://intents/active':
        contents = {
          note: 'Query active intents via GraphQL',
          query: 'query { oifIntents(where: { status_eq: "PENDING" }, limit: 50) { intentId sender amount status } }',
        };
        break;

      case 'indexer://proposals/active':
        contents = {
          note: 'Query active proposals via GraphQL',
          query: 'query { councilProposals(where: { status_eq: "ACTIVE" }) { proposalId title votesFor votesAgainst } }',
        };
        break;

      case 'indexer://stats/network':
        contents = {
          note: 'Query network stats via GraphQL',
          query: 'query { networkSnapshots(limit: 1, orderBy: timestamp_DESC) { totalTransactions totalAccounts } }',
        };
        break;

      default:
        return c.json({ error: 'Resource not found' }, 404);
    }

    return c.json({
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(contents, null, 2),
      }],
    });
  });

  // Tools
  app.post('/tools/list', (c) => {
    return c.json({ tools: TOOLS });
  });

  app.post('/tools/call', async (c) => {
    const { name, arguments: args } = await c.req.json() as { name: string; arguments: Record<string, unknown> };
    let result: unknown;
    let isError = false;

    switch (name) {
      case 'query_graphql':
        result = {
          endpoint: '/graphql',
          method: 'POST',
          body: {
            query: args.query,
            variables: args.variables,
          },
        };
        break;

      case 'get_block':
        result = {
          query: `query { blocks(where: { number_eq: ${args.blockNumber} }, limit: 1) { number hash timestamp gasUsed } }`,
        };
        break;

      case 'get_transaction':
        result = {
          query: `query { transactions(where: { hash_eq: "${args.hash}" }, limit: 1) { hash from to value status } }`,
        };
        break;

      case 'get_account':
        result = {
          query: `query { accounts(where: { id_eq: "${(args.address as string).toLowerCase()}" }, limit: 1) { id balance transactionCount } }`,
        };
        break;

      case 'get_token_balances':
        result = {
          query: `query { tokenBalances(where: { account_eq: "${(args.address as string).toLowerCase()}", balance_gt: "0" }) { token { symbol } balance } }`,
        };
        break;

      case 'get_agent':
        result = {
          query: `query { registeredAgents(where: { agentId_eq: "${args.agentId}" }, limit: 1) { agentId name role isActive a2aEndpoint } }`,
        };
        break;

      case 'search_agents':
        result = {
          query: `query { registeredAgents(where: { role_eq: "${args.role ?? ''}", isActive_eq: ${args.active ?? true} }, limit: ${args.limit ?? 50}) { agentId name role } }`,
        };
        break;

      case 'get_intent':
        result = {
          query: `query { oifIntents(where: { intentId_eq: "${args.intentId}" }, limit: 1) { intentId sender sourceChain destinationChain amount status } }`,
        };
        break;

      case 'get_proposal':
        result = {
          query: `query { councilProposals(where: { proposalId_eq: "${args.proposalId}" }, limit: 1) { proposalId title description status votesFor votesAgainst } }`,
        };
        break;

      case 'get_contract_events':
        result = {
          query: `query { logs(where: { address_eq: "${(args.address as string).toLowerCase()}" }, limit: ${args.limit ?? 100}, orderBy: block_number_DESC) { topics data blockNumber } }`,
        };
        break;

      default:
        result = { error: 'Tool not found' };
        isError = true;
    }

    return c.json({
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError,
    });
  });

  // Prompts
  app.post('/prompts/list', (c) => {
    return c.json({ prompts: PROMPTS });
  });

  app.post('/prompts/get', async (c) => {
    const { name, arguments: args } = await c.req.json() as { name: string; arguments: Record<string, string> };

    let messages: Array<{ role: string; content: { type: string; text: string } }> = [];

    switch (name) {
      case 'analyze_transaction':
        messages = [{
          role: 'user',
          content: {
            type: 'text',
            text: `Analyze the following transaction in detail. Explain what it does, the contracts involved, and any notable patterns.

Transaction Hash: ${args.hash}

Please query the transaction data using the indexer tools and provide a comprehensive analysis.`,
          },
        }];
        break;

      case 'summarize_agent_activity':
        messages = [{
          role: 'user',
          content: {
            type: 'text',
            text: `Summarize the on-chain activity for agent ID ${args.agentId} over the past ${args.days ?? 30} days.

Include:
- Transaction count and volume
- Types of operations performed
- Interactions with other agents
- Any notable events or anomalies`,
          },
        }];
        break;

      case 'explain_proposal':
        messages = [{
          role: 'user',
          content: {
            type: 'text',
            text: `Explain governance proposal ${args.proposalId} in simple terms.

Include:
- What the proposal aims to change
- Current voting status
- Key arguments for and against
- Potential impact if passed`,
          },
        }];
        break;

      default:
        return c.json({ error: 'Prompt not found' }, 404);
    }

    return c.json({ messages });
  });

  // Info endpoint
  app.get('/', (c) => {
    return c.json({
      server: SERVER_INFO.name,
      version: SERVER_INFO.version,
      description: SERVER_INFO.description,
      resources: RESOURCES,
      tools: TOOLS,
      prompts: PROMPTS,
      capabilities: SERVER_INFO.capabilities,
    });
  });

  return app;
}

const MCP_PORT = parseInt(process.env.MCP_PORT || '4354');

export async function startMCPServer(): Promise<void> {
  const app = createIndexerMCPServer();
  
  const server = Bun.serve({
    port: MCP_PORT,
    fetch: app.fetch,
  });

  console.log(`📡 MCP Server running on http://localhost:${MCP_PORT}`);
}
