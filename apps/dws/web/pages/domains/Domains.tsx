/**
 * Domains Page
 *
 * Manage JNS domains and DNS settings for DWS apps.
 */

import {
  AlertCircle,
  CheckCircle,
  Clock,
  Copy,
  ExternalLink,
  Globe,
  Link,
  Loader,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { type DomainRecord, domainsApi } from '../../lib/api'

// Extended domain type for local UI state
type Domain = DomainRecord & {
  registeredAt?: number
}

export default function DomainsPage() {
  const { isConnected, address } = useAccount()
  const [domains, setDomains] = useState<Domain[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddDomain, setShowAddDomain] = useState(false)
  const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null)
  const [filter, setFilter] = useState<'all' | 'jns' | 'custom'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const fetchDomains = useCallback(async () => {
    if (!address) return
    setLoading(true)
    setError(null)

    const result = await domainsApi.list(address).catch((err: Error) => {
      setError(err.message)
      return []
    })

    setDomains(result.map((d) => ({ ...d, registeredAt: Date.now() })))
    setLoading(false)
  }, [address])

  useEffect(() => {
    if (isConnected && address) {
      fetchDomains()
    }
  }, [isConnected, address, fetchDomains])

  if (!isConnected) {
    return (
      <div className="empty-state" style={{ paddingTop: '4rem' }}>
        <Globe size={64} />
        <h3>Connect Wallet</h3>
        <p>Connect your wallet to manage domains</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="empty-state" style={{ paddingTop: '4rem' }}>
        <Loader size={48} className="spin" />
        <h3>Loading domains...</h3>
      </div>
    )
  }

  const filteredDomains = domains.filter((d) => {
    if (filter !== 'all' && d.type !== filter) return false
    if (searchQuery && !d.name.includes(searchQuery)) return false
    return true
  })

  const getStatusBadge = (status: Domain['status']) => {
    const classes = {
      active: 'badge-success',
      pending: 'badge-warning',
      error: 'badge-error',
    }
    return classes[status]
  }

  const getSslBadge = (ssl: Domain['ssl']) => {
    const classes = {
      active: 'badge-success',
      pending: 'badge-warning',
      expired: 'badge-error',
      none: 'badge-neutral',
    }
    return classes[ssl]
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleDateString()
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  return (
    <div>
      {error && (
        <div
          className="card"
          style={{
            background: 'var(--error-bg)',
            border: '1px solid var(--error)',
            marginBottom: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertCircle size={18} style={{ color: 'var(--error)' }} />
            <span>{error}</span>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              style={{ marginLeft: 'auto' }}
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Domains</h1>
          <p className="page-subtitle">
            Manage your JNS domains and custom DNS
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowAddDomain(true)}
        >
          <Plus size={18} />
          Add Domain
        </button>
      </div>

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon compute">
            <Globe size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Total Domains</div>
            <div className="stat-value">{domains.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage">
            <Link size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">JNS Domains</div>
            <div className="stat-value">
              {domains.filter((d) => d.type === 'jns').length}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network">
            <ExternalLink size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Custom Domains</div>
            <div className="stat-value">
              {domains.filter((d) => d.type === 'custom').length}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon ai">
            <Shield size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">SSL Active</div>
            <div className="stat-value">
              {domains.filter((d) => d.ssl === 'active').length}
            </div>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search
            size={18}
            style={{
              position: 'absolute',
              left: '0.75rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
            }}
          />
          <input
            type="text"
            className="input"
            placeholder="Search domains..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: '2.5rem' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {(['all', 'jns', 'custom'] as const).map((f) => (
            <button
              type="button"
              key={f}
              className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilter(f)}
              style={{ textTransform: 'uppercase' }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Domains Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
          gap: '1rem',
        }}
      >
        {filteredDomains.map((domain) => (
          <button
            type="button"
            key={domain.id}
            className="card"
            style={{
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
              border: 'none',
            }}
            onClick={() => setSelectedDomain(domain)}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '1rem',
              }}
            >
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    marginBottom: '0.25rem',
                  }}
                >
                  <Globe size={18} style={{ color: 'var(--accent)' }} />
                  <span style={{ fontWeight: 600, fontSize: '1.1rem' }}>
                    {domain.name}
                  </span>
                </div>
                <span
                  className={`badge ${domain.type === 'jns' ? 'badge-info' : 'badge-neutral'}`}
                  style={{ fontSize: '0.7rem' }}
                >
                  {domain.type.toUpperCase()}
                </span>
              </div>
              <span className={`badge ${getStatusBadge(domain.status)}`}>
                {domain.status}
              </span>
            </div>

            <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.9rem' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  color: 'var(--text-secondary)',
                }}
              >
                <span>Target</span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.85rem',
                  }}
                >
                  {domain.targetType === 'app'
                    ? `App: ${domain.target.slice(0, 12)}...`
                    : domain.target.slice(0, 20)}
                  ...
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ color: 'var(--text-secondary)' }}>SSL</span>
                <span
                  className={`badge ${getSslBadge(domain.ssl)}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                  }}
                >
                  <Lock size={12} />
                  {domain.ssl}
                </span>
              </div>
              {domain.expiresAt && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <span>Expires</span>
                  <span>{formatTime(domain.expiresAt)}</span>
                </div>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                marginTop: '1rem',
                paddingTop: '1rem',
                borderTop: '1px solid var(--border)',
              }}
            >
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                style={{ flex: 1 }}
                onClick={(e) => {
                  e.stopPropagation()
                  copyToClipboard(domain.name)
                }}
              >
                <Copy size={14} /> Copy
              </button>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                style={{ flex: 1 }}
              >
                <Settings size={14} /> Manage
              </button>
            </div>
          </button>
        ))}
      </div>

      {filteredDomains.length === 0 && (
        <div className="card">
          <div className="empty-state" style={{ padding: '3rem' }}>
            <Globe size={48} />
            <h3>No domains found</h3>
            <p>Add a JNS domain or connect a custom domain</p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: '1rem' }}
              onClick={() => setShowAddDomain(true)}
            >
              <Plus size={18} /> Add Domain
            </button>
          </div>
        </div>
      )}

      {/* Add Domain Modal */}
      {showAddDomain && (
        <div className="modal-overlay">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => setShowAddDomain(false)}
            aria-label="Close modal"
          />
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowAddDomain(false)
            }}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <h2>Add Domain</h2>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => setShowAddDomain(false)}
              >
                <XCircle size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div
                style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}
              >
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                >
                  <Link size={18} /> Register JNS Domain
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                >
                  <ExternalLink size={18} /> Add Custom Domain
                </button>
              </div>

              <div className="form-group">
                <label htmlFor="domain-name">Domain Name</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    id="domain-name"
                    type="text"
                    placeholder="myapp"
                    className="input"
                    style={{ flex: 1 }}
                  />
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0 1rem',
                      background: 'var(--bg-tertiary)',
                      borderRadius: 'var(--radius-sm)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    .jeju
                  </span>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="link-to">Link To</label>
                <select id="link-to" className="input">
                  <option value="">Select a deployment...</option>
                  <option value="dep_1">my-web-app (Production)</option>
                  <option value="dep_2">api-service (Preview)</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="auto-ssl">Auto-SSL</label>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <input id="auto-ssl" type="checkbox" defaultChecked />
                  <span>Enable automatic HTTPS certificate</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowAddDomain(false)}
              >
                Cancel
              </button>
              <button type="button" className="btn btn-primary">
                <Plus size={18} /> Add Domain
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Domain Detail Modal */}
      {selectedDomain && (
        <div className="modal-overlay">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => setSelectedDomain(null)}
            aria-label="Close modal"
          />
          <div
            className="modal"
            style={{ maxWidth: '600px' }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSelectedDomain(null)
            }}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <div>
                <h2
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <Globe size={20} />
                  {selectedDomain.name}
                </h2>
                <span
                  className={`badge ${getStatusBadge(selectedDomain.status)}`}
                >
                  {selectedDomain.status}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => setSelectedDomain(null)}
              >
                <XCircle size={18} />
              </button>
            </div>
            <div className="modal-body">
              <h4 style={{ marginBottom: '1rem' }}>DNS Records</h4>
              {selectedDomain.records.length > 0 ? (
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Name</th>
                        <th>Value</th>
                        <th>TTL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedDomain.records.map((record) => (
                        <tr
                          key={`${record.type}-${record.name}-${record.value}`}
                        >
                          <td>
                            <span className="badge badge-neutral">
                              {record.type}
                            </span>
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>
                            {record.name}
                          </td>
                          <td
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '0.85rem',
                            }}
                          >
                            {record.value}
                          </td>
                          <td>{record.ttl}s</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ color: 'var(--text-muted)' }}>
                  No DNS records configured
                </p>
              )}

              <h4 style={{ marginTop: '1.5rem', marginBottom: '1rem' }}>
                SSL Certificate
              </h4>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '1rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                {selectedDomain.ssl === 'active' ? (
                  <>
                    <CheckCircle
                      size={20}
                      style={{ color: 'var(--success)' }}
                    />
                    <div>
                      <div style={{ fontWeight: 500 }}>Certificate Active</div>
                      <div
                        style={{
                          fontSize: '0.85rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        Auto-renews automatically
                      </div>
                    </div>
                  </>
                ) : selectedDomain.ssl === 'pending' ? (
                  <>
                    <Clock size={20} style={{ color: 'var(--warning)' }} />
                    <div>
                      <div style={{ fontWeight: 500 }}>Certificate Pending</div>
                      <div
                        style={{
                          fontSize: '0.85rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        Validation in progress...
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <AlertCircle size={20} style={{ color: 'var(--error)' }} />
                    <div>
                      <div style={{ fontWeight: 500 }}>No Certificate</div>
                      <div
                        style={{
                          fontSize: '0.85rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        Enable SSL for secure connections
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                style={{ color: 'var(--error)' }}
              >
                <Trash2 size={18} /> Delete Domain
              </button>
              <button type="button" className="btn btn-primary">
                <RefreshCw size={18} /> Refresh DNS
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
