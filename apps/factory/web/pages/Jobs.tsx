import { clsx } from 'clsx'
import { Briefcase, Building2, MapPin, Plus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SearchBar,
  StatsGrid,
} from '../components/shared'
import { type Job, useJobStats, useJobs } from '../hooks/useJobs'

const typeLabels: Record<Job['type'], string> = {
  'full-time': 'Full-time',
  'part-time': 'Part-time',
  contract: 'Contract',
  bounty: 'Bounty',
}

const typeFilters = [
  { value: 'all', label: 'All' },
  { value: 'full-time', label: 'Full-time' },
  { value: 'part-time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'bounty', label: 'Bounty' },
]

export function JobsPage() {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<Job['type'] | 'all'>('all')
  const [remoteOnly, setRemoteOnly] = useState(false)

  const { jobs, isLoading, error } = useJobs({
    type: typeFilter !== 'all' ? typeFilter : undefined,
    remote: remoteOnly || undefined,
    search: search || undefined,
  })
  const { stats, isLoading: statsLoading } = useJobStats()

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      if (!search) return true
      return job.title.toLowerCase().includes(search.toLowerCase())
    })
  }, [jobs, search])

  const formatSalary = useCallback((job: Job) => {
    if (!job.salary) return 'Competitive'
    const { min, max, currency, period } = job.salary
    const periodLabel = period ? `/${period}` : ''
    if (min === max) return `${currency}${min.toLocaleString()}${periodLabel}`
    return `${currency}${min.toLocaleString()} - ${currency}${max.toLocaleString()}${periodLabel}`
  }, [])

  const statsData = [
    {
      label: 'Total Jobs',
      value: stats.totalJobs.toString(),
      color: 'text-info-400',
      loading: statsLoading,
    },
    {
      label: 'Open Positions',
      value: stats.openJobs.toString(),
      color: 'text-success-400',
      loading: statsLoading,
    },
    {
      label: 'Remote Jobs',
      value: stats.remoteJobs.toString(),
      color: 'text-accent-400',
      loading: statsLoading,
    },
    {
      label: 'Avg. Salary',
      value:
        stats.averageSalary > 0
          ? `$${stats.averageSalary.toLocaleString()}`
          : '-',
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
            onChange={setSearch}
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
                onClick={() => setTypeFilter(type.value as Job['type'] | 'all')}
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

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remoteOnly}
              onChange={(e) => setRemoteOnly(e.target.checked)}
              className="w-4 h-4 rounded border-surface-600 bg-surface-800 text-factory-500 focus:ring-factory-500 focus:ring-offset-surface-900"
            />
            <span className="text-surface-300 text-sm">Remote only</span>
          </label>
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
              : 'Post a job listing to find talent'
          }
          actionLabel="Post Job"
          actionHref="/jobs/create"
        />
      ) : (
        <div className="space-y-4">
          {filteredJobs.map((job, index) => (
            <Link
              key={job.id}
              to={`/jobs/${job.id}`}
              className="card p-5 sm:p-6 card-hover block animate-slide-up"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
                    <h3 className="font-semibold text-surface-100 truncate">
                      {job.title}
                    </h3>
                    <span className="badge badge-info">
                      {typeLabels[job.type]}
                    </span>
                    {job.remote && (
                      <span className="badge badge-success">Remote</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-sm text-surface-400 mb-3">
                    <span className="flex items-center gap-1.5">
                      <Building2 className="w-4 h-4" aria-hidden="true" />
                      {job.company}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <MapPin className="w-4 h-4" aria-hidden="true" />
                      {job.location}
                    </span>
                  </div>
                  <p className="text-surface-400 text-sm line-clamp-2 mb-3">
                    {job.description}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {job.skills.slice(0, 5).map((skill) => (
                      <span key={skill} className="badge badge-neutral">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-left sm:text-right flex-shrink-0">
                  <p className="text-xl font-bold text-success-400 font-display">
                    {formatSalary(job)}
                  </p>
                  <p className="text-surface-500 text-sm mt-1">
                    {job.applications} applications
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
