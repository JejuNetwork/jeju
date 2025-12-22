/**
 * CI/CD Dashboard
 * Vercel-like build overview with real-time updates
 */

'use client'

import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import {
  CheckCircle,
  ChevronRight,
  Clock,
  GitBranch,
  GitCommit,
  Loader2,
  Package,
  Search,
  Settings,
  StopCircle,
  XCircle,
  Zap,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

const DWS_API_URL = process.env.NEXT_PUBLIC_DWS_URL || 'http://localhost:4030'

interface Build {
  runId: string
  runNumber: number
  workflowId: string
  workflowName?: string
  repoId: string
  repoName?: string
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
  conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped'
  triggerType: string
  branch: string
  commitSha: string
  commitMessage?: string
  triggeredBy: string
  startedAt: number
  completedAt?: number
  duration?: number
  environment?: string
  jobCount: number
  successCount: number
  failedCount: number
}

const statusConfig = {
  queued: {
    icon: Clock,
    color: 'text-gray-400',
    bg: 'bg-gray-500/20',
    label: 'Queued',
    animate: false,
  },
  in_progress: {
    icon: Loader2,
    color: 'text-blue-400',
    bg: 'bg-blue-500/20',
    label: 'Building',
    animate: true,
  },
  completed: {
    icon: CheckCircle,
    color: 'text-green-400',
    bg: 'bg-green-500/20',
    label: 'Success',
    animate: false,
  },
  failed: {
    icon: XCircle,
    color: 'text-red-400',
    bg: 'bg-red-500/20',
    label: 'Failed',
    animate: false,
  },
  cancelled: {
    icon: StopCircle,
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/20',
    label: 'Cancelled',
    animate: false,
  },
}

export default function CIDashboard() {
  const [builds, setBuilds] = useState<Build[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<
    'all' | 'running' | 'success' | 'failed'
  >('all')
  const [search, setSearch] = useState('')
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)

  const fetchBuilds = useCallback(async () => {
    const response = await fetch(
      `${DWS_API_URL}/ci/repos/0x0000000000000000000000000000000000000000000000000000000000000001/runs?limit=50`,
    )
    if (response.ok) {
      const data = await response.json()
      setBuilds(data.runs || [])
    }
    setIsLoading(false)
  }, [])

  useEffect(() => {
    fetchBuilds()
    const interval = setInterval(fetchBuilds, 5000)
    return () => clearInterval(interval)
  }, [fetchBuilds])

  const filteredBuilds = builds.filter((build) => {
    if (
      filter === 'running' &&
      build.status !== 'in_progress' &&
      build.status !== 'queued'
    )
      return false
    if (filter === 'success' && build.conclusion !== 'success') return false
    if (filter === 'failed' && build.conclusion !== 'failure') return false
    if (selectedRepo && build.repoName !== selectedRepo) return false
    if (
      search &&
      !build.repoName?.toLowerCase().includes(search.toLowerCase()) &&
      !build.commitMessage?.toLowerCase().includes(search.toLowerCase())
    )
      return false
    return true
  })

  const repos = [
    ...new Set(builds.map((b) => b.repoName).filter((r): r is string => !!r)),
  ]
  const runningCount = builds.filter(
    (b) => b.status === 'in_progress' || b.status === 'queued',
  ).length

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  }

  const getStatus = (build: Build) => {
    if (build.status === 'completed') {
      return build.conclusion === 'success'
        ? statusConfig.completed
        : statusConfig.failed
    }
    const status = statusConfig[build.status as keyof typeof statusConfig]
    return status || statusConfig.queued
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <div className="border-b border-neutral-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-semibold text-white flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-400" />
                Deployments
              </h1>
              {runningCount > 0 && (
                <span className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded-full flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {runningCount} running
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/ci/settings"
                className="p-2 hover:bg-neutral-800 rounded-lg transition-colors"
              >
                <Settings className="w-5 h-5 text-neutral-400" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="lg:w-64 space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
              <input
                type="text"
                placeholder="Search builds..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-700"
              />
            </div>

            <div className="space-y-1">
              <button
                onClick={() => setFilter('all')}
                className={clsx(
                  'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors',
                  filter === 'all'
                    ? 'bg-neutral-800 text-white'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50',
                )}
              >
                <span>All Builds</span>
                <span className="text-neutral-500">{builds.length}</span>
              </button>
              <button
                onClick={() => setFilter('running')}
                className={clsx(
                  'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors',
                  filter === 'running'
                    ? 'bg-neutral-800 text-white'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50',
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  Running
                </span>
                <span className="text-neutral-500">{runningCount}</span>
              </button>
              <button
                onClick={() => setFilter('success')}
                className={clsx(
                  'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors',
                  filter === 'success'
                    ? 'bg-neutral-800 text-white'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50',
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  Success
                </span>
                <span className="text-neutral-500">
                  {builds.filter((b) => b.conclusion === 'success').length}
                </span>
              </button>
              <button
                onClick={() => setFilter('failed')}
                className={clsx(
                  'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors',
                  filter === 'failed'
                    ? 'bg-neutral-800 text-white'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50',
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-400" />
                  Failed
                </span>
                <span className="text-neutral-500">
                  {builds.filter((b) => b.conclusion === 'failure').length}
                </span>
              </button>
            </div>

            <div className="pt-4 border-t border-neutral-800">
              <h3 className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">
                Repositories
              </h3>
              <div className="space-y-1">
                <button
                  onClick={() => setSelectedRepo(null)}
                  className={clsx(
                    'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors',
                    !selectedRepo
                      ? 'bg-neutral-800 text-white'
                      : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50',
                  )}
                >
                  <Package className="w-4 h-4" />
                  All Repositories
                </button>
                {repos.map((repo) => (
                  <button
                    key={repo}
                    onClick={() => setSelectedRepo(repo)}
                    className={clsx(
                      'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors truncate',
                      selectedRepo === repo
                        ? 'bg-neutral-800 text-white'
                        : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50',
                    )}
                  >
                    <Package className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate">{repo.split('/')[1]}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-2">
            {isLoading ? (
              <div className="text-center py-16">
                <Loader2 className="w-12 h-12 mx-auto mb-4 text-neutral-600 animate-spin" />
                <p className="text-neutral-400">Loading builds...</p>
              </div>
            ) : filteredBuilds.length === 0 ? (
              <div className="text-center py-16">
                <Package className="w-12 h-12 mx-auto mb-4 text-neutral-600" />
                <p className="text-neutral-400">No builds found</p>
              </div>
            ) : (
              filteredBuilds.map((build) => {
                const status = getStatus(build)
                const StatusIcon = status.icon

                return (
                  <Link
                    key={build.runId}
                    href={`/ci/${build.runId}`}
                    className="block bg-neutral-900 border border-neutral-800 rounded-xl p-4 hover:border-neutral-700 transition-colors group"
                  >
                    <div className="flex items-start gap-4">
                      <div className={clsx('p-2 rounded-lg', status.bg)}>
                        <StatusIcon
                          className={clsx(
                            'w-5 h-5',
                            status.color,
                            status.animate && 'animate-spin',
                          )}
                        />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-white group-hover:text-amber-400 transition-colors">
                            {build.workflowName}
                          </span>
                          <span className="text-neutral-500">
                            #{build.runNumber}
                          </span>
                          {build.environment && (
                            <span className="px-2 py-0.5 text-xs bg-purple-500/20 text-purple-400 rounded">
                              {build.environment}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-sm text-neutral-400 mb-2">
                          <span className="flex items-center gap-1">
                            <Package className="w-3.5 h-3.5" />
                            {build.repoName}
                          </span>
                          <span className="flex items-center gap-1">
                            <GitBranch className="w-3.5 h-3.5" />
                            {build.branch}
                          </span>
                          <span className="flex items-center gap-1">
                            <GitCommit className="w-3.5 h-3.5" />
                            {build.commitSha}
                          </span>
                        </div>

                        {build.commitMessage && (
                          <p className="text-sm text-neutral-500 truncate">
                            {build.commitMessage}
                          </p>
                        )}
                      </div>

                      <div className="text-right text-sm">
                        <div className="text-neutral-400">
                          {build.status === 'in_progress' ||
                          build.status === 'queued' ? (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" />
                              {formatDistanceToNow(build.startedAt, {
                                addSuffix: false,
                              })}
                            </span>
                          ) : (
                            formatDistanceToNow(build.startedAt, {
                              addSuffix: true,
                            })
                          )}
                        </div>
                        {build.duration && (
                          <div className="text-neutral-500 mt-1">
                            {formatDuration(build.duration)}
                          </div>
                        )}
                        <div className="mt-2 flex items-center justify-end gap-1">
                          {build.successCount > 0 && (
                            <span className="px-1.5 py-0.5 text-xs bg-green-500/20 text-green-400 rounded">
                              {build.successCount} passed
                            </span>
                          )}
                          {build.failedCount > 0 && (
                            <span className="px-1.5 py-0.5 text-xs bg-red-500/20 text-red-400 rounded">
                              {build.failedCount} failed
                            </span>
                          )}
                        </div>
                      </div>

                      <ChevronRight className="w-5 h-5 text-neutral-600 group-hover:text-neutral-400 transition-colors flex-shrink-0" />
                    </div>
                  </Link>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
