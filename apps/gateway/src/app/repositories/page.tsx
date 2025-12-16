'use client';

import { useState, useEffect } from 'react';
import { Search, Star, GitFork, Eye, Lock, Globe, GitBranch, Clock } from 'lucide-react';

interface Repository {
  id: string;
  name: string;
  full_name: string;
  owner: { login: string };
  description: string | null;
  visibility: 'public' | 'private' | 'internal';
  stargazers_count: number;
  forks_count: number;
  default_branch: string;
  topics: string[];
  created_at: string;
  updated_at: string;
  pushed_at: string | null;
  reputation_score: number;
  verified: boolean;
  head_cid: string;
  storage_backend: string;
}

export default function RepositoriesPage() {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'public' | 'private'>('all');
  const [sort, setSort] = useState<'updated' | 'stars' | 'created'>('updated');

  useEffect(() => {
    fetchRepositories();
  }, [filter, sort]);

  async function fetchRepositories() {
    setLoading(true);
    const gitServerUrl = process.env.NEXT_PUBLIC_JEJUGIT_URL ?? 'http://localhost:4020';
    const params = new URLSearchParams();
    params.set('sort', sort);
    if (filter !== 'all') params.set('visibility', filter);

    try {
      const response = await fetch(`${gitServerUrl}/api/v1/repos?${params}`);
      if (response.ok) {
        const data = await response.json() as { items: Repository[] };
        setRepositories(data.items ?? []);
      }
    } catch (error) {
      console.error('Failed to fetch repositories:', error);
    } finally {
      setLoading(false);
    }
  }

  const filteredRepos = repositories.filter(repo =>
    repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    repo.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    repo.owner.login.toLowerCase().includes(searchQuery.toLowerCase())
  );

  function formatDate(dateString: string | null): string {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    if (days < 365) return `${Math.floor(days / 30)} months ago`;
    return `${Math.floor(days / 365)} years ago`;
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Repositories</h1>
            <p className="text-gray-400 mt-1">
              Decentralized Git repositories stored on IPFS/Arweave
            </p>
          </div>
          <a
            href="/repositories/new"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
          >
            New Repository
          </a>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search repositories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </div>
          
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500"
          >
            <option value="all">All</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
          
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500"
          >
            <option value="updated">Recently Updated</option>
            <option value="stars">Most Stars</option>
            <option value="created">Newest</option>
          </select>
        </div>

        {/* Repository List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : filteredRepos.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400">No repositories found</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredRepos.map((repo) => (
              <div
                key={repo.id}
                className="p-6 bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <a
                        href={`/repositories/${repo.full_name}`}
                        className="text-xl font-semibold text-blue-400 hover:underline"
                      >
                        {repo.full_name}
                      </a>
                      {repo.visibility === 'private' ? (
                        <span className="px-2 py-0.5 text-xs bg-gray-700 text-gray-300 rounded-full flex items-center gap-1">
                          <Lock className="w-3 h-3" />
                          Private
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-xs bg-green-900/50 text-green-400 rounded-full flex items-center gap-1">
                          <Globe className="w-3 h-3" />
                          Public
                        </span>
                      )}
                      {repo.verified && (
                        <span className="px-2 py-0.5 text-xs bg-blue-900/50 text-blue-400 rounded-full">
                          Verified
                        </span>
                      )}
                    </div>
                    
                    {repo.description && (
                      <p className="text-gray-400 mt-2">{repo.description}</p>
                    )}
                    
                    {repo.topics.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {repo.topics.map((topic) => (
                          <span
                            key={topic}
                            className="px-2 py-1 text-xs bg-blue-900/30 text-blue-300 rounded-full hover:bg-blue-900/50 cursor-pointer"
                          >
                            {topic}
                          </span>
                        ))}
                      </div>
                    )}
                    
                    <div className="flex items-center gap-6 mt-4 text-sm text-gray-400">
                      <span className="flex items-center gap-1">
                        <Star className="w-4 h-4" />
                        {repo.stargazers_count}
                      </span>
                      <span className="flex items-center gap-1">
                        <GitFork className="w-4 h-4" />
                        {repo.forks_count}
                      </span>
                      <span className="flex items-center gap-1">
                        <GitBranch className="w-4 h-4" />
                        {repo.default_branch}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        Updated {formatDate(repo.updated_at)}
                      </span>
                    </div>
                  </div>
                  
                  <div className="text-right text-sm">
                    <div className="text-gray-400">
                      Storage: <span className="text-gray-300">{repo.storage_backend}</span>
                    </div>
                    {repo.reputation_score > 0 && (
                      <div className="text-gray-400 mt-1">
                        Reputation: <span className="text-green-400">{repo.reputation_score.toFixed(1)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
