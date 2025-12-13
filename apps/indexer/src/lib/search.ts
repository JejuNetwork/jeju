import { DataSource, Not, IsNull } from 'typeorm';
import { RegisteredAgent, TagIndex, ComputeProvider, StorageProvider } from '../model';

const searchCache = new Map<string, { data: SearchResult; expiresAt: number }>();
const CACHE_TTL = 30_000;

export type EndpointType = 'a2a' | 'mcp' | 'rest' | 'graphql' | 'all';
export type ServiceCategory = 'agent' | 'workflow' | 'app' | 'game' | 'oracle' | 'marketplace' | 'compute' | 'storage' | 'all';

export interface SearchParams {
  query?: string;
  endpointType?: EndpointType;
  tags?: string[];
  category?: ServiceCategory;
  minStakeTier?: number;
  verified?: boolean;
  active?: boolean;
  limit?: number;
  offset?: number;
}

export interface AgentSearchResult {
  agentId: string;
  name: string;
  description: string | null;
  tags: string[];
  serviceType: string | null;
  category: string | null;
  endpoints: {
    a2a: string | null;
    mcp: string | null;
  };
  tools: {
    mcpTools: string[];
    a2aSkills: string[];
  };
  stakeTier: number;
  stakeAmount: string;
  x402Support: boolean;
  active: boolean;
  isBanned: boolean;
  registeredAt: string;
  score: number;
}

export interface ProviderResult {
  providerId: string;
  type: 'compute' | 'storage';
  name: string;
  endpoint: string;
  agentId: number | null;
  isActive: boolean;
  isVerified: boolean;
  score: number;
}

export interface SearchResult {
  agents: AgentSearchResult[];
  providers: ProviderResult[];
  total: number;
  facets: {
    tags: Array<{ tag: string; count: number }>;
    serviceTypes: Array<{ type: string; count: number }>;
    endpointTypes: Array<{ type: string; count: number }>;
  };
  query: string | null;
  took: number;
}

function hashParams(params: SearchParams): string {
  return JSON.stringify(params);
}

function mapAgentToResult(agent: RegisteredAgent, score: number): AgentSearchResult {
  return {
    agentId: agent.agentId.toString(),
    name: agent.name ?? 'Unnamed Agent',
    description: agent.description ?? null,
    tags: agent.tags ?? [],
    serviceType: agent.serviceType ?? null,
    category: agent.category ?? null,
    endpoints: {
      a2a: agent.a2aEndpoint ?? null,
      mcp: agent.mcpEndpoint ?? null,
    },
    tools: {
      mcpTools: agent.mcpTools ?? [],
      a2aSkills: agent.a2aSkills ?? [],
    },
    stakeTier: agent.stakeTier,
    stakeAmount: agent.stakeAmount.toString(),
    x402Support: agent.x402Support,
    active: agent.active,
    isBanned: agent.isBanned,
    registeredAt: agent.registeredAt.toISOString(),
    score,
  };
}

