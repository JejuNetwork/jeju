import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { API_URL } from '../config'

interface ActivityEntry {
  action: string
  timestamp: number
  success: boolean
  result?: unknown
}

interface AutonomousStatus {
  enabled: boolean
  running?: boolean
  agentCount?: number
  agents?: Array<{
    id: string
    character: string
    lastTick: number
    tickCount: number
    recentActivity: ActivityEntry[]
  }>
  message?: string
}

function useAutonomousStatus() {
  return useQuery({
    queryKey: ['autonomous-status'],
    queryFn: async (): Promise<AutonomousStatus> => {
      const response = await fetch(`${API_URL}/api/v1/autonomous/status`)
      if (!response.ok) throw new Error('Failed to fetch status')
      return response.json()
    },
    refetchInterval: 5000,
  })
}

function useStartRunner() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const response = await fetch(`${API_URL}/api/v1/autonomous/start`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error('Failed to start runner')
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autonomous-status'] })
    },
  })
}

function useStopRunner() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const response = await fetch(`${API_URL}/api/v1/autonomous/stop`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error('Failed to stop runner')
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autonomous-status'] })
    },
  })
}

function useUnregisterAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (agentId: string) => {
      const response = await fetch(
        `${API_URL}/api/v1/autonomous/agents/${agentId}`,
        {
          method: 'DELETE',
        },
      )
      if (!response.ok) throw new Error('Failed to unregister agent')
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autonomous-status'] })
    },
  })
}

