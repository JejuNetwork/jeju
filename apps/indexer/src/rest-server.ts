import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { getDataSource } from './lib/db';
import { stakeRateLimiter, getRateLimitStats, RATE_LIMITS } from './lib/stake-rate-limiter';
import { search, getAgentById, getPopularTags, SearchParams } from './lib/search';
import {
  Block, Transaction, Account, Contract, TokenTransfer,
  RegisteredAgent, NodeStake, ComputeProvider, StorageProvider,
  TagIndex, ContainerImage, CrossServiceRequest, ComputeRental,
  StorageDeal, MarketplaceStats, OracleFeed, OracleOperator,
  OracleReport, OracleDispute, OracleSubscription, OracleNetworkStats,
} from './model';
import { ethers } from 'ethers';

const REST_PORT = parseInt(process.env.REST_PORT || '4352');

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;
const asyncHandler = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => 
  Promise.resolve(fn(req, res, next)).catch(next);

function parsePagination(query: Request['query'], defaults = { limit: 50, maxLimit: 100 }) {
  return {
    limit: Math.min(defaults.maxLimit, parseInt(query.limit as string) || defaults.limit),
    offset: Math.max(0, parseInt(query.offset as string) || 0),
  };
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(stakeRateLimiter({ skipPaths: ['/health', '/'] }));

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'indexer-rest', port: REST_PORT });
});

app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Jeju Indexer REST API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      search: '/api/search',
      agents: '/api/agents',
      blocks: '/api/blocks',
      transactions: '/api/transactions',
      contracts: '/api/contracts',
      tokens: '/api/tokens',
      nodes: '/api/nodes',
      providers: '/api/providers',
      tags: '/api/tags',
      stats: '/api/stats',
      // Cross-service integration
      containers: '/api/containers',
      crossServiceRequests: '/api/cross-service/requests',
      marketplaceStats: '/api/marketplace/stats',
      fullStackProviders: '/api/full-stack',
      // Oracle Network (JON)
      oracleFeeds: '/api/oracle/feeds',
      oracleOperators: '/api/oracle/operators',
      oracleReports: '/api/oracle/reports',
      oracleDisputes: '/api/oracle/disputes',
      oracleStats: '/api/oracle/stats',
    },
    graphql: 'http://localhost:4350/graphql',
    rateLimits: RATE_LIMITS,
  });
});

app.get('/api/search', asyncHandler(async (req, res) => {
  const ds = await getDataSource();
  const params: SearchParams = {
    query: req.query.q as string,
    endpointType: req.query.type as SearchParams['endpointType'],
    tags: req.query.tags ? (req.query.tags as string).split(',') : undefined,
    category: req.query.category as SearchParams['category'],
    minStakeTier: req.query.minTier ? parseInt(req.query.minTier as string) : undefined,
    verified: req.query.verified === 'true',
    active: req.query.active !== 'false',
    limit: Math.min(100, parseInt(req.query.limit as string) || 50),
    offset: parseInt(req.query.offset as string) || 0,
  };
  const results = await search(ds, params);
  res.json(results);
}));

app.get('/api/tags', asyncHandler(async (_req, res) => {
  const ds = await getDataSource();
  const tags = await getPopularTags(ds, 100);
  res.json({ tags, total: tags.length });
}));

app.get('/api/agents', asyncHandler(async (req, res) => {
  const ds = await getDataSource();
  const { limit, offset } = parsePagination(req.query);
  const active = req.query.active !== 'false';
  
  const [agents, total] = await ds.getRepository(RegisteredAgent).findAndCount({
    where: { active },
    order: { registeredAt: 'DESC' },
    take: limit,
    skip: offset,
    relations: ['owner'],
  });

  res.json({
    agents: agents.map(a => ({
      agentId: a.agentId.toString(),
      name: a.name,
      description: a.description,
      tags: a.tags,
      stakeTier: a.stakeTier,
      stakeAmount: a.stakeAmount.toString(),
      active: a.active,
      isBanned: a.isBanned,
      a2aEndpoint: a.a2aEndpoint,
      mcpEndpoint: a.mcpEndpoint,
      registeredAt: a.registeredAt.toISOString(),
      owner: a.owner?.address,
    })),
    total,
    limit,
    offset,
  });
}));

app.get('/api/agents/:id', asyncHandler(async (req, res) => {
  const ds = await getDataSource();
  const agent = await getAgentById(ds, req.params.id);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }
  res.json(agent);
}));

