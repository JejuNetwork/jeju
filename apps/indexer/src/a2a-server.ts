import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { getDataSource } from './lib/db';
import { stakeRateLimiter, RATE_LIMITS } from './lib/stake-rate-limiter';
import { search, getAgentById, getPopularTags, SearchParams } from './lib/search';
import { mapAgentSummary, mapAgentWithSkills, mapBlockSummary, mapBlockDetail, mapTransactionSummary, mapTransactionDetail } from './lib/mappers';
import { Block, Transaction, RegisteredAgent, NodeStake, TagIndex } from './model';

const A2A_PORT = parseInt(process.env.A2A_PORT || '4351');

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;
const asyncHandler = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => 
  Promise.resolve(fn(req, res, next)).catch(next);

const app = express();
app.use(cors());
app.use(express.json());
app.use(stakeRateLimiter({ skipPaths: ['/health', '/.well-known', '/playground', '/static'] }));

// Serve static files from public directory
app.use('/static', express.static(path.join(__dirname, '../public')));

// Custom styled GraphQL playground
app.get('/playground', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/playground.html'));
});

// Root redirect to playground
app.get('/', (_req: Request, res: Response) => {
  res.redirect('/playground');
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'indexer-a2a', port: A2A_PORT });
});

// A2A Agent Card
const AGENT_CARD = {
  protocolVersion: '0.3.0',
  name: 'Jeju Indexer',
  description: 'Query blockchain data, search ERC-8004 registry, and discover agents/services',
  url: `http://localhost:${A2A_PORT}/api/a2a`,
  preferredTransport: 'http',
  provider: { organization: 'Jeju Network', url: 'https://jeju.network' },
  version: '1.0.0',
  capabilities: { 
    streaming: false, 
    pushNotifications: false, 
    stateTransitionHistory: false 
  },
  defaultInputModes: ['text', 'data'],
  defaultOutputModes: ['text', 'data'],
  skills: [
    // Search & Discovery
    { id: 'search', name: 'Search Registry', description: 'Full-text search across agents, services, and providers', tags: ['search', 'discovery'], examples: ['Search for game agents', 'Find MCP services'] },
    { id: 'get-agent', name: 'Get Agent Details', description: 'Get full details of an ERC-8004 registered agent', tags: ['query', 'agent'], examples: ['Get agent #123'] },
    { id: 'list-agents', name: 'List Agents', description: 'List registered agents with filters', tags: ['query', 'agent'], examples: ['List active agents', 'Show top staked agents'] },
    { id: 'list-tags', name: 'List Popular Tags', description: 'Get popular tags for agent discovery', tags: ['query', 'tags'], examples: ['Show popular tags'] },
    // Blockchain Data
    { id: 'query-blocks', name: 'Query Blocks', description: 'Query recent blocks', tags: ['query', 'blockchain'], examples: ['Show recent blocks'] },
    { id: 'query-transactions', name: 'Query Transactions', description: 'Query recent transactions', tags: ['query', 'blockchain'], examples: ['Recent transactions'] },
    { id: 'get-block', name: 'Get Block', description: 'Get block by number or hash', tags: ['query', 'blockchain'], examples: ['Get block 1000'] },
    { id: 'get-transaction', name: 'Get Transaction', description: 'Get transaction by hash', tags: ['query', 'blockchain'], examples: ['Get tx 0x...'] },
    // Node & Provider Discovery
    { id: 'list-nodes', name: 'List Staking Nodes', description: 'List registered RPC nodes', tags: ['query', 'nodes'], examples: ['Show active nodes'] },
    { id: 'list-providers', name: 'List Providers', description: 'List compute and storage providers', tags: ['query', 'providers'], examples: ['Show compute providers'] },
    // Statistics
    { id: 'get-stats', name: 'Get Statistics', description: 'Get indexer statistics', tags: ['query', 'stats'], examples: ['Show stats'] },
  ],
};

app.get('/.well-known/agent-card.json', (_req: Request, res: Response) => {
  res.json(AGENT_CARD);
});

// A2A message types
interface A2ARequest {
  jsonrpc: string;
  method: string;
  params?: { 
    message?: { 
      messageId: string; 
      parts: Array<{ 
        kind: string; 
        text?: string;
        data?: Record<string, string | number | boolean | string[]> 
      }> 
    } 
  };
  id: string | number;
}

