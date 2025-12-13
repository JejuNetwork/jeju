import { DataSource } from 'typeorm';
import { RegisteredAgent, ComputeProvider, StorageProvider } from './model';

export interface AgentSearchResult {
  agentId: string;
  owner: string;
  name: string;
  metadataUri: string;
  active: boolean;
  registeredAt: string;
  totalExecutions: number;
  totalSpent: string;
  services: string[];
}

export interface ServiceSearchResult {
  serviceId: string;
  name: string;
  type: 'mcp' | 'a2a' | 'rest';
  endpoint: string;
  category: string;
  provider: string;
  agentId?: string;
  pricePerCall: string;
  isVerified: boolean;
}

export interface RoomSearchResult {
  roomId: string;
  name: string;
  roomType: string;
  phase: string;
  memberCount: number;
  owner: string;
  createdAt: string;
}

export interface CrucibleStats {
  agents: {
    total: number;
    active: number;
    totalExecutions: number;
    totalSpent: string;
  };
  rooms: {
    total: number;
    active: number;
    adversarial: number;
    collaborative: number;
  };
  services: {
    totalMcp: number;
    totalA2a: number;
    totalRest: number;
    verifiedProviders: number;
  };
}

export interface AgentSearchFilter {
  name?: string;
  owner?: string;
  active?: boolean;
  hasServices?: boolean;
  limit?: number;
  offset?: number;
}

export interface ServiceSearchFilter {
  type?: 'mcp' | 'a2a' | 'rest';
  category?: string;
  query?: string;
  verifiedOnly?: boolean;
  limit?: number;
  offset?: number;
}

function mapProviderToService(
  p: ComputeProvider | StorageProvider,
  category: 'compute' | 'storage'
): ServiceSearchResult {
  return {
    serviceId: `${category}-${p.address}`,
    name: p.name || `${category.charAt(0).toUpperCase() + category.slice(1)} Provider`,
    type: 'rest',
    endpoint: p.endpoint,
    category,
    provider: p.address,
    agentId: p.agentId?.toString(),
    pricePerCall: '0',
    isVerified: (p.agentId ?? 0) > 0,
  };
}

export async function searchAgents(
  dataSource: DataSource,
  filter: AgentSearchFilter = {}
): Promise<AgentSearchResult[]> {
  const {
    name,
    owner,
    active = true,
    limit = 50,
    offset = 0,
  } = filter;

  const agentRepo = dataSource.getRepository(RegisteredAgent);
  let query = agentRepo.createQueryBuilder('a');

  if (active !== undefined) {
    query = query.where('a.active = :active', { active });
  }

  if (name) {
    query = query.andWhere('LOWER(a.name) LIKE LOWER(:name)', { name: `%${name}%` });
  }

  if (owner) {
    query = query.andWhere('LOWER(a.owner) = LOWER(:owner)', { owner });
  }

  const agents = await query
    .orderBy('a.registeredAt', 'DESC')
    .take(limit)
    .skip(offset)
    .getMany();

  return agents.map(a => ({
    agentId: a.agentId.toString(),
    owner: a.owner?.address || '',
    name: a.name || 'Unnamed Agent',
    metadataUri: a.tokenURI || '',
    active: a.active,
    registeredAt: a.registeredAt.toISOString(),
    totalExecutions: 0,
    totalSpent: '0',
    services: [],
  }));
}

export async function getAgent(
  dataSource: DataSource,
  agentId: string
): Promise<AgentSearchResult | null> {
  const agentRepo = dataSource.getRepository(RegisteredAgent);
  const agent = await agentRepo.findOne({
    where: { agentId: BigInt(agentId) },
    relations: ['owner'],
  });

  if (!agent) return null;

  return {
    agentId: agent.agentId.toString(),
    owner: agent.owner?.address || '',
    name: agent.name || 'Unnamed Agent',
    metadataUri: agent.tokenURI || '',
    active: agent.active,
    registeredAt: agent.registeredAt.toISOString(),
    totalExecutions: 0,
    totalSpent: '0',
    services: [],
  };
}

