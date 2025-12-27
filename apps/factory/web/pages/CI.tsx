/**
 * CI/CD Page
 *
 * Browse and filter CI runs with responsive design.
 */

import { clsx } from 'clsx'
import { CheckCircle, Clock, GitBranch, Loader2, Play, Plus, XCircle } from 'lucide-react'
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
import { type CIRunStatus, useCIRuns, useCIStats } from '../hooks/useCI'
import { formatDuration, formatRelativeTime } from '../lib/format'

const statusColors: Record<CIRunStatus, string> = {
  queued: 'badge-neutral',
  running: 'badge-warning',
  success: 'badge-success',
  failure: 'badge-error',
  cancelled: 'badge-neutral',
}

const statusLabels: Record<CIRunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  success: 'Success',
  failure: 'Failed',
  cancelled: 'Cancelled',
}

const statusFilters = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'success', label: 'Success' },
  { value: 'failure', label: 'Failed' },
  { value: 'queued', label: 'Queued' },
]

function StatusIcon({ status }: { status: CIRunStatus }) {
  switch (status) {
    case 'success':
      return <CheckCircle className="w-5 h-5 text-success-400" aria-hidden="true" />
    case 'failure':
      return <XCircle className="w-5 h-5 text-error-400" aria-hidden="true" />
    case 'running':
      return <Loader2 className="w-5 h-5 text-warning-400 animate-spin" aria-hidden="true" />
    default:
      return <Clock className="w-5 h-5 text-surface-400" aria-hidden="true" />
  }
}

export function CIPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<CIRunStatus | 'all'>('all')

  const { runs, isLoading, error } = useCIRuns(
    statusFilter !== 'all' ? { status: statusFilter } : undefined,
  )
  const { stats, isLoading: statsLoading } = useCIStats()

  const filteredRuns = useMemo(() => {
    return runs.filter((run) => {
      if (!search) return true
      const searchLower = search.toLowerCase()
      return (
        run.workflow.toLowerCase().includes(searchLower) ||
        run.branch.toLowerCase().includes(searchLower) ||
        run.commitMessage.toLowerCase().includes(searchLower)
      )
    })
  }, [runs, search])

  const statsData = useMemo(() => [
    { label: 'Total Runs', value: stats.total.toString(), color: 'text-info-400', loading: statsLoading },
    { label: 'Running', value: stats.running.toString(), color: 'text-warning-400', loading: statsLoading },
    { label: 'Successful', value: stats.success.toString(), color: 'text-success-400', loading: statsLoading },
    { label: 'Failed', value: stats.failed.toString(), color: 'text-error-400', loading: statsLoading },
  ], [stats, statsLoading])

  return (
    <div className="page-container">
      <PageHeader
        title="CI/CD"
        description="Automated builds, tests, and deployments"
        icon={Play}
        iconColor="text-success-400"
        action={
          <Link to="/ci/new" className="btn btn-primary">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New</span> Workflow
          </Link>
        }
      />

      <div className="card p-3 sm:p-4 mb-6 animate-in">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search workflows..."
            className="flex-1 mb-0 p-0 border-0 bg-transparent shadow-none"
          />

          <div className="flex flex-wrap gap-2" role="group" aria-label="Status filters">
            {statusFilters.map((status) => (
              <button
                key={status.value}
                type="button"
                onClick={() => setStatusFilter(status.value as CIRunStatus | 'all')}
                className={clsx(
                  'px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  statusFilter === status.value
                    ? 'bg-factory-500 text-white shadow-glow'
                    : 'bg-surface-800 text-surface-400 hover:text-surface-100 hover:bg-surface-700',
                )}
                aria-pressed={statusFilter === status.value}
              >
                {status.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <StatsGrid stats={statsData} columns={4} />

      {isLoading ? (
        <LoadingState text="Loading CI runs..." />
      ) : error ? (
        <ErrorState title="Failed to load CI runs" />
      ) : filteredRuns.length === 0 ? (
        <EmptyState
          icon={Play}
          title="No workflow runs found"
          description={search ? 'Try a different search term' : 'Create a workflow to automate your builds'}
          actionLabel="New Workflow"
          actionHref="/ci/new"
        />
      ) : (
        <div className="space-y-4">
          {filteredRuns.map((run, index) => (
            <Link
              key={run.id}
              to={`/ci/${run.id}`}
              className="card p-5 sm:p-6 card-hover block animate-slide-up"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <StatusIcon status={run.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
                      <h3 className="font-semibold text-surface-100">{run.workflow}</h3>
                      <span className={clsx('badge', statusColors[run.status])}>
                        {statusLabels[run.status]}
                      </span>
                    </div>
                    <p className="text-surface-400 text-sm mb-2 truncate">
                      {run.commitMessage ?? 'No commit message'}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-sm text-surface-500">
                      <span className="flex items-center gap-1.5">
                        <GitBranch className="w-4 h-4" aria-hidden="true" />
                        {run.branch}
                      </span>
                      <span className="font-mono text-xs">{run.commit.slice(0, 7)}</span>
                      <span>{run.author}</span>
                    </div>
                  </div>
                </div>
                <div className="text-left sm:text-right flex-shrink-0">
                  <p className="text-surface-300 font-medium font-display">
                    {run.duration ? formatDuration(run.duration) : '-'}
                  </p>
                  <p className="text-surface-500 text-sm">
                    {formatRelativeTime(run.startedAt)}
                  </p>
                </div>
              </div>

              {run.jobs.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-surface-800/50">
                  {run.jobs.map((job) => (
                    <span
                      key={job.name}
                      className={clsx(
                        'px-2 py-1 rounded text-xs',
                        job.status === 'success' && 'bg-success-500/20 text-success-400',
                        job.status === 'failure' && 'bg-error-500/20 text-error-400',
                        job.status === 'running' && 'bg-warning-500/20 text-warning-400',
                        !['success', 'failure', 'running'].includes(job.status) && 'bg-surface-800 text-surface-400',
                      )}
                    >
                      {job.name}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