interface SkillResult {
  message: string;
  data: Record<string, unknown>;
}

// Execute A2A skills
async function executeSkill(skillId: string, params: Record<string, unknown>): Promise<SkillResult> {
  const ds = await getDataSource();

  switch (skillId) {
    // Search & Discovery
    case 'search': {
      const searchParams: SearchParams = {
        query: (params.query as string) ?? (params.q as string),
        endpointType: params.type as SearchParams['endpointType'],
        tags: params.tags as string[],
        category: params.category as SearchParams['category'],
        minStakeTier: params.minTier as number,
        verified: params.verified as boolean,
        limit: Math.min(50, (params.limit as number) ?? 20),
        offset: (params.offset as number) ?? 0,
      };
      const results = await search(ds, searchParams);
      return {
        message: `Found ${results.agents.length} agents and ${results.providers.length} providers`,
        data: results as unknown as Record<string, unknown>,
      };
    }

    case 'get-agent': {
      const agentId = (params.agentId as string) ?? (params.id as string);
      if (!agentId) {
        return { message: 'Agent ID required', data: { error: 'Missing agentId parameter' } };
      }
      const agent = await getAgentById(ds, agentId);
      if (!agent) {
        return { message: 'Agent not found', data: { error: 'Agent not found', agentId } };
      }
      return { message: `Agent ${agent.name} (ID: ${agentId})`, data: agent as unknown as Record<string, unknown> };
    }

    case 'list-agents': {
      const repo = ds.getRepository(RegisteredAgent);
      const limit = Math.min(50, (params.limit as number) ?? 20);
      const active = params.active !== false;
      
      const agents = await repo.find({
        where: { active },
        order: { stakeTier: 'DESC', registeredAt: 'DESC' },
        take: limit,
      });

      return {
        message: `Found ${agents.length} agents`,
        data: {
          agents: agents.map(mapAgentSummary),
          total: agents.length,
        },
      };
    }

    case 'list-tags': {
      const tags = await getPopularTags(ds, 50);
      return {
        message: `${tags.length} popular tags`,
        data: { tags },
      };
    }

    // Blockchain Data
    case 'query-blocks': {
      const repo = ds.getRepository(Block);
      const limit = Math.min(50, (params.limit as number) ?? 10);
      
      const blocks = await repo.find({
        order: { number: 'DESC' },
        take: limit,
      });

      return {
        message: `${blocks.length} recent blocks`,
        data: {
          blocks: blocks.map(mapBlockSummary),
        },
      };
    }

    case 'query-transactions': {
      const repo = ds.getRepository(Transaction);
      const limit = Math.min(50, (params.limit as number) ?? 10);
      
      const txs = await repo.find({
        order: { blockNumber: 'DESC' },
        take: limit,
        relations: ['from', 'to'],
      });

      return {
        message: `${txs.length} recent transactions`,
        data: {
          transactions: txs.map(mapTransactionSummary),
        },
      };
    }

    case 'get-block': {
      const blockNumber = (params.number as number) ?? (params.blockNumber as number);
      const blockHash = (params.hash as string) ?? (params.blockHash as string);
      
      if (!blockNumber && !blockHash) {
        return { message: 'Block number or hash required', data: { error: 'Missing parameter' } };
      }

      const block = await ds.getRepository(Block).findOne({
        where: blockHash ? { hash: blockHash } : { number: blockNumber },
      });

      if (!block) {
        return { message: 'Block not found', data: { error: 'Block not found' } };
      }

      return {
        message: `Block ${block.number}`,
        data: mapBlockDetail(block),
      };
    }

    case 'get-transaction': {
      const txHash = (params.hash as string) ?? (params.txHash as string);
      if (!txHash) {
        return { message: 'Transaction hash required', data: { error: 'Missing hash parameter' } };
      }

      const tx = await ds.getRepository(Transaction).findOne({
        where: { hash: txHash },
        relations: ['from', 'to'],
      });

      if (!tx) {
        return { message: 'Transaction not found', data: { error: 'Transaction not found' } };
      }

      return {
        message: `Transaction ${tx.hash.slice(0, 10)}...`,
        data: mapTransactionDetail(tx),
      };
    }

    // Nodes & Providers
    case 'list-nodes': {
      const repo = ds.getRepository(NodeStake);
      const active = params.active !== false;
      
      const nodes = await repo.find({
        where: active ? { isActive: true } : {},
        order: { stakedValueUSD: 'DESC' },
        take: 50,
      });

      return {
        message: `${nodes.length} staking nodes`,
        data: {
          nodes: nodes.map(n => ({
            nodeId: n.nodeId,
            operator: n.operator,
            stakedAmount: n.stakedAmount.toString(),
            rpcUrl: n.rpcUrl,
            isActive: n.isActive,
            uptimeScore: n.currentUptimeScore?.toString(),
          })),
        },
      };
    }

    case 'list-providers': {
      const results = await search(ds, { 
        endpointType: 'rest', 
        limit: 50 
      });
      
      return {
        message: `${results.providers.length} providers`,
        data: { providers: results.providers },
      };
    }

    // Statistics
    case 'get-stats': {
      const [blockCount, txCount, agentCount, nodeCount] = await Promise.all([
        ds.getRepository(Block).count(),
        ds.getRepository(Transaction).count(),
        ds.getRepository(RegisteredAgent).count({ where: { active: true } }),
        ds.getRepository(NodeStake).count({ where: { isActive: true } }),
      ]);

      const latestBlock = await ds.getRepository(Block).findOne({
        order: { number: 'DESC' },
      });

      const tagRepo = ds.getRepository(TagIndex);
      const topTags = await tagRepo.find({ order: { agentCount: 'DESC' }, take: 5 });

      return {
        message: `Indexer stats: ${blockCount} blocks, ${agentCount} agents`,
        data: {
          blocks: blockCount,
          transactions: txCount,
          agents: agentCount,
          nodes: nodeCount,
          latestBlock: latestBlock?.number || 0,
          topTags: topTags.map(t => t.tag),
        },
      };
    }

    default:
      return {
        message: 'Unknown skill',
        data: { 
          error: 'Skill not found', 
          availableSkills: AGENT_CARD.skills.map(s => s.id) 
        },
      };
  }
}

