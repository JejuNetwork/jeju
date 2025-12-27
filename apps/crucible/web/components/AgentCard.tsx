/**
 * Agent Card Component
 *
 * Displays an agent summary card in the agents list
 */

import { Link } from 'react-router-dom'
import type { Agent } from '../hooks'
import { getBotTypeConfig } from '../lib/constants'
import { formatDistanceToNow } from '../lib/utils'

interface AgentCardProps {
  agent: Agent
}

export function AgentCard({ agent }: AgentCardProps) {
  const botType = getBotTypeConfig(agent.botType)

  return (
    <Link
      to={`/agents/${agent.agentId}`}
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded-2xl"
      aria-label={`View ${agent.name} details`}
    >
      <article className="card p-6 h-full">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="text-4xl flex-shrink-0" role="img" aria-hidden="true">
            {botType.icon}
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={botType.badgeClass}>{botType.label}</span>
            <span className={agent.active ? 'badge-success' : 'badge-error'}>
              <span
                className={`w-1.5 h-1.5 rounded-full ${agent.active ? 'bg-current' : 'bg-current'}`}
                aria-hidden="true"
              />
              {agent.active ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>

        {/* Name */}
        <h3
          className="text-lg font-bold mb-3 font-display truncate"
          style={{ color: 'var(--text-primary)' }}
        >
          {agent.name}
        </h3>

        {/* Stats */}
        <dl
          className="space-y-2 text-sm"
          style={{ color: 'var(--text-secondary)' }}
        >
          <div className="flex justify-between items-center">
            <dt>Executions</dt>
            <dd
              className="font-semibold tabular-nums"
              style={{ color: 'var(--text-primary)' }}
            >
              {agent.executionCount.toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between items-center">
            <dt>Last Active</dt>
            <dd className="font-medium">
              {agent.lastExecutedAt > 0
                ? formatDistanceToNow(agent.lastExecutedAt)
                : 'Never'}
            </dd>
          </div>
        </dl>

        {/* Owner */}
        <div
          className="mt-4 pt-4 border-t flex items-center gap-2"
          style={{ borderColor: 'var(--border)' }}
        >
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Owner
          </span>
          <code
            className="text-xs font-mono px-2 py-1 rounded-lg flex-1 truncate"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-tertiary)',
            }}
          >
            {agent.owner.slice(0, 6)}...{agent.owner.slice(-4)}
          </code>
        </div>
      </article>
    </Link>
  )
}
