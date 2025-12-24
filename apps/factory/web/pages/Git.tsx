import { clsx } from 'clsx'
import {
  GitBranch,
  GitFork,
  Loader2,
  Lock,
  Plus,
  Search,
  Star,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useRepositories, useRepositoryStats } from '../hooks/useGit'

export function GitPage() {
  const [search, setSearch] = useState('')
  const { repositories, isLoading, error } = useRepositories({
    search: search || undefined,
  })
  const { stats, isLoading: statsLoading } = useRepositoryStats()

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffDays = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
    )
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
    return date.toLocaleDateString()
  }

  return (
    <div className="min-h-screen p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <GitBranch className="w-7 h-7 text-purple-400" />
            Repositories
          </h1>
          <p className="text-factory-400 mt-1">
            Decentralized git hosting on Jeju
          </p>
        </div>
        <Link to="/git/new" className="btn btn-primary">
          <Plus className="w-4 h-4" />
          New Repository
        </Link>
      </div>

      <div className="card p-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
          <input
            type="text"
            placeholder="Search repositories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-10"
          />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          {
            label: 'Total Repos',
            value: stats.totalRepos.toString(),
            color: 'text-purple-400',
          },
          {
            label: 'Public Repos',
            value: stats.publicRepos.toString(),
            color: 'text-blue-400',
          },
          {
            label: 'Total Stars',
            value: stats.totalStars.toString(),
            color: 'text-amber-400',
          },
          {
            label: 'Contributors',
            value: stats.contributors.toString(),
            color: 'text-green-400',
          },
        ].map((stat) => (
          <div key={stat.label} className="card p-4 text-center">
            {statsLoading ? (
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-factory-500" />
            ) : (
              <p className={clsx('text-2xl font-bold', stat.color)}>
                {stat.value}
              </p>
            )}
            <p className="text-factory-500 text-sm">{stat.label}</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="card p-12 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-accent-500" />
        </div>
      ) : error ? (
        <div className="card p-12 text-center">
          <GitBranch className="w-12 h-12 mx-auto mb-4 text-red-400" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">
            Failed to load repositories
          </h3>
          <p className="text-factory-500">Please try again later</p>
        </div>
      ) : repositories.length === 0 ? (
        <div className="card p-12 text-center">
          <GitBranch className="w-12 h-12 mx-auto mb-4 text-factory-600" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">
            No repositories found
          </h3>
          <p className="text-factory-500 mb-4">
            {search
              ? 'Try adjusting your search terms'
              : 'Create your first repository'}
          </p>
          <Link to="/git/new" className="btn btn-primary">
            New Repository
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {repositories.map((repo) => (
            <Link
              key={repo.id}
              to={`/git/${repo.owner}/${repo.name}`}
              className="card p-6 card-hover block"
            >
              <div className="flex items-start justify-between gap-6">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold text-factory-100">
                      {repo.fullName}
                    </h3>
                    {repo.isPrivate && (
                      <span className="flex items-center gap-1 text-factory-400 text-sm">
                        <Lock className="w-4 h-4" />
                        Private
                      </span>
                    )}
                    {repo.isFork && (
                      <span className="flex items-center gap-1 text-factory-400 text-sm">
                        <GitFork className="w-4 h-4" />
                        Fork
                      </span>
                    )}
                  </div>
                  <p className="text-factory-400 text-sm line-clamp-2 mb-3">
                    {repo.description || 'No description provided'}
                  </p>
                  <div className="flex items-center gap-4 text-sm text-factory-500">
                    {repo.language && (
                      <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded-full bg-blue-400" />
                        {repo.language}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Star className="w-4 h-4" />
                      {repo.stars}
                    </span>
                    <span className="flex items-center gap-1">
                      <GitFork className="w-4 h-4" />
                      {repo.forks}
                    </span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-factory-500 text-sm">
                    Updated {formatDate(repo.updatedAt)}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
