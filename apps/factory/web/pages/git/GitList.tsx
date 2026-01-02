import { clsx } from 'clsx'
import { GitBranch, GitFork, Lock, Plus, Star } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Pagination,
  SearchBar,
  StatsGrid,
} from '../../components/shared'
import { useRepositories, useRepositoryStats } from '../../hooks/useGit'
import { formatRelativeTime } from '../../lib/format'

const languageColors: Record<string, string> = {
  TypeScript: 'bg-blue-500',
  JavaScript: 'bg-yellow-500',
  Python: 'bg-green-500',
  Rust: 'bg-orange-500',
  Go: 'bg-cyan-500',
  Solidity: 'bg-purple-500',
}

const ITEMS_PER_PAGE = 10

export function GitListPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { repositories, isLoading, error } = useRepositories()
  const { stats, isLoading: statsLoading } = useRepositoryStats()

  const filteredRepos = useMemo(() => {
    return repositories.filter((repo) => {
      if (!search) return true
      const searchLower = search.toLowerCase()
      return (
        repo.name.toLowerCase().includes(searchLower) ||
        repo.description.toLowerCase().includes(searchLower) ||
        repo.owner.toLowerCase().includes(searchLower)
      )
    })
  }, [repositories, search])

  const totalPages = Math.ceil(filteredRepos.length / ITEMS_PER_PAGE)
  const paginatedRepos = filteredRepos.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE,
  )

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const statsData = [
    {
      label: 'Total Repos',
      value: stats.totalRepos.toString(),
      color: 'text-info-400',
      loading: statsLoading,
    },
    {
      label: 'Public',
      value: stats.publicRepos.toString(),
      color: 'text-success-400',
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
      color: 'text-accent-400',
      loading: statsLoading,
    },
  ]

  return (
    <div className="page-container">
      <PageHeader
        title="Repositories"
        icon={GitBranch}
        iconColor="text-info-400"
        action={
          <Link to="/git/new" className="btn btn-primary">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New</span> Repository
          </Link>
        }
      />

      <div className="card p-3 sm:p-4 mb-6 animate-in">
        <SearchBar
          value={search}
          onChange={handleSearchChange}
          placeholder="Search repositories..."
          className="mb-0 p-0 border-0 bg-transparent shadow-none"
        />
      </div>

      <StatsGrid stats={statsData} columns={4} />

      {isLoading ? (
        <LoadingState text="Loading repositories..." />
      ) : error ? (
        <ErrorState title="Failed to load repositories" />
      ) : filteredRepos.length === 0 ? (
        <EmptyState
          icon={GitBranch}
          title="No repositories found"
          description={
            search
              ? 'Try a different search term'
              : 'Create your first repository to get started'
          }
          actionLabel="New Repository"
          actionHref="/git/new"
        />
      ) : (
        <>
          <div className="space-y-4">
            {paginatedRepos.map((repo, index) => (
              <Link
                key={repo.id}
                to={`/git/${repo.owner}/${repo.name}`}
                className="card p-5 sm:p-6 card-hover block animate-slide-up"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
                      <h3 className="font-semibold text-factory-400 hover:underline">
                        {repo.fullName}
                      </h3>
                      {repo.isPrivate && (
                        <span className="badge badge-warning flex items-center gap-1">
                          <Lock className="w-3 h-3" />
                          Private
                        </span>
                      )}
                      {repo.isFork && (
                        <span className="badge badge-info flex items-center gap-1">
                          <GitFork className="w-3 h-3" />
                          Fork
                        </span>
                      )}
                    </div>

                    <p className="text-surface-400 text-sm mb-4 line-clamp-2">
                      {repo.description || 'No description provided'}
                    </p>

                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      {repo.language && (
                        <span className="flex items-center gap-1.5 text-surface-300">
                          <span
                            className={clsx(
                              'w-3 h-3 rounded-full',
                              languageColors[repo.language] || 'bg-surface-500',
                            )}
                          />
                          {repo.language}
                        </span>
                      )}
                      <span className="flex items-center gap-1.5 text-surface-500">
                        <Star className="w-4 h-4" />
                        {repo.stars}
                      </span>
                      <span className="flex items-center gap-1.5 text-surface-500">
                        <GitFork className="w-4 h-4" />
                        {repo.forks}
                      </span>
                      <span className="text-surface-500">
                        Updated {formatRelativeTime(repo.updatedAt)}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <Pagination
            currentPage={page}
            totalPages={totalPages}
            onPageChange={setPage}
            className="mt-8"
          />
        </>
      )}
    </div>
  )
}