app.post('/api/a2a', asyncHandler(async (req, res) => {
  const { method, params, id } = req.body as A2ARequest;

  if (method !== 'message/send') {
    res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
    return;
  }

  const message = params?.message;
  if (!message) {
    res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid params' } });
    return;
  }

  const dataPart = message.parts.find((p) => p.kind === 'data');
  if (!dataPart?.data) {
    res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'No data part' } });
    return;
  }

  const skillId = dataPart.data.skillId as string;
  if (!skillId) {
    res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'No skillId specified' } });
    return;
  }

  const result = await executeSkill(skillId, dataPart.data as Record<string, unknown>);

  res.json({
    jsonrpc: '2.0',
    id,
    result: {
      role: 'agent',
      parts: [
        { kind: 'text', text: result.message },
        { kind: 'data', data: result.data },
      ],
      messageId: message.messageId,
      kind: 'message',
    },
  });
}));

app.get('/api/a2a/search', asyncHandler(async (req, res) => {
  const result = await executeSkill('search', req.query as Record<string, unknown>);
  res.json(result.data);
}));

app.get('/api/a2a/agents/:id', asyncHandler(async (req, res) => {
  const result = await executeSkill('get-agent', { agentId: req.params.id });
  res.json(result.data);
}));

app.get('/api/a2a/tags', asyncHandler(async (_req, res) => {
  const result = await executeSkill('list-tags', {});
  res.json(result.data);
}));

app.get('/api/a2a/stats', asyncHandler(async (_req, res) => {
  const result = await executeSkill('get-stats', {});
  res.json(result.data);
}));

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[A2A] Unhandled error:', err.message, err.stack);
  res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: err.message } });
});

export async function startA2AServer(): Promise<void> {
  await getDataSource();
  app.listen(A2A_PORT, () => {
    console.log(`🤖 A2A Server running on http://localhost:${A2A_PORT}`);
  });
}

if (require.main === module) {
  startA2AServer().catch(console.error);
}

export { app };
