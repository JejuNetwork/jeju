import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { X, ExternalLink, Trash2, Edit, Github } from 'lucide-react';
import { useRegistryAppDetails, useRegistry, IDENTITY_REGISTRY_ADDRESS } from '../hooks/useRegistry';
import GitHubReputationPanel from './GitHubReputationPanel';

interface AppDetailModalProps {
  agentId: bigint;
  onClose: () => void;
}

export default function AppDetailModal({ agentId, onClose }: AppDetailModalProps) {
  const { address } = useAccount();
  const { app, isLoading } = useRegistryAppDetails(agentId);
  const { withdrawStake } = useRegistry();
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const isOwner = app && address && app.owner.toLowerCase() === address.toLowerCase();

  const handleWithdraw = async () => {
    if (!isOwner) return;
    setIsWithdrawing(true);
    const result = await withdrawStake(agentId);
    setIsWithdrawing(false);
    if (result.success) onClose();
  };

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }} onClick={onClose}>
      <div className="card" style={{ maxWidth: '600px', width: '100%', maxHeight: '90vh', overflow: 'auto', position: 'relative' }} onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', cursor: 'pointer', padding: '0.5rem' }}>
          <X size={24} />
        </button>

        {isLoading && (
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⏳</div>
            <p>Loading app details...</p>
          </div>
        )}

        {!isLoading && app && (
          <div>
            <div style={{ marginBottom: '1.5rem', paddingRight: '2rem' }}>
              <h2 style={{ fontSize: 'clamp(1.25rem, 4vw, 1.75rem)', marginBottom: '0.5rem', wordBreak: 'break-word' }}>{app.name}</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontFamily: 'var(--font-mono)' }}>Agent ID: {agentId.toString()}</p>
            </div>

            {app.description && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Description</h3>
                <p style={{ color: 'var(--text-secondary)' }}>{app.description}</p>
              </div>
            )}

            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Categories</h3>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {app.tags.map((tag: string, idx: number) => (
                  <span key={idx} className="pill">{tag}</span>
                ))}
              </div>
            </div>

            {app.a2aEndpoint && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>A2A Endpoint</h3>
                <div style={{ padding: '0.75rem', background: 'var(--surface-hover)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                  <code style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', wordBreak: 'break-all', minWidth: 0 }}>{app.a2aEndpoint}</code>
                  <a href={app.a2aEndpoint} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)', flexShrink: 0 }}><ExternalLink size={16} /></a>
                </div>
              </div>
            )}

            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Stake Information</h3>
              <div style={{ padding: '1rem', background: 'var(--surface-hover)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Token:</span>
                  <span style={{ fontWeight: 600 }}>{app.stakeToken}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Amount:</span>
                  <span style={{ fontWeight: 600 }}>{app.stakeAmount}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Deposited:</span>
                  <span>{new Date(Number(app.depositedAt) * 1000).toLocaleDateString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Status:</span>
                  <span className="badge badge-success">Active</span>
                </div>
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Owner</h3>
              <code style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', padding: '0.75rem', background: 'var(--surface-hover)', borderRadius: 'var(--radius-md)', display: 'block', wordBreak: 'break-all' }}>
                {app.owner}
              </code>
            </div>

            {/* GitHub Developer Reputation */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Github size={18} />Developer Reputation
              </h3>
              <GitHubReputationPanel
                agentId={agentId}
                registryAddress={IDENTITY_REGISTRY_ADDRESS}
              />
            </div>

            {isOwner && (
              <div className="banner banner-warning" style={{ flexDirection: 'column', alignItems: 'stretch', marginBottom: 0 }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--warning)' }}>Owner Actions</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
                  <button className="button button-secondary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                    <Edit size={16} />Edit
                  </button>
                  <button className="button" onClick={handleWithdraw} disabled={isWithdrawing} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: 'var(--error)' }}>
                    <Trash2 size={16} />{isWithdrawing ? 'Withdrawing...' : 'Withdraw'}
                  </button>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--warning)', marginTop: '0.75rem' }}>
                  Withdrawing will de-register your app and refund your full stake
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