app.get('/api/agents/tag/:tag', asyncHandler(async (req, res) => {
  const ds = await getDataSource();
  const { limit } = parsePagination(req.query);
  const tag = req.params.tag.toLowerCase();
  
  const agents = await ds.getRepository(RegisteredAgent)
    .createQueryBuilder('a')
    .where(':tag = ANY(a.tags)', { tag })
    .andWhere('a.active = true')
    .orderBy('a.stakeTier', 'DESC')
    .take(limit)
    .getMany();

  res.json({
    tag,
    agents: agents.map(a => ({
      agentId: a.agentId.toString(),
      name: a.name,
      tags: a.tags,
      stakeTier: a.stakeTier,
      a2aEndpoint: a.a2aEndpoint,
      mcpEndpoint: a.mcpEndpoint,
    })),
    count: agents.length,
  });
}));

app.get('/api/blocks', asyncHandler(async (req, res) => {
  const ds = await getDataSource();
  const { limit, offset } = parsePagination(req.query, { limit: 20, maxLimit: 100 });
  
  const blocks = await ds.getRepository(Block).find({
    order: { number: 'DESC' },
    take: limit,
    skip: offset,
  });

  res.json({
    blocks: blocks.map(b => ({
      number: b.number,
      hash: b.hash,
      timestamp: b.timestamp.toISOString(),
      transactionCount: b.transactionCount,
      gasUsed: b.gasUsed.toString(),
      gasLimit: b.gasLimit.toString(),
    })),
  });
}));

app.get('/api/blocks/:numberOrHash', asyncHandler(async (req, res) => {
  const ds = await getDataSource();
  const param = req.params.numberOrHash;
  const where = param.startsWith('0x') ? { hash: param } : { number: parseInt(param) };
  
  const block = await ds.getRepository(Block).findOne({ where });
  if (!block) {
    res.status(404).json({ error: 'Block not found' });
    return;
  }
  
  res.json({
    number: block.number,
    hash: block.hash,
    parentHash: block.parentHash,
    timestamp: block.timestamp.toISOString(),
    transactionCount: block.transactionCount,
    gasUsed: block.gasUsed.toString(),
    gasLimit: block.gasLimit.toString(),
    baseFeePerGas: block.baseFeePerGas?.toString() || null,
    size: block.size,
  });
}));

app.get('/api/transactions', asyncHandler(async (req, res) => {
  const ds = await getDataSource();
  const { limit, offset } = parsePagination(req.query, { limit: 20, maxLimit: 100 });
  
  const txs = await ds.getRepository(Transaction).find({
    order: { blockNumber: 'DESC' },
    take: limit,
    skip: offset,
    relations: ['from', 'to'],
  });

  res.json({
    transactions: txs.map(tx => ({
      hash: tx.hash,
      blockNumber: tx.blockNumber,
      from: tx.from?.address,
      to: tx.to?.address,
      value: tx.value.toString(),
      status: tx.status,
    })),
  });
}));

app.get('/api/transactions/:hash', asyncHandler(async (req, res) => {
  const ds = await getDataSource();
  const tx = await ds.getRepository(Transaction).findOne({
    where: { hash: req.params.hash },
    relations: ['from', 'to', 'block'],
  });
  
  if (!tx) {
    res.status(404).json({ error: 'Transaction not found' });
    return;
  }
  
  res.json({
    hash: tx.hash,
    blockNumber: tx.blockNumber,
    from: tx.from?.address,
    to: tx.to?.address,
    value: tx.value.toString(),
    gasPrice: tx.gasPrice?.toString(),
    gasLimit: tx.gasLimit.toString(),
    gasUsed: tx.gasUsed?.toString(),
    status: tx.status,
    input: tx.input,
    nonce: tx.nonce,
  });
}));

app.get('/api/accounts/:address', asyncHandler(async (req, res) => {
  const ds = await getDataSource();
  const account = await ds.getRepository(Account).findOne({
    where: { address: req.params.address.toLowerCase() },
  });
  
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  
  res.json({
    address: account.address,
    isContract: account.isContract,
    transactionCount: account.transactionCount,
    totalValueSent: account.totalValueSent.toString(),
    totalValueReceived: account.totalValueReceived.toString(),
    firstSeenBlock: account.firstSeenBlock,
    lastSeenBlock: account.lastSeenBlock,
    labels: account.labels,
  });
}));

app.get('/api/contracts', asyncHandler(async (req, res) => {
  const ds = await getDataSource();
  const { limit } = parsePagination(req.query, { limit: 20, maxLimit: 100 });
  const type = req.query.type as string;
  
  let query = ds.getRepository(Contract).createQueryBuilder('c')
    .leftJoinAndSelect('c.creator', 'creator');
  if (type) query = query.where('c.contractType = :type', { type: type.toUpperCase() });
  
  const contracts = await query.orderBy('c.firstSeenAt', 'DESC').take(limit).getMany();

  res.json({
    contracts: contracts.map(c => ({
      address: c.address,
      contractType: c.contractType,
      isERC20: c.isERC20,
      isERC721: c.isERC721,
      isERC1155: c.isERC1155,
      creator: c.creator?.address,
      firstSeenAt: c.firstSeenAt.toISOString(),
    })),
  });
}));

