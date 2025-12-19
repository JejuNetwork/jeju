import { useState } from 'react';
import { useAccount } from 'wagmi';
import { Radio, RefreshCw, Copy, Check, Key, Activity, Globe, Zap } from 'lucide-react';
import { useRPCChains, useCreateRPCKey } from '../../hooks';

export default function RPCGatewayPage() {
  const { isConnected } = useAccount();
  const { data: chainsData, isLoading, refetch } = useRPCChains();
  const createKey = useCreateRPCKey();
  
  const [showModal, setShowModal] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [tier, setTier] = useState('free');

  const handleCreateKey = async () => {
    const result = await createKey.mutateAsync({ tier });
    setApiKey(result.apiKey);
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const chains = chainsData?.chains ?? [];
  const mainnetChains = chains.filter(c => !c.isTestnet);

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">RPC Gateway</h1>
          <p className="page-subtitle">Multi-chain RPC access with failover and load balancing</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary" onClick={() => refetch()}>
            <RefreshCw size={16} /> Refresh
          </button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)} disabled={!isConnected}>
            <Key size={16} /> Get API Key
          </button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon compute"><Globe size={24} /></div>
          <div className="stat-content">
            <div className="stat-label">Chains Supported</div>
            <div className="stat-value">{chains.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage"><Radio size={24} /></div>
          <div className="stat-content">
            <div className="stat-label">Total Providers</div>
            <div className="stat-value">{chains.reduce((sum, c) => sum + c.providers, 0)}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network"><Zap size={24} /></div>
          <div className="stat-content">
            <div className="stat-label">Avg Latency</div>
            <div className="stat-value">
              {chains.filter(c => c.avgLatency).length > 0 
                ? `${Math.round(chains.reduce((sum, c) => sum + (c.avgLatency || 0), 0) / chains.filter(c => c.avgLatency).length)}ms`
                : '—'
              }
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon ai"><Activity size={24} /></div>
          <div className="stat-content">
            <div className="stat-label">Uptime</div>
            <div className="stat-value">99.9%</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <h3 className="card-title"><Radio size={18} /> RPC Endpoint</h3>
        </div>
        <div style={{ padding: '1rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Base URL</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <code style={{ flex: 1, fontSize: '0.9rem' }}>https://rpc.jejunetwork.org/v1/rpc/{'{chainId}'}</code>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => handleCopy('https://rpc.jejunetwork.org/v1/rpc/', 'base')}
            >
              {copied === 'base' ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>
        <div style={{ marginTop: '1rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          Include your API key in the <code>X-API-Key</code> header for higher rate limits. Payments via x402 for premium access.
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: '0' }}>
        <button className="tab active">Mainnets</button>
        <button className="tab">Testnets</button>
      </div>

      <div className="card" style={{ borderTopLeftRadius: 0 }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
            <div className="spinner" />
          </div>
        ) : chains.length === 0 ? (
          <div className="empty-state">
            <Radio size={48} />
            <h3>No chains available</h3>
            <p>Check back later for supported chains</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Chain</th>
                  <th>Chain ID</th>
                  <th>Symbol</th>
                  <th>Providers</th>
                  <th>Avg Latency</th>
                  <th>Endpoint</th>
                </tr>
              </thead>
              <tbody>
                {mainnetChains.map((chain) => (
                  <tr key={chain.chainId}>
                    <td style={{ fontWeight: 500 }}>{chain.name}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{chain.chainId}</td>
                    <td><span className="badge badge-neutral">{chain.symbol}</span></td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{chain.providers}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {chain.avgLatency ? `${chain.avgLatency}ms` : '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <code style={{ fontSize: '0.8rem' }}>/v1/rpc/{chain.chainId}</code>
                        <button
                          className="btn btn-ghost btn-icon"
                          style={{ padding: '0.25rem' }}
                          onClick={() => handleCopy(`https://rpc.jejunetwork.org/v1/rpc/${chain.chainId}`, `chain-${chain.chainId}`)}
                        >
                          {copied === `chain-${chain.chainId}` ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => { setShowModal(false); setApiKey(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Get API Key</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => { setShowModal(false); setApiKey(null); }}>×</button>
            </div>
            <div className="modal-body">
              {apiKey ? (
                <div>
                  <div style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--success-soft)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid var(--success)' }}>
                    <div style={{ fontWeight: 500, marginBottom: '0.5rem' }}>API Key Created</div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                      Save this key securely. It will not be shown again.
                    </div>
                  </div>
                  <div style={{ padding: '1rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <code style={{ flex: 1, fontSize: '0.85rem', wordBreak: 'break-all' }}>{apiKey}</code>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleCopy(apiKey, 'apikey')}
                      >
                        {copied === 'apikey' ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="form-group">
                    <label className="form-label">Tier</label>
                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                      {[
                        { value: 'free', label: 'Free', desc: '100 req/min, 10K req/day', price: 'Free' },
                        { value: 'standard', label: 'Standard', desc: '1K req/min, 1M req/day', price: '0.001 ETH/day' },
                        { value: 'premium', label: 'Premium', desc: 'Unlimited, priority routing', price: '0.01 ETH/day' },
                      ].map(t => (
                        <label
                          key={t.value}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '0.75rem',
                            padding: '1rem',
                            background: tier === t.value ? 'var(--accent-soft)' : 'var(--bg-tertiary)',
                            borderRadius: 'var(--radius-md)',
                            cursor: 'pointer',
                            border: `1px solid ${tier === t.value ? 'var(--accent)' : 'var(--border)'}`,
                          }}
                        >
                          <input
                            type="radio"
                            name="tier"
                            value={t.value}
                            checked={tier === t.value}
                            onChange={e => setTier(e.target.value)}
                            style={{ marginTop: '0.25rem' }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 500 }}>{t.label}</div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t.desc}</div>
                          </div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>{t.price}</div>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => { setShowModal(false); setApiKey(null); }}>
                {apiKey ? 'Close' : 'Cancel'}
              </button>
              {!apiKey && (
                <button className="btn btn-primary" onClick={handleCreateKey} disabled={createKey.isPending}>
                  {createKey.isPending ? 'Creating...' : <><Key size={16} /> Create Key</>}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


