import {
  Activity,
  Check,
  Cloud,
  Copy,
  Globe,
  Plus,
  RefreshCw,
  Trash2,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { useCDNStats } from '../../hooks'

interface CDNEndpoint {
  id: string
  origin: string
  customDomain: string | null
  status: 'active' | 'pending' | 'disabled'
  ssl: boolean
  cacheHitRate: number
  bandwidth: number
  requests: number
}

export default function CDNPage() {
  const { data: statsData, isLoading, refetch } = useCDNStats()
  const [showModal, setShowModal] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    origin: '',
    customDomain: '',
    ssl: true,
  })

  const [endpoints] = useState<CDNEndpoint[]>([])

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    setShowModal(false)
    setFormData({ origin: '', customDomain: '', ssl: true })
  }

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
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
          <h1 className="page-title">CDN</h1>
          <p className="page-subtitle">
            Content delivery network with global edge caching
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => refetch()}
          >
            <RefreshCw size={16} /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowModal(true)}
          >
            <Plus size={16} /> Create Endpoint
          </button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon storage">
            <Cloud size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Cache Entries</div>
            <div className="stat-value">
              {isLoading ? '—' : (statsData?.entries ?? 0).toLocaleString()}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon compute">
            <Zap size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Hit Rate</div>
            <div className="stat-value">
              {isLoading
                ? '—'
                : `${((statsData?.hitRate ?? 0) * 100).toFixed(1)}%`}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network">
            <Activity size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Cache Size</div>
            <div className="stat-value">
              {isLoading ? '—' : formatBytes(statsData?.sizeBytes ?? 0)}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon ai">
            <Globe size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Edge Locations</div>
            <div className="stat-value">12</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">
            <Globe size={18} /> CDN Endpoints
          </h3>
        </div>

        {endpoints.length === 0 ? (
          <div className="empty-state">
            <Cloud size={48} />
            <h3>No CDN endpoints</h3>
            <p>
              Create an endpoint to serve content from the global edge network
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowModal(true)}
            >
              <Plus size={16} /> Create Endpoint
            </button>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Origin</th>
                  <th>Custom Domain</th>
                  <th>Status</th>
                  <th>SSL</th>
                  <th>Hit Rate</th>
                  <th>Bandwidth</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map((endpoint) => (
                  <tr key={endpoint.id}>
                    <td>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                        }}
                      >
                        <code style={{ fontSize: '0.85rem' }}>
                          {endpoint.origin}
                        </code>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon"
                          style={{ padding: '0.25rem' }}
                          onClick={() =>
                            handleCopy(endpoint.origin, endpoint.id)
                          }
                        >
                          {copied === endpoint.id ? (
                            <Check size={14} />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      </div>
                    </td>
                    <td>{endpoint.customDomain || '—'}</td>
                    <td>
                      <span
                        className={`badge ${
                          endpoint.status === 'active'
                            ? 'badge-success'
                            : endpoint.status === 'pending'
                              ? 'badge-warning'
                              : 'badge-error'
                        }`}
                      >
                        {endpoint.status}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${endpoint.ssl ? 'badge-success' : 'badge-neutral'}`}
                      >
                        {endpoint.ssl ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {(endpoint.cacheHitRate * 100).toFixed(1)}%
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {formatBytes(endpoint.bandwidth)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div className="card-header">
          <h3 className="card-title">
            <Zap size={18} /> Cache Management
          </h3>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
          }}
        >
          <button type="button" className="btn btn-secondary">
            <RefreshCw size={16} /> Purge All Cache
          </button>
          <button type="button" className="btn btn-secondary">
            <Trash2 size={16} /> Purge by Path
          </button>
        </div>
        <div
          style={{
            marginTop: '1rem',
            padding: '1rem',
            background: 'var(--bg-tertiary)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '0.5rem',
            }}
          >
            <span style={{ color: 'var(--text-secondary)' }}>Cache Usage</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>
              {formatBytes(statsData?.sizeBytes ?? 0)} /{' '}
              {formatBytes(statsData?.maxSizeBytes ?? 0)}
            </span>
          </div>
          <div
            style={{
              height: '8px',
              background: 'var(--bg-primary)',
              borderRadius: '4px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${((statsData?.sizeBytes ?? 0) / (statsData?.maxSizeBytes ?? 1)) * 100}%`,
                background: 'var(--accent)',
                borderRadius: '4px',
              }}
            />
          </div>
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
              <h3 className="modal-title">Create CDN Endpoint</h3>
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
                  <label htmlFor="cdn-origin" className="form-label">
                    Origin URL *
                  </label>
                  <input
                    id="cdn-origin"
                    className="input"
                    placeholder="https://your-origin.com"
                    value={formData.origin}
                    onChange={(e) =>
                      setFormData({ ...formData, origin: e.target.value })
                    }
                    required
                  />
                  <div className="form-hint">
                    The origin server to cache content from
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="cdn-domain" className="form-label">
                    Custom Domain
                  </label>
                  <input
                    id="cdn-domain"
                    className="input"
                    placeholder="cdn.yourdomain.com"
                    value={formData.customDomain}
                    onChange={(e) =>
                      setFormData({ ...formData, customDomain: e.target.value })
                    }
                  />
                </div>
                <div className="form-group">
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={formData.ssl}
                      onChange={(e) =>
                        setFormData({ ...formData, ssl: e.target.checked })
                      }
                    />
                    <span>Enable SSL</span>
                  </label>
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
                  <Plus size={16} /> Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