app.get('/api/tokens/transfers', asyncHandler(async (req, res) => {
  const ds = await getDataSource();
  const { limit } = parsePagination(req.query, { limit: 20, maxLimit: 100 });
  const token = req.query.token as string;
  
  let query = ds.getRepository(TokenTransfer).createQueryBuilder('t')
    .leftJoinAndSelect('t.from', 'from')
    .leftJoinAndSelect('t.to', 'to')
    .leftJoinAndSelect('t.token', 'token');
  if (token) query = query.where('token.address = :token', { token: token.toLowerCase() });
  
  const transfers = await query.orderBy('t.timestamp', 'DESC').take(limit).getMany();

  res.json({
    transfers: transfers.map(t => ({
      id: t.id,
      token: t.token?.address,
      from: t.from?.address,
      to: t.to?.address,
      value: t.value?.toString(),
      tokenId: t.tokenId,
      tokenStandard: t.tokenStandard,
      timestamp: t.timestamp.toISOString(),
    })),
  });
}));

app.get('/api/nodes', asyncHandler(async (req, res) => {
  const ds = await getDataSource();
  const { limit } = parsePagination(req.query);
  const active = req.query.active !== 'false';
  
  const nodes = await ds.getRepository(NodeStake).find({
    where: active ? { isActive: true } : {},
    order: { stakedValueUSD: 'DESC' },
    take: limit,
  });

  res.json({
    nodes: nodes.map(n => ({
      nodeId: n.nodeId,
      operator: n.operator,
      stakedToken: n.stakedToken,
      stakedAmount: n.stakedAmount.toString(),
      stakedValueUSD: n.stakedValueUSD.toString(),
      rpcUrl: n.rpcUrl,
      geographicRegion: n.geographicRegion,
      isActive: n.isActive,
      isSlashed: n.isSlashed,
      uptimeScore: n.currentUptimeScore?.toString(),
    })),
    total: nodes.length,
  });
}));

app.get('/api/providers', asyncHandler(async (req, res) => {
  const ds = await getDataSource();
  const { limit } = parsePagination(req.query);
  const type = req.query.type as string;
  
  type ProviderInfo = { type: 'compute' | 'storage'; address: string; name: string; endpoint: string; agentId: number | null; isActive: boolean };
  const providers: ProviderInfo[] = [];

  if (!type || type === 'compute') {
    const compute = await ds.getRepository(ComputeProvider).find({ where: { isActive: true }, take: limit });
    providers.push(...compute.map(p => ({
      type: 'compute' as const, address: p.address, name: p.name || 'Compute Provider',
      endpoint: p.endpoint, agentId: p.agentId || null, isActive: p.isActive,
    })));
  }

  if (!type || type === 'storage') {
    const storage = await ds.getRepository(StorageProvider).find({ where: { isActive: true }, take: limit });
    providers.push(...storage.map(p => ({
      type: 'storage' as const, address: p.address, name: p.name,
      endpoint: p.endpoint, agentId: p.agentId || null, isActive: p.isActive,
    })));
  }

  res.json({ providers, total: providers.length });
}));

app.get('/api/containers', asyncHandler(async (req, res) => {
  const ds = await getDataSource();
  const { limit, offset } = parsePagination(req.query);
  const verified = req.query.verified === 'true';
  const gpuRequired = req.query.gpu === 'true';
  const teeRequired = req.query.tee === 'true';
  
  let query = ds.getRepository(ContainerImage).createQueryBuilder('c')
    .leftJoinAndSelect('c.storageProvider', 'sp')
    .leftJoinAndSelect('c.uploadedBy', 'uploader');
  
  if (verified) query = query.andWhere('c.verified = :verified', { verified: true });
  if (gpuRequired) query = query.andWhere('c.gpuRequired = :gpu', { gpu: true });
  if (teeRequired) query = query.andWhere('c.teeRequired = :tee', { tee: true });
  
  const [containers, total] = await query.orderBy('c.pullCount', 'DESC').take(limit).skip(offset).getManyAndCount();

  res.json({
    containers: containers.map(c => ({
      cid: c.cid,
      name: c.name,
      tag: c.tag,
      sizeBytes: c.sizeBytes.toString(),
      uploadedAt: c.uploadedAt.toISOString(),
      uploadedBy: c.uploadedBy?.address,
      storageProvider: c.storageProvider?.address,
      tier: c.tier,
      architecture: c.architecture,
      gpuRequired: c.gpuRequired,
      minGpuVram: c.minGpuVram,
      teeRequired: c.teeRequired,
      verified: c.verified,
      pullCount: c.pullCount,
      lastPulledAt: c.lastPulledAt?.toISOString(),
    })),
    total,
    limit,
    offset,
  });
}));

