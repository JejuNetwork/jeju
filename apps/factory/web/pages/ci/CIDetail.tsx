import { clsx } from 'clsx'
import {
  ArrowLeft,
  CheckCircle,
  Clock,
  Copy,
  Download,
  GitBranch,
  GitCommit,
  Loader2,
  Play,
  RefreshCw,
  Square,
  Terminal,
  User,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button, EmptyState, LoadingState } from '../../components/shared'
import { type CIRun, type CIRunStatus, useCIRuns } from '../../hooks/useCI'
import { formatDuration, formatRelativeTime } from '../../lib/format'

type TabType = 'jobs' | 'logs' | 'artifacts'

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

function StatusIcon({
  status,
  size = 'md',
}: {
  status: CIRunStatus
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  }

  switch (status) {
    case 'success':
      return (
        <CheckCircle
          className={clsx(sizeClasses[size], 'text-success-400')}
          aria-hidden="true"
        />
      )
    case 'failure':
      return (
        <XCircle
          className={clsx(sizeClasses[size], 'text-error-400')}
          aria-hidden="true"
        />
      )
    case 'running':
      return (
        <Loader2
          className={clsx(sizeClasses[size], 'text-warning-400 animate-spin')}
          aria-hidden="true"
        />
      )
    case 'cancelled':
      return (
        <Square
          className={clsx(sizeClasses[size], 'text-surface-500')}
          aria-hidden="true"
        />
      )
    default:
      return (
        <Clock
          className={clsx(sizeClasses[size], 'text-surface-400')}
          aria-hidden="true"
        />
      )
  }
}

export function CIDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [activeTab, setActiveTab] = useState<TabType>('jobs')

  const { runs, isLoading, error, refetch } = useCIRuns()
  const run = runs.find((r) => r.id === id)

  const handleRerun = () => {
    toast.info('Rerun functionality coming soon')
  }

  const handleCancel = () => {
    toast.info('Cancel functionality coming soon')
  }

  const handleCopyCommit = () => {
    if (!run) return
    navigator.clipboard.writeText(run.commit)
    toast.success('Commit SHA copied')
  }

  if (isLoading) {
    return (
      <div className="page-container">
        <LoadingState text="Loading CI run..." />
      </div>
    )
  }

  if (error || !run) {
    return (
      <div className="page-container">
        <Link
          to="/ci"
          className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-100 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to CI/CD
        </Link>
        <EmptyState
          icon={Play}
          title="Run not found"
          description="The CI run you're looking for doesn't exist or has been deleted."
          actionLabel="Browse CI Runs"
          actionHref="/ci"
        />
      </div>
    )
  }

  const tabs = [
    { id: 'jobs' as const, label: 'Jobs', icon: Play, count: run.jobs.length },
    { id: 'logs' as const, label: 'Logs', icon: Terminal },
    { id: 'artifacts' as const, label: 'Artifacts', icon: Download },
  ]

  return (
    <div className="page-container">
      {/* Back link */}
      <Link
        to="/ci"
        className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-100 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to CI/CD
      </Link>

      {/* Header */}
      <div className="card p-6 mb-6 animate-in">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <StatusIcon status={run.status} size="lg" />
            <div>
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h1 className="text-2xl font-bold text-surface-100 font-display">
                  {run.workflow}
                </h1>
                <span className={clsx('badge', statusColors[run.status])}>
                  {statusLabels[run.status]}
                </span>
              </div>
              <p className="text-surface-400 mb-3">
                {run.commitMessage ?? 'No commit message'}
              </p>

              {/* Metadata */}
              <div className="flex flex-wrap items-center gap-4 text-sm text-surface-500">
                <span className="flex items-center gap-1.5">
                  <GitBranch className="w-4 h-4" />
                  {run.branch}
                </span>
                <button
                  type="button"
                  onClick={handleCopyCommit}
                  className="flex items-center gap-1.5 hover:text-surface-300 transition-colors"
                  title="Copy commit SHA"
                >
                  <GitCommit className="w-4 h-4" />
                  <span className="font-mono">{run.commit.slice(0, 7)}</span>
                  <Copy className="w-3 h-3" />
                </button>
                <span className="flex items-center gap-1.5">
                  <User className="w-4 h-4" />
                  {run.author}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4" />
                  {formatRelativeTime(run.startedAt)}
                </span>
              </div>
            </div>
          </div>

          {/* Actions & Duration */}
          <div className="flex flex-col items-end gap-3">
            <div className="text-right mb-2">
              <p className="text-3xl font-bold text-surface-100 font-display">
                {run.duration ? formatDuration(run.duration) : '-'}
              </p>
              <p className="text-sm text-surface-500">Duration</p>
            </div>

            <div className="flex gap-2">
              {run.status === 'running' && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Square}
                  onClick={handleCancel}
                >
                  Cancel
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                icon={RefreshCw}
                onClick={handleRerun}
              >
                Rerun
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={RefreshCw}
                onClick={() => refetch()}
              >
                Refresh
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-surface-800/50 mb-6">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab.id
                ? 'text-factory-400 border-factory-400'
                : 'text-surface-400 border-transparent hover:text-surface-100 hover:border-surface-600',
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {tab.count !== undefined && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-surface-800 text-surface-400">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'jobs' && <JobsTab run={run} />}
      {activeTab === 'logs' && <LogsTab run={run} />}
      {activeTab === 'artifacts' && <ArtifactsTab />}
    </div>
  )
}

