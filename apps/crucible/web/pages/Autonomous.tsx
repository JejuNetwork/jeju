import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { API_URL } from '../config'
import { useCharacters } from '../hooks'

interface AutonomousStatus {
  enabled: boolean
  running?: boolean
  agentCount?: number
  agents?: Array<{
    id: string
    character: string
    lastTick: number
    tickCount: number
  }>
  message?: string
}

interface RegisterAgentRequest {
  characterId: string
  tickIntervalMs?: number
  capabilities?: {
    canChat?: boolean
    canTrade?: boolean
    canVote?: boolean
    canPropose?: boolean
    canStake?: boolean
    a2a?: boolean
    compute?: boolean
  }
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

function useRegisterAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (request: RegisterAgentRequest) => {
      const response = await fetch(`${API_URL}/api/v1/autonomous/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error ?? 'Failed to register agent')
      }
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
  const { data: characters } = useCharacters()
  const startRunner = useStartRunner()
  const stopRunner = useStopRunner()
  const registerAgent = useRegisterAgent()
  const unregisterAgent = useUnregisterAgent()

  const [showRegister, setShowRegister] = useState(false)
  const [selectedCharacter, setSelectedCharacter] = useState('')
  const [tickInterval, setTickInterval] = useState(60000)
  const [capabilities, setCapabilities] = useState({
    canChat: true,
    canTrade: false,
    canVote: false,
    canPropose: false,
    canStake: false,
    a2a: false,
    compute: false,
  })

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedCharacter) return

    await registerAgent.mutateAsync({
      characterId: selectedCharacter,
      tickIntervalMs: tickInterval,
      capabilities,
    })

    setShowRegister(false)
    setSelectedCharacter('')
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
                    htmlFor="character-select"
                    className="block text-sm font-medium mb-2"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Character
                  </label>
                  <select
                    id="character-select"
                    value={selectedCharacter}
                    onChange={(e) => setSelectedCharacter(e.target.value)}
                    className="input max-w-md"
                    required
                  >
                    <option value="">Select a character...</option>
                    {characters?.map((char) => (
                      <option key={char.id} value={char.id}>
                        {char.name} - {char.description}
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
                    <option value={30000}>30 seconds</option>
                    <option value={60000}>1 minute</option>
                    <option value={120000}>2 minutes</option>
                    <option value={300000}>5 minutes</option>
                    <option value={600000}>10 minutes</option>
                  </select>
                </div>

                <fieldset>
                  <legend
                    className="block text-sm font-medium mb-3"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Capabilities
                  </legend>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {Object.entries(capabilities).map(([key, value]) => (
                      <label
                        key={key}
                        className="flex items-center gap-2 p-3 rounded-lg cursor-pointer"
                        style={{ backgroundColor: 'var(--bg-secondary)' }}
                      >
                        <input
                          type="checkbox"
                          checked={value}
                          onChange={(e) =>
                            setCapabilities((prev) => ({
                              ...prev,
                              [key]: e.target.checked,
                            }))
                          }
                          className="w-4 h-4"
                        />
                        <span
                          className="text-sm"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {key
                            .replace(/([A-Z])/g, ' $1')
                            .replace(/^./, (s) => s.toUpperCase())}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

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
                    disabled={!selectedCharacter || registerAgent.isPending}
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
                      onClick={() => unregisterAgent.mutate(agent.id)}
                      disabled={unregisterAgent.isPending}
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