app.get('/api/containers/:cid', asyncHandler(async (req: Request, res: Response) => {
  const ds = await getDataSource();
  const repo = ds.getRepository(ContainerImage);
  
  const container = await repo.findOne({
    where: { cid: req.params.cid },
    relations: ['storageProvider', 'uploadedBy', 'verifiedBy'],
  });
  
  if (!container) {
    res.status(404).json({ error: 'Container not found' });
    return;
  }
  
  const computeRepo = ds.getRepository(ComputeProvider);
  const compatibleProviders = await computeRepo.find({
    where: { isActive: true },
    order: { totalEarnings: 'DESC' },
    take: 10,
  });
  
  res.json({
    container: {
      cid: container.cid,
      name: container.name,
      tag: container.tag,
      sizeBytes: container.sizeBytes.toString(),
      uploadedAt: container.uploadedAt.toISOString(),
      uploadedBy: container.uploadedBy?.address,
      storageProvider: container.storageProvider ? {
        address: container.storageProvider.address,
        name: container.storageProvider.name,
        endpoint: container.storageProvider.endpoint,
      } : null,
      tier: container.tier,
      expiresAt: container.expiresAt?.toISOString(),
      architecture: container.architecture,
      gpuRequired: container.gpuRequired,
      minGpuVram: container.minGpuVram,
      teeRequired: container.teeRequired,
      contentHash: container.contentHash,
      verified: container.verified,
      verifiedBy: container.verifiedBy?.agentId?.toString(),
      pullCount: container.pullCount,
      lastPulledAt: container.lastPulledAt?.toISOString(),
    },
    compatibleProviders: compatibleProviders.map(p => ({
      address: p.address,
      name: p.name || 'Compute Provider',
      endpoint: p.endpoint,
      agentId: p.agentId,
      isActive: p.isActive,
    })),
  });
}));

app.get('/api/cross-service/requests', asyncHandler(async (req, res) => {
  const ds = await getDataSource();
  const { limit, offset } = parsePagination(req.query);
  const status = req.query.status as string;
  const type = req.query.type as string;
  
  let query = ds.getRepository(CrossServiceRequest).createQueryBuilder('r')
    .leftJoinAndSelect('r.requester', 'requester')
    .leftJoinAndSelect('r.containerImage', 'container')
    .leftJoinAndSelect('r.sourceProvider', 'storage')
    .leftJoinAndSelect('r.destinationProvider', 'compute');
  
  if (status) query = query.andWhere('r.status = :status', { status: status.toUpperCase() });
  if (type) query = query.andWhere('r.requestType = :type', { type: type.toUpperCase() });
  
  const [requests, total] = await query.orderBy('r.createdAt', 'DESC').take(limit).skip(offset).getManyAndCount();

  res.json({
    requests: requests.map(r => ({
      requestId: r.requestId,
      requester: r.requester?.address,
      type: r.requestType,
      sourceCid: r.sourceCid,
      sourceProvider: r.sourceProvider?.address,
      destinationProvider: r.destinationProvider?.address,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString(),
      storageCost: r.storageCost.toString(),
      bandwidthCost: r.bandwidthCost.toString(),
      totalCost: r.totalCost.toString(),
      error: r.error,
      txHash: r.txHash,
      blockNumber: r.blockNumber,
    })),
    total,
    limit,
    offset,
  });
}));

