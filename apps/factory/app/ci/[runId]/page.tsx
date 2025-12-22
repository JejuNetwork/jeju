/**
 * Build Detail Page with Real-time Logs
 */

'use client'

import { clsx } from 'clsx'
import { format, formatDistanceToNow } from 'date-fns'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  GitBranch,
  GitCommit,
  Loader2,
  Package,
  RefreshCw,
  Server,
  StopCircle,
  Terminal,
  User,
  XCircle,
} from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  useArtifacts,
  useCIActions,
  useRunLogs,
  useWorkflowRun,
} from '@/lib/hooks/useCI'

// Remove DWS_API_URL unused constant
// const DWS_API_URL = process.env.NEXT_PUBLIC_DWS_URL || 'http://localhost:4030';

const statusConfig = {
  queued: {
    icon: Clock,
    color: 'text-neutral-400',
    bg: 'bg-neutral-500/20',
    animate: false,
  },
  in_progress: {
    icon: Loader2,
    color: 'text-blue-400',
    bg: 'bg-blue-500/20',
    animate: true,
  },
  completed: {
    icon: CheckCircle,
    color: 'text-green-400',
    bg: 'bg-green-500/20',
    animate: false,
  },
  failed: {
    icon: XCircle,
    color: 'text-red-400',
    bg: 'bg-red-500/20',
    animate: false,
  },
  skipped: {
    icon: AlertCircle,
    color: 'text-neutral-500',
    bg: 'bg-neutral-500/20',
    animate: false,
  },
  cancelled: {
    icon: StopCircle,
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/20',
    animate: false,
  },
}

