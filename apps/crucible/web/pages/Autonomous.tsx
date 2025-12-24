/**
 * Autonomous Mode Page
 */

import { useState } from 'react'
import { LoadingSpinner } from '../components/LoadingSpinner'
import {
  useAutonomousStatus,
  useCharacters,
  useRegisterAutonomousAgent,
  useRemoveAutonomousAgent,
  useStartAutonomous,
  useStopAutonomous,
} from '../hooks'
import { formatDistanceToNow } from '../lib/utils'

export default function AutonomousPage() {
  const [selectedCharacter, setSelectedCharacter] = useState('')
  const [tickInterval, setTickInterval] = useState('60000')

  const { data: status, isLoading } = useAutonomousStatus()
  const { data: characters } = useCharacters()
  const startAutonomous = useStartAutonomous()
  const stopAutonomous = useStopAutonomous()
  const registerAgent = useRegisterAutonomousAgent()
  const removeAgent = useRemoveAutonomousAgent()

  const handleRegister = async () => {
    if (!selectedCharacter) return
    await registerAgent.mutateAsync({
      characterId: selectedCharacter,
      tickIntervalMs: parseInt(tickInterval, 10),
    })
    setSelectedCharacter('')
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1
          className="text-3xl font-bold mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Autonomous Mode
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Run agents autonomously on configurable tick intervals
        </p>
      </div>

      {/* Status Card */}
      <div className="card-static p-6 mb-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div
              className={`w-4 h-4 rounded-full ${status?.running ? 'bg-green-500' : 'bg-gray-400'}`}
              style={{
                boxShadow: status?.running
                  ? '0 0 12px rgba(16, 185, 129, 0.6)'
                  : undefined,
              }}
            />
            <div>
              <h2
                className="text-xl font-bold"
                style={{ color: 'var(--text-primary)' }}
              >
                {status?.running ? 'Running' : 'Stopped'}
              </h2>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                {status?.enabled
                  ? 'Autonomous mode is enabled'
                  : 'Set AUTONOMOUS_ENABLED=true to enable'}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            {status?.running ? (
              <button
                type="button"
                onClick={() => stopAutonomous.mutate()}
                disabled={stopAutonomous.isPending}
                className="btn-secondary"
              >
                {stopAutonomous.isPending ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  'Stop'
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => startAutonomous.mutate()}
                disabled={startAutonomous.isPending}
                className="btn-primary"
              >
                {startAutonomous.isPending ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  'Start'
                )}
              </button>
            )}
          </div>
        </div>

        {/* Add Agent Form */}
        <div
          className="p-4 rounded-xl"
          style={{ backgroundColor: 'var(--bg-secondary)' }}
        >
          <h3
            className="font-bold mb-3"
            style={{ color: 'var(--text-primary)' }}
          >
            Register Agent
          </h3>
          <div className="flex gap-3">
            <select
              value={selectedCharacter}
              onChange={(e) => setSelectedCharacter(e.target.value)}
              className="input flex-1"
            >
              <option value="">Select a character...</option>
              {characters?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={tickInterval}
              onChange={(e) => setTickInterval(e.target.value)}
              className="input w-40"
            >
              <option value="30000">30 seconds</option>
              <option value="60000">1 minute</option>
              <option value="300000">5 minutes</option>
              <option value="600000">10 minutes</option>
            </select>
            <button
              type="button"
              onClick={handleRegister}
              disabled={!selectedCharacter || registerAgent.isPending}
              className="btn-primary"
            >
              {registerAgent.isPending ? <LoadingSpinner size="sm" /> : 'Add'}
            </button>
          </div>
          {registerAgent.isError && (
            <p className="mt-2 text-sm" style={{ color: 'var(--color-error)' }}>
              {registerAgent.error.message}
            </p>
          )}
        </div>
      </div>

      {/* Agent List */}
      <div className="card-static p-6">
        <h2
          className="text-lg font-bold mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          Registered Agents
        </h2>

        {!status?.agents || status.agents.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-4">⚡</div>
            <p style={{ color: 'var(--text-secondary)' }}>
              No autonomous agents registered
            </p>
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              Add an agent above to start autonomous execution
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {status.agents.map((agent) => (
              <div
                key={agent.agentId}
                className="flex items-center justify-between p-4 rounded-xl"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      agent.status === 'running'
                        ? 'bg-green-500'
                        : agent.status === 'error'
                          ? 'bg-red-500'
                          : 'bg-gray-400'
                    }`}
                  />
                  <div>
                    <p
                      className="font-medium"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {agent.characterId}
                    </p>
                    <div
                      className="flex gap-4 text-sm"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      <span>Interval: {agent.tickIntervalMs / 1000}s</span>
                      <span>Ticks: {agent.tickCount}</span>
                      {agent.lastTickAt > 0 && (
                        <span>
                          Last: {formatDistanceToNow(agent.lastTickAt)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeAgent.mutate(agent.agentId)}
                  disabled={removeAgent.isPending}
                  className="btn-ghost btn-sm text-red-500"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* How It Works */}
      <div className="mt-8 card-static p-6">
        <h2
          className="text-lg font-bold mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          How It Works
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex gap-3">
            <div
              className="w-8 h-8 rounded-full bg-crucible-primary/20 flex items-center justify-center flex-shrink-0"
              style={{ color: 'var(--color-primary)' }}
            >
              1
            </div>
            <div>
              <p
                className="font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                Tick Loop
              </p>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                Each agent runs on its configured interval
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <div
              className="w-8 h-8 rounded-full bg-crucible-primary/20 flex items-center justify-center flex-shrink-0"
              style={{ color: 'var(--color-primary)' }}
            >
              2
            </div>
            <div>
              <p
                className="font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                Decision Making
              </p>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                LLM decides what actions to take each tick
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <div
              className="w-8 h-8 rounded-full bg-crucible-primary/20 flex items-center justify-center flex-shrink-0"
              style={{ color: 'var(--color-primary)' }}
            >
              3
            </div>
            <div>
              <p
                className="font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                Action Execution
              </p>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                Up to 5 actions per tick (compute, storage, DeFi, etc.)
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <div
              className="w-8 h-8 rounded-full bg-crucible-primary/20 flex items-center justify-center flex-shrink-0"
              style={{ color: 'var(--color-primary)' }}
            >
              4
            </div>
            <div>
              <p
                className="font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                Backoff
              </p>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                Failed agents get exponential backoff
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
