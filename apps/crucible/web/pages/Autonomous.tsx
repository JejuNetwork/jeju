import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useAuthenticatedFetch, useMyAgents } from '../hooks'

interface AutonomousStatus {
  enabled: boolean
  running?: boolean
  agentCount?: number
  agents?: Array<{
    id: string
    agentId?: string
    character: string
    lastTick: number
    tickCount: number
    enabled?: boolean
  }>
  message?: string
}

interface RegisterAgentRequest {
  agentId: string
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

export default function AutonomousPage() {
  const { data: status, isLoading, error } = useAutonomousStatus()
  const { data: agentsData } = useMyAgents()
  const startRunner = useStartRunner()
  const stopRunner = useStopRunner()
  const registerAgent = useRegisterAgent()
  const unregisterAgent = useUnregisterAgent()

  const [showRegister, setShowRegister] = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [tickInterval, setTickInterval] = useState(60000)

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedAgentId) return

    await registerAgent.mutateAsync({
      agentId: selectedAgentId,
      tickIntervalMs: tickInterval,
    })

    setShowRegister(false)
    setSelectedAgentId('')
  }

  const formatTime = (timestamp: number) => {
    if (!timestamp) return 'Never'
    const date = new Date(timestamp)
    return date.toLocaleTimeString()
  }

  const _formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    if (minutes > 0) return `${minutes}m`
    return `${seconds}s`
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

      {/* Register Agent Form */}
      {status?.enabled && (
        <>
          <div className="flex items-center justify-between mb-6">
            <h2
              className="text-xl font-bold font-display"
              style={{ color: 'var(--text-primary)' }}
            >
              Registered Agents
            </h2>
            <button
              type="button"
              onClick={() => setShowRegister(!showRegister)}
              className={
                showRegister ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'
              }
            >
              {showRegister ? 'Cancel' : 'Register Agent'}
            </button>
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
                    Agent
                  </label>
                  <select
                    id="agent-select"
                    value={selectedAgentId}
                    onChange={(e) => setSelectedAgentId(e.target.value)}
                    className="input max-w-md"
                    required
                  >
                    <option value="">Select an agent...</option>
                    {agentsData?.agents.map((agent) => (
                      <option key={agent.agentId} value={agent.agentId}>
                        {agent.name} (#{agent.agentId})
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
                    <option value={60000}>1 minute</option>
                    <option value={120000}>2 minutes</option>
                    <option value={300000}>5 minutes</option>
                    <option value={600000}>10 minutes</option>
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
                    disabled={!selectedAgentId || registerAgent.isPending}
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

          {/* Agent List */}
          {status?.agents && status.agents.length > 0 ? (
            <div className="space-y-4">
              {status.agents.map((agent) => (
                <div
                  key={agent.id}
                  className="card-static p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
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
                        Agent #{agent.agentId ?? 'Unknown'}
                      </h3>
                      <p
                        className="text-sm font-mono"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        trigger: {agent.id}
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
                      onClick={() =>
                        agent.agentId
                          ? unregisterAgent.mutate(agent.agentId)
                          : undefined
                      }
                      disabled={!agent.agentId || unregisterAgent.isPending}
                      className="btn-ghost btn-sm"
                      style={{ color: 'var(--color-error)' }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
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
                Register an agent to start autonomous execution.
              </p>
              <button
                type="button"
                onClick={() => setShowRegister(true)}
                className="btn-primary"
              >
                Register Agent
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
