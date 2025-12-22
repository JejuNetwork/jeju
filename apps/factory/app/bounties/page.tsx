'use client';

import { useState } from 'react';
import { 
  DollarSign, 
  Search, 
  Clock, 
  Users, 
  Tag,
  Plus,
  Loader2
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { useBounties, useBountyStats, type Bounty } from '../../hooks/useBounties';

type BountyStatus = 'open' | 'in_progress' | 'review' | 'completed' | 'all';

const statusColors = {
  open: 'badge-success',
  in_progress: 'badge-warning',
  review: 'badge-info',
  completed: 'bg-factory-700/50 text-factory-300',
  cancelled: 'bg-red-500/20 text-red-400',
};

const statusLabels = {
  open: 'Open',
  in_progress: 'In Progress',
  review: 'In Review',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export default function BountiesPage() {
  const [filter, setFilter] = useState<BountyStatus>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'reward' | 'deadline' | 'applicants'>('reward');

  // Fetch real data
  const { bounties, isLoading, error, refetch } = useBounties(
    filter !== 'all' ? { status: filter } : undefined
  );
  const { stats, isLoading: statsLoading } = useBountyStats();

  const filteredBounties = bounties.filter(bounty => {
    if (search && !bounty.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).sort((a, b) => {
    if (sortBy === 'reward') {
      return parseFloat(b.rewards[0]?.amount || '0') - parseFloat(a.rewards[0]?.amount || '0');
    }
    if (sortBy === 'deadline') {
      return a.deadline - b.deadline;
    }
    return b.applicants - a.applicants;
  });

  const formatDeadline = (timestamp: number) => {
    const days = Math.ceil((timestamp - Date.now()) / (1000 * 60 * 60 * 24));
    if (days === 1) return '1 day left';
    if (days <= 0) return 'Expired';
    return `${days} days left`;
  };

  return (
    <div className="min-h-screen p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <DollarSign className="w-7 h-7 text-green-400" />
            Bounties
          </h1>
          <p className="text-factory-400 mt-1">Find work, earn rewards, build the network</p>
        </div>
        <Link href="/bounties/create" className="btn btn-primary">
          <Plus className="w-4 h-4" />
          Create Bounty
        </Link>
      </div>

      {/* Filters & Search */}
      <div className="card p-4 mb-6">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
            <input
              type="text"
              placeholder="Search bounties..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>

          {/* Status Filter */}
          <div className="flex gap-2">
            {(['all', 'open', 'in_progress', 'review', 'completed'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={clsx(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  filter === status
                    ? 'bg-accent-600 text-white'
                    : 'bg-factory-800 text-factory-400 hover:text-factory-100'
                )}
              >
                {status === 'all' ? 'All' : statusLabels[status]}
              </button>
            ))}
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="input w-auto"
          >
            <option value="reward">Highest Reward</option>
            <option value="deadline">Ending Soon</option>
            <option value="applicants">Most Applicants</option>
          </select>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Open Bounties', value: statsLoading ? '...' : stats.openBounties.toString(), color: 'text-green-400' },
          { label: 'Total Value', value: statsLoading ? '...' : stats.totalValue, color: 'text-amber-400' },
          { label: 'Completed', value: statsLoading ? '...' : stats.completed.toString(), color: 'text-blue-400' },
          { label: 'Avg. Payout', value: statsLoading ? '...' : stats.avgPayout, color: 'text-purple-400' },
        ].map((stat) => (
          <div key={stat.label} className="card p-4 text-center">
            <p className={clsx('text-2xl font-bold', stat.color)}>{stat.value}</p>
            <p className="text-factory-500 text-sm">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-accent-400" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="card p-8 text-center">
          <p className="text-red-400 mb-4">Failed to load bounties</p>
          <button onClick={() => refetch()} className="btn btn-secondary">
            Try Again
          </button>
        </div>
      )}

      {/* Bounty List */}
      {!isLoading && !error && (
        <div className="space-y-4">
          {filteredBounties.map((bounty) => (
            <BountyCard key={bounty.id} bounty={bounty} formatDeadline={formatDeadline} />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && filteredBounties.length === 0 && (
        <div className="card p-12 text-center">
          <DollarSign className="w-12 h-12 mx-auto mb-4 text-factory-600" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">No bounties found</h3>
          <p className="text-factory-500 mb-4">Try adjusting your filters or search terms</p>
          <Link href="/bounties/create" className="btn btn-primary">
            Create a Bounty
          </Link>
        </div>
      )}
    </div>
  );
}

function BountyCard({ bounty, formatDeadline }: { bounty: Bounty; formatDeadline: (ts: number) => string }) {
  return (
    <Link 
      href={`/bounties/${bounty.id}`}
      className="card p-6 card-hover block"
    >
      <div className="flex items-start justify-between gap-6">
        {/* Main Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="font-semibold text-factory-100 truncate">{bounty.title}</h3>
            <span className={clsx('badge', statusColors[bounty.status])}>
              {statusLabels[bounty.status]}
            </span>
          </div>
          
          <p className="text-factory-400 text-sm mb-4 line-clamp-2">{bounty.description}</p>

          <div className="flex flex-wrap items-center gap-4 text-sm">
            {/* Skills */}
            <div className="flex flex-wrap gap-2">
              {bounty.skills.slice(0, 4).map((skill) => (
                <span key={skill} className="badge badge-info">
                  {skill}
                </span>
              ))}
              {bounty.skills.length > 4 && (
                <span className="badge bg-factory-800 text-factory-400">
                  +{bounty.skills.length - 4}
                </span>
              )}
            </div>
            
            {/* Meta */}
            <span className="flex items-center gap-1 text-factory-500">
              <Clock className="w-4 h-4" />
              {formatDeadline(bounty.deadline)}
            </span>
            
            <span className="flex items-center gap-1 text-factory-500">
              <Users className="w-4 h-4" />
              {bounty.applicants} applicants
            </span>

            <span className="flex items-center gap-1 text-factory-500">
              <Tag className="w-4 h-4" />
              {bounty.milestones} milestones
            </span>
          </div>
        </div>

        {/* Rewards */}
        <div className="text-right flex-shrink-0">
          <div className="space-y-1">
            {bounty.rewards.map((reward, i) => (
              <p key={i} className={clsx(
                'font-bold',
                i === 0 ? 'text-xl text-green-400' : 'text-sm text-factory-400'
              )}>
                {reward.amount} {reward.token}
              </p>
            ))}
          </div>
          <p className="text-factory-500 text-sm mt-1">Reward</p>
        </div>
      </div>
    </Link>
  );
}
