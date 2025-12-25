import {
  Activity,
  AlertCircle,
  Check,
  Copy,
  Database,
  HardDrive,
  Plus,
  RefreshCw,
  Server,
  Upload,
} from 'lucide-react'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import {
  useDABlobs,
  useDAHealth,
  useDAOperators,
  useDAStats,
  useSubmitBlob,
} from '../hooks'

export default function DataAvailabilityPage() {
  const { isConnected, address } = useAccount()
  const {
    data: health,
    isLoading: healthLoading,
    refetch: refetchHealth,
  } = useDAHealth()
  const { data: stats, refetch: refetchStats } = useDAStats()
  const { data: operatorsData, refetch: refetchOperators } = useDAOperators()
  const { data: blobsData, refetch: refetchBlobs } = useDABlobs()
  const submitBlob = useSubmitBlob()

  const [showModal, setShowModal] = useState(false)
  const [blobData, setBlobData] = useState('')
  const [namespace, setNamespace] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const handleRefresh = () => {
    refetchHealth()
    refetchStats()
    refetchOperators()
    refetchBlobs()
  }

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!address) return

    await submitBlob.mutateAsync({
      data: blobData,
      submitter: address,
      namespace: namespace || undefined,
    })
    setShowModal(false)
    setBlobData('')
    setNamespace('')
    refetchBlobs()
  }

  const operators = operatorsData?.operators ?? []
  const blobs = blobsData?.blobs ?? []

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
          <h1 className="page-title">Data Availability</h1>
          <p className="page-subtitle">
            Decentralized data availability layer with erasure coding and
            sampling
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRefresh}
          >
            <RefreshCw size={16} /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowModal(true)}
            disabled={!isConnected}
          >
            <Upload size={16} /> Submit Blob
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon storage">
            <Database size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Total Blobs</div>
            <div className="stat-value">{stats?.blobs?.total ?? 0}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon compute">
            <Server size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Active Operators</div>
            <div className="stat-value">{stats?.operators?.active ?? 0}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network">
            <HardDrive size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Total Capacity</div>
            <div className="stat-value">
              {stats?.operators?.totalCapacityGB ?? 0} GB
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon ai">
            <Activity size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Used Capacity</div>
            <div className="stat-value">
              {stats?.operators?.usedCapacityGB?.toFixed(2) ?? '0'} GB
            </div>
          </div>
        </div>
      </div>

      {/* Health Status */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <h3 className="card-title">
            <Activity size={18} /> DA Layer Status
          </h3>
        </div>
        {healthLoading ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: '2rem',
            }}
          >
            <div className="spinner" />
          </div>
        ) : health ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
            }}
          >
            <div
              style={{
                padding: '1rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)',
                  marginBottom: '0.5rem',
                }}
              >
                Status
              </div>
              <span
                className={`badge ${health.status === 'healthy' ? 'badge-success' : 'badge-error'}`}
              >
                {health.status}
              </span>
            </div>
            <div
              style={{
                padding: '1rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)',
                  marginBottom: '0.5rem',
                }}
              >
                Initialized
              </div>
              <span
                className={`badge ${health.initialized ? 'badge-success' : 'badge-warning'}`}
              >
                {health.initialized ? 'Yes' : 'No'}
              </span>
            </div>
            <div
              style={{
                padding: '1rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)',
                  marginBottom: '0.5rem',
                }}
              >
                Local Operator
              </div>
              {health.localOperator ? (
                <code style={{ fontSize: '0.8rem' }}>
                  {health.localOperator.slice(0, 10)}...
                </code>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>
                  Not configured
                </span>
              )}
            </div>
            <div
              style={{
                padding: '1rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)',
                  marginBottom: '0.5rem',
                }}
              >
                Operator Status
              </div>
              <span
                className={`badge ${health.localOperatorStatus === 'running' ? 'badge-success' : 'badge-neutral'}`}
              >
                {health.localOperatorStatus ?? 'N/A'}
              </span>
            </div>
          </div>
        ) : (
          <div className="empty-state" style={{ padding: '2rem' }}>
            <AlertCircle size={32} />
            <p>Unable to fetch DA layer status</p>
          </div>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))',
          gap: '1.5rem',
        }}
      >
        {/* Operators */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Server size={18} /> Operators
            </h3>
            <span className="badge badge-neutral">{operators.length}</span>
          </div>
          {operators.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem' }}>
              <Server size={32} />
              <p>No operators registered</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {operators.map((op) => (
                <div
                  key={op.address}
                  style={{
                    padding: '0.75rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                  }}
                >
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background:
                        op.status === 'active' || op.status === 'running'
                          ? 'var(--success)'
                          : 'var(--text-muted)',
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      <code style={{ fontSize: '0.85rem' }}>
                        {op.address.slice(0, 10)}...{op.address.slice(-6)}
                      </code>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon"
                        style={{ padding: '0.15rem' }}
                        onClick={() => handleCopy(op.address, op.address)}
                      >
                        {copied === op.address ? (
                          <Check size={12} />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                    </div>
                    <div
                      style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}
                    >
                      {op.region} · {op.usedGB?.toFixed(1) ?? 0}/{op.capacityGB}{' '}
                      GB
                    </div>
                  </div>
                  <span
                    className={`badge ${op.status === 'active' || op.status === 'running' ? 'badge-success' : 'badge-neutral'}`}
                  >
                    {op.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Blobs */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Database size={18} /> Recent Blobs
            </h3>
            <span className="badge badge-neutral">{blobs.length}</span>
          </div>
          {blobs.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem' }}>
              <Database size={32} />
              <p>No blobs submitted yet</p>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setShowModal(true)}
                disabled={!isConnected}
              >
                <Upload size={14} /> Submit Blob
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {blobs.slice(0, 10).map((blob) => (
                <div
                  key={blob.id}
                  style={{
                    padding: '0.75rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '0.5rem',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      <code style={{ fontSize: '0.8rem' }}>
                        {blob.id.slice(0, 16)}...
                      </code>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon"
                        style={{ padding: '0.15rem' }}
                        onClick={() => handleCopy(blob.id, blob.id)}
                      >
                        {copied === blob.id ? (
                          <Check size={12} />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                    </div>
                    <span
                      className={`badge ${
                        blob.status === 'available'
                          ? 'badge-success'
                          : blob.status === 'pending' ||
                              blob.status === 'dispersing'
                            ? 'badge-warning'
                            : 'badge-error'
                      }`}
                    >
                      {blob.status}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-muted)',
                      display: 'flex',
                      gap: '1rem',
                    }}
                  >
                    <span>{formatBytes(blob.size)}</span>
                    <span>{new Date(blob.submittedAt).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Submit Blob Modal */}
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
            style={{ maxWidth: '550px' }}
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
              <h3 className="modal-title">Submit Blob</h3>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setShowModal(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="blob-data" className="form-label">
                    Data *
                  </label>
                  <textarea
                    id="blob-data"
                    className="input"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      minHeight: '150px',
                    }}
                    placeholder="Enter data (hex or base64 encoded)"
                    value={blobData}
                    onChange={(e) => setBlobData(e.target.value)}
                    required
                  />
                  <div className="form-hint">
                    Prefix with 0x for hex data, otherwise base64 is assumed
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="blob-namespace" className="form-label">
                    Namespace
                  </label>
                  <input
                    id="blob-namespace"
                    className="input"
                    placeholder="Optional namespace identifier"
                    value={namespace}
                    onChange={(e) => setNamespace(e.target.value)}
                  />
                </div>
                <div
                  style={{
                    padding: '1rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <div
                    style={{
                      fontSize: '0.85rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    Blobs are erasure coded and distributed across DA operators.
                    Data is retrievable via sampling proofs for verification.
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
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitBlob.isPending}
                >
                  {submitBlob.isPending ? (
                    'Submitting...'
                  ) : (
                    <>
                      <Plus size={16} /> Submit
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