interface JobsTabProps {
  run: CIRun
}

function JobsTab({ run }: JobsTabProps) {
  if (run.jobs.length === 0) {
    return (
      <div className="card p-8 animate-in text-center">
        <Play className="w-12 h-12 mx-auto mb-3 text-surface-600" />
        <h3 className="text-lg font-semibold text-surface-200 mb-2">No Jobs</h3>
        <p className="text-surface-500">This workflow run has no jobs yet.</p>
      </div>
    )
  }

  return (
    <div className="card overflow-hidden animate-in">
      <div className="divide-y divide-surface-800/50">
        {run.jobs.map((job, idx) => (
          <div
            key={job.name}
            className="flex items-center gap-4 px-4 py-4 animate-slide-up"
            style={{ animationDelay: `${idx * 30}ms` }}
          >
            <StatusIcon status={job.status as CIRunStatus} />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-surface-200">{job.name}</p>
            </div>
            <div className="text-right">
              <p className="text-surface-300 font-medium">
                {job.duration ? formatDuration(job.duration) : '-'}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

interface LogsTabProps {
  run: CIRun
}

function LogsTab({ run }: LogsTabProps) {
  // Simulated log output
  const sampleLogs = `[2024-01-15T10:30:00Z] Starting workflow: ${run.workflow}
[2024-01-15T10:30:01Z] Checking out repository...
[2024-01-15T10:30:05Z] Installing dependencies...
[2024-01-15T10:30:30Z] Running tests...
[2024-01-15T10:31:00Z] Building project...
[2024-01-15T10:31:30Z] ${run.status === 'success' ? 'Build completed successfully' : run.status === 'failure' ? 'Build failed with errors' : 'Build in progress...'}`

  return (
    <div className="card p-6 animate-in">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-surface-100 flex items-center gap-2">
          <Terminal className="w-4 h-4 text-surface-400" />
          Build Logs
        </h3>
        <Button
          variant="ghost"
          size="sm"
          icon={Download}
          onClick={() => toast.info('Log download coming soon')}
        >
          Download
        </Button>
      </div>
      <div className="bg-surface-950 rounded-lg p-4 font-mono text-sm overflow-x-auto">
        <pre className="text-surface-300 whitespace-pre-wrap">{sampleLogs}</pre>
      </div>
      <p className="text-xs text-surface-500 mt-3">
        Full log streaming coming soon
      </p>
    </div>
  )
}

function ArtifactsTab() {
  return (
    <div className="card p-8 animate-in text-center">
      <Download className="w-12 h-12 mx-auto mb-3 text-surface-600" />
      <h3 className="text-lg font-semibold text-surface-200 mb-2">
        Build Artifacts
      </h3>
      <p className="text-surface-500">
        Artifact storage and download coming soon.
      </p>
    </div>
  )
}
