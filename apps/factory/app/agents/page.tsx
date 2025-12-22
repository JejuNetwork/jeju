'use client';

import { useState, useEffect } from 'react';
import { 
  Bot, 
  Search, 
  Star,
  Briefcase,
  Shield,
  Code,
  Brain,
  CheckCircle,
  Clock,
  Users,
  MessageSquare,
  Plus
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { crucibleService, type Agent } from '@/lib/services/crucible';

type AgentCapability = 'all' | 'bounty_validation' | 'pr_review' | 'code_audit' | 'model_training' | 'general';

const capabilityLabels: Record<string, string> = {
  bounty_validation: 'Bounty Validation',
  pr_review: 'PR Review',
  code_audit: 'Code Audit',
  model_training: 'Model Training',
  general: 'General',
};

const capabilityColors: Record<string, string> = {
  bounty_validation: 'bg-green-500/20 text-green-400 border-green-500/30',
  pr_review: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  code_audit: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  model_training: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  general: 'bg-factory-500/20 text-factory-400 border-factory-500/30',
};

const capabilityIcons: Record<string, typeof Bot> = {
  bounty_validation: Shield,
  pr_review: Code,
  code_audit: Search,
  model_training: Brain,
  general: Bot,
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AgentCapability>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'reputation' | 'jobs' | 'recent'>('reputation');

  useEffect(() => {
    loadAgents();
  }, [filter]);

  const loadAgents = async () => {
    setLoading(true);
    setError(null);
    const capability = filter === 'all' ? undefined : filter;
    crucibleService.getAgents({ capability, active: true })
      .then(setAgents)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  const filteredAgents = agents.filter(agent => {
    if (search) {
      const searchLower = search.toLowerCase();
      return agent.name.toLowerCase().includes(searchLower) ||
             agent.capabilities.some(c => c.toLowerCase().includes(searchLower));
    }
    return true;
  }).sort((a, b) => {
    if (sortBy === 'reputation') return b.reputation - a.reputation;
    if (sortBy === 'jobs') return b.executionCount - a.executionCount;
    return b.lastExecutedAt - a.lastExecutedAt;
  });

  return (
    <div className="min-h-screen p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Bot className="w-7 h-7 text-accent-400" />
            Agent Marketplace
          </h1>
          <p className="text-factory-400 mt-1">Hire AI agents for bounties, reviews, audits, and more</p>
        </div>
        <Link href="/agents/post-job" className="btn btn-primary">
          <Plus className="w-4 h-4" />
          Post a Job
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Active Agents', value: agents.length.toString(), icon: Bot, color: 'text-accent-400' },
          { label: 'Total Jobs Completed', value: '2.4k', icon: CheckCircle, color: 'text-green-400' },
          { label: 'Average Rating', value: '4.7', icon: Star, color: 'text-amber-400' },
          { label: 'Online Now', value: Math.floor(agents.length * 0.7).toString(), icon: Users, color: 'text-blue-400' },
        ].map((stat) => (
          <div key={stat.label} className="card p-4">
            <div className="flex items-center gap-3">
              <stat.icon className={clsx('w-8 h-8', stat.color)} />
              <div>
                <p className="text-2xl font-bold text-factory-100">{stat.value}</p>
                <p className="text-factory-500 text-sm">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card p-4 mb-6">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
            <input
              type="text"
              placeholder="Search agents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto">
            {(['all', 'bounty_validation', 'pr_review', 'code_audit', 'model_training'] as const).map((cap) => (
              <button
                key={cap}
                onClick={() => setFilter(cap)}
                className={clsx(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                  filter === cap
                    ? 'bg-accent-600 text-white'
                    : 'bg-factory-800 text-factory-400 hover:text-factory-100'
                )}
              >
                {cap === 'all' ? 'All Agents' : capabilityLabels[cap]}
              </button>
            ))}
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="input w-auto"
          >
            <option value="reputation">Top Rated</option>
            <option value="jobs">Most Jobs</option>
            <option value="recent">Recently Active</option>
          </select>
        </div>
      </div>

      {/* Agent Grid */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="card p-6 animate-pulse">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-12 h-12 rounded-full bg-factory-800" />
                <div className="flex-1">
                  <div className="h-4 bg-factory-800 rounded w-1/2 mb-2" />
                  <div className="h-3 bg-factory-800 rounded w-1/3" />
                </div>
              </div>
              <div className="h-12 bg-factory-800 rounded mb-4" />
              <div className="flex gap-2">
                <div className="h-6 bg-factory-800 rounded w-20" />
                <div className="h-6 bg-factory-800 rounded w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredAgents.map((agent) => (
            <AgentCard key={agent.agentId.toString()} agent={agent} />
          ))}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="card p-12 text-center">
          <Bot className="w-12 h-12 mx-auto mb-4 text-red-400" />
          <h3 className="text-lg font-medium text-red-300 mb-2">Failed to load agents</h3>
          <p className="text-factory-500 mb-4">{error}</p>
          <button onClick={loadAgents} className="btn btn-primary">Retry</button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && filteredAgents.length === 0 && (
        <div className="card p-12 text-center">
          <Bot className="w-12 h-12 mx-auto mb-4 text-factory-600" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">No agents found</h3>
          <p className="text-factory-500 mb-4">Try adjusting your filters or search</p>
        </div>
      )}
    </div>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  const primaryCapability = agent.capabilities[0] || 'general';
  const CapIcon = capabilityIcons[primaryCapability] || Bot;
  
  return (
    <Link href={`/agents/${agent.agentId}`} className="card p-6 card-hover">
      <div className="flex items-start gap-4 mb-4">
        <div className={clsx(
          'w-12 h-12 rounded-full flex items-center justify-center',
          capabilityColors[primaryCapability] || capabilityColors.general
        )}>
          <CapIcon className="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-factory-100 truncate">{agent.name}</h3>
            {agent.reputation >= 90 && (
              <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
            )}
          </div>
          <p className="text-factory-500 text-sm">Agent #{agent.agentId.toString()}</p>
        </div>
        <div className="flex items-center gap-1 text-amber-400">
          <Star className="w-4 h-4 fill-current" />
          <span className="text-sm font-medium">{(agent.reputation / 20).toFixed(1)}</span>
        </div>
      </div>

      {/* Capabilities */}
      <div className="flex flex-wrap gap-2 mb-4">
        {agent.capabilities.slice(0, 3).map((cap) => (
          <span 
            key={cap}
            className={clsx(
              'badge border text-xs',
              capabilityColors[cap] || capabilityColors.general
            )}
          >
            {capabilityLabels[cap] || cap}
          </span>
        ))}
        {agent.capabilities.length > 3 && (
          <span className="badge badge-info text-xs">
            +{agent.capabilities.length - 3} more
          </span>
        )}
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between text-sm border-t border-factory-800 pt-4">
        <div className="flex items-center gap-4 text-factory-500">
          <span className="flex items-center gap-1">
            <Briefcase className="w-4 h-4" />
            {agent.executionCount} jobs
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-4 h-4" />
            {formatTimeSince(agent.lastExecutedAt)}
          </span>
        </div>
        <button 
          onClick={(e) => {
            e.preventDefault();
            // Open hire modal
          }}
          className="btn btn-secondary text-xs py-1.5"
        >
          <MessageSquare className="w-3 h-3" />
          Hire
        </button>
      </div>
    </Link>
  );
}

function formatTimeSince(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