app.get('/api/marketplace/stats', asyncHandler(async (_req, res) => {
  const ds = await getDataSource();
  
  // Compute stats
  const computeRepo = ds.getRepository(ComputeProvider);
  const computeProviders = await computeRepo.find();
  const activeCompute = computeProviders.filter(p => p.isActive);
  const agentLinkedCompute = computeProviders.filter(p => p.agentId && p.agentId > 0);
  const totalComputeStake = computeProviders.reduce((sum, p) => sum + (p.stakeAmount || 0n), 0n);
  const totalComputeEarnings = computeProviders.reduce((sum, p) => sum + (p.totalEarnings || 0n), 0n);
  
  // Storage stats
  const storageRepo = ds.getRepository(StorageProvider);
  const storageProviders = await storageRepo.find();
  const activeStorage = storageProviders.filter(p => p.isActive);
  const agentLinkedStorage = storageProviders.filter(p => p.agentId && p.agentId > 0);
  const totalStorageStake = storageProviders.reduce((sum, p) => sum + (p.stakeAmount || 0n), 0n);
  const totalCapacity = storageProviders.reduce((sum, p) => sum + Number(p.totalCapacityGB || 0n), 0);
  const usedCapacity = storageProviders.reduce((sum, p) => sum + Number(p.usedCapacityGB || 0n), 0);
  
  // Cross-service stats
  const containerRepo = ds.getRepository(ContainerImage);
  const requestRepo = ds.getRepository(CrossServiceRequest);
  const [totalContainers, verifiedContainers] = await Promise.all([
    containerRepo.count(),
    containerRepo.count({ where: { verified: true } }),
  ]);
  const [totalRequests, successfulRequests] = await Promise.all([
    requestRepo.count(),
    requestRepo.count({ where: { status: 'COMPLETED' as never } }),
  ]);
  
  // Rental stats
  const rentalRepo = ds.getRepository(ComputeRental);
  const dealRepo = ds.getRepository(StorageDeal);
  const [totalRentals, activeRentals] = await Promise.all([
    rentalRepo.count(),
    rentalRepo.count({ where: { status: 'ACTIVE' as never } }),
  ]);
  const [totalDeals, activeDeals] = await Promise.all([
    dealRepo.count(),
    dealRepo.count({ where: { status: 'ACTIVE' as never } }),
  ]);
  
  // Agent stats
  const agentRepo = ds.getRepository(RegisteredAgent);
  const totalAgents = await agentRepo.count({ where: { active: true } });
  const bannedAgents = await agentRepo.count({ where: { isBanned: true } });
  
  // Full-stack agents (both compute and storage with same agent ID)
  const computeAgentIds = new Set(agentLinkedCompute.map(p => p.agentId));
  const fullStackCount = agentLinkedStorage.filter(p => p.agentId && computeAgentIds.has(p.agentId)).length;

  res.json({
    compute: {
      totalProviders: computeProviders.length,
      activeProviders: activeCompute.length,
      agentLinkedProviders: agentLinkedCompute.length,
      totalRentals,
      activeRentals,
      totalStakedETH: ethers.formatEther(totalComputeStake),
      totalEarningsETH: ethers.formatEther(totalComputeEarnings),
    },
    storage: {
      totalProviders: storageProviders.length,
      activeProviders: activeStorage.length,
      agentLinkedProviders: agentLinkedStorage.length,
      totalDeals,
      activeDeals,
      totalCapacityTB: (totalCapacity / 1024).toFixed(2),
      usedCapacityTB: (usedCapacity / 1024).toFixed(2),
      totalStakedETH: ethers.formatEther(totalStorageStake),
    },
    crossService: {
      totalContainerImages: totalContainers,
      verifiedContainerImages: verifiedContainers,
      totalCrossServiceRequests: totalRequests,
      successfulRequests,
      fullStackAgents: fullStackCount,
    },
    erc8004: {
      totalRegisteredAgents: totalAgents,
      computeAgents: agentLinkedCompute.length,
      storageAgents: agentLinkedStorage.length,
      fullStackAgents: fullStackCount,
      bannedAgents,
    },
    lastUpdated: new Date().toISOString(),
  });
}));

// ============================================================================
// FULL-STACK PROVIDERS - Providers with both compute and storage
// ============================================================================

app.get('/api/full-stack', asyncHandler(async (req: Request, res: Response) => {
  const ds = await getDataSource();
  const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
  
  // Find agents that are linked to both compute and storage providers
  const computeRepo = ds.getRepository(ComputeProvider);
  const storageRepo = ds.getRepository(StorageProvider);
  
  const computeWithAgent = await computeRepo.find({
    where: { isActive: true },
  });
  const storageWithAgent = await storageRepo.find({
    where: { isActive: true },
  });
  
  // Group by agent ID
  const computeByAgent = new Map<number, ComputeProvider[]>();
  for (const p of computeWithAgent) {
    if (p.agentId) {
      const existing = computeByAgent.get(p.agentId) || [];
      existing.push(p);
      computeByAgent.set(p.agentId, existing);
    }
  }
  
  const fullStackProviders: Array<{
    agentId: number;
    compute: Array<{ address: string; name: string; endpoint: string }>;
    storage: Array<{ address: string; name: string; endpoint: string; providerType: string }>;
  }> = [];
  
  for (const storage of storageWithAgent) {
    if (storage.agentId && computeByAgent.has(storage.agentId)) {
      const computeProviders = computeByAgent.get(storage.agentId) || [];
      
      // Check if we already have this agent
      let existing = fullStackProviders.find(f => f.agentId === storage.agentId);
      if (!existing) {
        existing = {
          agentId: storage.agentId,
          compute: computeProviders.map(c => ({
            address: c.address,
            name: c.name || 'Compute Provider',
            endpoint: c.endpoint,
          })),
          storage: [],
        };
        fullStackProviders.push(existing);
      }
      
      existing.storage.push({
        address: storage.address,
        name: storage.name,
        endpoint: storage.endpoint,
        providerType: storage.providerType,
      });
    }
  }
  
  res.json({
    fullStackProviders: fullStackProviders.slice(0, limit),
    total: fullStackProviders.length,
  });
}));

