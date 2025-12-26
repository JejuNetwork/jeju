/**
 * Marketplace Jobs Page
 *
 * View and manage compute jobs in the DWS marketplace.
 */

import {
  Activity,
  AlertCircle,
  CheckCircle,
  Clock,
  Cpu,
  DollarSign,
  Globe,
  Loader,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Server,
  XCircle,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { marketplaceApi } from '../../lib/api'

// Job type adapted from marketplace listings
interface Job {
  id: string
  type: 'compute' | 'storage' | 'cdn' | 'function' | 'inference'
  status: 'pending' | 'matched' | 'active' | 'completed' | 'failed' | 'disputed'
  requirements: {
    cpuCores?: number
    memoryGb?: number
    gpuType?: string
    storageGb?: number
    regions?: string[]
    teeRequired?: boolean
  }
  budget: bigint
  deadline: number
  provider?: string
  matchedAt?: number
  completedAt?: number
  createdAt: number
  result?: {
    success: boolean
    duration: number
    cost: bigint
  }
}

export default function MarketplaceJobsPage() {
  const { isConnected } = useAccount()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNewJob, setShowNewJob] = useState(false)
  const [filter, setFilter] = useState<
    'all' | 'pending' | 'active' | 'completed' | 'failed'
  >('all')
  const [searchQuery, setSearchQuery] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    // Fetch marketplace listings
    const listingsResult = await marketplaceApi
      .listListings()
      .catch((err: Error) => {
        setError(err.message)
        return []
      })

    // Convert listings to jobs for display
    // In production, you'd have a proper jobs API
    setJobs(
      listingsResult.map((l) => ({
        id: l.id,
        type: l.type === 'inference' ? 'compute' : (l.type as Job['type']),
        status: l.status === 'active' ? 'active' : ('pending' as Job['status']),
        requirements: {},
        budget: BigInt(0),
        deadline: Date.now() + 3600000,
        provider: l.providerId,
        createdAt: Date.now(),
      })),
    )

    setLoading(false)
  }, [])

  useEffect(() => {
    if (isConnected) {
      fetchData()
    }
  }, [isConnected, fetchData])

  if (!isConnected) {
    return (
      <div className="empty-state" style={{ paddingTop: '4rem' }}>
        <Cpu size={64} />
        <h3>Connect Wallet</h3>
        <p>Connect your wallet to manage jobs</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="empty-state" style={{ paddingTop: '4rem' }}>
        <Loader size={48} className="spin" />
        <h3>Loading marketplace...</h3>
      </div>
    )
  }

  const filteredJobs = jobs.filter((j) => {
    if (filter !== 'all' && j.status !== filter) return false
    if (searchQuery && !j.id.includes(searchQuery)) return false
    return true
  })

  const formatEth = (wei: bigint) => {
    const eth = Number(wei) / 1e18
    if (eth >= 1) return `${eth.toFixed(4)} ETH`
    return `${eth.toFixed(6)} ETH`
  }

  const getStatusBadge = (status: Job['status']) => {
    const classes = {
      pending: 'badge-warning',
      matched: 'badge-info',
      active: 'badge-success',
      completed: 'badge-success',
      failed: 'badge-error',
      disputed: 'badge-error',
    }
    return classes[status]
  }

  const getStatusIcon = (status: Job['status']) => {
    switch (status) {
      case 'pending':
        return <Clock size={14} />
      case 'matched':
        return <CheckCircle size={14} />
      case 'active':
        return <Loader size={14} className="spin" />
      case 'completed':
        return <CheckCircle size={14} />
      case 'failed':
        return <XCircle size={14} />
      case 'disputed':
        return <AlertCircle size={14} />
    }
  }

  const getTypeIcon = (type: Job['type']) => {
    switch (type) {
      case 'compute':
        return <Cpu size={16} />
      case 'storage':
        return <Server size={16} />
      case 'cdn':
        return <Globe size={16} />
      case 'function':
        return <Zap size={16} />
      case 'inference':
        return <Activity size={16} />
    }
  }

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp
    if (diff < 0) {
      const remaining = -diff
      if (remaining < 3600000)
        return `${Math.floor(remaining / 60000)}m remaining`
      return `${Math.floor(remaining / 3600000)}h remaining`
    }
    if (diff < 60000) return 'Just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return new Date(timestamp).toLocaleDateString()
  }

  const totalSpent = jobs
    .filter((j) => j.result?.success)
    .reduce((sum, j) => sum + (j.result?.cost ?? BigInt(0)), BigInt(0))

  const activeJobs = jobs.filter(
    (j) => j.status === 'active' || j.status === 'matched',
  ).length
  const completedJobs = jobs.filter((j) => j.status === 'completed').length
  const successRate =
    jobs.filter((j) => j.result).length > 0
      ? Math.round(
          (jobs.filter((j) => j.result?.success).length /
            jobs.filter((j) => j.result).length) *
            100,
        )
      : 0

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
          <h1 className="page-title">Compute Jobs</h1>
          <p className="page-subtitle">
            Submit and track compute jobs in the DWS marketplace
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowNewJob(true)}
        >
          <Plus size={18} />
          New Job
        </button>
      </div>

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon compute">
            <Activity size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Active Jobs</div>
            <div className="stat-value">{activeJobs}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage">
            <CheckCircle size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Completed</div>
            <div className="stat-value">{completedJobs}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network">
            <DollarSign size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Total Spent</div>
            <div className="stat-value" style={{ fontSize: '1.25rem' }}>
              {formatEth(totalSpent)}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon ai">
            <Zap size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Success Rate</div>
            <div className="stat-value">{successRate}%</div>
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
            placeholder="Search jobs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: '2.5rem' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {(['all', 'pending', 'active', 'completed', 'failed'] as const).map(
            (f) => (
              <button
                type="button"
                key={f}
                className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFilter(f)}
                style={{ textTransform: 'capitalize' }}
              >
                {f}
              </button>
            ),
          )}
        </div>
      </div>

      {/* Jobs Table */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">
            <Cpu size={18} /> Your Jobs
          </h3>
          <button type="button" className="btn btn-sm btn-secondary">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        {filteredJobs.length === 0 ? (
          <div className="empty-state" style={{ padding: '3rem' }}>
            <Cpu size={48} />
            <h3>No jobs found</h3>
            <p>Submit your first compute job</p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: '1rem' }}
              onClick={() => setShowNewJob(true)}
            >
              <Plus size={18} /> New Job
            </button>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Requirements</th>
                  <th>Budget</th>
                  <th>Provider</th>
                  <th>Deadline</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.9rem',
                        }}
                      >
                        {job.id}
                      </span>
                    </td>
                    <td>
                      <span
                        className="badge badge-neutral"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                        }}
                      >
                        {getTypeIcon(job.type)}
                        {job.type}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${getStatusBadge(job.status)}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                        }}
                      >
                        {getStatusIcon(job.status)}
                        {job.status}
                      </span>
                    </td>
                    <td>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '0.25rem',
                        }}
                      >
                        {job.requirements.cpuCores && (
                          <span
                            className="badge badge-neutral"
                            style={{ fontSize: '0.75rem' }}
                          >
                            {job.requirements.cpuCores} CPU
                          </span>
                        )}
                        {job.requirements.memoryGb && (
                          <span
                            className="badge badge-neutral"
                            style={{ fontSize: '0.75rem' }}
                          >
                            {job.requirements.memoryGb}GB RAM
                          </span>
                        )}
                        {job.requirements.gpuType && (
                          <span
                            className="badge badge-info"
                            style={{ fontSize: '0.75rem' }}
                          >
                            {job.requirements.gpuType}
                          </span>
                        )}
                        {job.requirements.teeRequired && (
                          <span
                            className="badge badge-success"
                            style={{ fontSize: '0.75rem' }}
                          >
                            TEE
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {formatEth(job.budget)}
                    </td>
                    <td>
                      {job.provider ? (
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.85rem',
                          }}
                        >
                          {job.provider.slice(0, 6)}...{job.provider.slice(-4)}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <span
                        style={{
                          color:
                            job.deadline < Date.now()
                              ? 'var(--error)'
                              : 'var(--text-secondary)',
                        }}
                      >
                        {formatTime(job.deadline)}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                      >
                        <MoreVertical size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* New Job Modal */}
      {showNewJob && (
        <div className="modal-overlay">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => setShowNewJob(false)}
            aria-label="Close modal"
          />
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowNewJob(false)
            }}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <h2>Submit New Job</h2>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => setShowNewJob(false)}
              >
                <XCircle size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="job-type">Job Type</label>
                <select id="job-type" className="input">
                  <option value="compute">Compute</option>
                  <option value="storage">Storage</option>
                  <option value="cdn">CDN</option>
                  <option value="function">Edge Function</option>
                </select>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '1rem',
                }}
              >
                <div className="form-group">
                  <label htmlFor="cpu-cores">CPU Cores</label>
                  <input
                    id="cpu-cores"
                    type="number"
                    className="input"
                    placeholder="8"
                    defaultValue="8"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="memory-gb">Memory (GB)</label>
                  <input
                    id="memory-gb"
                    type="number"
                    className="input"
                    placeholder="32"
                    defaultValue="32"
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="gpu-type">GPU Type (Optional)</label>
                <select id="gpu-type" className="input">
                  <option value="">None</option>
                  <option value="nvidia-a100">NVIDIA A100</option>
                  <option value="nvidia-h100">NVIDIA H100</option>
                  <option value="nvidia-v100">NVIDIA V100</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="regions">Preferred Regions</label>
                <select
                  id="regions"
                  className="input"
                  multiple
                  style={{ height: 'auto' }}
                >
                  <option value="us-east-1">US East</option>
                  <option value="us-west-2">US West</option>
                  <option value="eu-west-1">EU West</option>
                  <option value="ap-northeast-1">Asia Pacific</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="require-tee">
                  <input id="require-tee" type="checkbox" defaultChecked />{' '}
                  Require TEE (Trusted Execution Environment)
                </label>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '1rem',
                }}
              >
                <div className="form-group">
                  <label htmlFor="budget">Budget (ETH)</label>
                  <input
                    id="budget"
                    type="number"
                    className="input"
                    placeholder="1.0"
                    step="0.01"
                    defaultValue="1.0"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="deadline">Deadline</label>
                  <input
                    id="deadline"
                    type="datetime-local"
                    className="input"
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowNewJob(false)}
              >
                Cancel
              </button>
              <button type="button" className="btn btn-primary">
                <Plus size={18} /> Submit Job
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
