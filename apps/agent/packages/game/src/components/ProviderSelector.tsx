import React, { useState, useEffect } from 'react';

interface Provider {
  name: string;
  display_name: string;
  enabled: boolean;
  requires_api_key: boolean;
  status: 'available' | 'not_configured' | 'error';
  message: string;
}

interface ProviderStatus {
  providers: Provider[];
  active: string;
  selected: string | null;
  preferences: string[];
}

interface ProviderResponse {
  success: boolean;
  data: ProviderStatus;
}

interface ProviderSelectorProps {
  onProviderChange?: (provider: string) => void;
}

export const ProviderSelector: React.FC<ProviderSelectorProps> = ({ onProviderChange }) => {
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isTauri, setIsTauri] = useState(false);

  // Check if we're in Tauri environment
  useEffect(() => {
    const checkTauri = async () => {
      try {
        await import('@tauri-apps/api/core');
        setIsTauri(true);
      } catch {
        setIsTauri(false);
        setLoading(false);
        setError('This component requires the Tauri desktop app');
      }
    };
    checkTauri();
  }, []);

  // Fetch provider status
  const fetchProviders = async () => {
    if (!isTauri) return;

    try {
      setLoading(true);
      const { invoke } = await import('@tauri-apps/api/core');
      const response = await invoke<ProviderResponse>('get_available_providers');
      if (response.success && response.data) {
        setProviderStatus(response.data);
      } else {
        setError('Failed to fetch providers');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  // Set selected provider
  const handleProviderChange = async (provider: string | null) => {
    if (!isTauri) return;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const response = await invoke<{ success: boolean }>('set_selected_provider', {
        provider,
      });
      if (response.success) {
        await fetchProviders(); // Refresh status
        if (onProviderChange && provider) {
          onProviderChange(provider);
        }
      }
    } catch (err) {
      console.error('Failed to set provider:', err);
    }
  };

  useEffect(() => {
    if (isTauri) {
      fetchProviders();
      // Poll for updates every 30 seconds
      const interval = setInterval(fetchProviders, 30000);
      return () => clearInterval(interval);
    }
  }, [isTauri]);

  if (loading) {
    return <div className="provider-selector loading">Loading providers...</div>;
  }

  if (error) {
    return <div className="provider-selector error">Error: {error}</div>;
  }

  if (!providerStatus) {
    return <div className="provider-selector">No provider data available</div>;
  }

  const availableProviders = providerStatus.providers.filter((p) => p.status === 'available');
  const currentProvider = providerStatus.selected || providerStatus.active;

  return (
    <div className="provider-selector">
      <div className="provider-header">
        <h3>AI Provider Selection</h3>
        <button className="refresh-btn" onClick={fetchProviders} title="Refresh provider status">
          ↻
        </button>
      </div>

      <div className="current-provider">
        <label>Active Provider:</label>
        <span className="provider-name">
          {providerStatus.providers.find((p) => p.name === currentProvider)?.displayName ||
            currentProvider}
        </span>
      </div>

      <div className="provider-list">
        <label>Available Providers:</label>
        <div className="providers">
          {availableProviders.map((provider) => (
            <div
              key={provider.name}
              className={`provider-item ${provider.name === currentProvider ? 'active' : ''}`}
            >
              <button
                className="provider-btn"
                onClick={() => handleProviderChange(provider.name)}
                disabled={provider.name === currentProvider}
              >
                <div className="provider-info">
                  <span className="provider-display-name">{provider.displayName}</span>
                  <span className="provider-status">{provider.message}</span>
                </div>
                {provider.name === currentProvider && <span className="active-indicator">✓</span>}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="provider-preferences">
        <label>Provider Priority:</label>
        <div className="preference-info">
          <small>Drag to reorder or use default preferences</small>
        </div>
        <button className="reset-preferences-btn" onClick={() => handleProviderChange(null)}>
          Use Default Priority
        </button>
      </div>

      <style jsx>{`
        .provider-selector {
          background: #1a1a1a;
          border: 1px solid #333;
          border-radius: 8px;
          padding: 16px;
          color: #fff;
          font-family: monospace;
        }

        .provider-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }

        .provider-header h3 {
          margin: 0;
          font-size: 16px;
          color: #00ff00;
        }

        .refresh-btn {
          background: transparent;
          border: 1px solid #333;
          color: #00ff00;
          padding: 4px 8px;
          cursor: pointer;
          border-radius: 4px;
        }

        .refresh-btn:hover {
          background: #333;
        }

        .current-provider {
          margin-bottom: 16px;
          padding: 8px;
          background: #0a0a0a;
          border-radius: 4px;
        }

        .current-provider label {
          color: #888;
          margin-right: 8px;
        }

        .provider-name {
          color: #00ff00;
          font-weight: bold;
        }

        .provider-list {
          margin-bottom: 16px;
        }

        .provider-list label {
          display: block;
          color: #888;
          margin-bottom: 8px;
        }

        .providers {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .provider-item {
          background: #0a0a0a;
          border: 1px solid #333;
          border-radius: 4px;
          overflow: hidden;
        }

        .provider-item.active {
          border-color: #00ff00;
        }

        .provider-btn {
          width: 100%;
          background: transparent;
          border: none;
          color: #fff;
          padding: 12px;
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
          text-align: left;
        }

        .provider-btn:hover:not(:disabled) {
          background: #1a1a1a;
        }

        .provider-btn:disabled {
          cursor: default;
          opacity: 0.7;
        }

        .provider-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .provider-display-name {
          font-weight: bold;
        }

        .provider-status {
          font-size: 12px;
          color: #888;
        }

        .active-indicator {
          color: #00ff00;
          font-size: 18px;
        }

        .provider-preferences {
          border-top: 1px solid #333;
          padding-top: 16px;
        }

        .provider-preferences label {
          display: block;
          color: #888;
          margin-bottom: 8px;
        }

        .preference-info {
          margin-bottom: 8px;
        }

        .preference-info small {
          color: #666;
        }

        .reset-preferences-btn {
          background: #0a0a0a;
          border: 1px solid #333;
          color: #fff;
          padding: 8px 16px;
          cursor: pointer;
          border-radius: 4px;
        }

        .reset-preferences-btn:hover {
          background: #1a1a1a;
          border-color: #00ff00;
        }

        .loading,
        .error {
          text-align: center;
          padding: 32px;
          color: #888;
        }

        .error {
          color: #ff4444;
        }
      `}</style>
    </div>
  );
};
