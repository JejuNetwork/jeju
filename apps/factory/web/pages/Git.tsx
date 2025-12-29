import { GitBranch, GitFork, Lock, Plus, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SearchBar,
  StatsGrid,
} from '../components/shared'
import { useRepositories, useRepositoryStats } from '../hooks/useGit'
import { formatRelativeTime } from '../lib/format'

export function GitPage() {
  const [search, setSearch] = useState('')
  const { repositories, isLoading, error } = useRepositories({
    search: search || undefined,
  })
  const { stats, isLoading: statsLoading } = useRepositoryStats()

  const statsData = useMemo(
    () => [
      {
        label: 'Total Repos',
        value: stats.totalRepos.toString(),
        color: 'text-accent-400',
        loading: statsLoading,
      },
      {
        label: 'Public Repos',
        value: stats.publicRepos.toString(),
        color: 'text-info-400',
        loading: statsLoading,
      },
      {
        label: 'Total Stars',
        value: stats.totalStars.toString(),
        color: 'text-warning-400',
        loading: statsLoading,
      },
      {
        label: 'Contributors',
        value: stats.contributors.toString(),
        color: 'text-success-400',
        loading: statsLoading,
      },
    ],
    [stats, statsLoading],
  )

  return (
    <div className="page-container">
      <PageHeader
        title="Repositories"
        icon={GitBranch}
        iconColor="text-accent-400"
        action={
          <Link to="/git/new" className="btn btn-primary">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New</span> Repo
          </Link>
        }
      />

      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Search repositories..."
      />

      <StatsGrid stats={statsData} columns={4} />

      {isLoading ? (
        <LoadingState text="Loading repositories..." />
      ) : error ? (
        <ErrorState title="Failed to load repositories" />
      ) : repositories.length === 0 ? (
        <EmptyState
          icon={GitBranch}
          title="No repositories found"
          description={
            search
              ? 'Try a different search term'
              : 'Create a repo to host your code'
          }
          actionLabel="New Repo"
          actionHref="/git/new"
        />
      ) : (
        <div className="space-y-4">
          {repositories.map((repo, index) => (
            <Link
              key={repo.id}
              to={`/git/${repo.owner}/${repo.name}`}
              className="card p-5 sm:p-6 card-hover block animate-slide-up"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
                    <h3 className="font-semibold text-surface-100">
                      {repo.fullName}
                    </h3>
                    {repo.isPrivate && (
                      <span className="flex items-center gap-1.5 text-surface-400 text-sm">
                        <Lock className="w-4 h-4" aria-hidden="true" />
                        Private
                      </span>
                    )}
                    {repo.isFork && (
                      <span className="flex items-center gap-1.5 text-surface-400 text-sm">
                        <GitFork className="w-4 h-4" aria-hidden="true" />
                        Fork
                      </span>
                    )}
                  </div>
                  <p className="text-surface-400 text-sm line-clamp-2 mb-3">
                    {repo.description ?? 'No description provided'}
                  </p>
                  <div className="flex flex-wrap items-center gap-4 text-sm text-surface-500">
                    {repo.language && (
                      <span className="flex items-center gap-1.5">
                        <span
                          className="w-3 h-3 rounded-full bg-info-400"
                          aria-hidden="true"
                        />
                        {repo.language}
                      </span>
                    )}
                    <span className="flex items-center gap-1.5">
                      <Star className="w-4 h-4" aria-hidden="true" />
                      {repo.stars}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <GitFork className="w-4 h-4" aria-hidden="true" />
                      {repo.forks}
                    </span>
                  </div>
                </div>
                <div className="text-left sm:text-right flex-shrink-0">
                  <p className="text-surface-500 text-sm">
                    Updated {formatRelativeTime(repo.updatedAt)}
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
