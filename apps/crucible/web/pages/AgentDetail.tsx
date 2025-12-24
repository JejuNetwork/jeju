/**
 * Agent Detail Page
 */

import { Link, useParams } from 'react-router-dom'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useAgent, useAgentBalance } from '../hooks'
import { formatDistanceToNow } from '../lib/utils'

const BOT_TYPE_LABELS: Record<string, { label: string; icon: string }> = {
  ai_agent: { label: 'AI Agent', icon: '🤖' },
  trading_bot: { label: 'Trading Bot', icon: '📈' },
  org_tool: { label: 'Org Tool', icon: '🏢' },
}

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: agent, isLoading, error } = useAgent(id ?? '')
  const { data: balance } = useAgentBalance(id ?? '')

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (error || !agent) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-4">⚠️</div>
        <p style={{ color: 'var(--color-error)' }}>
          {error?.message ?? 'Agent not found'}
        </p>
        <Link to="/agents" className="btn-secondary mt-4 inline-block">
          Back to Agents
        </Link>
      </div>
    )
  }

  const botType = BOT_TYPE_LABELS[agent.botType] ?? BOT_TYPE_LABELS.ai_agent
  const balanceEth = balance ? (Number(balance) / 1e18).toFixed(4) : '0.0000'

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <Link
          to="/agents"
          className="text-sm flex items-center gap-1 mb-4"
          style={{ color: 'var(--text-tertiary)' }}
        >
          ← Back to Agents
        </Link>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="text-4xl">{botType.icon}</div>
            <div>
              <h1
                className="text-3xl font-bold mb-1"
                style={{ color: 'var(--text-primary)' }}
              >
                {agent.name}
              </h1>
              <div className="flex items-center gap-2">
                <span
                  className={agent.active ? 'badge-success' : 'badge-error'}
                >
                  {agent.active ? 'Active' : 'Inactive'}
                </span>
                <span className="badge-primary">{botType.label}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Link to={`/chat?agent=${id}`} className="btn-secondary">
              Chat
            </Link>
            <button type="button" className="btn-primary">
              Execute
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Stats */}
        <div className="card-static p-6">
          <h2
            className="text-lg font-bold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            Statistics
          </h2>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span style={{ color: 'var(--text-secondary)' }}>Executions</span>
              <span
                className="text-xl font-bold"
                style={{ color: 'var(--text-primary)' }}
              >
                {agent.executionCount}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span style={{ color: 'var(--text-secondary)' }}>
                Last Active
              </span>
              <span
                className="font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                {agent.lastExecutedAt > 0
                  ? formatDistanceToNow(agent.lastExecutedAt)
                  : 'Never'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span style={{ color: 'var(--text-secondary)' }}>Registered</span>
              <span
                className="font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                {formatDistanceToNow(agent.registeredAt)}
              </span>
            </div>
          </div>
        </div>

        {/* Vault */}
        <div className="card-static p-6">
          <h2
            className="text-lg font-bold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            Vault
          </h2>
          <div className="space-y-4">
            <div
              className="p-4 rounded-xl"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <p
                className="text-sm mb-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Balance
              </p>
              <p
                className="text-2xl font-bold"
                style={{ color: 'var(--text-primary)' }}
              >
                {balanceEth} ETH
              </p>
            </div>
            <button type="button" className="btn-secondary w-full">
              Fund Vault
            </button>
          </div>
        </div>

        {/* Addresses */}
        <div className="card-static p-6 md:col-span-2">
          <h2
            className="text-lg font-bold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            Addresses
          </h2>
          <div className="space-y-3">
            <div>
              <p
                className="text-sm mb-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Agent ID
              </p>
              <code
                className="text-sm font-mono px-3 py-2 rounded-lg block"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-secondary)',
                }}
              >
                {agent.agentId}
              </code>
            </div>
            <div>
              <p
                className="text-sm mb-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Owner
              </p>
              <code
                className="text-sm font-mono px-3 py-2 rounded-lg block"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-secondary)',
                }}
              >
                {agent.owner}
              </code>
            </div>
            <div>
              <p
                className="text-sm mb-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Vault Address
              </p>
              <code
                className="text-sm font-mono px-3 py-2 rounded-lg block"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-secondary)',
                }}
              >
                {agent.vaultAddress}
              </code>
            </div>
            {agent.characterCid && (
              <div>
                <p
                  className="text-sm mb-1"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Character CID
                </p>
                <code
                  className="text-sm font-mono px-3 py-2 rounded-lg block truncate"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {agent.characterCid}
                </code>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