app.get('/api/oracle/feeds', asyncHandler(async (req, res) => {
  const ds = await getDataSource();
  const { limit, offset } = parsePagination(req.query);
  const category = req.query.category as string;
  const active = req.query.active !== 'false';
  
  let query = ds.getRepository(OracleFeed).createQueryBuilder('f');
  if (active) query = query.where('f.isActive = :active', { active: true });
  if (category) query = query.andWhere('f.category = :category', { category: category.toUpperCase() });
  
  const [feeds, total] = await query.orderBy('f.totalReports', 'DESC').take(limit).skip(offset).getManyAndCount();

  res.json({
    feeds: feeds.map(f => ({
      feedId: f.feedId,
      symbol: f.symbol,
      baseToken: f.baseToken,
      quoteToken: f.quoteToken,
      decimals: f.decimals,
      heartbeatSeconds: f.heartbeatSeconds,
      category: f.category,
      isActive: f.isActive,
      minOracles: f.minOracles,
      quorumThreshold: f.quorumThreshold,
      latestPrice: f.latestPrice?.toString(),
      latestConfidence: f.latestConfidence?.toString(),
      latestTimestamp: f.latestTimestamp?.toISOString(),
      latestRound: f.latestRound?.toString(),
      totalReports: f.totalReports,
      totalDisputes: f.totalDisputes,
      createdAt: f.createdAt.toISOString(),
      lastUpdated: f.lastUpdated.toISOString(),
    })),
    total,
    limit,
    offset,
  });
}));

app.get('/api/oracle/feeds/:feedId', asyncHandler(async (req, res) => {
  const ds = await getDataSource();
  const feed = await ds.getRepository(OracleFeed).findOne({ where: { feedId: req.params.feedId } });
  
  if (!feed) {
    res.status(404).json({ error: 'Feed not found' });
    return;
  }
  
  const recentReports = await ds.getRepository(OracleReport).find({
    where: { feed: { id: feed.id } },
    order: { submittedAt: 'DESC' },
    take: 10,
    relations: ['submittedBy'],
  });
  
  res.json({
    feed: {
      feedId: feed.feedId,
      symbol: feed.symbol,
      baseToken: feed.baseToken,
      quoteToken: feed.quoteToken,
      decimals: feed.decimals,
      heartbeatSeconds: feed.heartbeatSeconds,
      category: feed.category,
      isActive: feed.isActive,
      minOracles: feed.minOracles,
      quorumThreshold: feed.quorumThreshold,
      latestPrice: feed.latestPrice?.toString(),
      latestConfidence: feed.latestConfidence?.toString(),
      latestTimestamp: feed.latestTimestamp?.toISOString(),
      latestRound: feed.latestRound?.toString(),
      totalReports: feed.totalReports,
      totalDisputes: feed.totalDisputes,
      createdAt: feed.createdAt.toISOString(),
      lastUpdated: feed.lastUpdated.toISOString(),
    },
    recentReports: recentReports.map(r => ({
      reportId: r.reportId,
      round: r.round.toString(),
      price: r.price.toString(),
      confidence: r.confidence.toString(),
      timestamp: r.timestamp.toISOString(),
      isDisputed: r.isDisputed,
      isValid: r.isValid,
      submittedBy: r.submittedBy?.address,
      submittedAt: r.submittedAt.toISOString(),
    })),
  });
}));

