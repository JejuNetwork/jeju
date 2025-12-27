import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  Clock,
  ExternalLink,
  type LucideProps,
  XCircle,
} from 'lucide-react'
import { type ComponentType, useState } from 'react'
import { type Intent, useIntents } from '../../hooks/useIntentAPI'

type IntentStatus = string

const ClockIcon = Clock as ComponentType<LucideProps>
const AlertCircleIcon = AlertCircle as ComponentType<LucideProps>
const CheckCircleIcon = CheckCircle as ComponentType<LucideProps>
const XCircleIcon = XCircle as ComponentType<LucideProps>
const ExternalLinkIcon = ExternalLink as ComponentType<LucideProps>
const ArrowRightIcon = ArrowRight as ComponentType<LucideProps>

const STATUS_CONFIG: Record<
  IntentStatus,
  { color: string; icon: React.ReactNode; label: string }
> = {
  open: {
    color: 'var(--chain-jeju)',
    icon: <ClockIcon size={14} />,
    label: 'Open',
  },
  pending: {
    color: 'var(--warning-bright)',
    icon: <AlertCircleIcon size={14} />,
    label: 'Pending',
  },
  filled: {
    color: 'var(--success-bright)',
    icon: <CheckCircleIcon size={14} />,
    label: 'Filled',
  },
  expired: {
    color: 'var(--text-muted)',
    icon: <ClockIcon size={14} />,
    label: 'Expired',
  },
  cancelled: {
    color: 'var(--text-muted)',
    icon: <XCircleIcon size={14} />,
    label: 'Cancelled',
  },
  failed: {
    color: 'var(--error-bright)',
    icon: <XCircleIcon size={14} />,
    label: 'Failed',
  },
}

function getStatusConfig(status: string) {
  const config = STATUS_CONFIG[status]
  if (!config) {
    throw new Error(`Unknown intent status: ${status}`)
  }
  return config
}

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  11155111: 'Sepolia',
  42161: 'Arbitrum',
  10: 'Optimism',
  420691: 'Network',
  420690: 'Testnet',
  31337: 'Localnet',
}

export function IntentsView() {
  const [statusFilter, setStatusFilter] = useState<string>('')
  const { data: intents, isLoading } = useIntents({
    status: statusFilter || undefined,
    limit: 100,
  })

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
        }}
      >
        {['', 'open', 'pending', 'filled', 'expired'].map((status) => (
          <button
            type="button"
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`pill ${statusFilter === status ? 'pill-active' : ''}`}
          >
            {status === '' ? 'All' : status}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {isLoading ? (
          <div className="empty-state">
            <div className="spinner" style={{ margin: '0 auto 1rem' }} />
            <p>Loading intents...</p>
          </div>
        ) : intents?.length === 0 ? (
          <div className="empty-state">
            <p>No intents yet. Create one to get started.</p>
          </div>
        ) : (
          intents?.map((intent) => (
            <IntentCard key={intent.intentId} intent={intent} />
          ))
        )}
      </div>
    </div>
  )
}

function IntentCard({ intent }: { intent: Intent }) {
  const status = getStatusConfig(intent.status)
  const sourceChain =
    CHAIN_NAMES[intent.sourceChainId] || `Chain ${intent.sourceChainId}`
  const destChain = intent.outputs[0]
    ? CHAIN_NAMES[intent.outputs[0].chainId] ||
      `Chain ${intent.outputs[0].chainId}`
    : '—'
  const inputAmount = intent.inputs[0]
    ? formatAmount(intent.inputs[0].amount)
    : '—'
  const outputAmount = intent.outputs[0]
    ? formatAmount(intent.outputs[0].amount)
    : '—'

  return (
    <div className="card" style={{ padding: '1rem', marginBottom: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* Top row: Status + ID */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                background: `${status.color}20`,
                border: `1px solid ${status.color}40`,
                borderRadius: '6px',
                color: status.color,
                fontSize: '0.75rem',
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              {status.icon}
              {status.label}
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.8125rem',
                  color: 'var(--text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {intent.intentId.slice(0, 10)}...{intent.intentId.slice(-8)}
              </div>
              <div
                style={{
                  fontSize: '0.6875rem',
                  color: 'var(--text-muted)',
                  marginTop: '2px',
                }}
              >
                {formatTime(intent.createdAt)}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="button button-ghost"
            style={{
              flexShrink: 0,
              padding: '0.375rem 0.75rem',
              fontSize: '0.75rem',
            }}
          >
            <ExternalLinkIcon size={12} />
            View
          </button>
        </div>

        {/* Route */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            padding: '0.75rem',
            background: 'var(--surface-hover)',
            borderRadius: 'var(--radius-md)',
            flexWrap: 'wrap',
          }}
        >
          <ChainBadge name={sourceChain} amount={inputAmount} />
          <ArrowRightIcon size={18} color="var(--text-muted)" />
          <ChainBadge name={destChain} amount={outputAmount} />
        </div>

        {/* Solver info */}
        {intent.solver && (
          <div
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
              textAlign: 'center',
            }}
          >
            Solver:{' '}
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                color: 'var(--accent-primary)',
              }}
            >
              {intent.solver.slice(0, 8)}...{intent.solver.slice(-4)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function ChainBadge({ name, amount }: { name: string; amount: string }) {
  return (
    <div style={{ textAlign: 'center', minWidth: '80px' }}>
      <div
        style={{
          fontSize: '1.125rem',
          fontWeight: 700,
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-primary)',
        }}
      >
        {amount}
      </div>
      <div
        style={{
          fontSize: '0.75rem',
          color: 'var(--text-secondary)',
          marginTop: '2px',
        }}
      >
        {name}
      </div>
    </div>
  )
}

function formatAmount(amount: string): string {
  const value = parseFloat(amount) / 1e18
  if (value >= 1000) return `${(value / 1000).toFixed(2)}K`
  if (value >= 1) return value.toFixed(4)
  return value.toFixed(6)
}

function formatTime(timestamp: number | undefined): string {
  if (!timestamp) return 'Unknown'
  const diff = Date.now() - timestamp
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return new Date(timestamp).toLocaleDateString()
}
