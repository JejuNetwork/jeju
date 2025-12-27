/**
 * Agents Page
 *
 * Browse and manage deployed AI agents
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AgentCard } from '../components/AgentCard'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useAgents } from '../hooks'

export default function AgentsPage() {
  const [showActiveOnly, setShowActiveOnly] = useState(false)
  const { data, isLoading, error } = useAgents({
    active: showActiveOnly ? true : undefined,
    limit: 50,
  })

  return (
    <div className="max-w-6xl mx-auto">
      {/* Page Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1
            className="text-3xl md:text-4xl font-bold mb-2 font-display"
            style={{ color: 'var(--text-primary)' }}
          >
            Agents
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Registered agents and their vaults
          </p>
        </div>
        <Link to="/agents/new" className="btn-primary">
          Deploy Agent
        </Link>
      </header>

      {/* Filters */}
      <fieldset
        className="flex flex-wrap items-center gap-4 mb-8 p-4 rounded-xl border-0"
        style={{ backgroundColor: 'var(--bg-secondary)' }}
        aria-label="Filter agents"
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowActiveOnly(false)}
            className={`btn-sm ${!showActiveOnly ? 'btn-primary' : 'btn-ghost'}`}
            aria-pressed={!showActiveOnly}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setShowActiveOnly(true)}
            className={`btn-sm ${showActiveOnly ? 'btn-primary' : 'btn-ghost'}`}
            aria-pressed={showActiveOnly}
          >
            <span className="status-dot-active mr-2" aria-hidden="true" />
            Active
          </button>
        </div>
        {data && (
          <span
            className="text-sm ml-auto"
            style={{ color: 'var(--text-tertiary)' }}
            aria-live="polite"
          >
            {data.total} result{data.total !== 1 ? 's' : ''}
          </span>
        )}
      </fieldset>

      {/* Loading State */}
      {isLoading && (
        <output className="flex flex-col items-center justify-center py-20">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-sm" style={{ color: 'var(--text-tertiary)' }}>
            Loading agents
          </p>
        </output>
      )}

      {/* Error State */}
      {error && (
        <div
          className="card-static p-8 text-center"
          role="alert"
          aria-live="assertive"
        >
          <div className="text-5xl mb-4" role="img" aria-label="Error">
            ⚠️
          </div>
          <h2
            className="text-xl font-bold mb-2"
            style={{ color: 'var(--color-error)' }}
          >
            Failed to load agents
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>{error.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-secondary mt-4"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty State */}
      {data && data.agents.length === 0 && (
        <div className="card-static p-12 text-center">
          <div
            className="text-6xl mb-6 animate-float"
            role="img"
            aria-label="Robot"
          >
            🤖
          </div>
          <h2
            className="text-2xl font-bold mb-3 font-display"
            style={{ color: 'var(--text-primary)' }}
          >
            {showActiveOnly ? 'No active agents' : 'No agents registered'}
          </h2>
          <p
            className="mb-6 max-w-md mx-auto"
            style={{ color: 'var(--text-secondary)' }}
          >
            {showActiveOnly
              ? 'No agents are currently active. Deploy a new one or check the full list.'
              : 'Deploy an agent to register it on-chain and create its vault.'}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/agents/new" className="btn-primary">
              Deploy Agent
            </Link>
            {showActiveOnly && (
              <button
                type="button"
                onClick={() => setShowActiveOnly(false)}
                className="btn-secondary"
              >
                Show All
              </button>
            )}
          </div>
        </div>
      )}

      {/* Agent Grid */}
      {data && data.agents.length > 0 && (
        <ul
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 stagger-children list-none"
          aria-label="Agent list"
        >
          {data.agents.map((agent) => (
            <li key={agent.agentId}>
              <AgentCard agent={agent} />
            </li>
          ))}
        </ul>
      )}

      {/* Load More */}
      {data?.hasMore && (
        <div className="text-center mt-10">
          <button type="button" className="btn-secondary">
            Load More
          </button>
        </div>
      )}
    </div>
  )
}