export default function BuildDetailPage() {
  const params = useParams()
  const runId = params.runId as string

  const { run: build, isLoading, refetch } = useWorkflowRun(runId)
  const { logs } = useRunLogs(runId)
  const { cancelRun, rerunWorkflow } = useCIActions()
  const { artifacts, downloadArtifact } = useArtifacts(runId)

  const [selectedJob, setSelectedJob] = useState<string | null>(null)
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    if (build?.jobs?.[0]?.jobId && !selectedJob) {
      setSelectedJob(build.jobs[0].jobId)
    }
  }, [build, selectedJob])

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [autoScroll])

  const selectedJobData = build?.jobs?.find((j) => j.jobId === selectedJob)
  const filteredLogs = selectedJob
    ? logs.filter((l) => l.jobId === selectedJob)
    : logs

  const getStatus = (s: string, conclusion?: string) => {
    if (s === 'completed') {
      return conclusion === 'success'
        ? statusConfig.completed
        : statusConfig.failed
    }
    const status = statusConfig[s as keyof typeof statusConfig]
    return status || statusConfig.queued
  }

  const copyLogs = () => {
    const text = filteredLogs
      .map((l) => `[${format(l.timestamp, 'HH:mm:ss')}] ${l.message}`)
      .join('\n')
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  }

  const handleCancel = async () => {
    await cancelRun(runId)
    refetch()
  }

  const handleRerun = async () => {
    await rerunWorkflow(runId)
  }

  if (isLoading || !build) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    )
  }

  const buildStatus = getStatus(build.status, build.conclusion)
  const BuildStatusIcon = buildStatus.icon

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <div className="border-b border-neutral-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link
                href="/ci"
                className="p-2 hover:bg-neutral-800 rounded-lg transition-colors -ml-2"
              >
                <ArrowLeft className="w-5 h-5 text-neutral-400" />
              </Link>
              <div className="flex items-center gap-3">
                <div className={clsx('p-2 rounded-lg', buildStatus.bg)}>
                  <BuildStatusIcon
                    className={clsx(
                      'w-5 h-5',
                      buildStatus.color,
                      buildStatus.animate && 'animate-spin',
                    )}
                  />
                </div>
                <div>
                  <h1 className="text-lg font-semibold text-white">
                    Run #{build.runNumber}
                  </h1>
                  <div className="flex items-center gap-2 text-sm text-neutral-400">
                    <Package className="w-3.5 h-3.5" />
                    {build.repoId.slice(0, 10)}...
                    <span className="text-neutral-600">•</span>
                    <GitBranch className="w-3.5 h-3.5" />
                    {build.branch}
                    <span className="text-neutral-600">•</span>
                    <GitCommit className="w-3.5 h-3.5" />
                    {build.commitSha.slice(0, 7)}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {(build.status === 'in_progress' ||
                build.status === 'queued') && (
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-2 px-3 py-1.5 bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-sm"
                >
                  <StopCircle className="w-4 h-4" />
                  Cancel
                </button>
              )}
              <button
                onClick={handleRerun}
                className="flex items-center gap-2 px-3 py-1.5 bg-neutral-800 text-white hover:bg-neutral-700 border border-neutral-700 rounded-lg text-sm"
              >
                <RefreshCw className="w-4 h-4" />
                Re-run
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-3 space-y-4">
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
              <h3 className="text-sm font-medium text-neutral-400 mb-3">
                Summary
              </h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-neutral-500">Status</span>
                  <span className={buildStatus.color}>
                    {build.status === 'completed'
                      ? build.conclusion
                      : build.status}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Trigger</span>
                  <span className="text-neutral-300">
                    {build.triggerType || 'manual'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Started</span>
                  <span className="text-neutral-300">
                    {formatDistanceToNow(build.startedAt, { addSuffix: true })}
                  </span>
                </div>
                {(build.duration !== undefined ||
                  build.completedAt !== undefined) && (
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Duration</span>
                    <span className="text-neutral-300">
                      {formatDuration(
                        build.duration ??
                          (build.completedAt
                            ? build.completedAt - build.startedAt
                            : 0),
                      )}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-neutral-500">Triggered by</span>
                  <span className="text-neutral-300 flex items-center gap-1">
                    <User className="w-3 h-3" />
                    {build.triggeredBy}
                  </span>
                </div>
                {build.environment && (
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Environment</span>
                    <span className="px-2 py-0.5 text-xs bg-purple-500/20 text-purple-400 rounded">
                      {build.environment}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
              <h3 className="text-sm font-medium text-neutral-400 mb-3">
                Jobs
              </h3>
              <div className="space-y-1">
                {build.jobs.map((job) => {
                  const jobStatus = getStatus(job.status, job.conclusion)
                  const JobIcon = jobStatus.icon

                  return (
                    <button
                      key={job.jobId}
                      onClick={() => setSelectedJob(job.jobId)}
                      className={clsx(
                        'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-left',
                        selectedJob === job.jobId
                          ? 'bg-neutral-800 text-white'
                          : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50',
                      )}
                    >
                      <JobIcon
                        className={clsx(
                          'w-4 h-4 flex-shrink-0',
                          jobStatus.color,
                          jobStatus.animate && 'animate-spin',
                        )}
                      />
                      <span className="flex-1 truncate">{job.name}</span>
                      {job.duration && (
                        <span className="text-neutral-500 text-xs">
                          {formatDuration(job.duration)}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {artifacts.length > 0 && (
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
                <h3 className="text-sm font-medium text-neutral-400 mb-3">
                  Artifacts
                </h3>
                <div className="space-y-2">
                  {artifacts.map((artifact) => (
                    <button
                      key={artifact.artifactId}
                      onClick={() => downloadArtifact(artifact.name)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-neutral-800/50 hover:bg-neutral-800 text-neutral-300 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      <span className="flex-1 truncate text-left">
                        {artifact.name}
                      </span>
                      <span className="text-neutral-500 text-xs">
                        {(artifact.sizeBytes / 1024 / 1024).toFixed(1)} MB
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="col-span-9">
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-neutral-500" />
                  <span className="text-sm font-medium text-neutral-300">
                    {selectedJobData?.name || 'All Jobs'}
                  </span>
                  {selectedJobData?.runnerName && (
                    <span className="text-xs text-neutral-500 flex items-center gap-1">
                      <Server className="w-3 h-3" />
                      {selectedJobData.runnerName}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-neutral-500">
                    <input
                      type="checkbox"
                      checked={autoScroll}
                      onChange={(e) => setAutoScroll(e.target.checked)}
                      className="rounded border-neutral-600 bg-neutral-800 text-amber-500 focus:ring-amber-500"
                    />
                    Auto-scroll
                  </label>
                  <button
                    onClick={copyLogs}
                    className="p-2 hover:bg-neutral-800 rounded-lg transition-colors"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4 text-neutral-500" />
                    )}
                  </button>
                </div>
              </div>

              {selectedJobData && (
                <div className="border-b border-neutral-800">
                  <div className="divide-y divide-neutral-800/50">
                    {selectedJobData.steps.map((step) => {
                      const stepStatus = getStatus(step.status, step.conclusion)
                      const StepIcon = stepStatus.icon
                      const isExpanded = expandedSteps.has(step.stepId)

                      return (
                        <div key={step.stepId}>
                          <button
                            onClick={() => {
                              setExpandedSteps((prev) => {
                                const next = new Set(prev)
                                if (next.has(step.stepId)) {
                                  next.delete(step.stepId)
                                } else {
                                  next.add(step.stepId)
                                }
                                return next
                              })
                            }}
                            className="w-full flex items-center gap-3 px-4 py-2 hover:bg-neutral-800/50 text-left transition-colors"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-neutral-500" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-neutral-500" />
                            )}
                            <StepIcon
                              className={clsx(
                                'w-4 h-4',
                                stepStatus.color,
                                stepStatus.animate && 'animate-spin',
                              )}
                            />
                            <span className="text-sm text-neutral-300">
                              {step.name}
                            </span>
                            {step.startedAt && step.completedAt && (
                              <span className="text-xs text-neutral-500 ml-auto">
                                {formatDuration(
                                  step.completedAt - step.startedAt,
                                )}
                              </span>
                            )}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="h-96 overflow-auto bg-[#0d0d0d] font-mono text-sm">
                <div className="p-4 space-y-0.5">
                  {filteredLogs.map((log, i) => {
                    if (log.level === 'endgroup') return null

                    return (
                      <div
                        key={i}
                        className={clsx(
                          'flex gap-3',
                          log.level === 'group' && 'mt-2 mb-1',
                          log.level === 'error' && 'text-red-400',
                          log.level === 'warn' && 'text-yellow-400',
                          log.level === 'command' && 'text-cyan-400',
                        )}
                      >
                        <span className="text-neutral-600 select-none flex-shrink-0">
                          {format(log.timestamp, 'HH:mm:ss')}
                        </span>
                        <span
                          className={clsx(
                            log.level === 'group' &&
                              'font-semibold text-neutral-200',
                            log.level === 'command' &&
                              'before:content-["$"] before:mr-1',
                            log.level === 'info' && 'text-neutral-400',
                            log.level === 'debug' && 'text-neutral-500',
                          )}
                        >
                          {log.message}
                        </span>
                      </div>
                    )
                  })}
                  <div ref={logsEndRef} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