app.get('/api/oracle/operators', asyncHandler(async (req, res) => {
  const ds = await getDataSource();
  const { limit, offset } = parsePagination(req.query);
  const active = req.query.active !== 'false';
  const jailed = req.query.jailed === 'true';
  
  let query = ds.getRepository(OracleOperator).createQueryBuilder('o');
  if (active) query = query.where('o.isActive = :active', { active: true });
  if (jailed) query = query.andWhere('o.isJailed = :jailed', { jailed: true });
  
  const [operators, total] = await query.orderBy('o.stakedAmount', 'DESC').take(limit).skip(offset).getManyAndCount();

  res.json({
    operators: operators.map(o => ({
      address: o.address,
      identityId: o.identityId?.toString(),
      isActive: o.isActive,
      isJailed: o.isJailed,
      stakedAmount: o.stakedAmount.toString(),
      delegatedAmount: o.delegatedAmount.toString(),
      totalSlashed: o.totalSlashed.toString(),
      reportsSubmitted: o.reportsSubmitted,
      reportsAccepted: o.reportsAccepted,
      disputesAgainst: o.disputesAgainst,
      disputesLost: o.disputesLost,
      participationScore: o.participationScore,
      accuracyScore: o.accuracyScore,
      uptimeScore: o.uptimeScore,
      totalEarnings: o.totalEarnings.toString(),
      pendingRewards: o.pendingRewards.toString(),
      registeredAt: o.registeredAt.toISOString(),
      lastActiveAt: o.lastActiveAt.toISOString(),
    })),
    total,
    limit,
    offset,
  });
}));

app.get('/api/oracle/operators/:address', asyncHandler(async (req, res) => {
  const ds = await getDataSource();
  const operator = await ds.getRepository(OracleOperator).findOne({
    where: { address: req.params.address.toLowerCase() },
  });
  
  if (!operator) {
    res.status(404).json({ error: 'Operator not found' });
    return;
  }
  
  res.json({
    operator: {
      address: operator.address,
      identityId: operator.identityId?.toString(),
      isActive: operator.isActive,
      isJailed: operator.isJailed,
      stakedAmount: operator.stakedAmount.toString(),
      delegatedAmount: operator.delegatedAmount.toString(),
      totalSlashed: operator.totalSlashed.toString(),
      reportsSubmitted: operator.reportsSubmitted,
      reportsAccepted: operator.reportsAccepted,
      disputesAgainst: operator.disputesAgainst,
      disputesLost: operator.disputesLost,
      participationScore: operator.participationScore,
      accuracyScore: operator.accuracyScore,
      uptimeScore: operator.uptimeScore,
      totalEarnings: operator.totalEarnings.toString(),
      pendingRewards: operator.pendingRewards.toString(),
      registeredAt: operator.registeredAt.toISOString(),
      lastActiveAt: operator.lastActiveAt.toISOString(),
    },
  });
}));

app.get('/api/oracle/reports', asyncHandler(async (req, res) => {
  const ds = await getDataSource();
  const { limit, offset } = parsePagination(req.query);
  const feedId = req.query.feedId as string;
  const disputed = req.query.disputed === 'true';
  
  let query = ds.getRepository(OracleReport).createQueryBuilder('r')
    .leftJoinAndSelect('r.feed', 'feed')
    .leftJoinAndSelect('r.submittedBy', 'submitter');
  
  if (feedId) query = query.where('feed.feedId = :feedId', { feedId });
  if (disputed) query = query.andWhere('r.isDisputed = :disputed', { disputed: true });
  
  const [reports, total] = await query.orderBy('r.submittedAt', 'DESC').take(limit).skip(offset).getManyAndCount();

  res.json({
    reports: reports.map(r => ({
      reportId: r.reportId,
      feedId: r.feed?.feedId,
      symbol: r.feed?.symbol,
      round: r.round.toString(),
      price: r.price.toString(),
      confidence: r.confidence.toString(),
      timestamp: r.timestamp.toISOString(),
      isDisputed: r.isDisputed,
      isValid: r.isValid,
      submittedBy: r.submittedBy?.address,
      submittedAt: r.submittedAt.toISOString(),
      txHash: r.txHash,
      blockNumber: r.blockNumber,
    })),
    total,
    limit,
    offset,
  });
}));

app.get('/api/oracle/disputes', asyncHandler(async (req, res) => {
  const ds = await getDataSource();
  const { limit, offset } = parsePagination(req.query);
  const status = req.query.status as string;
  
  let query = ds.getRepository(OracleDispute).createQueryBuilder('d')
    .leftJoinAndSelect('d.report', 'report')
    .leftJoinAndSelect('d.feed', 'feed')
    .leftJoinAndSelect('d.disputer', 'disputer')
    .leftJoinAndSelect('d.challenger', 'challenger');
  
  if (status) query = query.where('d.status = :status', { status: status.toUpperCase() });
  
  const [disputes, total] = await query.orderBy('d.openedAt', 'DESC').take(limit).skip(offset).getManyAndCount();

  res.json({
    disputes: disputes.map(d => ({
      disputeId: d.disputeId,
      reportId: d.report?.reportId,
      feedId: d.feed?.feedId,
      disputer: d.disputer?.address,
      bond: d.bond.toString(),
      reason: d.reason,
      status: d.status,
      challenger: d.challenger?.address,
      challengeBond: d.challengeBond?.toString(),
      outcome: d.outcome,
      slashedAmount: d.slashedAmount?.toString(),
      openedAt: d.openedAt.toISOString(),
      challengeDeadline: d.challengeDeadline.toISOString(),
      resolvedAt: d.resolvedAt?.toISOString(),
      txHash: d.txHash,
      blockNumber: d.blockNumber,
    })),
    total,
    limit,
    offset,
  });
}));

