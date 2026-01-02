import { Link } from 'react-router-dom'
import type { Agent } from '../hooks'
import { getBotTypeConfig } from '../lib/constants'
import { formatDistanceToNow } from '../lib/utils'

interface AgentCardProps {
  agent: Agent
}

const CAPABILITY_ICONS: Record<string, { icon: string; label: string }> = {
  canChat: { icon: '💬', label: 'Chat' },
  canTrade: { icon: '📈', label: 'Trade' },
  canVote: { icon: '🗳️', label: 'Vote' },
  canPropose: { icon: '📝', label: 'Propose' },
  canStake: { icon: '🔒', label: 'Stake' },
  a2a: { icon: '🤝', label: 'A2A' },
  compute: { icon: '🧮', label: 'Compute' },
  autonomous: { icon: '🔄', label: 'Auto' },
}

export function AgentCard({ agent }: AgentCardProps) {
  const botType = getBotTypeConfig(agent.botType)

  // Extract capabilities from agent data
  const capabilities = agent.capabilities ?? {}
  const activeCapabilities = Object.entries(capabilities)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key)

  // Add autonomous if tick interval is set
  if (agent.tickIntervalMs && agent.tickIntervalMs > 0) {
    activeCapabilities.push('autonomous')
  }

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
                className="w-1.5 h-1.5 rounded-full bg-current"
                aria-hidden="true"
              />
              {agent.active ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>

        {/* Name & Description */}
        <h3
          className="text-lg font-bold mb-1 font-display truncate"
          style={{ color: 'var(--text-primary)' }}
        >
          {agent.name}
        </h3>
        {agent.description && (
          <p
            className="text-sm mb-3 line-clamp-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            {agent.description}
          </p>
        )}

        {/* Capabilities */}
        {activeCapabilities.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-4">
            {activeCapabilities.slice(0, 4).map((cap) => {
              const config = CAPABILITY_ICONS[cap] ?? { icon: '✓', label: cap }
              return (
                <span
                  key={cap}
                  className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs"
                  style={{
                    backgroundColor: 'rgba(99, 102, 241, 0.1)',
                    color: 'var(--color-primary)',
                  }}
                  title={config.label}
                >
                  <span aria-hidden="true">{config.icon}</span>
                  <span className="hidden sm:inline">{config.label}</span>
                </span>
              )
            })}
            {activeCapabilities.length > 4 && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-tertiary)',
                }}
              >
                +{activeCapabilities.length - 4}
              </span>
            )}
          </div>
        )}

        {/* Stats */}
        <dl
          className="grid grid-cols-2 gap-2 text-sm"
          style={{ color: 'var(--text-secondary)' }}
        >
          <div className="flex flex-col">
            <dt className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Executions
            </dt>
            <dd
              className="font-bold tabular-nums text-base"
              style={{ color: 'var(--text-primary)' }}
            >
              {agent.executionCount.toLocaleString()}
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Last Active
            </dt>
            <dd className="font-medium text-base">
              {agent.lastExecutedAt > 0
                ? formatDistanceToNow(agent.lastExecutedAt)
                : 'Never'}
            </dd>
          </div>
        </dl>

        {/* Footer: Owner + Vault */}
        <div
          className="mt-4 pt-4 border-t flex items-center justify-between gap-2"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="text-xs whitespace-nowrap"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Owner
            </span>
            <code
              className="text-xs font-mono px-2 py-1 rounded-lg truncate"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-tertiary)',
              }}
            >
              {agent.owner.slice(0, 6)}...{agent.owner.slice(-4)}
            </code>
          </div>
          {agent.vaultBalance && BigInt(agent.vaultBalance) > 0n && (
            <span
              className="text-xs font-mono px-2 py-1 rounded-lg whitespace-nowrap"
              style={{
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                color: 'var(--color-success)',
              }}
            >
              {formatBalance(agent.vaultBalance)} ETH
            </span>
          )}
        </div>
      </article>
    </Link>
  )
}

function formatBalance(wei: string): string {
  const value = BigInt(wei)
  const eth = Number(value) / 1e18
  if (eth >= 1) return eth.toFixed(2)
  if (eth >= 0.01) return eth.toFixed(3)
  if (eth >= 0.001) return eth.toFixed(4)
  return '<0.001'
}
