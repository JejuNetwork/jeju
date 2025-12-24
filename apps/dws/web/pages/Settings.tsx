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
  User,
} from 'lucide-react'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { CONTRACTS, NETWORK } from '../config'
import { useRegisterNode } from '../hooks'
import { useAgentId } from '../hooks/useAgentId'
import { useBanStatus } from '../hooks/useBanStatus'

export default function SettingsPage() {
  const { address, isConnected } = useAccount()
  const { hasAgent, agentId, tokenURI } = useAgentId()
  const { isBanned, banRecord } = useBanStatus()
  const registerNode = useRegisterNode()

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
    setTimeout(() => setCopied(null), 2000)
  }

  const handleRegisterNode = async (e: React.FormEvent) => {
    e.preventDefault()
    await registerNode.mutateAsync({
      nodeId: nodeFormData.nodeId,
      endpoint: nodeFormData.endpoint,
      region: nodeFormData.region,
      zone: nodeFormData.zone,
      totalCpu: parseInt(nodeFormData.totalCpu, 10),
      totalMemoryMb: parseInt(nodeFormData.totalMemoryMb, 10),
      totalStorageMb: parseInt(nodeFormData.totalStorageMb, 10),
    })
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
  }

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
          Manage your account, security, and preferences
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '200px 1fr',
          gap: '1.5rem',
        }}
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
                      Reason: {banRecord.reason || 'No reason provided'}
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
                    <label
                      style={{
                        position: 'relative',
                        width: 44,
                        height: 24,
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        defaultChecked={item.enabled}
                        style={{ opacity: 0, width: 0, height: 0 }}
                      />
                      <span
                        style={{
                          position: 'absolute',
                          inset: 0,
                          background: item.enabled
                            ? 'var(--accent)'
                            : 'var(--bg-primary)',
                          borderRadius: 12,
                          transition: 'background 0.2s',
                        }}
                      >
                        <span
                          style={{
                            position: 'absolute',
                            top: 2,
                            left: item.enabled ? 22 : 2,
                            width: 20,
                            height: 20,
                            background: 'white',
                            borderRadius: '50%',
                            transition: 'left 0.2s',
                          }}
                        />
                      </span>
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

              <div className="empty-state" style={{ padding: '3rem' }}>
                <Server size={48} />
                <h3>No nodes registered</h3>
                <p>Register a compute node to start earning as a provider</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowNodeModal(true)}
                  disabled={!isConnected}
                >
                  <Plus size={16} /> Register Node
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showNodeModal && (
        <div className="modal-overlay">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => setShowNodeModal(false)}
            aria-label="Close modal"
          />
          <div
            className="modal"
            style={{ maxWidth: '550px' }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') {
                setShowNodeModal(false)
              }
            }}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <h3 className="modal-title">Register Compute Node</h3>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setShowNodeModal(false)}
              >
                ×
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
