import { clsx } from 'clsx'
import {
  CheckCircle,
  Clock,
  GitBranch,
  Loader2,
  Play,
  Plus,
  Search,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { type CIRunStatus, useCIRuns, useCIStats } from '../hooks/useCI'

const statusColors: Record<CIRunStatus, string> = {
  queued: 'bg-factory-700/50 text-factory-300',
  running: 'badge-warning',
  success: 'badge-success',
  failure: 'bg-red-500/20 text-red-400',
  cancelled: 'bg-factory-700/50 text-factory-300',
}

const statusLabels: Record<CIRunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  success: 'Success',
  failure: 'Failed',
  cancelled: 'Cancelled',
}

const StatusIcon = ({ status }: { status: CIRunStatus }) => {
  switch (status) {
    case 'success':
      return <CheckCircle className="w-4 h-4 text-green-400" />
    case 'failure':
      return <XCircle className="w-4 h-4 text-red-400" />
    case 'running':
      return <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
    default:
      return <Clock className="w-4 h-4 text-factory-400" />
  }
}

export function CIPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<CIRunStatus | 'all'>('all')

  const { runs, isLoading, error } = useCIRuns(
    statusFilter !== 'all' ? { status: statusFilter } : undefined,
  )
  const { stats, isLoading: statsLoading } = useCIStats()

  const filteredRuns = runs.filter((run) => {
    if (search) {
      const searchLower = search.toLowerCase()
      return (
        run.workflow.toLowerCase().includes(searchLower) ||
        run.branch.toLowerCase().includes(searchLower) ||
        run.commitMessage.toLowerCase().includes(searchLower)
      )
    }
    return true
  })

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '-'
    if (seconds < 60) return `${seconds}s`
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}m ${secs}s`
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMins = Math.floor((now.getTime() - date.getTime()) / (1000 * 60))
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`
    return date.toLocaleDateString()
  }

  return (
    <div className="min-h-screen p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Play className="w-7 h-7 text-green-400" />
            CI/CD
          </h1>
          <p className="text-factory-400 mt-1">
            Continuous integration and deployment
          </p>
        </div>
        <Link to="/ci/new" className="btn btn-primary">
          <Plus className="w-4 h-4" />
          New Workflow
        </Link>
      </div>

      <div className="card p-4 mb-6">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
            <input
              type="text"
              placeholder="Search workflows..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>

          <div className="flex gap-2">
            {(['all', 'running', 'success', 'failure', 'queued'] as const).map(
              (status) => (
                <button
                  type="button"
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={clsx(
                    'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                    statusFilter === status
                      ? 'bg-accent-600 text-white'
                      : 'bg-factory-800 text-factory-400 hover:text-factory-100',
                  )}
                >
                  {status === 'all' ? 'All' : statusLabels[status]}
                </button>
              ),
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          {
            label: 'Total Runs',
            value: stats.total.toString(),
            color: 'text-blue-400',
          },
          {
            label: 'Running',
            value: stats.running.toString(),
            color: 'text-amber-400',
          },
          {
            label: 'Successful',
            value: stats.success.toString(),
            color: 'text-green-400',
          },
          {
            label: 'Failed',
            value: stats.failed.toString(),
            color: 'text-red-400',
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
          <Play className="w-12 h-12 mx-auto mb-4 text-red-400" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">
            Failed to load CI runs
          </h3>
          <p className="text-factory-500">Please try again later</p>
        </div>
      ) : filteredRuns.length === 0 ? (
        <div className="card p-12 text-center">
          <Play className="w-12 h-12 mx-auto mb-4 text-factory-600" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">
            No workflow runs found
          </h3>
          <p className="text-factory-500 mb-4">
            {search
              ? 'Try adjusting your search terms'
              : 'Trigger your first workflow'}
          </p>
          <Link to="/ci/new" className="btn btn-primary">
            New Workflow
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredRuns.map((run) => (
            <Link
              key={run.id}
              to={`/ci/${run.id}`}
              className="card p-6 card-hover block"
            >
              <div className="flex items-start justify-between gap-6">
                <div className="flex items-start gap-4">
                  <StatusIcon status={run.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold text-factory-100">
                        {run.workflow}
                      </h3>
                      <span className={clsx('badge', statusColors[run.status])}>
                        {statusLabels[run.status]}
                      </span>
                    </div>
                    <p className="text-factory-400 text-sm mb-2 truncate">
                      {run.commitMessage ?? 'No commit message'}
                    </p>
                    <div className="flex items-center gap-4 text-sm text-factory-500">
                      <span className="flex items-center gap-1">
                        <GitBranch className="w-4 h-4" />
                        {run.branch}
                      </span>
                      <span className="font-mono text-xs">
                        {run.commit.slice(0, 7)}
                      </span>
                      <span>{run.author}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-factory-300 font-medium">
                    {formatDuration(run.duration)}
                  </p>
                  <p className="text-factory-500 text-sm">
                    {formatTime(run.startedAt)}
                  </p>
                </div>
              </div>

              {run.jobs.length > 0 && (
                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-factory-800">
                  {run.jobs.map((job) => (
                    <span
                      key={job.name}
                      className={clsx(
                        'px-2 py-1 rounded text-xs',
                        job.status === 'success' &&
                          'bg-green-500/20 text-green-400',
                        job.status === 'failure' &&
                          'bg-red-500/20 text-red-400',
                        job.status === 'running' &&
                          'bg-amber-500/20 text-amber-400',
                        !['success', 'failure', 'running'].includes(
                          job.status,
                        ) && 'bg-factory-800 text-factory-400',
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
