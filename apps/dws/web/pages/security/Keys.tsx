import {
  Check,
  Copy,
  Key,
  Lock,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useCreateKey, useKMSKeys } from '../../hooks'

export default function KeysPage() {
  const { isConnected } = useAccount()
  const { data: keysData, isLoading, refetch } = useKMSKeys()
  const createKey = useCreateKey()

  const [showModal, setShowModal] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    threshold: '2',
    totalParties: '3',
  })

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    await createKey.mutateAsync({
      threshold: parseInt(formData.threshold, 10),
      totalParties: parseInt(formData.totalParties, 10),
    })
    setShowModal(false)
    setFormData({ threshold: '2', totalParties: '3' })
  }

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const keys = keysData?.keys ?? []

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
          <h1 className="page-title">Key Management (KMS)</h1>
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
            disabled={!isConnected}
          >
            <Plus size={16} /> Create Key
          </button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon compute">
            <Key size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Total Keys</div>
            <div className="stat-value">{keys.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage">
            <Shield size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">TEE Secured</div>
            <div className="stat-value">{keys.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network">
            <Lock size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Threshold Parties</div>
            <div className="stat-value">
              {keys.reduce((sum, k) => sum + k.totalParties, 0)}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">
            <Key size={18} /> Keys
          </h3>
        </div>

        {isLoading ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: '3rem',
            }}
          >
            <div className="spinner" />
          </div>
        ) : keys.length === 0 ? (
          <div className="empty-state">
            <Key size={48} />
            <h3>No keys yet</h3>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowModal(true)}
              disabled={!isConnected}
            >
              <Plus size={16} /> Create Key
            </button>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Key ID</th>
                  <th>Public Key</th>
                  <th>Address</th>
                  <th>Threshold</th>
                  <th>Version</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.keyId}>
                    <td
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.85rem',
                      }}
                    >
                      {key.keyId.slice(0, 12)}...
                    </td>
                    <td>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                        }}
                      >
                        <code
                          style={{
                            fontSize: '0.8rem',
                            maxWidth: '120px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {key.publicKey.slice(0, 20)}...
                        </code>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon"
                          style={{ padding: '0.25rem' }}
                          onClick={() =>
                            handleCopy(key.publicKey, `pk-${key.keyId}`)
                          }
                        >
                          {copied === `pk-${key.keyId}` ? (
                            <Check size={14} />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      </div>
                    </td>
                    <td>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                        }}
                      >
                        <code style={{ fontSize: '0.8rem' }}>
                          {key.address.slice(0, 6)}...{key.address.slice(-4)}
                        </code>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon"
                          style={{ padding: '0.25rem' }}
                          onClick={() =>
                            handleCopy(key.address, `addr-${key.keyId}`)
                          }
                        >
                          {copied === `addr-${key.keyId}` ? (
                            <Check size={14} />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-accent">
                        {key.threshold} of {key.totalParties}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      v{key.version}
                    </td>
                    <td>{new Date(key.createdAt).toLocaleDateString()}</td>
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
              <h3 className="modal-title">Create Threshold Key</h3>
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
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '1rem',
                  }}
                >
                  <div className="form-group">
                    <label htmlFor="key-threshold" className="form-label">
                      Threshold (M)
                    </label>
                    <select
                      id="key-threshold"
                      className="input"
                      value={formData.threshold}
                      onChange={(e) =>
                        setFormData({ ...formData, threshold: e.target.value })
                      }
                    >
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="4">4</option>
                      <option value="5">5</option>
                    </select>
                    <div className="form-hint">Signatures required</div>
                  </div>
                  <div className="form-group">
                    <label htmlFor="key-total-parties" className="form-label">
                      Total Parties (N)
                    </label>
                    <select
                      id="key-total-parties"
                      className="input"
                      value={formData.totalParties}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          totalParties: e.target.value,
                        })
                      }
                    >
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="5">5</option>
                      <option value="7">7</option>
                    </select>
                    <div className="form-hint">Total key shares</div>
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
                  disabled={createKey.isPending}
                >
                  {createKey.isPending ? (
                    'Creating...'
                  ) : (
                    <>
                      <Key size={16} /> Create Key
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
