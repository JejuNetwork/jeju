import { useState } from 'react';
import { Clock, CheckCircle, XCircle, AlertCircle, ArrowRight, ExternalLink } from 'lucide-react';
import { useIntents } from '../hooks/useOIF';
import type { Intent, IntentStatus } from '../../../../../types/oif';

const STATUS_CONFIG: Record<IntentStatus, { color: string; icon: React.ReactNode; label: string }> = {
  open: { color: 'var(--info)', icon: <Clock size={14} />, label: 'Open' },
  pending: { color: 'var(--warning)', icon: <AlertCircle size={14} />, label: 'Pending' },
  filled: { color: 'var(--success)', icon: <CheckCircle size={14} />, label: 'Filled' },
  expired: { color: 'var(--text-secondary)', icon: <Clock size={14} />, label: 'Expired' },
  cancelled: { color: 'var(--text-secondary)', icon: <XCircle size={14} />, label: 'Cancelled' },
  failed: { color: 'var(--error)', icon: <XCircle size={14} />, label: 'Failed' },
};

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  11155111: 'Sepolia',
  42161: 'Arbitrum',
  10: 'Optimism',
  420691: 'Jeju',
  420690: 'Jeju Testnet',
};

export function IntentsView() {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const { data: intents, isLoading } = useIntents({ status: statusFilter || undefined, limit: 100 });

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
      {/* Filters */}
      <div style={{
        display: 'flex',
        gap: '12px',
        marginBottom: '24px',
      }}>
        {['', 'open', 'pending', 'filled', 'expired'].map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            style={{
              padding: '8px 16px',
              background: statusFilter === status ? 'var(--bg-tertiary)' : 'transparent',
              border: `1px solid ${statusFilter === status ? 'var(--border-accent)' : 'var(--border-subtle)'}`,
              borderRadius: '8px',
              color: statusFilter === status ? 'var(--text-accent)' : 'var(--text-secondary)',
              fontSize: '13px',
              fontWeight: 500,
            }}
          >
            {status || 'All'}
          </button>
        ))}
      </div>

      {/* Intent List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
            Loading intents...
          </div>
        ) : intents?.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
            No intents found
          </div>
        ) : (
          intents?.map((intent) => (
            <IntentCard key={intent.intentId} intent={intent} />
          ))
        )}
      </div>
    </div>
  );
}

function IntentCard({ intent }: { intent: Intent }) {
  const status = STATUS_CONFIG[intent.status];
  const sourceChain = CHAIN_NAMES[intent.sourceChainId] || `Chain ${intent.sourceChainId}`;
  const destChain = intent.outputs[0] ? CHAIN_NAMES[intent.outputs[0].chainId] || `Chain ${intent.outputs[0].chainId}` : '—';

  const inputAmount = intent.inputs[0] ? formatAmount(intent.inputs[0].amount) : '—';
  const outputAmount = intent.outputs[0] ? formatAmount(intent.outputs[0].amount) : '—';

  return (
    <div
      className="animate-slide-in"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '12px',
        padding: '20px',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* Left: ID and Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
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
              fontSize: '12px',
              fontWeight: 500,
            }}
          >
            {status.icon}
            {status.label}
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text-secondary)' }}>
              {intent.intentId.slice(0, 10)}...{intent.intentId.slice(-8)}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              {formatTime(intent.createdAt)}
            </div>
          </div>
        </div>

        {/* Center: Route */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <ChainBadge name={sourceChain} amount={inputAmount} />
          <ArrowRight size={20} color="var(--text-secondary)" />
          <ChainBadge name={destChain} amount={outputAmount} />
        </div>

        {/* Right: Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {intent.solver && (
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Solver: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-accent)' }}>
                {intent.solver.slice(0, 8)}...
              </span>
            </div>
          )}
          <button
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '6px 12px',
              background: 'transparent',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              color: 'var(--text-secondary)',
              fontSize: '12px',
            }}
          >
            <ExternalLink size={12} />
            View
          </button>
        </div>
      </div>
    </div>
  );
}

function ChainBadge({ name, amount }: { name: string; amount: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        fontSize: '16px',
        fontWeight: 600,
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-primary)',
      }}>
        {amount}
      </div>
      <div style={{
        fontSize: '12px',
        color: 'var(--text-secondary)',
        marginTop: '2px',
      }}>
        {name}
      </div>
    </div>
  );
}

function formatAmount(amount: string): string {
  const value = parseFloat(amount) / 1e18;
  if (value >= 1000) return `${(value / 1000).toFixed(2)}K`;
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString();
}