export async function search(
  dataSource: DataSource,
  params: SearchParams = {}
): Promise<SearchResult> {
  const startTime = Date.now();
  const {
    query,
    endpointType = 'all',
    tags,
    category,
    minStakeTier = 0,
    verified,
    active = true,
    limit = 50,
    offset = 0,
  } = params;

  const cacheKey = hashParams(params);
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.data, took: Date.now() - startTime };
  }

  const agentRepo = dataSource.getRepository(RegisteredAgent);
  const computeRepo = dataSource.getRepository(ComputeProvider);
  const storageRepo = dataSource.getRepository(StorageProvider);
  const tagRepo = dataSource.getRepository(TagIndex);

  let agentQuery = agentRepo.createQueryBuilder('a').leftJoinAndSelect('a.owner', 'owner');

  if (active !== undefined) agentQuery = agentQuery.andWhere('a.active = :active', { active });
  if (endpointType === 'a2a') agentQuery = agentQuery.andWhere('a.a2aEndpoint IS NOT NULL');
  else if (endpointType === 'mcp') agentQuery = agentQuery.andWhere('a.mcpEndpoint IS NOT NULL');
  else if (endpointType === 'rest') agentQuery = agentQuery.andWhere("a.serviceType = 'rest'");
  if (category && category !== 'all') agentQuery = agentQuery.andWhere('a.category = :category', { category });
  if (minStakeTier > 0) agentQuery = agentQuery.andWhere('a.stakeTier >= :minTier', { minTier: minStakeTier });
  if (verified) agentQuery = agentQuery.andWhere('a.stakeAmount > 0');
  if (tags && tags.length > 0) agentQuery = agentQuery.andWhere('a.tags && :tags', { tags });

  let agents: RegisteredAgent[];
  const scores = new Map<string, number>();

  if (query && query.trim()) {
    const rawQuery = `
      SELECT a.*, 
        ts_rank_cd(
          to_tsvector('english', COALESCE(a.name, '') || ' ' || COALESCE(a.description, '') || ' ' || 
            COALESCE(array_to_string(a.tags, ' '), '') || ' ' || COALESCE(array_to_string(a.mcp_tools, ' '), '') || ' ' ||
            COALESCE(array_to_string(a.a2a_skills, ' '), '')),
          plainto_tsquery('english', $1), 32
        ) * (1 + (a.stake_tier::float / 4)) as rank
      FROM registered_agent a
      WHERE a.active = $2 AND (
        to_tsvector('english', COALESCE(a.name, '') || ' ' || COALESCE(a.description, '') || ' ' || 
          COALESCE(array_to_string(a.tags, ' '), '')) @@ plainto_tsquery('english', $1)
        OR LOWER(a.name) LIKE LOWER($3) OR LOWER(a.description) LIKE LOWER($3)
        OR EXISTS (SELECT 1 FROM unnest(a.tags) t WHERE LOWER(t) LIKE LOWER($3)))
      ORDER BY rank DESC, a.stake_tier DESC LIMIT $4 OFFSET $5`;

    const results = await dataSource.query(rawQuery, [query, active, `%${query}%`, limit, offset]) as Array<RegisteredAgent & { rank: number }>;
    agents = results.map(r => { scores.set(r.id, r.rank); return r; });
  } else {
    agents = await agentQuery.orderBy('a.stakeTier', 'DESC').addOrderBy('a.registeredAt', 'DESC').take(limit).skip(offset).getMany();
    agents.forEach(a => scores.set(a.id, a.stakeTier / 4));
  }

  const providers: ProviderResult[] = [];
  
  if (endpointType === 'all' || endpointType === 'rest') {
    const providerLimit = Math.max(10, Math.floor(limit / 4));
    const searchPattern = query ? `%${query}%` : null;

    const buildQuery = (alias: string) => {
      const conditions = [`${alias}.isActive = :active`];
      const params: Record<string, unknown> = { active };
      if (searchPattern) {
        conditions.push(`(LOWER(${alias}.name) LIKE LOWER(:q) OR LOWER(${alias}.endpoint) LIKE LOWER(:q))`);
        params.q = searchPattern;
      }
      return { where: conditions.join(' AND '), params };
    };

    const { where, params } = buildQuery('p');
    const [computeProviders, storageProviders] = await Promise.all([
      computeRepo.createQueryBuilder('p').where(where, params).take(providerLimit).getMany(),
      storageRepo.createQueryBuilder('p').where(where, params).take(providerLimit).getMany(),
    ]);

    const mapProvider = (p: ComputeProvider | StorageProvider, type: 'compute' | 'storage'): ProviderResult => ({
      providerId: `${type}:${p.address}`,
      type,
      name: p.name || `${type.charAt(0).toUpperCase() + type.slice(1)} Provider`,
      endpoint: p.endpoint,
      agentId: p.agentId || null,
      isActive: p.isActive,
      isVerified: (p.agentId ?? 0) > 0,
      score: p.agentId ? 0.8 : 0.5,
    });

    providers.push(
      ...computeProviders.map(p => mapProvider(p, 'compute')),
      ...storageProviders.map(p => mapProvider(p, 'storage'))
    );
  }

  const tagFacets = await tagRepo.find({ order: { agentCount: 'DESC' }, take: 20 });

  const serviceTypeCounts = await agentRepo.createQueryBuilder('a')
    .select('a.serviceType', 'type').addSelect('COUNT(*)', 'count')
    .where('a.active = true').andWhere('a.serviceType IS NOT NULL')
    .groupBy('a.serviceType').getRawMany() as Array<{ type: string; count: string }>;

  const [a2aCount, mcpCount, restCount] = await Promise.all([
    agentRepo.count({ where: { active: true, a2aEndpoint: Not(IsNull()) } }),
    agentRepo.count({ where: { active: true, mcpEndpoint: Not(IsNull()) } }),
    agentRepo.count({ where: { active: true, serviceType: 'rest' } }),
  ]);

  const agentResults = agents
    .map(a => mapAgentToResult(a, scores.get(a.id) || 0))
    .sort((a, b) => b.score - a.score);
  providers.sort((a, b) => b.score - a.score);

  const totalAgents = await agentRepo.count({ where: { active: true } });

  const result: SearchResult = {
    agents: agentResults,
    providers,
    total: totalAgents + providers.length,
    facets: {
      tags: tagFacets.map(t => ({ tag: t.tag, count: t.agentCount })),
      serviceTypes: serviceTypeCounts.map(s => ({ type: s.type, count: parseInt(s.count) })),
      endpointTypes: [
        { type: 'a2a', count: a2aCount },
        { type: 'mcp', count: mcpCount },
        { type: 'rest', count: restCount },
      ],
    },
    query: query ?? null,
    took: Date.now() - startTime,
  };

  searchCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL });
  return result;
}

export async function getAgentById(
  dataSource: DataSource,
  agentId: string
): Promise<AgentSearchResult | null> {
  const agentRepo = dataSource.getRepository(RegisteredAgent);
  const agent = await agentRepo.findOne({
    where: { agentId: BigInt(agentId) },
    relations: ['owner'],
  });

  return agent ? mapAgentToResult(agent, 1) : null;
}

export async function getPopularTags(
  dataSource: DataSource,
  limit = 50
): Promise<Array<{ tag: string; count: number }>> {
  const tagRepo = dataSource.getRepository(TagIndex);
  const tags = await tagRepo.find({
    order: { agentCount: 'DESC' },
    take: limit,
  });

  return tags.map(t => ({ tag: t.tag, count: t.agentCount }));
}

export function invalidateSearchCache(): void {
  searchCache.clear();
}
