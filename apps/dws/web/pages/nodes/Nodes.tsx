/**
 * Node Management Page
 *
 * For node operators to manage their DWS infrastructure nodes.
 */

import {
  AlertCircle,
  Cpu,
  DollarSign,
  Download,
  HardDrive,
  Loader,
  MoreVertical,
  Plus,
  Server,
  Settings,
  Shield,
  TrendingUp,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { nodesApi } from '../../lib/api'

// Extended node type for UI state - not extending NodeInfo to avoid type conflicts
interface Node {
  nodeId: string
  operator: string
  endpoint: string
  services: string[]
  region: string
  stake: string
  status: 'online' | 'offline' | 'maintenance' | 'syncing'
  teePlatform: string
  attestationHash?: string
  lastSeen: number
  id: string
  earnings: {
    pending: bigint
    total: bigint
    last24h: bigint
  }
  resources: {
    cpuCores: number
    cpuUsage: number
    memoryGb: number
    memoryUsage: number
    storageGb: number
    storageUsage: number
    bandwidth: number
  }
  attestation: {
    platform: 'intel-sgx' | 'amd-sev' | 'intel-tdx' | 'simulator'
    verified: boolean
    lastVerified: number
  }
  reputation: number
  uptime: number
  registeredAt: number
}

export default function NodesPage() {
  const { isConnected } = useAccount()
  const [nodes, setNodes] = useState<Node[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddNode, setShowAddNode] = useState(false)

  const fetchNodes = useCallback(async () => {
    setLoading(true)
    setError(null)

    const result = await nodesApi.list().catch((err: Error) => {
      setError(err.message)
      return []
    })

    const STATUS_MAP: Record<string, Node['status']> = {
      active: 'online',
      syncing: 'syncing',
    }
    const TEE_MAP: Record<string, Node['attestation']['platform']> = {
      'intel-sgx': 'intel-sgx',
      'amd-sev': 'amd-sev',
      'intel-tdx': 'intel-tdx',
    }

    setNodes(
      result.map((n) => ({
        ...n,
        id: n.nodeId,
        status: STATUS_MAP[n.status] || 'offline',
        earnings: {
          pending: BigInt(n.earnings?.pending || '0'),
          total: BigInt(n.earnings?.total || '0'),
          last24h: 0n,
        },
        resources: {
          cpuCores: n.resources?.cpu || 0,
          cpuUsage: 0,
          memoryGb: n.resources?.memory || 0,
          memoryUsage: 0,
          storageGb: n.resources?.storage || 0,
          storageUsage: 0,
          bandwidth: n.resources?.bandwidth || 0,
        },
        attestation: {
          platform: TEE_MAP[n.teePlatform] || 'simulator',
          verified: !!n.attestationHash,
          lastVerified: n.lastSeen,
        },
        reputation: 50,
        uptime: 99,
        registeredAt: n.lastSeen,
      })),
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    if (isConnected) {
      fetchNodes()
    }
  }, [isConnected, fetchNodes])

  if (!isConnected) {
    return (
      <div className="empty-state" style={{ paddingTop: '4rem' }}>
        <Server size={64} />
        <h3>Connect Wallet</h3>
        <p>Connect your wallet to manage your nodes</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="empty-state" style={{ paddingTop: '4rem' }}>
        <Loader size={48} className="spin" />
        <h3>Loading nodes...</h3>
      </div>
    )
  }

  const totalStake = nodes.reduce(
    (sum, n) => sum + BigInt(n.stake || '0'),
    BigInt(0),
  )
  const pendingEarnings = nodes.reduce(
    (sum, n) => sum + (n.earnings?.pending || BigInt(0)),
    BigInt(0),
  )
  const last24hEarnings = nodes.reduce(
    (sum, n) => sum + n.earnings.last24h,
    BigInt(0),
  )
  const onlineNodes = nodes.filter((n) => n.status === 'online').length

  const formatEth = (wei: bigint) => {
    const eth = Number(wei) / 1e18
    if (eth >= 1000) return `${(eth / 1000).toFixed(2)}K ETH`
    if (eth >= 1) return `${eth.toFixed(4)} ETH`
    return `${eth.toFixed(6)} ETH`
  }

  const getStatusBadge = (status: Node['status']) => {
    const classes = {
      online: 'badge-success',
      offline: 'badge-error',
      maintenance: 'badge-warning',
      syncing: 'badge-info',
    }
    return classes[status]
  }

  const getStatusIcon = (status: Node['status']) => {
    switch (status) {
      case 'online':
        return <Wifi size={14} />
      case 'offline':
        return <WifiOff size={14} />
      case 'maintenance':
        return <Settings size={14} />
      case 'syncing':
        return <Loader size={14} className="spin" />
    }
  }

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp
    if (diff < 60000) return 'Just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return new Date(timestamp).toLocaleDateString()
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
          <h1 className="page-title">Node Management</h1>
          <p className="page-subtitle">
            Manage your DWS infrastructure nodes and earnings
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={pendingEarnings === BigInt(0)}
          >
            <Download size={18} />
            Withdraw {formatEth(pendingEarnings)}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowAddNode(true)}
          >
            <Plus size={18} />
            Add Node
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon compute">
            <Server size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Your Nodes</div>
            <div className="stat-value">{nodes.length}</div>
            <div className="stat-change positive">{onlineNodes} online</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage">
            <Shield size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Total Stake</div>
            <div className="stat-value" style={{ fontSize: '1.25rem' }}>
              {formatEth(totalStake)}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network">
            <DollarSign size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Pending Earnings</div>
            <div className="stat-value" style={{ fontSize: '1.25rem' }}>
              {formatEth(pendingEarnings)}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon ai">
            <TrendingUp size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Earnings (24h)</div>
            <div className="stat-value" style={{ fontSize: '1.25rem' }}>
              {formatEth(last24hEarnings)}
            </div>
            <div className="stat-change positive">+12%</div>
          </div>
        </div>
      </div>

      {/* Nodes List */}
      {nodes.map((node) => (
        <div key={node.id} className="card" style={{ marginBottom: '1rem' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: '1rem',
            }}
          >
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-tertiary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Server size={24} style={{ color: 'var(--accent)' }} />
              </div>
              <div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: '1.1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  Node {node.nodeId.slice(0, 10)}...
                  <span
                    className={`badge ${getStatusBadge(node.status)}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                    }}
                  >
                    {getStatusIcon(node.status)}
                    {node.status}
                  </span>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  {node.endpoint}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="btn btn-sm btn-secondary">
                <Settings size={14} />
              </button>
              <button type="button" className="btn btn-sm btn-secondary">
                <MoreVertical size={14} />
              </button>
            </div>
          </div>

          {/* Services */}
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              marginBottom: '1rem',
              flexWrap: 'wrap',
            }}
          >
            {node.services.map((service) => (
              <span
                key={service}
                className="badge badge-info"
                style={{ textTransform: 'uppercase' }}
              >
                {service}
              </span>
            ))}
            <span className="badge badge-neutral">{node.region}</span>
            {node.attestation.verified && (
              <span
                className="badge badge-success"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                }}
              >
                <Shield size={12} /> TEE Verified
              </span>
            )}
          </div>

          {/* Resources */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '1rem',
            }}
          >
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '0.25rem',
                }}
              >
                <span
                  style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}
                >
                  <Cpu size={14} style={{ marginRight: '0.25rem' }} />
                  CPU
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.85rem',
                  }}
                >
                  {node.resources.cpuUsage}%
                </span>
              </div>
              <div
                style={{
                  height: '4px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '2px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${node.resources.cpuUsage}%`,
                    background:
                      node.resources.cpuUsage > 80
                        ? 'var(--error)'
                        : 'var(--accent)',
                    transition: 'width 0.3s',
                  }}
                />
              </div>
            </div>
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '0.25rem',
                }}
              >
                <span
                  style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}
                >
                  <HardDrive size={14} style={{ marginRight: '0.25rem' }} />
                  Memory
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.85rem',
                  }}
                >
                  {node.resources.memoryUsage}%
                </span>
              </div>
              <div
                style={{
                  height: '4px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '2px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${node.resources.memoryUsage}%`,
                    background:
                      node.resources.memoryUsage > 80
                        ? 'var(--error)'
                        : 'var(--success)',
                    transition: 'width 0.3s',
                  }}
                />
              </div>
            </div>
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '0.25rem',
                }}
              >
                <span
                  style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}
                >
                  Storage
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.85rem',
                  }}
                >
                  {node.resources.storageUsage}%
                </span>
              </div>
              <div
                style={{
                  height: '4px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '2px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${node.resources.storageUsage}%`,
                    background: 'var(--warning)',
                    transition: 'width 0.3s',
                  }}
                />
              </div>
            </div>
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '0.25rem',
                }}
              >
                <span
                  style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}
                >
                  Bandwidth
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.85rem',
                  }}
                >
                  {node.resources.bandwidth} Mbps
                </span>
              </div>
              <div
                style={{
                  height: '4px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '2px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(node.resources.bandwidth / 10, 100)}%`,
                    background: 'var(--info)',
                    transition: 'width 0.3s',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Stats Row */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: '1rem',
              paddingTop: '1rem',
              borderTop: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div
                  style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}
                >
                  Reputation
                </div>
                <div
                  style={{
                    fontWeight: 600,
                    color:
                      node.reputation >= 90
                        ? 'var(--success)'
                        : node.reputation >= 70
                          ? 'var(--warning)'
                          : 'var(--error)',
                  }}
                >
                  {node.reputation}/100
                </div>
              </div>
              <div>
                <div
                  style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}
                >
                  Uptime
                </div>
                <div style={{ fontWeight: 600 }}>{node.uptime}%</div>
              </div>
              <div>
                <div
                  style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}
                >
                  Stake
                </div>
                <div style={{ fontWeight: 600 }}>
                  {formatEth(BigInt(node.stake || '0'))}
                </div>
              </div>
              <div>
                <div
                  style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}
                >
                  Earnings (24h)
                </div>
                <div style={{ fontWeight: 600, color: 'var(--success)' }}>
                  {formatEth(node.earnings.last24h)}
                </div>
              </div>
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Last seen: {formatTime(node.lastSeen)}
            </div>
          </div>
        </div>
      ))}

      {nodes.length === 0 && (
        <div className="card">
          <div className="empty-state" style={{ padding: '3rem' }}>
            <Server size={48} />
            <h3>No nodes registered</h3>
            <p>Register your first node to start earning</p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: '1rem' }}
              onClick={() => setShowAddNode(true)}
            >
              <Plus size={18} /> Add Node
            </button>
          </div>
        </div>
      )}

      {/* Add Node Modal */}
      {showAddNode && (
        <div className="modal-overlay">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => setShowAddNode(false)}
            aria-label="Close modal"
          />
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowAddNode(false)
            }}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <h2>Register New Node</h2>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => setShowAddNode(false)}
              >
                <XCircle size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="node-endpoint">Node Endpoint</label>
                <input
                  id="node-endpoint"
                  type="text"
                  placeholder="https://your-node.example.com:8080"
                  className="input"
                />
              </div>

              <fieldset
                className="form-group"
                style={{ border: 'none', padding: 0, margin: 0 }}
              >
                <legend style={{ marginBottom: '0.5rem' }}>
                  Services to Provide
                </legend>
                <div
                  style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}
                >
                  {['cdn', 'compute', 'storage', 'da', 'git', 'pkg'].map(
                    (service) => (
                      <label
                        key={service}
                        htmlFor={`service-${service}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          padding: '0.5rem 0.75rem',
                          background: 'var(--bg-tertiary)',
                          borderRadius: 'var(--radius-sm)',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          id={`service-${service}`}
                          type="checkbox"
                          defaultChecked={[
                            'cdn',
                            'compute',
                            'storage',
                          ].includes(service)}
                        />
                        <span style={{ textTransform: 'uppercase' }}>
                          {service}
                        </span>
                      </label>
                    ),
                  )}
                </div>
              </fieldset>

              <div className="form-group">
                <label htmlFor="node-region">Region</label>
                <select id="node-region" className="input">
                  <option value="us-east-1">US East (N. Virginia)</option>
                  <option value="us-west-2">US West (Oregon)</option>
                  <option value="eu-west-1">EU (Ireland)</option>
                  <option value="eu-central-1">EU (Frankfurt)</option>
                  <option value="ap-northeast-1">Asia Pacific (Tokyo)</option>
                  <option value="ap-southeast-1">
                    Asia Pacific (Singapore)
                  </option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="stake-amount">Stake Amount (ETH)</label>
                <input
                  id="stake-amount"
                  type="number"
                  placeholder="100"
                  className="input"
                  defaultValue="100"
                />
                <small style={{ color: 'var(--text-muted)' }}>
                  Minimum stake: 100 ETH for full node
                </small>
              </div>

              <div className="form-group">
                <label htmlFor="tee-platform">TEE Platform</label>
                <select id="tee-platform" className="input">
                  <option value="intel-sgx">Intel SGX</option>
                  <option value="amd-sev">AMD SEV</option>
                  <option value="intel-tdx">Intel TDX</option>
                  <option value="simulator">Simulator (Dev only)</option>
                </select>
              </div>

              <div
                style={{
                  padding: '1rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-md)',
                  marginTop: '1rem',
                }}
              >
                <h4 style={{ marginBottom: '0.5rem' }}>
                  Hardware Requirements
                </h4>
                <ul
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: '0.9rem',
                    paddingLeft: '1rem',
                  }}
                >
                  <li>CPU: 8+ cores (16+ recommended)</li>
                  <li>RAM: 32GB+ (64GB+ for compute)</li>
                  <li>Storage: 500GB+ NVMe SSD</li>
                  <li>Network: 1Gbps+ dedicated connection</li>
                  <li>TEE: Intel SGX, AMD SEV, or Intel TDX</li>
                </ul>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowAddNode(false)}
              >
                Cancel
              </button>
              <button type="button" className="btn btn-primary">
                <Shield size={18} /> Register & Stake
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
