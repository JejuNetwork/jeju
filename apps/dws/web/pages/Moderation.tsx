import {
  AlertCircle,
  AlertTriangle,
  Ban,
  CheckCircle,
  Clock,
  Eye,
  RefreshCw,
  Search,
  Shield,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import {
  useModerationHealth,
  useModerationQueue,
  useModerationStatus,
} from '../hooks'

interface ModerationQueueItem {
  id: string
  type: 'ban' | 'review' | 'appeal'
  target: string
  reason: string
  service: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  createdAt: number
  attempts: number
  lastError?: string
}

export default function ModerationPage() {
  const {
    data: healthData,
    isLoading: healthLoading,
    refetch: refetchHealth,
  } = useModerationHealth()
  const {
    data: queueData,
    isLoading: queueLoading,
    refetch: refetchQueue,
  } = useModerationQueue()

  const [addressToCheck, setAddressToCheck] = useState('')
  const [checkedAddress, setCheckedAddress] = useState<string | null>(null)
  const { data: statusData, isLoading: statusLoading } =
    useModerationStatus(checkedAddress)

  const handleCheckAddress = (e: React.FormEvent) => {
    e.preventDefault()
    if (addressToCheck.match(/^0x[a-fA-F0-9]{40}$/)) {
      setCheckedAddress(addressToCheck)
    }
  }

  const handleRefreshAll = () => {
    refetchHealth()
    refetchQueue()
  }

  const queueLength = healthData?.queueLength ?? 0
  const items: ModerationQueueItem[] = queueData?.items ?? []

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'badge-error'
      case 'high':
        return 'badge-warning'
      case 'normal':
        return 'badge-info'
      default:
        return 'badge-neutral'
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'ban':
        return <Ban size={14} />
      case 'review':
        return <Eye size={14} />
      case 'appeal':
        return <Shield size={14} />
      default:
        return <AlertCircle size={14} />
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'banned':
        return <Ban size={16} className="text-error" />
      case 'on_notice':
      case 'challenged':
        return <AlertTriangle size={16} className="text-warning" />
      case 'cleared':
        return <CheckCircle size={16} className="text-success" />
      case 'appealing':
        return <Clock size={16} className="text-info" />
      default:
        return <Users size={16} className="text-muted" />
    }
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
          <h1 className="page-title">Moderation</h1>
          <p className="page-subtitle">
            Decentralized content moderation and ban management
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRefreshAll}
          >
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon compute">
            <Shield size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Queue Length</div>
            <div className="stat-value">{queueLength}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network">
            <AlertTriangle size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Urgent</div>
            <div className="stat-value">
              {items.filter((i) => i.priority === 'urgent').length}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage">
            <Ban size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Pending Bans</div>
            <div className="stat-value">
              {items.filter((i) => i.type === 'ban').length}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon ai">
            <Eye size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Reviews</div>
            <div className="stat-value">
              {items.filter((i) => i.type === 'review').length}
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
          gap: '1.5rem',
        }}
      >
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Search size={18} /> Check Address Status
            </h3>
          </div>
          <div style={{ padding: '1rem' }}>
            <form onSubmit={handleCheckAddress}>
              <div className="form-group">
                <label htmlFor="check-address" className="form-label">
                  Wallet Address
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    id="check-address"
                    className="input"
                    placeholder="0x..."
                    value={addressToCheck}
                    onChange={(e) => setAddressToCheck(e.target.value)}
                    style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
                    pattern="^0x[a-fA-F0-9]{40}$"
                  />
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={
                      statusLoading ||
                      !addressToCheck.match(/^0x[a-fA-F0-9]{40}$/)
                    }
                  >
                    {statusLoading ? 'Checking...' : 'Check'}
                  </button>
                </div>
              </div>
            </form>

            {statusData && (
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
                    alignItems: 'center',
                    gap: '0.75rem',
                    marginBottom: '0.75rem',
                  }}
                >
                  {getStatusIcon(statusData.status)}
                  <span
                    style={{ fontWeight: 500, textTransform: 'capitalize' }}
                  >
                    {statusData.status.replace('_', ' ')}
                  </span>
                  {statusData.isBanned && (
                    <span className="badge badge-error">Banned</span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: '0.85rem',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-muted)',
                    wordBreak: 'break-all',
                  }}
                >
                  {statusData.address}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Shield size={18} /> System Health
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
          ) : healthData ? (
            <div style={{ display: 'grid', gap: '0.75rem', padding: '1rem' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>Status</span>
                <span
                  className={`badge ${healthData.status === 'ok' ? 'badge-success' : 'badge-error'}`}
                >
                  {healthData.status}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>Queue Length</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>
                  {healthData.queueLength}
                </span>
              </div>
              <div
                style={{
                  borderTop: '1px solid var(--border)',
                  paddingTop: '0.75rem',
                }}
              >
                <div
                  style={{
                    fontSize: '0.85rem',
                    color: 'var(--text-muted)',
                    marginBottom: '0.5rem',
                  }}
                >
                  Moderation Marketplace
                </div>
                <code
                  style={{
                    fontSize: '0.75rem',
                    fontFamily: 'var(--font-mono)',
                    wordBreak: 'break-all',
                  }}
                >
                  {healthData.moderationMarketplace}
                </code>
              </div>
              <div>
                <div
                  style={{
                    fontSize: '0.85rem',
                    color: 'var(--text-muted)',
                    marginBottom: '0.5rem',
                  }}
                >
                  Ban Manager
                </div>
                <code
                  style={{
                    fontSize: '0.75rem',
                    fontFamily: 'var(--font-mono)',
                    wordBreak: 'break-all',
                  }}
                >
                  {healthData.banManager}
                </code>
              </div>
            </div>
          ) : (
            <div className="empty-state" style={{ padding: '1.5rem' }}>
              <AlertCircle size={32} />
              <p>Unable to load health status</p>
            </div>
          )}
        </div>

        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-header">
            <h3 className="card-title">
              <Clock size={18} /> Moderation Queue
            </h3>
          </div>

          {queueLoading ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                padding: '3rem',
              }}
            >
              <div className="spinner" />
            </div>
          ) : items.length === 0 ? (
            <div className="empty-state">
              <Shield size={48} />
              <h3>Queue is empty</h3>
              <p>No pending moderation actions</p>
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Type</th>
                    <th>Target</th>
                    <th>Service</th>
                    <th>Priority</th>
                    <th>Reason</th>
                    <th>Created</th>
                    <th>Attempts</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.8rem',
                        }}
                      >
                        {item.id.slice(0, 12)}...
                      </td>
                      <td>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                          }}
                        >
                          {getTypeIcon(item.type)}
                          <span style={{ textTransform: 'capitalize' }}>
                            {item.type}
                          </span>
                        </div>
                      </td>
                      <td
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.8rem',
                        }}
                      >
                        {item.target.slice(0, 10)}...
                      </td>
                      <td>
                        <span className="badge badge-neutral">
                          {item.service}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`badge ${getPriorityColor(item.priority)}`}
                        >
                          {item.priority}
                        </span>
                      </td>
                      <td
                        style={{
                          maxWidth: '200px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={item.reason}
                      >
                        {item.reason}
                      </td>
                      <td>{new Date(item.createdAt).toLocaleString()}</td>
                      <td>
                        {item.attempts > 0 ? (
                          <span
                            className={`badge ${item.attempts >= 3 ? 'badge-error' : 'badge-warning'}`}
                          >
                            {item.attempts}/3
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