app.get('/api/oracle/stats', asyncHandler(async (_req, res) => {
  const ds = await getDataSource();
  
  const [totalFeeds, activeFeeds, operators, totalReports, disputedReports, totalDisputes, openDisputes, totalSubscriptions, activeSubscriptions] = await Promise.all([
    ds.getRepository(OracleFeed).count(),
    ds.getRepository(OracleFeed).count({ where: { isActive: true } }),
    ds.getRepository(OracleOperator).find(),
    ds.getRepository(OracleReport).count(),
    ds.getRepository(OracleReport).count({ where: { isDisputed: true } }),
    ds.getRepository(OracleDispute).count(),
    ds.getRepository(OracleDispute).count({ where: { status: 'OPEN' as never } }),
    ds.getRepository(OracleSubscription).count(),
    ds.getRepository(OracleSubscription).count({ where: { isActive: true } }),
  ]);
  
  const activeOperators = operators.filter(o => o.isActive && !o.isJailed);
  const totalStaked = operators.reduce((sum, o) => sum + o.stakedAmount, 0n);
  const totalEarnings = operators.reduce((sum, o) => sum + o.totalEarnings, 0n);
  const avgParticipation = operators.length > 0 ? Math.floor(operators.reduce((sum, o) => sum + o.participationScore, 0) / operators.length) : 0;
  const avgAccuracy = operators.length > 0 ? Math.floor(operators.reduce((sum, o) => sum + o.accuracyScore, 0) / operators.length) : 0;

  res.json({
    feeds: {
      total: totalFeeds,
      active: activeFeeds,
    },
    operators: {
      total: operators.length,
      active: activeOperators.length,
      jailed: operators.filter(o => o.isJailed).length,
      totalStakedETH: ethers.formatEther(totalStaked),
      totalEarningsETH: ethers.formatEther(totalEarnings),
      avgParticipationScore: avgParticipation,
      avgAccuracyScore: avgAccuracy,
    },
    reports: {
      total: totalReports,
      disputed: disputedReports,
      disputeRate: totalReports > 0 ? ((disputedReports / totalReports) * 10000).toFixed(0) : '0',
    },
    disputes: {
      total: totalDisputes,
      open: openDisputes,
    },
    subscriptions: {
      total: totalSubscriptions,
      active: activeSubscriptions,
    },
    lastUpdated: new Date().toISOString(),
  });
}));

app.get('/api/stats', asyncHandler(async (_req, res) => {
  const ds = await getDataSource();
  
  const [blockCount, txCount, accountCount, contractCount, agentCount, nodeCount] = await Promise.all([
    ds.getRepository(Block).count(),
    ds.getRepository(Transaction).count(),
    ds.getRepository(Account).count(),
    ds.getRepository(Contract).count(),
    ds.getRepository(RegisteredAgent).count({ where: { active: true } }),
    ds.getRepository(NodeStake).count({ where: { isActive: true } }),
  ]);

  const latestBlock = await ds.getRepository(Block).createQueryBuilder('b').orderBy('b.number', 'DESC').limit(1).getOne();

  res.json({
    blocks: blockCount,
    transactions: txCount,
    accounts: accountCount,
    contracts: contractCount,
    agents: agentCount,
    nodes: nodeCount,
    latestBlock: latestBlock?.number || 0,
    rateLimitStats: getRateLimitStats(),
  });
}));

app.get('/api/rate-limits', (_req, res) => {
  res.json({
    tiers: RATE_LIMITS,
    thresholds: {
      FREE: { minUsd: 0, limit: RATE_LIMITS.FREE },
      BASIC: { minUsd: 10, limit: RATE_LIMITS.BASIC },
      PRO: { minUsd: 100, limit: RATE_LIMITS.PRO },
      UNLIMITED: { minUsd: 1000, limit: 'unlimited' },
    },
    stats: getRateLimitStats(),
    note: 'Stake tokens to increase rate limits',
  });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[REST] Unhandled error:', err.message, err.stack);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

export async function startRestServer(): Promise<void> {
  await getDataSource();
  
  app.listen(REST_PORT, () => {
    console.log(`📡 REST API running on http://localhost:${REST_PORT}`);
  });
}

if (require.main === module) {
  startRestServer().catch(console.error);
}

export { app };
