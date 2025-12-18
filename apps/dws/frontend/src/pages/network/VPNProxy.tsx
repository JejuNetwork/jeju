import { useState } from 'react';
import { useAccount } from 'wagmi';
import { Network, Plus, Globe, Shield, Activity, Copy, Check, MapPin } from 'lucide-react';
import { useVPNRegions, useCreateVPNSession } from '../../hooks';

export default function VPNProxyPage() {
  const { isConnected } = useAccount();
  const { data: regionsData, isLoading } = useVPNRegions();
  const createSession = useCreateVPNSession();
  
  const [showModal, setShowModal] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<{
    host: string;
    port: number;
    username: string;
    password: string;
    expiresAt: number;
  } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    region: '',
    type: 'http',
    duration: '3600000',
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await createSession.mutateAsync({
      region: formData.region || undefined,
      type: formData.type,
      duration: parseInt(formData.duration),
    });
    setSessionInfo({
      host: result.proxy.host,
      port: result.proxy.port,
      username: 'session-user',
      password: 'session-pass',
      expiresAt: result.expiresAt,
    });
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const regions = regionsData?.regions ?? [];

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">VPN / Proxy</h1>
          <p className="page-subtitle">Anonymous, decentralized proxy network for web scraping and privacy</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-primary" onClick={() => setShowModal(true)} disabled={!isConnected}>
            <Plus size={16} /> New Session
          </button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon compute"><Globe size={24} /></div>
          <div className="stat-content">
            <div className="stat-label">Regions</div>
            <div className="stat-value">{regions.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage"><Network size={24} /></div>
          <div className="stat-content">
            <div className="stat-label">Total Nodes</div>
            <div className="stat-value">{regions.reduce((sum, r) => sum + r.nodeCount, 0)}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network"><Shield size={24} /></div>
          <div className="stat-content">
            <div className="stat-label">Active Sessions</div>
            <div className="stat-value">0</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon ai"><Activity size={24} /></div>
          <div className="stat-content">
            <div className="stat-label">Network Health</div>
            <div className="stat-value"><span className="badge badge-success">Healthy</span></div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title"><MapPin size={18} /> Available Regions</h3>
        </div>
        
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
            <div className="spinner" />
          </div>
        ) : regions.length === 0 ? (
          <div className="empty-state">
            <Globe size={48} />
            <h3>No regions available</h3>
            <p>Check back later for available proxy regions</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
            {regions.map((region) => (
              <div
                key={region.code}
                style={{
                  padding: '1rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <MapPin size={16} style={{ color: 'var(--accent)' }} />
                  <span style={{ fontWeight: 500 }}>{region.name}</span>
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  {region.country}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.75rem' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{region.nodeCount} nodes</span>
                  <span className="badge badge-success">Online</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
        <div className="card">
          <div className="card-header">
            <h3 className="card-title"><Network size={18} /> Proxy Types</h3>
          </div>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={{ padding: '1rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>HTTP/HTTPS</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Standard web proxy for HTTP requests</div>
            </div>
            <div style={{ padding: '1rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>SOCKS5</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Protocol-agnostic proxy for any TCP traffic</div>
            </div>
            <div style={{ padding: '1rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>Residential</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>IPs from residential ISPs for higher trust</div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title"><Shield size={18} /> Use Cases</h3>
          </div>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <Activity size={18} style={{ color: 'var(--accent)' }} />
              <span>Web Scraping & Data Collection</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <Shield size={18} style={{ color: 'var(--accent)' }} />
              <span>Privacy & Anonymity</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <Globe size={18} style={{ color: 'var(--accent)' }} />
              <span>Geo-targeted Testing</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <Network size={18} style={{ color: 'var(--accent)' }} />
              <span>Load Distribution</span>
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => { setShowModal(false); setSessionInfo(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">New Proxy Session</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => { setShowModal(false); setSessionInfo(null); }}>×</button>
            </div>
            {sessionInfo ? (
              <div className="modal-body">
                <div style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--success-soft)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid var(--success)' }}>
                  <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>Session Created</div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    Expires {new Date(sessionInfo.expiresAt).toLocaleString()}
                  </div>
                </div>
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {[
                    { label: 'Host', value: sessionInfo.host, id: 'host' },
                    { label: 'Port', value: sessionInfo.port.toString(), id: 'port' },
                    { label: 'Username', value: sessionInfo.username, id: 'username' },
                    { label: 'Password', value: sessionInfo.password, id: 'password' },
                  ].map(item => (
                    <div key={item.id} style={{ padding: '0.75rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>{item.label}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <code style={{ flex: 1, fontSize: '0.85rem' }}>{item.value}</code>
                        <button
                          className="btn btn-ghost btn-icon"
                          style={{ padding: '0.25rem' }}
                          onClick={() => handleCopy(item.value, item.id)}
                        >
                          {copied === item.id ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreate}>
                <div className="modal-body">
                  <div className="form-group">
                    <label className="form-label">Region</label>
                    <select
                      className="input"
                      value={formData.region}
                      onChange={e => setFormData({ ...formData, region: e.target.value })}
                    >
                      <option value="">Auto (closest)</option>
                      {regions.map(r => (
                        <option key={r.code} value={r.code}>{r.name} - {r.country}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Proxy Type</label>
                    <select
                      className="input"
                      value={formData.type}
                      onChange={e => setFormData({ ...formData, type: e.target.value })}
                    >
                      <option value="http">HTTP/HTTPS</option>
                      <option value="socks5">SOCKS5</option>
                      <option value="residential">Residential</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Duration</label>
                    <select
                      className="input"
                      value={formData.duration}
                      onChange={e => setFormData({ ...formData, duration: e.target.value })}
                    >
                      <option value="3600000">1 hour</option>
                      <option value="86400000">24 hours</option>
                      <option value="604800000">7 days</option>
                    </select>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={createSession.isPending}>
                    {createSession.isPending ? 'Creating...' : <><Network size={16} /> Create Session</>}
                  </button>
                </div>
              </form>
            )}
            {sessionInfo && (
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => { setShowModal(false); setSessionInfo(null); }}>Close</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


