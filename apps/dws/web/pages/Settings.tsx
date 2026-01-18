import {
  Bell,
  Check,
  Copy,
  ExternalLink,
  Key,
  Plus,
  RefreshCw,
  Server,
  Shield,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { Skeleton } from '../components/Skeleton'
import { CONTRACTS, NETWORK } from '../config'
import { useConfirm, useToast } from '../context/AppContext'
import { useProviderStats, useRegisterNode } from '../hooks'
import { useAgentId } from '../hooks/useAgentId'
import { useBanStatus } from '../hooks/useBanStatus'

export default function SettingsPage() {
  const { address, isConnected } = useAccount()
  const { hasAgent, agentId, tokenURI } = useAgentId()
  const { isBanned, banRecord } = useBanStatus()
  const { data: providerStats, isLoading: nodesLoading } = useProviderStats()
  const registerNode = useRegisterNode()
  const { showSuccess, showError } = useToast()
  const confirm = useConfirm()

  const [activeTab, setActiveTab] = useState<
    'profile' | 'security' | 'notifications' | 'nodes'
  >('profile')
  const [copied, setCopied] = useState<string | null>(null)
  const [showNodeModal, setShowNodeModal] = useState(false)
  const [nodeFormData, setNodeFormData] = useState({
    nodeId: '',
    endpoint: '',
    region: 'us-east',
    zone: 'us-east-1',
    totalCpu: '4',
    totalMemoryMb: '8192',
    totalStorageMb: '102400',
  })

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    showSuccess('Copied', 'Copied to clipboard')
    setTimeout(() => setCopied(null), 2000)
  }

  const handleRegisterNode = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await registerNode.mutateAsync({
        nodeId: nodeFormData.nodeId,
        endpoint: nodeFormData.endpoint,
        region: nodeFormData.region,
        zone: nodeFormData.zone,
        totalCpu: parseInt(nodeFormData.totalCpu, 10),
        totalMemoryMb: parseInt(nodeFormData.totalMemoryMb, 10),
        totalStorageMb: parseInt(nodeFormData.totalStorageMb, 10),
      })
      showSuccess(
        'Node registered',
        `Successfully registered "${nodeFormData.nodeId}"`,
      )
      setShowNodeModal(false)
      setNodeFormData({
        nodeId: '',
        endpoint: '',
        region: 'us-east',
        zone: 'us-east-1',
        totalCpu: '4',
        totalMemoryMb: '8192',
        totalStorageMb: '102400',
      })
    } catch (error) {
      showError(
        'Registration failed',
        error instanceof Error ? error.message : 'Failed to register node',
      )
    }
  }

  const handleDeregisterNode = async (nodeId: string) => {
    const confirmed = await confirm({
      title: 'Deregister Node',
      message: `Are you sure you want to deregister node "${nodeId.slice(0, 10)}..."? You will need to claim any pending rewards first.`,
      confirmText: 'Deregister',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (!confirmed) return

    try {
      // TODO: Implement deregister mutation when API is ready
      showSuccess('Node deregistered', `Successfully deregistered node`)
    } catch (error) {
      showError(
        'Deregistration failed',
        error instanceof Error ? error.message : 'Failed to deregister node',
      )
    }
  }

  const registeredNodes = providerStats?.nodes ?? []

  const tabs = [
    { id: 'profile', label: 'Profile', icon: <User size={16} /> },
    { id: 'security', label: 'Security', icon: <Shield size={16} /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell size={16} /> },
    { id: 'nodes', label: 'Nodes', icon: <Server size={16} /> },
  ] as const

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">
          Manage your profile, security, and node configuration
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(180px, 220px) 1fr',
          gap: '1.5rem',
        }}
        className="settings-grid"
      >
        <div className="card" style={{ height: 'fit-content' }}>
          <div style={{ display: 'grid', gap: '0.25rem' }}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.75rem 1rem',
                  background:
                    activeTab === tab.id ? 'var(--accent-soft)' : 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  color:
                    activeTab === tab.id
                      ? 'var(--accent)'
                      : 'var(--text-secondary)',
                  fontWeight: activeTab === tab.id ? 500 : 400,
                  transition: 'all var(--transition-fast)',
                  textAlign: 'left',
                }}
              >
                {tab.icon}
                {tab.label}
                {tab.id === 'nodes' && registeredNodes.length > 0 && (
                  <span
                    className="badge badge-accent"
                    style={{ marginLeft: 'auto', fontSize: '0.7rem' }}
                  >
                    {registeredNodes.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          {activeTab === 'profile' && (
            <div>
              <h3
                style={{
                  fontSize: '1.25rem',
                  fontWeight: 600,
                  marginBottom: '1.5rem',
                }}
              >
                Profile
              </h3>

              <div style={{ display: 'grid', gap: '1.5rem' }}>
                <div>
                  <div
                    style={{
                      fontSize: '0.85rem',
                      color: 'var(--text-muted)',
                      marginBottom: '0.5rem',
                    }}
                  >
                    Wallet Address
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.75rem',
                      background: 'var(--bg-tertiary)',
                      borderRadius: 'var(--radius-md)',
                    }}
                  >
                    <code style={{ flex: 1, fontSize: '0.9rem' }}>
                      {address ?? 'Not connected'}
                    </code>
                    {address && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon"
                        style={{ padding: '0.25rem' }}
                        onClick={() => handleCopy(address, 'address')}
                      >
                        {copied === 'address' ? (
                          <Check size={14} />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      fontSize: '0.85rem',
                      color: 'var(--text-muted)',
                      marginBottom: '0.5rem',
                    }}
                  >
                    ERC-8004 Agent
                  </div>
                  {hasAgent ? (
                    <div
                      style={{
                        padding: '1rem',
                        background: 'var(--success-soft)',
                        borderRadius: 'var(--radius-md)',
                        borderLeft: '3px solid var(--success)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 500 }}>
                            Agent ID: {agentId}
                          </div>
                          <div
                            style={{
                              fontSize: '0.85rem',
                              color: 'var(--text-secondary)',
                              marginTop: '0.25rem',
                            }}
                          >
                            {tokenURI?.slice(0, 50)}...
                          </div>
                        </div>
                        <a
                          href={`https://explorer.jejunetwork.org/token/${CONTRACTS.identityRegistry}/instance/${agentId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-ghost btn-sm"
                        >
                          <ExternalLink size={14} />
                        </a>
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: '1rem',
                        background: 'var(--bg-tertiary)',
                        borderRadius: 'var(--radius-md)',
                      }}
                    >
                      <div style={{ marginBottom: '0.75rem' }}>
                        No agent registered
                      </div>
                      <a
                        href="https://gateway.jejunetwork.org/register"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-primary btn-sm"
                      >
                        <Plus size={14} /> Register Agent
                      </a>
                    </div>
                  )}
                </div>

                {isBanned && banRecord && (
                  <div
                    style={{
                      padding: '1rem',
                      background: 'var(--error-soft)',
                      borderRadius: 'var(--radius-md)',
                      borderLeft: '3px solid var(--error)',
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 500,
                        color: 'var(--error)',
                        marginBottom: '0.5rem',
                      }}
                    >
                      Account Suspended
                    </div>
                    <div
                      style={{
                        fontSize: '0.9rem',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      Reason: {banRecord.reason ?? 'Not specified'}
                    </div>
                  </div>
                )}

                <div>
                  <div
                    style={{
                      fontSize: '0.85rem',
                      color: 'var(--text-muted)',
                      marginBottom: '0.5rem',
                    }}
                  >
                    Network
                  </div>
                  <div
                    style={{
                      padding: '0.75rem',
                      background: 'var(--bg-tertiary)',
                      borderRadius: 'var(--radius-md)',
                    }}
                  >
                    <span
                      className={`badge ${NETWORK === 'mainnet' ? 'badge-success' : NETWORK === 'testnet' ? 'badge-warning' : 'badge-neutral'}`}
                    >
                      {NETWORK}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div>
              <h3
                style={{
                  fontSize: '1.25rem',
                  fontWeight: 600,
                  marginBottom: '1.5rem',
                }}
              >
                Security
              </h3>

              <div style={{ display: 'grid', gap: '1rem' }}>
                <div
                  style={{
                    padding: '1rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>
                      Two-Factor Authentication
                    </div>
                    <div
                      style={{
                        fontSize: '0.85rem',
                        color: 'var(--text-muted)',
                      }}
                    >
                      Secure your account with wallet signature verification
                    </div>
                  </div>
                  <span className="badge badge-success">Enabled</span>
                </div>

                <div
                  style={{
                    padding: '1rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>API Keys</div>
                    <div
                      style={{
                        fontSize: '0.85rem',
                        color: 'var(--text-muted)',
                      }}
                    >
                      Manage your API keys for programmatic access
                    </div>
                  </div>
                  <a href="/security/keys" className="btn btn-secondary btn-sm">
                    <Key size={14} /> Manage
                  </a>
                </div>

                <div
                  style={{
                    padding: '1rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>Active Sessions</div>
                    <div
                      style={{
                        fontSize: '0.85rem',
                        color: 'var(--text-muted)',
                      }}
                    >
                      View and manage your active sessions
                    </div>
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm">
                    <RefreshCw size={14} /> Revoke All
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div>
              <h3
                style={{
                  fontSize: '1.25rem',
                  fontWeight: 600,
                  marginBottom: '1.5rem',
                }}
              >
                Notifications
              </h3>

              <div style={{ display: 'grid', gap: '1rem' }}>
                {[
                  {
                    label: 'Job Completions',
                    desc: 'Get notified when compute jobs complete',
                    enabled: true,
                  },
                  {
                    label: 'Low Balance Alerts',
                    desc: 'Alert when x402 balance is low',
                    enabled: true,
                  },
                  {
                    label: 'Security Alerts',
                    desc: 'Important security notifications',
                    enabled: true,
                  },
                  {
                    label: 'Weekly Reports',
                    desc: 'Usage and billing summaries',
                    enabled: false,
                  },
                  {
                    label: 'Marketing',
                    desc: 'News and feature announcements',
                    enabled: false,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      padding: '1rem',
                      background: 'var(--bg-tertiary)',
                      borderRadius: 'var(--radius-md)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 500 }}>{item.label}</div>
                      <div
                        style={{
                          fontSize: '0.85rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {item.desc}
                      </div>
                    </div>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        defaultChecked={item.enabled}
                        aria-label={`Toggle ${item.label}`}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'nodes' && (
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '1.5rem',
                }}
              >
                <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>
                  Provider Nodes
                </h3>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setShowNodeModal(true)}
                  disabled={!isConnected}
                >
                  <Plus size={14} /> Register Node
                </button>
              </div>

              {nodesLoading ? (
                <div style={{ display: 'grid', gap: '1rem' }}>
                  <Skeleton height={80} />
                  <Skeleton height={80} />
                </div>
              ) : registeredNodes.length === 0 ? (
                <div className="empty-state" style={{ padding: '3rem' }}>
                  <Server size={48} />
                  <h3>No nodes registered</h3>
                  <p>Register a node to start earning rewards</p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setShowNodeModal(true)}
                    disabled={!isConnected}
                  >
                    <Plus size={16} /> Register Node
                  </button>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '1rem' }}>
                  {registeredNodes.map((node) => (
                    <div
                      key={node.nodeId}
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
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          marginBottom: '0.75rem',
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '0.9rem',
                              fontWeight: 500,
                            }}
                          >
                            {node.nodeId.slice(0, 20)}...
                          </div>
                          <div
                            style={{
                              fontSize: '0.8rem',
                              color: 'var(--text-muted)',
                              marginTop: '0.25rem',
                            }}
                          >
                            {node.region} • {node.rpcUrl}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <span
                            className={`badge ${
                              node.isActive
                                ? 'badge-success'
                                : node.isSlashed
                                  ? 'badge-error'
                                  : 'badge-warning'
                            }`}
                          >
                            {node.isActive
                              ? 'Active'
                              : node.isSlashed
                                ? 'Slashed'
                                : 'Inactive'}
                          </span>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            title="Deregister node"
                            onClick={() => handleDeregisterNode(node.nodeId)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
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
                              fontSize: '0.75rem',
                              color: 'var(--text-muted)',
                            }}
                          >
                            Staked
                          </div>
                          <div style={{ fontWeight: 500 }}>
                            ${parseFloat(node.stakedValueUSD).toFixed(2)}
                          </div>
                        </div>
                        <div>
                          <div
                            style={{
                              fontSize: '0.75rem',
                              color: 'var(--text-muted)',
                            }}
                          >
                            Pending
                          </div>
                          <div
                            style={{ fontWeight: 500, color: 'var(--success)' }}
                          >
                            ${parseFloat(node.pendingRewards).toFixed(4)}
                          </div>
                        </div>
                        <div>
                          <div
                            style={{
                              fontSize: '0.75rem',
                              color: 'var(--text-muted)',
                            }}
                          >
                            Uptime
                          </div>
                          <div style={{ fontWeight: 500 }}>
                            {(node.performance.uptimeScore / 100).toFixed(1)}%
                          </div>
                        </div>
                        <div>
                          <div
                            style={{
                              fontSize: '0.75rem',
                              color: 'var(--text-muted)',
                            }}
                          >
                            Requests
                          </div>
                          <div style={{ fontWeight: 500 }}>
                            {node.performance.requestsServed.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  <a
                    href="/node"
                    className="btn btn-secondary"
                    style={{ justifySelf: 'start' }}
                  >
                    View Full Dashboard
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showNodeModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <button
            type="button"
            className="modal-backdrop"
            onClick={() => setShowNodeModal(false)}
            tabIndex={-1}
            aria-label="Close"
          />
          <div className="modal" style={{ maxWidth: '550px' }}>
            <div className="modal-header">
              <h3 className="modal-title">Register Compute Node</h3>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setShowNodeModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleRegisterNode}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="node-id" className="form-label">
                    Node ID *
                  </label>
                  <input
                    id="node-id"
                    className="input"
                    placeholder="my-compute-node-1"
                    value={nodeFormData.nodeId}
                    onChange={(e) =>
                      setNodeFormData({
                        ...nodeFormData,
                        nodeId: e.target.value,
                      })
                    }
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="endpoint-url" className="form-label">
                    Endpoint URL *
                  </label>
                  <input
                    id="endpoint-url"
                    className="input"
                    placeholder="https://node.example.com:8080"
                    value={nodeFormData.endpoint}
                    onChange={(e) =>
                      setNodeFormData({
                        ...nodeFormData,
                        endpoint: e.target.value,
                      })
                    }
                    required
                  />
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '1rem',
                  }}
                >
                  <div className="form-group">
                    <label htmlFor="node-region" className="form-label">
                      Region
                    </label>
                    <select
                      id="node-region"
                      className="input"
                      value={nodeFormData.region}
                      onChange={(e) =>
                        setNodeFormData({
                          ...nodeFormData,
                          region: e.target.value,
                        })
                      }
                    >
                      <option value="us-east">US East</option>
                      <option value="us-west">US West</option>
                      <option value="eu-west">EU West</option>
                      <option value="eu-central">EU Central</option>
                      <option value="asia-east">Asia East</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="node-zone" className="form-label">
                      Zone
                    </label>
                    <input
                      id="node-zone"
                      className="input"
                      value={nodeFormData.zone}
                      onChange={(e) =>
                        setNodeFormData({
                          ...nodeFormData,
                          zone: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '1rem',
                  }}
                >
                  <div className="form-group">
                    <label htmlFor="node-cpu" className="form-label">
                      CPU Cores
                    </label>
                    <input
                      id="node-cpu"
                      className="input"
                      type="number"
                      value={nodeFormData.totalCpu}
                      onChange={(e) =>
                        setNodeFormData({
                          ...nodeFormData,
                          totalCpu: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="node-memory" className="form-label">
                      Memory (MB)
                    </label>
                    <input
                      id="node-memory"
                      className="input"
                      type="number"
                      value={nodeFormData.totalMemoryMb}
                      onChange={(e) =>
                        setNodeFormData({
                          ...nodeFormData,
                          totalMemoryMb: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="node-storage" className="form-label">
                      Storage (MB)
                    </label>
                    <input
                      id="node-storage"
                      className="input"
                      type="number"
                      value={nodeFormData.totalStorageMb}
                      onChange={(e) =>
                        setNodeFormData({
                          ...nodeFormData,
                          totalStorageMb: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowNodeModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={registerNode.isPending}
                >
                  {registerNode.isPending ? (
                    'Registering...'
                  ) : (
                    <>
                      <Server size={16} /> Register
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
