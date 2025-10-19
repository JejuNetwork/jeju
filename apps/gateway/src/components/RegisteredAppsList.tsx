/**
 * @fileoverview List of registered apps/agents from IdentityRegistry
 * @module gateway/components/RegisteredAppsList
 */

import { useState } from 'react';
import { useRegisteredApps } from '../hooks/useRegistry';
import { Loader, RefreshCw, Book } from 'lucide-react';

interface RegisteredAppsListProps {
  onSelectApp: (agentId: bigint) => void;
}

const TAG_FILTERS = [
  { value: 'all', label: 'All Apps' },
  { value: 'app', label: 'Applications' },
  { value: 'game', label: 'Games' },
  { value: 'marketplace', label: 'Marketplaces' },
  { value: 'defi', label: 'DeFi' },
  { value: 'social', label: 'Social' },
  { value: 'info-provider', label: 'Information' },
  { value: 'service', label: 'Services' },
];

const TAG_ICONS: Record<string, string> = {
  app: '📱',
  game: '🎮',
  marketplace: '🏪',
  defi: '💰',
  social: '💬',
  'info-provider': '📊',
  service: '⚙️',
};

export default function RegisteredAppsList({ onSelectApp }: RegisteredAppsListProps) {
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const { apps, isLoading, refetch } = useRegisteredApps(selectedTag === 'all' ? undefined : selectedTag);

  return (
    <div>
      {/* Tag Filters */}
      <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {TAG_FILTERS.map((filter) => (
          <button
            key={filter.value}
            className={selectedTag === filter.value ? 'badge' : 'badge-secondary'}
            onClick={() => setSelectedTag(filter.value)}
            style={{
              padding: '0.5rem 1rem',
              border: selectedTag === filter.value ? '2px solid #667eea' : '1px solid #cbd5e1',
              background: selectedTag === filter.value ? '#667eea' : 'white',
              color: selectedTag === filter.value ? 'white' : '#64748b',
              borderRadius: '9999px',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 500,
            }}
          >
            {filter.label}
          </button>
        ))}
        <button
          onClick={() => refetch()}
          className="button-secondary"
          style={{ marginLeft: 'auto', padding: '0.5rem 1rem' }}
        >
          <RefreshCw size={16} style={{ display: 'inline', marginRight: '0.5rem' }} />
          Refresh
        </button>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <Loader size={32} style={{ animation: 'spin 1s linear infinite', color: '#667eea', margin: '0 auto' }} />
          <p style={{ marginTop: '1rem', color: '#64748b' }}>Loading registered apps...</p>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && apps && apps.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <Book size={48} style={{ margin: '0 auto 1rem', color: '#94a3b8' }} />
          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>No Apps Found</h3>
          <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>
            {selectedTag === 'all' 
              ? 'No apps registered yet. Be the first to register!'
              : `No apps with tag "${selectedTag}" found.`}
          </p>
          <button
            className="button"
            onClick={() => setSelectedTag('all')}
            style={{ display: selectedTag === 'all' ? 'none' : 'inline-block' }}
          >
            Show All Apps
          </button>
        </div>
      )}

      {/* Apps Grid */}
      {!isLoading && apps && apps.length > 0 && (
        <div className="grid grid-3" style={{ gap: '1.5rem' }}>
          {apps.map((app) => (
            <div
              key={app.agentId.toString()}
              className="card"
              style={{
                cursor: 'pointer',
                transition: 'all 0.2s',
                border: '1px solid #e2e8f0',
                padding: '1.5rem',
              }}
              onClick={() => onSelectApp(app.agentId)}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-4px)';
                e.currentTarget.style.boxShadow = '0 8px 16px rgba(102, 126, 234, 0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              {/* App Header */}
              <div style={{ display: 'flex', alignItems: 'start', marginBottom: '1rem' }}>
                <div style={{ 
                  width: '48px', 
                  height: '48px', 
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, #667eea, #764ba2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '24px',
                  marginRight: '1rem',
                }}>
                  {app.tags[0] ? TAG_ICONS[app.tags[0]] || '🔷' : '🔷'}
                </div>
                <div style={{ flex: 1 }}>
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                    {app.name}
                  </h3>
                  <p style={{ fontSize: '0.75rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                    ID: {app.agentId.toString()}
                  </p>
                </div>
              </div>

              {/* Tags */}
              {app.tags.length > 0 && (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                  {app.tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="badge"
                      style={{
                        padding: '0.25rem 0.75rem',
                        borderRadius: '9999px',
                        fontSize: '0.75rem',
                        background: '#f1f5f9',
                        color: '#475569',
                        border: '1px solid #cbd5e1',
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Stake Info */}
              <div style={{ 
                padding: '0.75rem',
                background: '#f8fafc',
                borderRadius: '8px',
                fontSize: '0.875rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <span style={{ color: '#64748b' }}>Stake:</span>
                  <span style={{ fontWeight: 600 }}>
                    {app.stakeAmount} {app.stakeToken}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Owner:</span>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {app.owner.slice(0, 6)}...{app.owner.slice(-4)}
                  </span>
                </div>
              </div>

              {/* A2A Status */}
              {app.a2aEndpoint && (
                <div style={{ 
                  marginTop: '0.75rem',
                  padding: '0.5rem',
                  background: '#ecfdf5',
                  border: '1px solid #059669',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  color: '#047857',
                  textAlign: 'center',
                }}>
                  ✅ A2A Enabled
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


