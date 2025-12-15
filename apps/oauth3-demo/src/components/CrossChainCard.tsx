import { Globe, ArrowRight, CheckCircle, Clock } from 'lucide-react';
import type { OAuth3Session, OAuth3Identity } from '../hooks/useOAuth3';

interface CrossChainCardProps {
  identity: OAuth3Identity | null;
  session: OAuth3Session;
}

const SUPPORTED_CHAINS = [
  { id: 420691, name: 'Jeju', status: 'deployed' as const },
  { id: 8453, name: 'Base', status: 'available' as const },
  { id: 1, name: 'Ethereum', status: 'available' as const },
  { id: 42161, name: 'Arbitrum', status: 'available' as const },
  { id: 10, name: 'Optimism', status: 'available' as const },
];

export function CrossChainCard({ identity, session: _session }: CrossChainCardProps) {
  // _session kept for API - will be used for cross-chain intent signing
  if (!identity) {
    return null;
  }

  return (
    <div className="card" style={{ marginTop: '1.5rem' }}>
      <div className="card-header">
        <Globe size={20} />
        <div>
          <h3 className="card-title">Cross-Chain Identity</h3>
          <p className="card-subtitle">Deploy your identity across multiple chains</p>
        </div>
      </div>

      <div style={{ 
        display: 'flex', 
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.75rem 1rem',
        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%)',
        borderRadius: 'var(--radius-sm)',
        marginBottom: '1.5rem',
        fontSize: '0.875rem'
      }}>
        <Globe size={16} style={{ color: 'var(--accent-primary)' }} />
        <span>Same identity, same address, every chain.</span>
      </div>

      {/* Chain Status Grid */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: '0.75rem'
      }}>
        {SUPPORTED_CHAINS.map((chain) => (
          <div
            key={chain.id}
            style={{
              padding: '1rem',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-sm)',
              border: chain.status === 'deployed' 
                ? '1px solid var(--success)' 
                : '1px solid var(--border)',
            }}
          >
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: '0.5rem'
            }}>
              <span style={{ fontWeight: 500 }}>{chain.name}</span>
              {chain.status === 'deployed' ? (
                <CheckCircle size={14} style={{ color: 'var(--success)' }} />
              ) : (
                <Clock size={14} style={{ color: 'var(--text-muted)' }} />
              )}
            </div>
            <div style={{ 
              fontSize: '0.75rem', 
              color: chain.status === 'deployed' ? 'var(--success)' : 'var(--text-muted)'
            }}>
              {chain.status === 'deployed' ? 'Deployed' : 'Available'}
            </div>
          </div>
        ))}
      </div>

      {/* Intent Actions */}
      <div style={{ marginTop: '1.5rem' }}>
        <div style={{ 
          fontSize: '0.75rem', 
          color: 'var(--text-muted)', 
          textTransform: 'uppercase',
          marginBottom: '0.75rem'
        }}>
          Quick Actions
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <button className="button button-secondary" disabled>
            <ArrowRight size={14} />
            Deploy to Base
          </button>
          <button className="button button-secondary" disabled>
            <ArrowRight size={14} />
            Sync to Arbitrum
          </button>
          <button className="button button-secondary" disabled>
            <Globe size={14} />
            Cross-Chain Transfer
          </button>
        </div>
        <p style={{ 
          fontSize: '0.75rem', 
          color: 'var(--text-muted)',
          marginTop: '0.75rem'
        }}>
          Cross-chain actions use the Open Intents Framework for trustless execution.
        </p>
      </div>
    </div>
  );
}
