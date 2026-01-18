import { clsx } from 'clsx'
import { Briefcase, Building2, Clock, Globe, MapPin, Plus } from 'lucide-react'
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
import { useJobStats, useJobs } from '../../hooks/useJobs'
import { formatCurrency, formatRelativeTime } from '../../lib/format'

type JobTypeFilter = 'all' | 'full-time' | 'part-time' | 'contract' | 'bounty'

const typeFilters = [
  { value: 'all', label: 'All Types' },
  { value: 'full-time', label: 'Full-time' },
  { value: 'part-time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'bounty', label: 'Bounty' },
]

const typeColors: Record<string, string> = {
  'full-time': 'badge-success',
  'part-time': 'badge-info',
  contract: 'badge-warning',
  bounty: 'badge-accent',
}

const ITEMS_PER_PAGE = 10

export function JobsListPage() {
  const [typeFilter, setTypeFilter] = useState<JobTypeFilter>('all')
  const [remoteOnly, setRemoteOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { jobs, isLoading, error } = useJobs({
    type: typeFilter !== 'all' ? typeFilter : undefined,
    remote: remoteOnly ? true : undefined,
  })
  const { stats, isLoading: statsLoading } = useJobStats()

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      if (!search) return true
      const searchLower = search.toLowerCase()
      return (
        job.title.toLowerCase().includes(searchLower) ||
        job.company.toLowerCase().includes(searchLower)
      )
    })
  }, [jobs, search])

  const totalPages = Math.ceil(filteredJobs.length / ITEMS_PER_PAGE)
  const paginatedJobs = filteredJobs.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE,
  )

  const handleTypeChange = useCallback((type: JobTypeFilter) => {
    setTypeFilter(type)
    setPage(1)
  }, [])

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const statsData = [
    {
      label: 'Open Jobs',
      value: stats.openJobs.toString(),
      color: 'text-success-400',
      loading: statsLoading,
    },
    {
      label: 'Total Jobs',
      value: stats.totalJobs.toString(),
      color: 'text-info-400',
      loading: statsLoading,
    },
    {
      label: 'Remote',
      value: stats.remoteJobs.toString(),
      color: 'text-accent-400',
      loading: statsLoading,
    },
    {
      label: 'Avg. Salary',
      value:
        stats.averageSalary > 0 ? formatCurrency(stats.averageSalary) : 'N/A',
      color: 'text-warning-400',
      loading: statsLoading,
    },
  ]

  return (
    <div className="page-container">
      <PageHeader
        title="Jobs"
        icon={Briefcase}
        iconColor="text-info-400"
        action={
          <Link to="/jobs/create" className="btn btn-primary">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Post</span> Job
          </Link>
        }
      />

      <div className="card p-3 sm:p-4 mb-6 animate-in">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
          <SearchBar
            value={search}
            onChange={handleSearchChange}
            placeholder="Search jobs..."
            className="flex-1 mb-0 p-0 border-0 bg-transparent shadow-none"
          />

          <fieldset
            className="flex flex-wrap gap-2 border-0"
            aria-label="Job type filters"
          >
            {typeFilters.map((type) => (
              <button
                key={type.value}
                type="button"
                onClick={() => handleTypeChange(type.value as JobTypeFilter)}
                className={clsx(
                  'px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  typeFilter === type.value
                    ? 'bg-factory-500 text-white shadow-glow'
                    : 'bg-surface-800 text-surface-400 hover:text-surface-100 hover:bg-surface-700',
                )}
                aria-pressed={typeFilter === type.value}
              >
                {type.label}
              </button>
            ))}
          </fieldset>

          <button
            type="button"
            onClick={() => {
              setRemoteOnly(!remoteOnly)
              setPage(1)
            }}
            className={clsx(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              remoteOnly
                ? 'bg-accent-500 text-white'
                : 'bg-surface-800 text-surface-400 hover:text-surface-100 hover:bg-surface-700',
            )}
          >
            <Globe className="w-4 h-4" />
            Remote Only
          </button>
        </div>
      </div>

      <StatsGrid stats={statsData} columns={4} />

      {isLoading ? (
        <LoadingState text="Loading jobs..." />
      ) : error ? (
        <ErrorState title="Failed to load jobs" />
      ) : filteredJobs.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No jobs found"
          description={
            search
              ? 'Try a different search term'
              : 'Be the first to post a job in the network'
          }
          actionLabel="Post Job"
          actionHref="/jobs/create"
        />
      ) : (
        <>
          <div className="space-y-4">
            {paginatedJobs.map((job, index) => (
              <Link
                key={job.id}
                to={`/jobs/${job.id}`}
                className="card p-5 sm:p-6 card-hover block animate-slide-up"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-surface-800 flex items-center justify-center flex-shrink-0">
                    {job.companyLogo ? (
                      <img
                        src={job.companyLogo}
                        alt={job.company}
                        className="w-10 h-10 rounded-lg object-cover"
                      />
                    ) : (
                      <Building2 className="w-6 h-6 text-surface-500" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-1">
                      <h3 className="font-semibold text-surface-100 truncate">
                        {job.title}
                      </h3>
                      <span className={clsx('badge', typeColors[job.type])}>
                        {job.type.replace('-', ' ')}
                      </span>
                      {job.remote && (
                        <span className="badge badge-info">
                          <Globe className="w-3 h-3 mr-1" />
                          Remote
                        </span>
                      )}
                    </div>

                    <p className="text-surface-300 text-sm mb-2">
                      {job.company}
                    </p>

                    <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-sm text-surface-500">
                      <span className="flex items-center gap-1.5">
                        <MapPin className="w-4 h-4" />
                        {job.location}
                      </span>
                      {job.salary && (
                        <span className="text-success-400 font-medium">
                          {formatCurrency(job.salary.min)} -{' '}
                          {formatCurrency(job.salary.max)}
                        </span>
                      )}
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-4 h-4" />
                        {formatRelativeTime(job.createdAt)}
                      </span>
                    </div>

                    {job.skills.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {job.skills.slice(0, 4).map((skill) => (
                          <span key={skill} className="badge badge-neutral">
                            {skill}
                          </span>
                        ))}
                        {job.skills.length > 4 && (
                          <span className="badge badge-neutral">
                            +{job.skills.length - 4}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="text-left sm:text-right flex-shrink-0">
                    <p className="text-surface-500 text-sm">
                      {job.applications} applications
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