export async function searchServices(
  dataSource: DataSource,
  filter: ServiceSearchFilter = {}
): Promise<ServiceSearchResult[]> {
  const {
    type,
    category,
    query,
    verifiedOnly = false,
    limit = 50,
    offset = 0,
  } = filter;

  if (type && type !== 'rest') return []; // Only REST providers indexed currently

  const computeRepo = dataSource.getRepository(ComputeProvider);
  const storageRepo = dataSource.getRepository(StorageProvider);
  const searchPattern = query ? `%${query}%` : null;

  let computeQuery = computeRepo.createQueryBuilder('p').where('p.isActive = :active', { active: true });
  let storageQuery = storageRepo.createQueryBuilder('p').where('p.isActive = :active', { active: true });

  if (verifiedOnly) {
    computeQuery = computeQuery.andWhere('p.agentId > 0');
    storageQuery = storageQuery.andWhere('p.agentId > 0');
  }
  if (searchPattern) {
    computeQuery = computeQuery.andWhere('LOWER(p.name) LIKE LOWER(:q) OR LOWER(p.endpoint) LIKE LOWER(:q)', { q: searchPattern });
    storageQuery = storageQuery.andWhere('LOWER(p.name) LIKE LOWER(:q) OR LOWER(p.endpoint) LIKE LOWER(:q)', { q: searchPattern });
  }

  const [computeProviders, storageProviders] = await Promise.all([
    computeQuery.take(limit).skip(offset).getMany(),
    storageQuery.take(limit).skip(offset).getMany(),
  ]);

  const results = [
    ...computeProviders.map(p => mapProviderToService(p, 'compute')),
    ...storageProviders.map(p => mapProviderToService(p, 'storage')),
  ];

  return category ? results.filter(r => r.category === category) : results;
}

export async function getService(
  dataSource: DataSource,
  serviceId: string
): Promise<ServiceSearchResult | null> {
  const [type, address] = serviceId.split('-');
  if (!address) return null;

  if (type === 'compute') {
    const p = await dataSource.getRepository(ComputeProvider).findOne({ where: { address: address.toLowerCase() } });
    return p ? mapProviderToService(p, 'compute') : null;
  }
  if (type === 'storage') {
    const p = await dataSource.getRepository(StorageProvider).findOne({ where: { address: address.toLowerCase() } });
    return p ? mapProviderToService(p, 'storage') : null;
  }
  return null;
}

export async function getCrucibleStats(dataSource: DataSource): Promise<CrucibleStats> {
  const [totalAgents, activeAgents, activeCompute, activeStorage] = await Promise.all([
    dataSource.getRepository(RegisteredAgent).count(),
    dataSource.getRepository(RegisteredAgent).count({ where: { active: true } }),
    dataSource.getRepository(ComputeProvider).count({ where: { isActive: true } }),
    dataSource.getRepository(StorageProvider).count({ where: { isActive: true } }),
  ]);

  return {
    agents: { total: totalAgents, active: activeAgents, totalExecutions: 0, totalSpent: '0' },
    rooms: { total: 0, active: 0, adversarial: 0, collaborative: 0 },
    services: { totalMcp: 0, totalA2a: 0, totalRest: activeCompute + activeStorage, verifiedProviders: activeCompute + activeStorage },
  };
}

export async function getAgentServices(
  dataSource: DataSource,
  agentId: string
): Promise<ServiceSearchResult[]> {
  const agentIdNum = parseInt(agentId);
  const [computeProviders, storageProviders] = await Promise.all([
    dataSource.getRepository(ComputeProvider).find({ where: { agentId: agentIdNum, isActive: true } }),
    dataSource.getRepository(StorageProvider).find({ where: { agentId: agentIdNum, isActive: true } }),
  ]);

  return [
    ...computeProviders.map(p => mapProviderToService(p, 'compute')),
    ...storageProviders.map(p => mapProviderToService(p, 'storage')),
  ];
}
