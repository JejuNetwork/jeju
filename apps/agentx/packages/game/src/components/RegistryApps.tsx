/**
 * Registry Apps Browser
 * Displays apps discovered from the ERC-8004 registry
 */

import React, { useEffect, useState } from 'react';
import { API_BASE_URL } from '../config/api';

interface DiscoveredApp {
  agentId: bigint;
  name: string;
  description?: string;
  tags: string[];
  a2aEndpoint?: string;
  capabilities?: Array<{
    skillId: string;
    name: string;
    description: string;
  }>;
}

interface RegistryAppsProps {
  primaryAgentId?: string;
}

const TAG_ICONS: Record<string, string> = {
  app: '📱',
  game: '🎮',
  marketplace: '🏪',
  defi: '💰',
  social: '💬',
  'info-provider': '📊',
  service: '⚙️',
};

export const RegistryApps: React.FC<RegistryAppsProps> = ({ primaryAgentId }) => {
  const [apps, setApps] = useState<DiscoveredApp[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedApp, setSelectedApp] = useState<DiscoveredApp | null>(null);
  const [filterTag, setFilterTag] = useState<string>('all');

  useEffect(() => {
    if (!primaryAgentId) return;

    const fetchApps = async () => {
      setIsLoading(true);
      
      // Call the DISCOVER_APPS action via agent API
      const response = await fetch(`${API_BASE_URL}/agents/${primaryAgentId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'DISCOVER_APPS',
          parameters: { tag: filterTag === 'all' ? undefined : filterTag },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setApps(data.apps || []);
      }

      setIsLoading(false);
    };

    fetchApps();
  }, [primaryAgentId, filterTag]);

  const connectToApp = async (app: DiscoveredApp) => {
    if (!primaryAgentId) return;

    const response = await fetch(`${API_BASE_URL}/agents/${primaryAgentId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'CONNECT_TO_APP',
        parameters: { agentId: app.agentId.toString() },
      }),
    });

    if (response.ok) {
      const result = await response.json();
      setSelectedApp({ ...app, capabilities: result.capabilities });
    }
  };

  const filteredApps = filterTag === 'all' 
    ? apps 
    : apps.filter((app) => app.tags.includes(filterTag));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '12px' }}>
      {/* Header */}
      <div style={{ marginBottom: '12px', borderBottom: '1px solid rgba(0, 255, 65, 0.3)', paddingBottom: '8px' }}>
        <h3 style={{ 
          color: 'var(--terminal-green-bright)', 
          fontSize: '14px',
          margin: 0,
          textTransform: 'uppercase',
          letterSpacing: '1px',
        }}>
          📚 REGISTERED APPS
        </h3>
        <p style={{ color: 'var(--terminal-green-dim)', fontSize: '11px', margin: '4px 0 0 0' }}>
          Apps discovered from ERC-8004 registry
        </p>
      </div>

      {/* Tag Filters */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {['all', 'game', 'marketplace', 'defi', 'service', 'info-provider'].map((tag) => (
          <button
            key={tag}
            onClick={() => setFilterTag(tag)}
            style={{
              padding: '4px 8px',
              fontSize: '10px',
              background: filterTag === tag ? 'rgba(0, 255, 65, 0.2)' : 'transparent',
              border: `1px solid ${filterTag === tag ? 'var(--terminal-green)' : 'rgba(0, 255, 65, 0.3)'}`,
              color: filterTag === tag ? 'var(--terminal-green-bright)' : 'var(--terminal-green-dim)',
              cursor: 'pointer',
              borderRadius: '4px',
              textTransform: 'uppercase',
              transition: 'all 0.2s',
            }}
          >
            {tag}
          </button>
        ))}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--terminal-green-dim)' }}>
          <div className="loading-spinner" />
          <p>Loading registry...</p>
        </div>
      )}

      {/* Apps List */}
      {!isLoading && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredApps.length === 0 && (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--terminal-green-dim)' }}>
              <p>No apps found{filterTag !== 'all' ? ` with tag "${filterTag}"` : ''}</p>
            </div>
          )}

          {filteredApps.map((app) => (
            <div
              key={app.agentId.toString()}
              onClick={() => setSelectedApp(app)}
              style={{
                padding: '10px',
                marginBottom: '8px',
                border: '1px solid rgba(0, 255, 65, 0.3)',
                borderRadius: '4px',
                cursor: 'pointer',
                background: selectedApp?.agentId === app.agentId 
                  ? 'rgba(0, 255, 65, 0.1)' 
                  : 'transparent',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(0, 255, 65, 0.15)';
                e.currentTarget.style.borderColor = 'var(--terminal-green)';
              }}
              onMouseLeave={(e) => {
                if (selectedApp?.agentId !== app.agentId) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = 'rgba(0, 255, 65, 0.3)';
                }
              }}
            >
              {/* App Header */}
              <div style={{ display: 'flex', alignItems: 'start', gap: '8px', marginBottom: '6px' }}>
                <span style={{ fontSize: '20px' }}>
                  {app.tags[0] ? TAG_ICONS[app.tags[0]] || '🔷' : '🔷'}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ 
                    color: 'var(--terminal-green-bright)', 
                    fontSize: '13px',
                    fontWeight: 600,
                  }}>
                    {app.name}
                  </div>
                  <div style={{ 
                    color: 'var(--terminal-green-dim)', 
                    fontSize: '10px',
                    fontFamily: 'monospace',
                  }}>
                    ID: {app.agentId.toString()}
                  </div>
                </div>
              </div>

              {/* Description */}
              {app.description && (
                <p style={{ 
                  fontSize: '11px',
                  color: 'var(--terminal-green-dim)',
                  margin: '0 0 6px 0',
                  lineHeight: '1.4',
                }}>
                  {app.description}
                </p>
              )}

              {/* Tags */}
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' }}>
                {app.tags.map((tag, idx) => (
                  <span
                    key={idx}
                    style={{
                      fontSize: '9px',
                      padding: '2px 6px',
                      borderRadius: '3px',
                      background: 'rgba(0, 255, 65, 0.2)',
                      color: 'var(--terminal-green)',
                      border: '1px solid rgba(0, 255, 65, 0.3)',
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>

              {/* A2A Status */}
              {app.a2aEndpoint && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <div style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: 'var(--terminal-green-bright)',
                    boxShadow: '0 0 4px var(--terminal-green-bright)',
                  }} />
                  <span style={{ fontSize: '10px', color: 'var(--terminal-green)' }}>
                    A2A Enabled
                  </span>
                </div>
              )}

              {/* Connect Button */}
              {app.a2aEndpoint && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    connectToApp(app);
                  }}
                  style={{
                    marginTop: '8px',
                    padding: '6px 12px',
                    fontSize: '11px',
                    background: 'rgba(0, 255, 65, 0.2)',
                    border: '1px solid var(--terminal-green)',
                    color: 'var(--terminal-green-bright)',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    width: '100%',
                  }}
                >
                  Connect
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Selected App Details */}
      {selectedApp && selectedApp.capabilities && (
        <div style={{
          marginTop: '12px',
          padding: '12px',
          border: '1px solid var(--terminal-green)',
          borderRadius: '4px',
          background: 'rgba(0, 255, 65, 0.05)',
        }}>
          <h4 style={{ 
            color: 'var(--terminal-green-bright)',
            fontSize: '12px',
            margin: '0 0 8px 0',
            textTransform: 'uppercase',
          }}>
            {selectedApp.name} - Capabilities
          </h4>
          <div style={{ fontSize: '11px', color: 'var(--terminal-green)' }}>
            {selectedApp.capabilities.map((cap, idx) => (
              <div key={idx} style={{ marginBottom: '4px' }}>
                <strong>{cap.name}:</strong> {cap.description}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

