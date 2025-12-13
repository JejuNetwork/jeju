import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { getDataSource } from './lib/db';
import { stakeRateLimiter, RATE_LIMITS } from './lib/stake-rate-limiter';
import { search, getAgentById, getPopularTags, SearchParams } from './lib/search';
import { mapAgentSummary, mapAgentWithSkills, mapAgentWithTools, mapBlockSummary, mapBlockDetail, mapTransactionSummary, mapTransactionDetail, mapProviderSummary } from './lib/mappers';
import { Block, Transaction, RegisteredAgent, NodeStake, TagIndex, ComputeProvider, StorageProvider } from './model';

const MCP_PORT = parseInt(process.env.MCP_PORT || '4353');

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;
const asyncHandler = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => 
  Promise.resolve(fn(req, res, next)).catch(next);

const app = express();
app.use(cors());
app.use(express.json());
app.use(stakeRateLimiter({ skipPaths: ['/health'] }));

// MCP Server Info
const SERVER_INFO = {
  name: 'jeju-indexer',
  version: '1.0.0',
  description: 'Jeju blockchain indexer - query blocks, transactions, agents, and services',
  capabilities: {
    resources: true,
    tools: true,
    prompts: false,
  },
};

// MCP Resources
const RESOURCES = [
  // Registry & Discovery
  { uri: 'indexer://agents', name: 'Registered Agents', description: 'All ERC-8004 registered agents', mimeType: 'application/json' },
  { uri: 'indexer://agents/a2a', name: 'A2A Agents', description: 'Agents with A2A endpoints', mimeType: 'application/json' },
  { uri: 'indexer://agents/mcp', name: 'MCP Agents', description: 'Agents with MCP endpoints', mimeType: 'application/json' },
  { uri: 'indexer://tags', name: 'Popular Tags', description: 'Popular tags for agent discovery', mimeType: 'application/json' },
  { uri: 'indexer://providers/compute', name: 'Compute Providers', description: 'Active compute providers', mimeType: 'application/json' },
  { uri: 'indexer://providers/storage', name: 'Storage Providers', description: 'Active storage providers', mimeType: 'application/json' },
  // Blockchain Data
  { uri: 'indexer://blocks/recent', name: 'Recent Blocks', description: 'Last 20 blocks', mimeType: 'application/json' },
  { uri: 'indexer://transactions/recent', name: 'Recent Transactions', description: 'Last 20 transactions', mimeType: 'application/json' },
  { uri: 'indexer://nodes', name: 'Staking Nodes', description: 'Active RPC staking nodes', mimeType: 'application/json' },
  // Statistics
  { uri: 'indexer://stats', name: 'Statistics', description: 'Indexer statistics', mimeType: 'application/json' },
];

// MCP Tools
const TOOLS = [
  // Search
  {
    name: 'search',
    description: 'Full-text search across agents, services, and providers',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        type: { type: 'string', enum: ['a2a', 'mcp', 'rest', 'all'], description: 'Filter by endpoint type' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        category: { type: 'string', description: 'Filter by category (agent, workflow, app, game)' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
    },
  },
  // Agent queries
  {
    name: 'get_agent',
    description: 'Get details of a specific agent by ID',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'list_agents_by_tag',
    description: 'Find agents with a specific tag',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Tag to search for' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: ['tag'],
    },
  },
  // Blockchain queries
  {
    name: 'get_block',
    description: 'Get block by number or hash',
    inputSchema: {
      type: 'object',
      properties: {
        number: { type: 'number', description: 'Block number' },
        hash: { type: 'string', description: 'Block hash' },
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
];

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'indexer-mcp', port: MCP_PORT });
});

// MCP Initialize
app.post('/initialize', (_req: Request, res: Response) => {
  res.json({
    protocolVersion: '2024-11-05',
    serverInfo: SERVER_INFO,
    capabilities: SERVER_INFO.capabilities,
  });
});

// MCP Resources List
app.post('/resources/list', (_req: Request, res: Response) => {
  res.json({ resources: RESOURCES });
});

