import {
  Check,
  Copy,
  Globe,
  Key,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { useAccount } from 'wagmi'

interface OAuth3App {
  id: string
  name: string
  clientId: string
  redirectUris: string[]
  grants: string[]
  createdAt: number
  requestCount: number
}

export default function OAuth3Page() {
  const { isConnected } = useAccount()
  const [showModal, setShowModal] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [apps] = useState<OAuth3App[]>([])
  const [formData, setFormData] = useState({
    name: '',
    redirectUri: '',
    grants: ['authorization_code'],
  })

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    setShowModal(false)
    setFormData({ name: '', redirectUri: '', grants: ['authorization_code'] })
  }

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div>
      <div
        className="page-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h1 className="page-title">OAuth3 Applications</h1>
          <p className="page-subtitle">
            Wallet-based OAuth authentication for your applications
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="btn btn-secondary">
            <RefreshCw size={16} /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowModal(true)}
            disabled={!isConnected}
          >
            <Plus size={16} /> New Application
          </button>
        </div>
      </div>

      <div
        className="card"
        style={{
          marginBottom: '1.5rem',
          borderColor: 'var(--accent)',
          background: 'var(--accent-soft)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Shield size={24} style={{ color: 'var(--accent)' }} />
          <div>
            <div style={{ fontWeight: 500 }}>
              OAuth3 with Wallet Authentication
            </div>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              OAuth3 extends OAuth 2.0 with wallet-based authentication. Users
              sign in with their wallet, and your app receives verified wallet
              address claims.
            </div>
          </div>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon compute">
            <Shield size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Applications</div>
            <div className="stat-value">{apps.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage">
            <Key size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Total Requests</div>
            <div className="stat-value">
              {apps
                .reduce((sum, a) => sum + a.requestCount, 0)
                .toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">
            <Shield size={18} /> Applications
          </h3>
        </div>

        {apps.length === 0 ? (
          <div className="empty-state">
            <Shield size={48} />
            <h3>No OAuth3 applications</h3>
            <p>Register an application to enable wallet-based authentication</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowModal(true)}
              disabled={!isConnected}
            >
              <Plus size={16} /> New Application
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {apps.map((app) => (
              <div
                key={app.id}
                style={{
                  padding: '1rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    marginBottom: '0.75rem',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '1.05rem' }}>
                      {app.name}
                    </div>
                    <div
                      style={{
                        fontSize: '0.85rem',
                        color: 'var(--text-muted)',
                      }}
                    >
                      Created {new Date(app.createdAt).toLocaleDateString()} ·{' '}
                      {app.requestCount.toLocaleString()} requests
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  <div
                    style={{
                      padding: '0.75rem',
                      background: 'var(--bg-primary)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)',
                        marginBottom: '0.25rem',
                      }}
                    >
                      Client ID
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      <code style={{ flex: 1, fontSize: '0.85rem' }}>
                        {app.clientId}
                      </code>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon"
                        style={{ padding: '0.25rem' }}
                        onClick={() => handleCopy(app.clientId, app.id)}
                      >
                        {copied === app.id ? (
                          <Check size={14} />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '0.75rem',
                      background: 'var(--bg-primary)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)',
                        marginBottom: '0.25rem',
                      }}
                    >
                      Redirect URIs
                    </div>
                    <div style={{ fontSize: '0.85rem' }}>
                      {app.redirectUris.join(', ')}
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)',
                        marginBottom: '0.5rem',
                      }}
                    >
                      Grant Types
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: '0.5rem',
                        flexWrap: 'wrap',
                      }}
                    >
                      {app.grants.map((grant) => (
                        <span key={grant} className="badge badge-neutral">
                          {grant}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
          gap: '1.5rem',
          marginTop: '1.5rem',
        }}
      >
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Globe size={18} /> Endpoints
            </h3>
          </div>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div
              style={{
                padding: '0.75rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginBottom: '0.25rem',
                }}
              >
                Authorization
              </div>
              <code style={{ fontSize: '0.85rem' }}>/oauth3/authorize</code>
            </div>
            <div
              style={{
                padding: '0.75rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginBottom: '0.25rem',
                }}
              >
                Token
              </div>
              <code style={{ fontSize: '0.85rem' }}>/oauth3/token</code>
            </div>
            <div
              style={{
                padding: '0.75rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginBottom: '0.25rem',
                }}
              >
                User Info
              </div>
              <code style={{ fontSize: '0.85rem' }}>/oauth3/userinfo</code>
            </div>
            <div
              style={{
                padding: '0.75rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginBottom: '0.25rem',
                }}
              >
                JWKS
              </div>
              <code style={{ fontSize: '0.85rem' }}>
                /.well-known/jwks.json
              </code>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Key size={18} /> Integration
            </h3>
          </div>
          <pre
            style={{
              background: 'var(--bg-tertiary)',
              padding: '1rem',
              borderRadius: 'var(--radius-md)',
              overflow: 'auto',
              fontSize: '0.8rem',
            }}
          >
            {`// OAuth3 Authorization URL
const authUrl = new URL('/oauth3/authorize', DWS_URL);
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', 'openid wallet');
authUrl.searchParams.set('state', generateState());

// Token response includes wallet claim
{
  "access_token": "...",
  "id_token": "...",
  "wallet": {
    "address": "0x...",
    "chainId": 420690
  }
}`}
          </pre>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => setShowModal(false)}
            aria-label="Close modal"
          />
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') {
                setShowModal(false)
              }
            }}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <h3 className="modal-title">New OAuth3 Application</h3>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setShowModal(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="oauth3-app-name" className="form-label">
                    Application Name *
                  </label>
                  <input
                    id="oauth3-app-name"
                    className="input"
                    placeholder="My App"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="oauth3-redirect-uri" className="form-label">
                    Redirect URI *
                  </label>
                  <input
                    id="oauth3-redirect-uri"
                    className="input"
                    placeholder="https://myapp.com/callback"
                    value={formData.redirectUri}
                    onChange={(e) =>
                      setFormData({ ...formData, redirectUri: e.target.value })
                    }
                    required
                  />
                  <div className="form-hint">
                    Where users are redirected after authorization
                  </div>
                </div>
                <div className="form-group">
                  <span className="form-label">Grant Types</span>
                  <div style={{ display: 'grid', gap: '0.5rem' }}>
                    {[
                      {
                        value: 'authorization_code',
                        label: 'Authorization Code',
                      },
                      { value: 'refresh_token', label: 'Refresh Token' },
                      {
                        value: 'client_credentials',
                        label: 'Client Credentials',
                      },
                    ].map((grant) => (
                      <label
                        key={grant.value}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={formData.grants.includes(grant.value)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({
                                ...formData,
                                grants: [...formData.grants, grant.value],
                              })
                            } else {
                              setFormData({
                                ...formData,
                                grants: formData.grants.filter(
                                  (g) => g !== grant.value,
                                ),
                              })
                            }
                          }}
                        />
                        <span>{grant.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  <Plus size={16} /> Create Application
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
