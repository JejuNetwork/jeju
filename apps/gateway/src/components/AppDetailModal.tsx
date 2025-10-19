/**
 * @fileoverview Modal displaying detailed app/agent information
 * @module gateway/components/AppDetailModal
 */

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { X, ExternalLink, Trash2, Edit } from 'lucide-react';
import { useRegistryAppDetails, useRegistry } from '../hooks/useRegistry';
import { formatTokenAmount } from '../lib/tokenUtils';

interface AppDetailModalProps {
  agentId: bigint;
  onClose: () => void;
}

export default function AppDetailModal({ agentId, onClose }: AppDetailModalProps) {
  const { address } = useAccount();
  const { app, isLoading, refetch } = useRegistryAppDetails(agentId);
  const { withdrawStake } = useRegistry();
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const isOwner = app && address && app.owner.toLowerCase() === address.toLowerCase();

  const handleWithdraw = async () => {
    if (!isOwner) return;

    setIsWithdrawing(true);
    const result = await withdrawStake(agentId);
    setIsWithdrawing(false);

    if (result.success) {
      onClose();
    }
  };

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          maxWidth: '600px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '1rem',
            right: '1rem',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0.5rem',
          }}
        >
          <X size={24} />
        </button>

        {/* Loading State */}
        {isLoading && (
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⏳</div>
            <p>Loading app details...</p>
          </div>
        )}

        {/* App Details */}
        {!isLoading && app && (
          <div>
            {/* Header */}
            <div style={{ marginBottom: '2rem' }}>
              <h2 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>{app.name}</h2>
              <p style={{ color: '#64748b', fontSize: '0.875rem', fontFamily: 'monospace' }}>
                Agent ID: {agentId.toString()}
              </p>
            </div>

            {/* Description */}
            {app.description && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Description</h3>
                <p style={{ color: '#64748b' }}>{app.description}</p>
              </div>
            )}

            {/* Tags */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Categories</h3>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {app.tags.map((tag, idx) => (
                  <span
                    key={idx}
                    className="badge"
                    style={{
                      padding: '0.5rem 1rem',
                      borderRadius: '9999px',
                      background: '#f1f5f9',
                      color: '#475569',
                      border: '1px solid #cbd5e1',
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* A2A Endpoint */}
            {app.a2aEndpoint && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>A2A Endpoint</h3>
                <div style={{
                  padding: '0.75rem',
                  background: '#f8fafc',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}>
                  <code style={{ fontSize: '0.875rem', color: '#475569' }}>
                    {app.a2aEndpoint}
                  </code>
                  <a
                    href={app.a2aEndpoint}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#667eea', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                  >
                    <ExternalLink size={16} />
                  </a>
                </div>
              </div>
            )}

            {/* Stake Info */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Stake Information</h3>
              <div style={{
                padding: '1rem',
                background: '#f8fafc',
                borderRadius: '8px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ color: '#64748b' }}>Token:</span>
                  <span style={{ fontWeight: 600 }}>{app.stakeToken}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ color: '#64748b' }}>Amount:</span>
                  <span style={{ fontWeight: 600 }}>{app.stakeAmount}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ color: '#64748b' }}>Deposited:</span>
                  <span style={{ fontSize: '0.875rem' }}>
                    {new Date(Number(app.depositedAt) * 1000).toLocaleDateString()}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Status:</span>
                  <span className="badge-success" style={{ padding: '0.25rem 0.75rem', borderRadius: '9999px' }}>
                    Active
                  </span>
                </div>
              </div>
            </div>

            {/* Owner Info */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Owner</h3>
              <code style={{ 
                fontSize: '0.875rem',
                color: '#475569',
                padding: '0.75rem',
                background: '#f8fafc',
                borderRadius: '8px',
                display: 'block',
              }}>
                {app.owner}
              </code>
            </div>

            {/* Owner Actions */}
            {isOwner && (
              <div style={{
                padding: '1rem',
                background: '#fef3c7',
                border: '1px solid '#f59e0b',
                borderRadius: '8px',
                marginBottom: '1rem',
              }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', color: '#92400e' }}>
                  Owner Actions
                </h3>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button
                    className="button-secondary"
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                  >
                    <Edit size={16} />
                    Edit Details
                  </button>
                  <button
                    className="button"
                    onClick={handleWithdraw}
                    disabled={isWithdrawing}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      background: '#dc2626',
                    }}
                  >
                    <Trash2 size={16} />
                    {isWithdrawing ? 'Withdrawing...' : 'Withdraw & De-register'}
                  </button>
                </div>
                <p style={{ fontSize: '0.75rem', color: '#92400e', marginTop: '0.75rem', margin: 0 }}>
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


