import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Sparkles, Search, ExternalLink, Zap, Server, Bot, Box, Shield, DollarSign } from 'lucide-react';

interface RegisteredApp {
  agentId: string;
  name: string;
  description?: string;
  owner: string;
  tags: string[];
  a2aEndpoint?: string;
  mcpEndpoint?: string;
  serviceType?: 'agent' | 'mcp' | 'app';
  category?: string;
  x402Support?: boolean;
  stakeToken: string;
  stakeAmount: string;
  stakeTier?: number;
  registeredAt: string;
  metadataUri?: string;
  image?: string;
  mcpTools?: string[];
  a2aSkills?: string[];
  active?: boolean;
}

interface RegisteredAppsListProps {
  onSelectApp: (agentId: bigint) => void;
}

const INDEXER_URL = import.meta.env.VITE_INDEXER_URL || 'http://localhost:4000/graphql';

const TYPE_FILTERS = [
  { value: 'all', label: 'All', icon: Box },
  { value: 'agent', label: 'Agents', icon: Bot },
  { value: 'mcp', label: 'MCP', icon: Server },
  { value: 'app', label: 'Apps', icon: Box },
];

const CATEGORY_FILTERS = [
  { value: 'all', label: 'All Categories' },
  { value: 'ai', label: 'AI & ML' },
  { value: 'defi', label: 'DeFi' },
  { value: 'gaming', label: 'Gaming' },
  { value: 'social', label: 'Social' },
  { value: 'productivity', label: 'Productivity' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'finance', label: 'Finance' },
  { value: 'creative', label: 'Creative' },
];

const TAG_FILTERS = [
  { value: 'all', label: 'All', emoji: '✨' },
  { value: 'app', label: 'Apps', emoji: '📱' },
  { value: 'game', label: 'Games', emoji: '🎮' },
  { value: 'marketplace', label: 'Markets', emoji: '🏪' },
  { value: 'defi', label: 'DeFi', emoji: '💰' },
  { value: 'social', label: 'Social', emoji: '💬' },
  { value: 'service', label: 'Services', emoji: '⚙️' },
];

const STAKE_TIERS = [
  { label: 'Free', className: 'text-muted' },
  { label: 'Bronze', className: 'text-success' },
  { label: 'Silver', className: 'text-info' },
  { label: 'Gold', className: 'text-accent' },
];

interface FetchFilters {
  search?: string;
  tag?: string;
  serviceType?: string;
  category?: string;
  x402Only?: boolean;
  activeOnly?: boolean;
}

async function fetchAgentsFromIndexer(filters: FetchFilters = {}): Promise<RegisteredApp[]> {
  const { search, tag, serviceType, category, x402Only, activeOnly } = filters;
  
  const whereConditions: string[] = [];
  if (search) whereConditions.push(`name_containsInsensitive: "${search}"`);
  if (tag && tag !== 'all') whereConditions.push(`tags_containsAll: ["${tag}"]`);
  if (serviceType && serviceType !== 'all') whereConditions.push(`serviceType_eq: "${serviceType}"`);
  if (category && category !== 'all') whereConditions.push(`category_eq: "${category}"`);
  if (x402Only) whereConditions.push(`x402Support_eq: true`);
  if (activeOnly) whereConditions.push(`active_eq: true, isBanned_eq: false`);
  
  const whereClause = whereConditions.length > 0 ? `where: { ${whereConditions.join(', ')} }` : '';
  
  const query = `
    query GetAgents {
      registeredAgents(
        limit: 100
        orderBy: registeredAt_DESC
        ${whereClause}
      ) {
        id agentId owner { address } name description tags tokenURI stakeToken stakeAmount stakeTier registeredAt lastActivityAt active isBanned a2aEndpoint mcpEndpoint serviceType category x402Support mcpTools a2aSkills image
      }
    }
  `;

  const response = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  const result = await response.json();
  if (result.errors) {
    console.error('GraphQL errors:', result.errors);
    return [];
  }

  return (result.data?.registeredAgents || []).map((agent: Record<string, unknown>) => ({
    agentId: agent.agentId || agent.id,
    name: (agent.name as string) || `Agent #${agent.id}`,
    description: agent.description,
    owner: (agent.owner as { address: string })?.address || '0x0',
    tags: (agent.tags as string[]) || [],
    stakeToken: (agent.stakeToken as string) || 'ETH',
    stakeAmount: formatStake(agent.stakeAmount as string),
    stakeTier: (agent.stakeTier as number) ?? 0,
    registeredAt: agent.registeredAt,
    metadataUri: agent.tokenURI,
    active: agent.active !== false && !agent.isBanned,
    a2aEndpoint: agent.a2aEndpoint,
    mcpEndpoint: agent.mcpEndpoint,
    serviceType: (agent.serviceType as 'agent' | 'mcp' | 'app') || 'agent',
    category: agent.category,
    x402Support: agent.x402Support ?? false,
    mcpTools: agent.mcpTools || [],
    a2aSkills: agent.a2aSkills || [],
    image: agent.image,
  }));
}

