'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { 
  GitBranch, 
  Search, 
  Plus,
  Star,
  GitFork,
  Clock,
  Lock,
  Globe,
  Eye,
  Users,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { useRepositories, useRepositoryStats, useStarRepo, type Repository } from '../../hooks/useGit';

type RepoFilter = 'all' | 'public' | 'private' | 'forked';

const languageColors: Record<string, string> = {
  'Solidity': 'bg-purple-400',
  'TypeScript': 'bg-blue-400',
  'Python': 'bg-yellow-400',
  'JavaScript': 'bg-yellow-300',
  'Rust': 'bg-orange-400',
  'Go': 'bg-cyan-400',
  'Markdown': 'bg-gray-400',
};

export default function GitPage() {
  const { isConnected, address } = useAccount();
  const [filter, setFilter] = useState<RepoFilter>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'updated' | 'stars' | 'name'>('updated');

  // Fetch real data
  const { repositories, isLoading, error, refetch } = useRepositories({ search: search || undefined });
  const { stats, isLoading: statsLoading } = useRepositoryStats();
  const starMutation = useStarRepo();

  const filteredRepos = repositories.filter(repo => {
    if (filter === 'public' && repo.isPrivate) return false;
    if (filter === 'private' && !repo.isPrivate) return false;
    if (filter === 'forked' && !repo.isFork) return false;
    return true;
  }).sort((a, b) => {
    if (sortBy === 'stars') return b.stars - a.stars;
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    return b.updatedAt - a.updatedAt;
  });

  const formatDate = (timestamp: number) => {
    const days = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
    if (days === 0) {
      const hours = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60));
      if (hours === 0) return 'Just now';
      return `${hours}h ago`;
    }
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return `${Math.floor(days / 7)} weeks ago`;
  };

  const handleStar = (e: React.MouseEvent, owner: string, name: string) => {
    e.preventDefault();
    starMutation.mutate({ owner, name });
  };

  return (
    <div className="min-h-screen p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <GitBranch className="w-7 h-7 text-purple-400" />
            Repositories
          </h1>
          <p className="text-factory-400 mt-1">Decentralized git hosting on Jeju</p>
        </div>
        <Link href="/git/new" className="btn btn-primary">
          <Plus className="w-4 h-4" />
          New Repository
        </Link>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-6">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
            <input
              type="text"
              placeholder="Find a repository..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>

          <div className="flex gap-2">
            {(['all', 'public', 'private', 'forked'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={clsx(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize',
                  filter === f
                    ? 'bg-accent-600 text-white'
                    : 'bg-factory-800 text-factory-400 hover:text-factory-100'
                )}
              >
                {f}
              </button>
            ))}
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="input w-auto"
          >
            <option value="updated">Last updated</option>
            <option value="stars">Stars</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Repos', value: statsLoading ? '...' : stats.totalRepos.toLocaleString(), icon: GitBranch, color: 'text-purple-400' },
          { label: 'Public', value: statsLoading ? '...' : stats.publicRepos.toLocaleString(), icon: Globe, color: 'text-green-400' },
          { label: 'Total Stars', value: statsLoading ? '...' : stats.totalStars.toLocaleString(), icon: Star, color: 'text-amber-400' },
          { label: 'Contributors', value: statsLoading ? '...' : stats.contributors.toLocaleString(), icon: Users, color: 'text-blue-400' },
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

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-accent-400" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="card p-8 text-center">
          <p className="text-red-400 mb-4">Failed to load repositories</p>
          <button onClick={() => refetch()} className="btn btn-secondary">
            Try Again
          </button>
        </div>
      )}

      {/* Repository List */}
      {!isLoading && !error && (
        <div className="space-y-4">
          {filteredRepos.map((repo) => (
            <RepoCard 
              key={repo.id} 
              repo={repo} 
              formatDate={formatDate}
              onStar={handleStar}
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && filteredRepos.length === 0 && (
        <div className="card p-12 text-center">
          <GitBranch className="w-12 h-12 mx-auto mb-4 text-factory-600" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">No repositories found</h3>
          <p className="text-factory-500 mb-4">Try adjusting your filters or create a new repository</p>
          <Link href="/git/new" className="btn btn-primary">
            New Repository
          </Link>
        </div>
      )}
    </div>
  );
}

function RepoCard({ 
  repo, 
  formatDate, 
  onStar 
}: { 
  repo: Repository; 
  formatDate: (ts: number) => string;
  onStar: (e: React.MouseEvent, owner: string, name: string) => void;
}) {
  return (
    <Link 
      href={`/git/${repo.fullName}`}
      className="card p-6 card-hover block"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Repo name & visibility */}
          <div className="flex items-center gap-3 mb-2">
            <span className="text-factory-400">{repo.owner}/</span>
            <span className="font-semibold text-accent-400 hover:underline">{repo.name}</span>
            <span className={clsx(
              'badge',
              repo.isPrivate 
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'bg-factory-700/50 text-factory-400 border border-factory-600'
            )}>
              {repo.isPrivate ? (
                <><Lock className="w-3 h-3 mr-1" /> Private</>
              ) : (
                <><Globe className="w-3 h-3 mr-1" /> Public</>
              )}
            </span>
            {repo.isFork && (
              <span className="badge bg-factory-700/50 text-factory-400 border border-factory-600">
                <GitFork className="w-3 h-3 mr-1" /> Fork
              </span>
            )}
          </div>

          {/* Description */}
          {repo.description && (
            <p className="text-factory-400 text-sm mb-3">{repo.description}</p>
          )}

          {/* Topics */}
          {repo.topics && repo.topics.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {repo.topics.map((topic) => (
                <span key={topic} className="badge badge-info">
                  {topic}
                </span>
              ))}
            </div>
          )}

          {/* Stats row */}
          <div className="flex items-center gap-5 text-sm text-factory-500">
            {/* Language */}
            {repo.language && (
              <span className="flex items-center gap-1.5">
                <span className={clsx(
                  'w-3 h-3 rounded-full',
                  languageColors[repo.language] || 'bg-gray-400'
                )} />
                {repo.language}
              </span>
            )}

            {/* Stars */}
            <span className="flex items-center gap-1">
              <Star className="w-4 h-4" />
              {repo.stars}
            </span>

            {/* Forks */}
            <span className="flex items-center gap-1">
              <GitFork className="w-4 h-4" />
              {repo.forks}
            </span>

            {/* Watchers */}
            <span className="flex items-center gap-1">
              <Eye className="w-4 h-4" />
              {repo.watchers}
            </span>

            {/* Updated */}
            <span className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              Updated {formatDate(repo.updatedAt)}
            </span>
          </div>
        </div>

        {/* Star button */}
        <button 
          className="btn btn-secondary text-sm py-1.5"
          onClick={(e) => onStar(e, repo.owner, repo.name)}
        >
          <Star className="w-4 h-4" />
          Star
        </button>
      </div>
    </Link>
  );
}
