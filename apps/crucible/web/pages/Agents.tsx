/**
 * Agents Page
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
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1
            className="text-3xl font-bold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Agents
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Manage your deployed AI agents
          </p>
        </div>
        <Link to="/agents/new" className="btn-primary">
          + Create Agent
        </Link>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6">
        <button
          type="button"
          onClick={() => setShowActiveOnly(!showActiveOnly)}
          className={`btn-sm ${showActiveOnly ? 'btn-primary' : 'btn-secondary'}`}
        >
          {showActiveOnly ? 'Active Only' : 'Show All'}
        </button>
        {data && (
          <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {data.total} agent{data.total !== 1 ? 's' : ''} found
          </span>
        )}
      </div>

      {isLoading && (
        <div className="flex justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {error && (
        <div className="text-center py-20">
          <div className="text-4xl mb-4">⚠️</div>
          <p style={{ color: 'var(--color-error)' }}>{error.message}</p>
        </div>
      )}

      {data && data.agents.length === 0 && (
        <div className="text-center py-20">
          <div className="text-4xl mb-4">🤖</div>
          <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
            No agents found. Create your first agent to get started.
          </p>
          <Link to="/agents/new" className="btn-primary inline-block">
            Create Agent
          </Link>
        </div>
      )}

      {data && data.agents.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.agents.map((agent) => (
            <AgentCard key={agent.agentId} agent={agent} />
          ))}
        </div>
      )}

      {data?.hasMore && (
        <div className="text-center mt-8">
          <button type="button" className="btn-secondary">
            Load More
          </button>
        </div>
      )}
    </div>
  )
}
