/**
 * App Deployments Page
 *
 * Manage app deployments on DWS - deploy, rollback, view logs.
 * Uses real API calls - no mock data.
 */

import {
  AlertCircle,
  ArrowRight,
  Box,
  CheckCircle,
  Clock,
  ExternalLink,
  GitBranch,
  Globe,
  Loader,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { type Deployment, deploymentsApi } from '../../lib/api'

export default function DeploymentsPage() {
  const { isConnected, address } = useAccount()
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNewDeploy, setShowNewDeploy] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [filter, setFilter] = useState<
    'all' | 'active' | 'deploying' | 'failed'
  >('all')

  // Form state
  const [gitUrl, setGitUrl] = useState('')
  const [branch, setBranch] = useState('main')
  const [framework, setFramework] = useState('auto')
  const [region, setRegion] = useState('us-east-1')

  const fetchDeployments = useCallback(async () => {
    if (!address) return
    setLoading(true)
    setError(null)

    const result = await deploymentsApi.list(address).catch((err: Error) => {
      setError(err.message)
      return []
    })

    setDeployments(result)
    setLoading(false)
  }, [address])

  useEffect(() => {
    if (isConnected && address) {
      fetchDeployments()
    }
  }, [isConnected, address, fetchDeployments])

  if (!isConnected) {
    return (
      <div className="empty-state" style={{ paddingTop: '4rem' }}>
        <Box size={64} />
        <h3>Connect Wallet</h3>
        <p>Connect your wallet to manage deployments</p>
      </div>
    )
  }

  const filteredDeployments = deployments.filter(
    (d) => filter === 'all' || d.status === filter,
  )

  const getStatusIcon = (status: Deployment['status']) => {
    switch (status) {
      case 'active':
        return <CheckCircle size={16} style={{ color: 'var(--success)' }} />
      case 'deploying':
        return (
          <Loader
            size={16}
            className="spin"
            style={{ color: 'var(--warning)' }}
          />
        )
      case 'failed':
        return <XCircle size={16} style={{ color: 'var(--error)' }} />
      case 'stopped':
        return <AlertCircle size={16} style={{ color: 'var(--text-muted)' }} />
    }
  }

  const getStatusBadge = (status: Deployment['status']) => {
    const classes = {
      active: 'badge-success',
      deploying: 'badge-warning',
      failed: 'badge-error',
      stopped: 'badge-neutral',
    }
    return classes[status]
  }

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp
    if (diff < 60000) return 'Just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return new Date(timestamp).toLocaleDateString()
  }

  const handleDeploy = async () => {
    if (!address || !gitUrl) return

    setDeploying(true)
    setError(null)

    const result = await deploymentsApi
      .deploy(address, {
        gitUrl,
        branch,
        framework: framework === 'auto' ? undefined : framework,
        region,
      })
      .catch((err: Error) => {
        setError(err.message)
        return null
      })

    setDeploying(false)

    if (result) {
      setDeployments((prev) => [result, ...prev])
      setShowNewDeploy(false)
      setGitUrl('')
      setBranch('main')
    }
  }

  const handleRollback = async (deploymentId: string) => {
    if (!address) return

    await deploymentsApi.rollback(address, deploymentId).catch((err: Error) => {
      setError(err.message)
    })

    fetchDeployments()
  }

  const handleDelete = async (deploymentId: string) => {
    if (!address) return

    await deploymentsApi.delete(address, deploymentId).catch((err: Error) => {
      setError(err.message)
    })

    setDeployments((prev) => prev.filter((d) => d.id !== deploymentId))
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Deployments</h1>
          <p className="page-subtitle">
            Deploy and manage your applications on DWS
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowNewDeploy(true)}
        >
          <Upload size={18} />
          New Deployment
        </button>
      </div>

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

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon compute">
            <Box size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Total Deployments</div>
            <div className="stat-value">{deployments.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage">
            <CheckCircle size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Active</div>
            <div className="stat-value">
              {deployments.filter((d) => d.status === 'active').length}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon ai">
            <Loader size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Deploying</div>
            <div className="stat-value">
              {deployments.filter((d) => d.status === 'deploying').length}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network">
            <Globe size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Regions</div>
            <div className="stat-value">
              {new Set(deployments.map((d) => d.region)).size}
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        {(['all', 'active', 'deploying', 'failed'] as const).map((f) => (
          <button
            type="button"
            key={f}
            className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter(f)}
            style={{ textTransform: 'capitalize' }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Deployments List */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">
            <Box size={18} /> Your Deployments
          </h3>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => fetchDeployments()}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="empty-state" style={{ padding: '3rem' }}>
            <Loader size={48} className="spin" />
            <h3>Loading deployments...</h3>
          </div>
        ) : filteredDeployments.length === 0 ? (
          <div className="empty-state" style={{ padding: '3rem' }}>
            <Box size={48} />
            <h3>No deployments found</h3>
            <p>Deploy your first app to get started</p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: '1rem' }}
              onClick={() => setShowNewDeploy(true)}
            >
              <Upload size={18} /> Deploy Now
            </button>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>App</th>
                  <th>Status</th>
                  <th>Version</th>
                  <th>Domain</th>
                  <th>Region</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredDeployments.map((deployment) => (
                  <tr key={deployment.id}>
                    <td>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.25rem',
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>
                          {deployment.appName}
                        </span>
                        {deployment.commit && (
                          <span
                            style={{
                              fontSize: '0.8rem',
                              color: 'var(--text-muted)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                            }}
                          >
                            <GitBranch size={12} />
                            {deployment.branch} @ {deployment.commit}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span
                        className={`badge ${getStatusBadge(deployment.status)}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                        }}
                      >
                        {getStatusIcon(deployment.status)}
                        {deployment.status}
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.85rem',
                        }}
                      >
                        {deployment.version}
                      </span>
                    </td>
                    <td>
                      <a
                        href={deployment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          color: 'var(--accent)',
                        }}
                      >
                        {deployment.domain}
                        <ExternalLink size={12} />
                      </a>
                    </td>
                    <td>{deployment.region}</td>
                    <td>
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        <Clock size={12} />
                        {formatTime(deployment.updatedAt)}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          title="Rollback"
                          onClick={() => handleRollback(deployment.id)}
                        >
                          <RotateCcw size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          title="View Logs"
                        >
                          <ArrowRight size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          title="Delete"
                          onClick={() => handleDelete(deployment.id)}
                          style={{ color: 'var(--error)' }}
                        >
                          <Trash2 size={14} />
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

      {/* New Deploy Modal */}
      {showNewDeploy && (
        <div className="modal-overlay">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => setShowNewDeploy(false)}
            aria-label="Close modal"
          />
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowNewDeploy(false)
            }}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <h2>New Deployment</h2>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => setShowNewDeploy(false)}
              >
                <XCircle size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="git-repo">Git Repository</label>
                <input
                  id="git-repo"
                  type="text"
                  placeholder="https://github.com/user/repo"
                  className="input"
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="branch">Branch</label>
                <input
                  id="branch"
                  type="text"
                  placeholder="main"
                  className="input"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="framework">Framework</label>
                <select
                  id="framework"
                  className="input"
                  value={framework}
                  onChange={(e) => setFramework(e.target.value)}
                >
                  <option value="auto">Auto-detect</option>
                  <option value="nextjs">Next.js</option>
                  <option value="react">React</option>
                  <option value="vue">Vue</option>
                  <option value="svelte">Svelte</option>
                  <option value="astro">Astro</option>
                  <option value="static">Static</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="region">Region</label>
                <select
                  id="region"
                  className="input"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                >
                  <option value="us-east-1">US East (N. Virginia)</option>
                  <option value="us-west-2">US West (Oregon)</option>
                  <option value="eu-west-1">EU (Ireland)</option>
                  <option value="ap-northeast-1">Asia Pacific (Tokyo)</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowNewDeploy(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleDeploy}
                disabled={deploying || !gitUrl}
              >
                {deploying ? (
                  <Loader size={18} className="spin" />
                ) : (
                  <Play size={18} />
                )}{' '}
                Deploy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