export default function AutonomousPage() {
  const { data: status, isLoading, error } = useAutonomousStatus()
  const startRunner = useStartRunner()
  const stopRunner = useStopRunner()
  const unregisterAgent = useUnregisterAgent()
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set())

  const toggleExpanded = (agentId: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev)
      if (next.has(agentId)) {
        next.delete(agentId)
      } else {
        next.add(agentId)
      }
      return next
    })
  }

  const formatTime = (timestamp: number) => {
    if (!timestamp) return 'Never'
    const date = new Date(timestamp)
    return date.toLocaleTimeString()
  }

  const formatActivityTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const [expandedActivities, setExpandedActivities] = useState<Set<string>>(new Set())

  const toggleActivityExpanded = (key: string) => {
    setExpandedActivities((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const formatResult = (result: unknown): string => {
    if (!result) return ''
    if (typeof result === 'string') return result.slice(0, 60)
    if (typeof result === 'object' && result !== null) {
      const obj = result as Record<string, unknown>
      if ('error' in obj) return String(obj.error).slice(0, 60)
      if ('text' in obj) return String(obj.text).slice(0, 60)
      if ('message' in obj) return String(obj.message).slice(0, 60)
      return JSON.stringify(result).slice(0, 60)
    }
    return String(result).slice(0, 60)
  }

  const getFullResult = (result: unknown): string => {
    if (!result) return ''
    if (typeof result === 'string') return result
    return JSON.stringify(result, null, 2)
  }

  if (isLoading) {
    return (
      <output className="flex flex-col items-center justify-center py-20">
        <LoadingSpinner size="lg" />
        <p className="mt-4 text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Loading autonomous status
        </p>
      </output>
    )
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="card-static p-8 text-center" role="alert">
          <div className="text-5xl mb-4">⚠️</div>
          <h2
            className="text-xl font-bold mb-2"
            style={{ color: 'var(--color-error)' }}
          >
            Failed to load autonomous status
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>{error.message}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1
            className="text-3xl md:text-4xl font-bold mb-2 font-display"
            style={{ color: 'var(--text-primary)' }}
          >
            Autonomous Agents
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Self-running agents that tick on intervals and take actions
          </p>
        </div>
        <div className="flex gap-3">
          {status?.running ? (
            <button
              type="button"
              onClick={() => stopRunner.mutate()}
              disabled={stopRunner.isPending}
              className="btn-secondary"
            >
              {stopRunner.isPending ? (
                <LoadingSpinner size="sm" />
              ) : (
                'Stop Runner'
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => startRunner.mutate()}
              disabled={startRunner.isPending}
              className="btn-primary"
            >
              {startRunner.isPending ? (
                <LoadingSpinner size="sm" />
              ) : (
                'Start Runner'
              )}
            </button>
          )}
        </div>
      </header>

      {/* Status Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="card-static p-5 text-center">
          <p
            className="text-sm font-medium mb-2"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Status
          </p>
          <p
            className="text-2xl font-bold font-display"
            style={{
              color: status?.running
                ? 'var(--color-success)'
                : 'var(--text-tertiary)',
            }}
          >
            {status?.running ? 'Running' : 'Stopped'}
          </p>
        </div>
        <div className="card-static p-5 text-center">
          <p
            className="text-sm font-medium mb-2"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Enabled
          </p>
          <p
            className="text-2xl font-bold font-display"
            style={{ color: 'var(--text-primary)' }}
          >
            {status?.enabled ? 'Yes' : 'No'}
          </p>
        </div>
        <div className="card-static p-5 text-center">
          <p
            className="text-sm font-medium mb-2"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Active Agents
          </p>
          <p
            className="text-2xl font-bold font-display"
            style={{ color: 'var(--text-primary)' }}
          >
            {status?.agentCount ?? 0}
          </p>
        </div>
      </div>

      {/* Not Enabled Message */}
      {!status?.enabled && (
        <div className="card-static p-8 text-center mb-8">
          <div className="text-5xl mb-4">🔌</div>
          <h2
            className="text-xl font-bold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Autonomous Mode Not Enabled
          </h2>
          <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
            {status?.message ??
              'Set AUTONOMOUS_ENABLED=true to enable autonomous agents.'}
          </p>
          <code
            className="block p-4 rounded-lg text-sm font-mono text-left max-w-md mx-auto"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            AUTONOMOUS_ENABLED=true bun run dev:server
          </code>
        </div>
      )}

      {/* Agents Section */}
      {status?.enabled && (
        <>
          <div className="flex items-center justify-between mb-6">
            <h2
              className="text-xl font-bold font-display"
              style={{ color: 'var(--text-primary)' }}
            >
              Registered Agents
            </h2>
            <Link to="/agents/new" className="btn-primary btn-sm">
              Deploy Agent
            </Link>
          </div>

          {/* Agent List */}
          {status?.agents && status.agents.length > 0 ? (
            <div className="space-y-4">
              {status.agents.map((agent) => {
                const isExpanded = expandedAgents.has(agent.id)
                const hasActivity = agent.recentActivity && agent.recentActivity.length > 0
                return (
                  <div key={agent.id} className="card-static overflow-hidden">
                    {/* Agent Header */}
                    <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div
                          className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                          style={{ backgroundColor: 'var(--bg-secondary)' }}
                        >
                          🤖
                        </div>
                        <div>
                          <h3
                            className="font-bold font-display"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {agent.character}
                          </h3>
                          <p
                            className="text-sm font-mono"
                            style={{ color: 'var(--text-tertiary)' }}
                          >
                            {agent.id}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-center">
                          <p
                            className="text-xs"
                            style={{ color: 'var(--text-tertiary)' }}
                          >
                            Last Tick
                          </p>
                          <p
                            className="font-medium"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {formatTime(agent.lastTick)}
                          </p>
                        </div>
                        <div className="text-center">
                          <p
                            className="text-xs"
                            style={{ color: 'var(--text-tertiary)' }}
                          >
                            Ticks
                          </p>
                          <p
                            className="font-medium tabular-nums"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {agent.tickCount}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleExpanded(agent.id)}
                          className="btn-ghost btn-sm"
                          style={{ color: 'var(--text-secondary)' }}
                          disabled={!hasActivity}
                          title={hasActivity ? 'Show activity' : 'No activity yet'}
                        >
                          {isExpanded ? '▼' : '▶'} Activity
                        </button>
                        <button
                          type="button"
                          onClick={() => unregisterAgent.mutate(agent.id)}
                          disabled={unregisterAgent.isPending}
                          className="btn-ghost btn-sm"
                          style={{ color: 'var(--color-error)' }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    {/* Activity Timeline */}
                    {isExpanded && hasActivity && (
                      <div
                        className="border-t px-5 py-4"
                        style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
                      >
                        <p
                          className="text-xs font-medium mb-3"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          Recent Activity (last 10)
                        </p>
                        <div className="space-y-1">
                          {[...agent.recentActivity].reverse().map((activity, idx) => {
                            const activityKey = `${agent.id}-${activity.timestamp}-${idx}`
                            const isActivityExpanded = expandedActivities.has(activityKey)
                            return (
                              <div key={activityKey}>
                                <button
                                  type="button"
                                  onClick={() => activity.result && toggleActivityExpanded(activityKey)}
                                  className="w-full flex items-start gap-3 text-sm text-left py-1 px-2 rounded hover:bg-black/10"
                                  style={{ cursor: activity.result ? 'pointer' : 'default' }}
                                >
                                  <span
                                    className="flex-shrink-0 w-5 text-center"
                                    style={{ color: activity.success ? 'var(--color-success)' : 'var(--color-error)' }}
                                  >
                                    {activity.success ? '✓' : '✗'}
                                  </span>
                                  <span
                                    className="flex-shrink-0 font-mono text-xs"
                                    style={{ color: 'var(--text-tertiary)' }}
                                  >
                                    {formatActivityTime(activity.timestamp)}
                                  </span>
                                  <span
                                    className="font-medium flex-shrink-0"
                                    style={{ color: 'var(--text-primary)' }}
                                  >
                                    {activity.action}
                                  </span>
                                  {activity.result && !isActivityExpanded && (
                                    <span
                                      className="truncate"
                                      style={{ color: activity.success ? 'var(--text-secondary)' : 'var(--color-error)' }}
                                    >
                                      {formatResult(activity.result)}...
                                    </span>
                                  )}
                                  {activity.result && (
                                    <span
                                      className="flex-shrink-0 ml-auto"
                                      style={{ color: 'var(--text-tertiary)' }}
                                    >
                                      {isActivityExpanded ? '▼' : '▶'}
                                    </span>
                                  )}
                                </button>
                                {isActivityExpanded && activity.result && (
                                  <pre
                                    className="mt-1 ml-8 p-3 rounded text-xs overflow-x-auto"
                                    style={{
                                      backgroundColor: 'var(--bg-primary)',
                                      color: 'var(--text-secondary)',
                                      maxHeight: '200px',
                                      overflowY: 'auto',
                                    }}
                                  >
                                    {getFullResult(activity.result)}
                                  </pre>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="card-static p-12 text-center">
              <div className="text-5xl mb-4">🤖</div>
              <h3
                className="text-xl font-bold mb-2"
                style={{ color: 'var(--text-primary)' }}
              >
                No Autonomous Agents
              </h3>
              <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
                Deploy an agent to start autonomous execution.
              </p>
              <Link to="/agents/new" className="btn-primary">
                Deploy Agent
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  )
}
