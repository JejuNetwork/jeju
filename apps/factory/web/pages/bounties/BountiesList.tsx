import { clsx } from 'clsx'
import { Clock, DollarSign, Plus, Tag, Users } from 'lucide-react'
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
import { useBounties, useBountyStats } from '../../hooks/useBounties'
import { formatDeadline } from '../../lib/format'

type BountyStatusFilter =
  | 'open'
  | 'in_progress'
  | 'review'
  | 'completed'
  | 'all'
type SortOption = 'reward' | 'deadline' | 'applicants'

const statusColors: Record<string, string> = {
  open: 'badge-success',
  in_progress: 'badge-warning',
  review: 'badge-info',
  completed: 'badge-neutral',
  cancelled: 'badge-error',
}

const statusLabels: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  review: 'In Review',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const statusFilters = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'review', label: 'In Review' },
  { value: 'completed', label: 'Completed' },
]

const ITEMS_PER_PAGE = 10

export function BountiesListPage() {
  const [filter, setFilter] = useState<BountyStatusFilter>('all')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('reward')
  const [page, setPage] = useState(1)

  const { bounties, isLoading, error } = useBounties(
    filter !== 'all' ? { status: filter } : undefined,
  )
  const { stats, isLoading: statsLoading } = useBountyStats()

  const filteredBounties = useMemo(() => {
    return bounties
      .filter((bounty) => {
        if (!search) return true
        return bounty.title.toLowerCase().includes(search.toLowerCase())
      })
      .sort((a, b) => {
        if (sortBy === 'reward') {
          const aAmount = Number.parseFloat(a.rewards[0]?.amount ?? '0')
          const bAmount = Number.parseFloat(b.rewards[0]?.amount ?? '0')
          return bAmount - aAmount
        }
        if (sortBy === 'deadline') {
          return a.deadline - b.deadline
        }
        return b.applicants - a.applicants
      })
  }, [bounties, search, sortBy])

  const totalPages = Math.ceil(filteredBounties.length / ITEMS_PER_PAGE)
  const paginatedBounties = filteredBounties.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE,
  )

  const handleSortChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value
      if (
        value === 'reward' ||
        value === 'deadline' ||
        value === 'applicants'
      ) {
        setSortBy(value)
        setPage(1)
      }
    },
    [],
  )

  const handleFilterChange = useCallback((status: BountyStatusFilter) => {
    setFilter(status)
    setPage(1)
  }, [])

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const statsData = [
    {
      label: 'Open Bounties',
      value: stats.openBounties.toString(),
      color: 'text-success-400',
      loading: statsLoading,
    },
    {
      label: 'Total Value',
      value: stats.totalValue,
      color: 'text-warning-400',
      loading: statsLoading,
    },
    {
      label: 'Completed',
      value: stats.completed.toString(),
      color: 'text-info-400',
      loading: statsLoading,
    },
    {
      label: 'Avg. Payout',
      value: stats.avgPayout,
      color: 'text-accent-400',
      loading: statsLoading,
    },
  ]

  return (
    <div className="page-container">
      <PageHeader
        title="Bounties"
        icon={DollarSign}
        iconColor="text-success-400"
        action={
          <Link to="/bounties/create" className="btn btn-primary">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Create</span> Bounty
          </Link>
        }
      />

      <div
        className="relative bg-gradient-to-br from-surface-800/90 to-surface-900/95 border border-surface-700/60 p-3 sm:p-4 mb-6 animate-in"
        style={{
          clipPath:
            'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px))',
        }}
      >
        {/* Corner accents */}
        <div className="absolute top-0 right-0 w-3 h-3 bg-gradient-to-bl from-factory-500/50 to-transparent" />
        <div className="absolute bottom-0 left-0 w-3 h-3 bg-gradient-to-tr from-factory-500/50 to-transparent" />

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
          <SearchBar
            value={search}
            onChange={handleSearchChange}
            placeholder="Search bounties..."
            className="flex-1 mb-0 p-0 border-0 bg-transparent shadow-none [clip-path:none]"
          />

          <fieldset
            className="flex flex-wrap gap-2 border-0"
            aria-label="Status filters"
          >
            {statusFilters.map((status) => (
              <button
                key={status.value}
                type="button"
                onClick={() =>
                  handleFilterChange(status.value as BountyStatusFilter)
                }
                className={clsx(
                  'px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-all',
                  filter === status.value
                    ? 'bg-factory-500 text-white shadow-glow'
                    : 'bg-surface-800 text-surface-400 hover:text-surface-100 hover:bg-surface-700 border border-surface-600 hover:border-factory-500',
                )}
                style={{
                  clipPath:
                    'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)',
                }}
                aria-pressed={filter === status.value}
              >
                {status.label}
              </button>
            ))}
          </fieldset>

          <select
            value={sortBy}
            onChange={handleSortChange}
            className="input w-full sm:w-auto uppercase text-xs tracking-wider"
            aria-label="Sort bounties by"
          >
            <option value="reward">Highest Reward</option>
            <option value="deadline">Ending Soon</option>
            <option value="applicants">Most Applicants</option>
          </select>
        </div>
      </div>

      <StatsGrid stats={statsData} columns={4} />

      {isLoading ? (
        <LoadingState text="Loading bounties..." />
      ) : error ? (
        <ErrorState title="Failed to load bounties" />
      ) : filteredBounties.length === 0 ? (
        <EmptyState
          icon={DollarSign}
          title="No bounties found"
          description={
            search
              ? 'Try a different search term'
              : 'Create a bounty to fund open-source work'
          }
          actionLabel="Create Bounty"
          actionHref="/bounties/create"
        />
      ) : (
        <>
          <div className="space-y-4">
            {paginatedBounties.map((bounty, index) => (
              <Link
                key={bounty.id}
                to={`/bounties/${bounty.id}`}
                className="relative block bg-gradient-to-br from-surface-800/90 to-surface-900/95 border border-surface-700/60 p-5 sm:p-6 transition-all hover:border-factory-500/40 hover:shadow-[0_0_30px_rgba(6,182,212,0.15)] animate-slide-up group"
                style={{
                  animationDelay: `${index * 50}ms`,
                  clipPath:
                    'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px))',
                }}
              >
                {/* Corner accents */}
                <div className="absolute top-0 right-0 w-3 h-3 bg-gradient-to-bl from-factory-500/40 to-transparent group-hover:from-factory-500/70 transition-all" />
                <div className="absolute bottom-0 left-0 w-3 h-3 bg-gradient-to-tr from-factory-500/40 to-transparent group-hover:from-factory-500/70 transition-all" />

                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
                      <h3 className="font-bold text-surface-100 truncate uppercase tracking-wide">
                        {bounty.title}
                      </h3>
                      <span
                        className={clsx('badge', statusColors[bounty.status])}
                      >
                        {statusLabels[bounty.status]}
                      </span>
                    </div>
                    <p className="text-surface-400 text-sm mb-4 line-clamp-2">
                      {bounty.description}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-sm">
                      <div className="flex flex-wrap gap-2">
                        {bounty.skills.map((skill) => (
                          <span key={skill} className="badge badge-info">
                            {skill}
                          </span>
                        ))}
                      </div>
                      <span className="flex items-center gap-1.5 text-surface-500 text-xs uppercase tracking-wider">
                        <Clock className="w-4 h-4" aria-hidden="true" />
                        {formatDeadline(bounty.deadline)}
                      </span>
                      <span className="flex items-center gap-1.5 text-surface-500 text-xs uppercase tracking-wider">
                        <Users className="w-4 h-4" aria-hidden="true" />
                        {bounty.applicants} applicants
                      </span>
                      <span className="flex items-center gap-1.5 text-surface-500 text-xs uppercase tracking-wider">
                        <Tag className="w-4 h-4" aria-hidden="true" />
                        {bounty.milestones} milestones
                      </span>
                    </div>
                  </div>
                  <div className="text-left sm:text-right flex-shrink-0">
                    <div className="space-y-1">
                      {bounty.rewards.map((reward, idx) => (
                        <p
                          key={`${reward.token}-${reward.amount}`}
                          className={clsx(
                            'font-bold font-display tracking-wide',
                            idx === 0
                              ? 'text-xl text-success-400'
                              : 'text-sm text-surface-400',
                          )}
                        >
                          {reward.amount} {reward.token}
                        </p>
                      ))}
                    </div>
                    <p className="text-surface-500 text-xs mt-1 uppercase tracking-widest">
                      Reward
                    </p>
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
