/**
 * Agent Card Component
 */

import { Link } from 'react-router-dom'
import type { Agent } from '../hooks'
import { formatDistanceToNow } from '../lib/utils'

interface AgentCardProps {
  agent: Agent
}

const BOT_TYPE_LABELS: Record<
  string,
  { label: string; icon: string; className: string }
> = {
  ai_agent: { label: 'AI Agent', icon: '🤖', className: 'badge-primary' },
  trading_bot: { label: 'Trading Bot', icon: '📈', className: 'badge-accent' },
  org_tool: { label: 'Org Tool', icon: '🏢', className: 'badge-purple' },
}

export function AgentCard({ agent }: AgentCardProps) {
  const botType = BOT_TYPE_LABELS[agent.botType] ?? BOT_TYPE_LABELS.ai_agent

  return (
    <Link to={`/agents/${agent.agentId}`}>
      <div className="card p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="text-3xl">{botType.icon}</div>
          <div className="flex flex-col items-end gap-2">
            <span className={botType.className}>{botType.label}</span>
            <span className={agent.active ? 'badge-success' : 'badge-error'}>
              {agent.active ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>

        <h3
          className="text-lg font-bold mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          {agent.name}
        </h3>

        <div
          className="space-y-2 text-sm"
          style={{ color: 'var(--text-secondary)' }}
        >
          <div className="flex justify-between">
            <span>Executions:</span>
            <span className="font-medium">{agent.executionCount}</span>
          </div>
          <div className="flex justify-between">
            <span>Last Active:</span>
            <span className="font-medium">
              {agent.lastExecutedAt > 0
                ? formatDistanceToNow(agent.lastExecutedAt)
                : 'Never'}
            </span>
          </div>
        </div>

        <div
          className="mt-4 pt-4 border-t"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Owner:
            </span>
            <code
              className="text-xs font-mono px-2 py-1 rounded flex-1 truncate"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-tertiary)',
              }}
            >
              {agent.owner.slice(0, 6)}...{agent.owner.slice(-4)}
            </code>
          </div>
        </div>
      </div>
    </Link>
  )
}