function formatStake(amount: string): string {
  const value = BigInt(amount || '0');
  const eth = Number(value) / 1e18;
  return eth < 0.001 ? '<0.001' : eth.toFixed(3);
}

function getServiceIcon(type: string) {
  switch (type) {
    case 'mcp': return Server;
    case 'app': return Box;
    default: return Bot;
  }
}

export default function RegisteredAppsList({ onSelectApp }: RegisteredAppsListProps) {
  const [selectedTag, setSelectedTag] = useState('all');
  const [selectedType, setSelectedType] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [x402Only, setX402Only] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [apps, setApps] = useState<RegisteredApp[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchApps = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const results = await fetchAgentsFromIndexer({
      search: searchQuery || undefined,
      tag: selectedTag !== 'all' ? selectedTag : undefined,
      serviceType: selectedType !== 'all' ? selectedType : undefined,
      category: selectedCategory !== 'all' ? selectedCategory : undefined,
      x402Only,
      activeOnly,
    });
    setApps(results);
    setIsLoading(false);
  }, [searchQuery, selectedTag, selectedType, selectedCategory, x402Only, activeOnly]);

  useEffect(() => {
    const debounce = setTimeout(fetchApps, 300);
    return () => clearTimeout(debounce);
  }, [fetchApps]);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.5rem', marginBottom: '1rem' }}>
        <div style={{ position: 'relative', minWidth: 0 }}>
          <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="input"
            type="text"
            placeholder="Search agents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: '2.5rem' }}
          />
        </div>
        <select className="input" value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} style={{ width: 'auto', minWidth: '120px' }}>
          {CATEGORY_FILTERS.map((cat) => <option key={cat.value} value={cat.value}>{cat.label}</option>)}
        </select>
        <button onClick={fetchApps} className="button button-secondary" style={{ padding: '0.75rem' }}>
          <RefreshCw size={16} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        {TYPE_FILTERS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => setSelectedType(value)}
            className={`pill ${selectedType === value ? 'pill-active' : ''}`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <label className="pill" style={{ cursor: 'pointer', gap: '0.5rem' }}>
          <input type="checkbox" checked={x402Only} onChange={(e) => setX402Only(e.target.checked)} style={{ accentColor: 'var(--accent-primary)' }} />
          <DollarSign size={12} /> x402
        </label>
        <label className="pill" style={{ cursor: 'pointer', gap: '0.5rem' }}>
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} style={{ accentColor: 'var(--accent-primary)' }} />
          <Zap size={12} /> Active
        </label>
      </div>

      <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '1.5rem', overflowX: 'auto', paddingBottom: '0.25rem' }}>
        {TAG_FILTERS.map(({ value, label, emoji }) => (
          <button key={value} onClick={() => setSelectedTag(value)} className={`pill ${selectedTag === value ? 'pill-active' : ''}`} style={{ flexShrink: 0 }}>
            {emoji} {label}
          </button>
        ))}
      </div>

      {error && <div className="banner banner-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {isLoading && (
        <div className="empty-state">
          <div className="spinner" style={{ margin: '0 auto 1rem' }} />
          <p>Searching marketplace...</p>
        </div>
      )}

      {!isLoading && apps.length === 0 && (
        <div className="card empty-state">
          <Sparkles size={48} className="empty-state-icon" />
          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>No Agents Found</h3>
          <p>{searchQuery ? `No results for "${searchQuery}"` : 'No agents registered yet'}</p>
        </div>
      )}

      {!isLoading && apps.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: '1rem' }}>
          {apps.map((app) => {
            const ServiceIcon = getServiceIcon(app.serviceType || 'agent');
            const tier = STAKE_TIERS[app.stakeTier ?? 0];

            return (
              <div
                key={app.agentId}
                className="card"
                onClick={() => onSelectApp(BigInt(app.agentId))}
                style={{ cursor: 'pointer', opacity: app.active ? 1 : 0.6, padding: '1.25rem' }}
              >
                <div style={{ display: 'flex', alignItems: 'start', gap: '1rem', marginBottom: '1rem' }}>
                  <div style={{
                    width: '52px',
                    height: '52px',
                    borderRadius: 'var(--radius-lg)',
                    background: app.image ? `url(${app.image}) center/cover` : 'var(--gradient-brand)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    flexShrink: 0,
                    boxShadow: 'var(--shadow-md)',
                  }}>
                    {!app.image && <ServiceIcon size={24} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                        {app.name}
                      </h3>
                      {app.x402Support && <span className="badge badge-success" style={{ fontSize: '0.625rem', padding: '0.125rem 0.375rem' }}>x402</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="badge badge-accent" style={{ fontSize: '0.625rem', padding: '0.125rem 0.5rem', textTransform: 'uppercase' }}>
                        {app.serviceType || 'agent'}
                      </span>
                      <code style={{ fontSize: '0.75rem' }}>#{app.agentId}</code>
                    </div>
                  </div>
                </div>

                {app.description && (
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {app.description}
                  </p>
                )}

                {app.tags.length > 0 && (
                  <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                    {app.tags.slice(0, 3).map((tag, idx) => (
                      <span key={idx} className="pill" style={{ fontSize: '0.6875rem', padding: '0.1875rem 0.5rem' }}>{tag}</span>
                    ))}
                    {app.tags.length > 3 && <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', padding: '0.1875rem 0.25rem' }}>+{app.tags.length - 3}</span>}
                  </div>
                )}

                {(app.a2aEndpoint || app.mcpEndpoint) && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                    {app.a2aEndpoint && <span className="badge badge-info" style={{ fontSize: '0.6875rem' }}><Bot size={10} /> A2A</span>}
                    {app.mcpEndpoint && <span className="badge" style={{ fontSize: '0.6875rem', background: 'var(--accent-secondary-soft)', color: 'var(--accent-secondary)' }}><Server size={10} /> MCP</span>}
                    {(app.mcpTools?.length || 0) > 0 && <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>{app.mcpTools?.length} tools</span>}
                  </div>
                )}

                <div style={{ padding: '0.75rem', background: 'var(--surface-hover)', borderRadius: 'var(--radius-md)', fontSize: '0.8125rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Shield size={12} /> Tier</span>
                    <span style={{ fontWeight: 600, color: `var(--${tier.className === 'text-muted' ? 'text-muted' : tier.className === 'text-success' ? 'success' : tier.className === 'text-info' ? 'info' : 'accent-primary'})` }}>
                      {tier.label}
                      {app.stakeAmount !== '<0.001' && app.stakeAmount !== '0.000' && <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.75rem' }}> ({app.stakeAmount} ETH)</span>}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Owner</span>
                    <code style={{ fontSize: '0.75rem' }}>{app.owner.slice(0, 6)}...{app.owner.slice(-4)}</code>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                  {app.metadataUri && (
                    <a href={app.metadataUri} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="button button-ghost" style={{ flex: 1, justifyContent: 'center', fontSize: '0.75rem' }}>
                      <ExternalLink size={12} /> Metadata
                    </a>
                  )}
                  {app.a2aEndpoint && (
                    <a href={app.a2aEndpoint} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="button button-ghost" style={{ flex: 1, justifyContent: 'center', fontSize: '0.75rem', color: 'var(--info)' }}>
                      <Bot size={12} /> A2A
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && apps.length > 0 && (
        <p style={{ marginTop: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Showing {apps.length} agent{apps.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}
