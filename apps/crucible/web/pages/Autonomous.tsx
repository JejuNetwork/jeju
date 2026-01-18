import type { JsonValue } from '@jejunetwork/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useAuthenticatedFetch, useCharacters } from '../hooks'

interface ActivityEntry {
  action: string
  timestamp: number
  success: boolean
  result?: JsonValue
}

interface AutonomousAgentStatus {
  id: string
  character: string
  lastTick: number
  tickCount: number
  recentActivity: ActivityEntry[]
}

interface AutonomousStatus {
  enabled: boolean
  running?: boolean
  agentCount?: number
  agents?: AutonomousAgentStatus[]
  message?: string
}

interface RegisterAgentRequest {
  characterId: string
  tickIntervalMs?: number
}

function useAutonomousStatus() {
  const { authenticatedFetch } = useAuthenticatedFetch()
  return useQuery({
    queryKey: ['autonomous-status'],
    queryFn: async (): Promise<AutonomousStatus> => {
      return authenticatedFetch<AutonomousStatus>('/api/v1/autonomous/status', {
        requireAuth: false,
      })
    },
    refetchInterval: 5000,
  })
}

function useStartRunner() {
  const queryClient = useQueryClient()
  const { authenticatedFetch } = useAuthenticatedFetch()
  return useMutation({
    mutationFn: async () => {
      return authenticatedFetch('/api/v1/autonomous/start', {
        method: 'POST',
        requireAuth: true,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autonomous-status'] })
    },
  })
}

function useStopRunner() {
  const queryClient = useQueryClient()
  const { authenticatedFetch } = useAuthenticatedFetch()
  return useMutation({
    mutationFn: async () => {
      return authenticatedFetch('/api/v1/autonomous/stop', {
        method: 'POST',
        requireAuth: true,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autonomous-status'] })
    },
  })
}

function useRegisterAgent() {
  const queryClient = useQueryClient()
  const { authenticatedFetch } = useAuthenticatedFetch()
  return useMutation({
    mutationFn: async (request: RegisterAgentRequest) => {
      return authenticatedFetch(`/api/v1/autonomous/agents`, {
        method: 'POST',
        body: request,
        requireAuth: true,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autonomous-status'] })
    },
  })
}

function useUnregisterAgent() {
  const queryClient = useQueryClient()
  const { authenticatedFetch } = useAuthenticatedFetch()
  return useMutation({
    mutationFn: async (agentId: string) => {
      return authenticatedFetch(`/api/v1/autonomous/agents/${agentId}`, {
        method: 'DELETE',
        requireAuth: true,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autonomous-status'] })
    },
  })
}

function formatTime(timestamp: number): string {
  if (!timestamp) return 'Never'
  return new Date(timestamp).toLocaleTimeString()
}

function formatActivityTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function summarizeJsonValue(value: JsonValue): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return value.slice(0, 60)
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  const json = JSON.stringify(value)
  return json.length > 60 ? `${json.slice(0, 60)}…` : json
}

function formatJsonValue(value: JsonValue): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

export default function AutonomousPage() {
  const { data: status, isLoading, error } = useAutonomousStatus()
  const { data: characters } = useCharacters()
  const startRunner = useStartRunner()
  const stopRunner = useStopRunner()
  const registerAgent = useRegisterAgent()
  const unregisterAgent = useUnregisterAgent()

  const [showRegister, setShowRegister] = useState(false)
  const [selectedCharacterId, setSelectedCharacterId] = useState('')
  const [tickInterval, setTickInterval] = useState(60_000)

  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set())
  const [expandedActivities, setExpandedActivities] = useState<Set<string>>(
    new Set(),
  )

  const toggleExpanded = (agentId: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  }

  const toggleActivityExpanded = (key: string) => {
    setExpandedActivities((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedCharacterId) return

    await registerAgent.mutateAsync({
      characterId: selectedCharacterId,
      tickIntervalMs: tickInterval,
    })

    setShowRegister(false)
    setSelectedCharacterId('')
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

      {!status?.enabled && (
        <div className="card-static p-8 text-center mb-8">
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

      {status?.enabled && (
        <>
          <div className="flex items-center justify-between mb-6">
            <h2
              className="text-xl font-bold font-display"
              style={{ color: 'var(--text-primary)' }}
            >
              Registered Agents
            </h2>
            <div className="flex gap-3">
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setShowRegister((v) => !v)}
              >
                {showRegister ? 'Close' : 'Register existing'}
              </button>
              <Link to="/agents/new" className="btn-primary btn-sm">
                Deploy Agent
              </Link>
            </div>
          </div>

          {showRegister && (
            <div className="card-static p-6 mb-6 animate-slide-up">
              <h3
                className="text-lg font-bold mb-4 font-display"
                style={{ color: 'var(--text-primary)' }}
              >
                Register New Agent
              </h3>

              <form onSubmit={handleRegister} className="space-y-5">
                <div>
                  <label
                    htmlFor="agent-select"
                    className="block text-sm font-medium mb-2"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Character
                  </label>
                  <select
                    id="agent-select"
                    value={selectedCharacterId}
                    onChange={(e) => setSelectedCharacterId(e.target.value)}
                    className="input max-w-md"
                    required
                  >
                    <option value="">Select a character...</option>
                    {characters?.map((character) => (
                      <option key={character.id} value={character.id}>
                        {character.name} ({character.id})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="tick-interval"
                    className="block text-sm font-medium mb-2"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Tick Interval
                  </label>
                  <select
                    id="tick-interval"
                    value={tickInterval}
                    onChange={(e) => setTickInterval(Number(e.target.value))}
                    className="input max-w-xs"
                  >
                    <option value={60_000}>1 minute</option>
                    <option value={120_000}>2 minutes</option>
                    <option value={300_000}>5 minutes</option>
                    <option value={600_000}>10 minutes</option>
                  </select>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowRegister(false)}
                    className="btn-ghost"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!selectedCharacterId || registerAgent.isPending}
                    className="btn-primary"
                  >
                    {registerAgent.isPending ? (
                      <LoadingSpinner size="sm" />
                    ) : (
                      'Register'
                    )}
                  </button>
                </div>

                {registerAgent.isError && (
                  <div
                    className="p-3 rounded-lg"
                    style={{ backgroundColor: 'rgba(244, 63, 94, 0.1)' }}
                    role="alert"
                  >
                    <p
                      className="text-sm"
                      style={{ color: 'var(--color-error)' }}
                    >
                      {registerAgent.error.message}
                    </p>
                  </div>
                )}
              </form>
            </div>
          )}

          {status?.agents && status.agents.length > 0 ? (
            <div className="space-y-4">
              {status.agents.map((agent) => {
                const isExpanded = expandedAgents.has(agent.id)
                const hasActivity = agent.recentActivity.length > 0

                return (
                  <div key={agent.id} className="card-static overflow-hidden">
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
                          title={
                            hasActivity ? 'Show activity' : 'No activity yet'
                          }
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

                    {isExpanded && hasActivity && (
                      <div
                        className="border-t px-5 py-4"
                        style={{
                          borderColor: 'var(--border-primary)',
                          backgroundColor: 'var(--bg-secondary)',
                        }}
                      >
                        <p
                          className="text-xs font-medium mb-3"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          Recent Activity (last 10)
                        </p>
                        <div className="space-y-1">
                          {[...agent.recentActivity]
                            .reverse()
                            .map((activity, idx) => {
                              const activityKey = `${agent.id}-${activity.timestamp}-${idx}`
                              const expanded =
                                expandedActivities.has(activityKey)
                              const hasResult = activity.result !== undefined
                              const result = activity.result
                              return (
                                <div key={activityKey}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (hasResult)
                                        toggleActivityExpanded(activityKey)
                                    }}
                                    className="w-full flex items-start gap-3 text-sm text-left py-1 px-2 rounded hover:bg-black/10"
                                    style={{
                                      cursor: hasResult ? 'pointer' : 'default',
                                    }}
                                  >
                                    <span
                                      className="flex-shrink-0 w-5 text-center"
                                      style={{
                                        color: activity.success
                                          ? 'var(--color-success)'
                                          : 'var(--color-error)',
                                      }}
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
                                    {hasResult && !expanded && (
                                      <span
                                        className="truncate"
                                        style={{
                                          color: activity.success
                                            ? 'var(--text-secondary)'
                                            : 'var(--color-error)',
                                        }}
                                      >
                                        {result !== undefined
                                          ? summarizeJsonValue(result)
                                          : ''}
                                      </span>
                                    )}
                                    {hasResult && (
                                      <span
                                        className="flex-shrink-0 ml-auto"
                                        style={{
                                          color: 'var(--text-tertiary)',
                                        }}
                                      >
                                        {expanded ? '▼' : '▶'}
                                      </span>
                                    )}
                                  </button>
                                  {expanded && hasResult && (
                                    <pre
                                      className="mt-1 ml-8 p-3 rounded text-xs overflow-x-auto"
                                      style={{
                                        backgroundColor: 'var(--bg-primary)',
                                        color: 'var(--text-secondary)',
                                        maxHeight: '200px',
                                        overflowY: 'auto',
                                      }}
                                    >
                                      {result !== undefined
                                        ? formatJsonValue(result)
                                        : ''}
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