app.post('/resources/read', asyncHandler(async (req, res) => {
  const { uri } = req.body;
  const ds = await getDataSource();
  let contents: unknown;

  switch (uri) {
    case 'indexer://agents': {
      const agents = await ds.getRepository(RegisteredAgent).find({
        where: { active: true },
        order: { stakeTier: 'DESC', registeredAt: 'DESC' },
        take: 100,
      });
      contents = agents.map(mapAgentSummary);
      break;
    }

    case 'indexer://agents/a2a': {
      const agents = await ds.getRepository(RegisteredAgent)
        .createQueryBuilder('a')
        .where('a.active = true')
        .andWhere('a.a2aEndpoint IS NOT NULL')
        .orderBy('a.stakeTier', 'DESC')
        .take(100)
        .getMany();
      contents = agents.map(mapAgentWithSkills);
      break;
    }

    case 'indexer://agents/mcp': {
      const agents = await ds.getRepository(RegisteredAgent)
        .createQueryBuilder('a')
        .where('a.active = true')
        .andWhere('a.mcpEndpoint IS NOT NULL')
        .orderBy('a.stakeTier', 'DESC')
        .take(100)
        .getMany();
      contents = agents.map(mapAgentWithTools);
      break;
    }

    case 'indexer://tags': {
      contents = await getPopularTags(ds, 100);
      break;
    }

    case 'indexer://providers/compute': {
      const providers = await ds.getRepository(ComputeProvider).find({
        where: { isActive: true },
        take: 100,
      });
      contents = providers.map(p => mapProviderSummary(p, 'compute'));
      break;
    }

    case 'indexer://providers/storage': {
      const providers = await ds.getRepository(StorageProvider).find({
        where: { isActive: true },
        take: 100,
      });
      contents = providers.map(p => mapProviderSummary(p, 'storage'));
      break;
    }

    case 'indexer://blocks/recent': {
      const blocks = await ds.getRepository(Block).find({
        order: { number: 'DESC' },
        take: 20,
      });
      contents = blocks.map(mapBlockSummary);
      break;
    }

    case 'indexer://transactions/recent': {
      const txs = await ds.getRepository(Transaction).find({
        order: { blockNumber: 'DESC' },
        take: 20,
        relations: ['from', 'to'],
      });
      contents = txs.map(mapTransactionSummary);
      break;
    }

    case 'indexer://nodes': {
      const nodes = await ds.getRepository(NodeStake).find({
        where: { isActive: true },
        order: { stakedValueUSD: 'DESC' },
        take: 50,
      });
      contents = nodes.map(n => ({
        nodeId: n.nodeId,
        operator: n.operator,
        rpcUrl: n.rpcUrl,
        stakedAmount: n.stakedAmount.toString(),
        uptimeScore: n.currentUptimeScore?.toString(),
      }));
      break;
    }

    case 'indexer://stats': {
      const [blockCount, txCount, agentCount, nodeCount] = await Promise.all([
        ds.getRepository(Block).count(),
        ds.getRepository(Transaction).count(),
        ds.getRepository(RegisteredAgent).count({ where: { active: true } }),
        ds.getRepository(NodeStake).count({ where: { isActive: true } }),
      ]);
      const latestBlock = await ds.getRepository(Block).findOne({ order: { number: 'DESC' } });
      contents = {
        blocks: blockCount,
        transactions: txCount,
        agents: agentCount,
        nodes: nodeCount,
        latestBlock: latestBlock?.number || 0,
      };
      break;
    }

    default:
      res.status(404).json({ error: 'Resource not found' });
      return;
  }

  res.json({
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(contents, null, 2),
    }],
  });
}));

app.post('/tools/list', (_req, res) => {
  res.json({ tools: TOOLS });
});

app.post('/tools/call', asyncHandler(async (req, res) => {
  const { name, arguments: args } = req.body;
  const ds = await getDataSource();
  let result: unknown;
  let isError = false;

  switch (name) {
    case 'search': {
      const searchParams: SearchParams = {
        query: args?.query,
        endpointType: args?.type,
        tags: args?.tags,
        category: args?.category,
        limit: Math.min(50, args?.limit || 20),
      };
      result = await search(ds, searchParams);
      break;
    }

    case 'get_agent': {
      if (!args?.agentId) {
        result = { error: 'agentId required' };
        isError = true;
      } else {
        const agent = await getAgentById(ds, args.agentId);
        if (!agent) {
          result = { error: 'Agent not found' };
          isError = true;
        } else {
          result = agent;
        }
      }
      break;
    }

    case 'list_agents_by_tag': {
      if (!args?.tag) {
        result = { error: 'tag required' };
        isError = true;
      } else {
        const agents = await ds.getRepository(RegisteredAgent)
          .createQueryBuilder('a')
          .where(':tag = ANY(a.tags)', { tag: args.tag.toLowerCase() })
          .andWhere('a.active = true')
          .orderBy('a.stakeTier', 'DESC')
          .take((args?.limit as number) ?? 20)
          .getMany();
        result = agents.map(mapAgentSummary);
      }
      break;
    }

    case 'get_block': {
      if (!args?.number && !args?.hash) {
        result = { error: 'number or hash required' };
        isError = true;
      } else {
        const block = await ds.getRepository(Block).findOne({
          where: args.hash ? { hash: args.hash } : { number: args.number },
        });
        if (!block) {
          result = { error: 'Block not found' };
          isError = true;
        } else {
          result = mapBlockDetail(block);
        }
      }
      break;
    }

    case 'get_transaction': {
      if (!args?.hash) {
        result = { error: 'hash required' };
        isError = true;
      } else {
        const tx = await ds.getRepository(Transaction).findOne({
          where: { hash: args.hash },
          relations: ['from', 'to'],
        });
        if (!tx) {
          result = { error: 'Transaction not found' };
          isError = true;
        } else {
          result = mapTransactionDetail(tx);
        }
      }
      break;
    }

    case 'get_account': {
      if (!args?.address) {
        result = { error: 'address required' };
        isError = true;
      } else {
        const { Account } = await import('./model');
        const account = await ds.getRepository(Account).findOne({
          where: { address: args.address.toLowerCase() },
        });
        if (!account) {
          result = { error: 'Account not found' };
          isError = true;
        } else {
          result = {
            address: account.address,
            isContract: account.isContract,
            transactionCount: account.transactionCount,
            totalValueSent: account.totalValueSent.toString(),
            totalValueReceived: account.totalValueReceived.toString(),
            labels: account.labels,
          };
        }
      }
      break;
    }

    default:
      result = { error: 'Tool not found' };
      isError = true;
  }

  res.json({
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    isError,
  });
}));

app.get('/', (_req, res) => {
  res.json({
    server: SERVER_INFO.name,
    version: SERVER_INFO.version,
    description: SERVER_INFO.description,
    resources: RESOURCES,
    tools: TOOLS,
    capabilities: SERVER_INFO.capabilities,
    rateLimits: RATE_LIMITS,
  });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[MCP] Unhandled error:', err.message, err.stack);
  res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: err.message } });
});

export async function startMCPServer(): Promise<void> {
  await getDataSource();
  app.listen(MCP_PORT, () => {
    console.log(`🔌 MCP Server running on http://localhost:${MCP_PORT}`);
  });
}

if (require.main === module) {
  startMCPServer().catch(console.error);
}

export { app };
