import {
  Check,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useCreateSecret, useSecrets } from '../../hooks'

export default function SecretsPage() {
  const { isConnected } = useAccount()
  const { data: secretsData, isLoading, refetch } = useSecrets()
  const createSecret = useCreateSecret()

  const [showModal, setShowModal] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(new Set())
  const [formData, setFormData] = useState({
    name: '',
    value: '',
    expiresIn: '',
  })

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    await createSecret.mutateAsync({
      name: formData.name,
      value: formData.value,
      expiresIn: formData.expiresIn
        ? parseInt(formData.expiresIn, 10)
        : undefined,
    })
    setShowModal(false)
    setFormData({ name: '', value: '', expiresIn: '' })
  }

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const toggleReveal = (id: string) => {
    const newRevealed = new Set(revealedSecrets)
    if (newRevealed.has(id)) {
      newRevealed.delete(id)
    } else {
      newRevealed.add(id)
    }
    setRevealedSecrets(newRevealed)
  }

  const secrets = secretsData?.secrets ?? []

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
          <h1 className="page-title">Secrets Vault</h1>
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
            <Plus size={16} /> Add Secret
          </button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon compute">
            <Lock size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Total Secrets</div>
            <div className="stat-value">{secrets.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network">
            <Clock size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Expiring Soon</div>
            <div className="stat-value">
              {
                secrets.filter(
                  (s) =>
                    s.expiresAt &&
                    s.expiresAt < Date.now() + 7 * 24 * 60 * 60 * 1000,
                ).length
              }
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">
            <Lock size={18} /> Secrets
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
        ) : secrets.length === 0 ? (
          <div className="empty-state">
            <Lock size={48} />
            <h3>No secrets yet</h3>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowModal(true)}
              disabled={!isConnected}
            >
              <Plus size={16} /> Add Secret
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {secrets.map((secret) => (
              <div
                key={secret.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  padding: '1rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                }}
              >
                <Lock size={20} style={{ color: 'var(--accent)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>{secret.name}</span>
                    {secret.expiresAt && (
                      <span
                        className={`badge ${secret.expiresAt < Date.now() ? 'badge-error' : secret.expiresAt < Date.now() + 7 * 24 * 60 * 60 * 1000 ? 'badge-warning' : 'badge-neutral'}`}
                      >
                        {secret.expiresAt < Date.now()
                          ? 'Expired'
                          : `Expires ${new Date(secret.expiresAt).toLocaleDateString()}`}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: '0.85rem',
                      color: 'var(--text-muted)',
                      marginTop: '0.25rem',
                    }}
                  >
                    Created {new Date(secret.createdAt).toLocaleDateString()}
                    {secret.updatedAt !== secret.createdAt &&
                      ` · Updated ${new Date(secret.updatedAt).toLocaleDateString()}`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.25rem' }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => toggleReveal(secret.id)}
                    title={revealedSecrets.has(secret.id) ? 'Hide' : 'Reveal'}
                  >
                    {revealedSecrets.has(secret.id) ? (
                      <EyeOff size={14} />
                    ) : (
                      <Eye size={14} />
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      handleCopy(`\${secrets.${secret.name}}`, secret.id)
                    }
                    title="Copy reference"
                  >
                    {copied === secret.id ? (
                      <Check size={14} />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div className="card-header">
          <h3 className="card-title">
            <Lock size={18} /> Usage
          </h3>
        </div>
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div
            style={{
              padding: '1rem',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div style={{ fontWeight: 500, marginBottom: '0.5rem' }}>
              In Workers
            </div>
            <code
              style={{
                display: 'block',
                padding: '0.75rem',
                background: 'var(--bg-primary)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.85rem',
              }}
            >
              {`const apiKey = env.SECRET_API_KEY;`}
            </code>
          </div>
          <div
            style={{
              padding: '1rem',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div style={{ fontWeight: 500, marginBottom: '0.5rem' }}>
              In Containers
            </div>
            <code
              style={{
                display: 'block',
                padding: '0.75rem',
                background: 'var(--bg-primary)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.85rem',
              }}
            >
              {`process.env.SECRET_API_KEY`}
            </code>
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
              <h3 className="modal-title">Add Secret</h3>
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
                  <label htmlFor="secret-name" className="form-label">
                    Secret Name *
                  </label>
                  <input
                    id="secret-name"
                    className="input"
                    placeholder="API_KEY"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        name: e.target.value
                          .toUpperCase()
                          .replace(/[^A-Z0-9_]/g, '_'),
                      })
                    }
                    required
                  />
                  <div className="form-hint">Use UPPER_SNAKE_CASE</div>
                </div>
                <div className="form-group">
                  <label htmlFor="secret-value" className="form-label">
                    Secret Value *
                  </label>
                  <input
                    id="secret-value"
                    className="input"
                    type="password"
                    placeholder="Enter secret value"
                    value={formData.value}
                    onChange={(e) =>
                      setFormData({ ...formData, value: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="secret-expires" className="form-label">
                    Expires In
                  </label>
                  <select
                    id="secret-expires"
                    className="input"
                    value={formData.expiresIn}
                    onChange={(e) =>
                      setFormData({ ...formData, expiresIn: e.target.value })
                    }
                  >
                    <option value="">Never</option>
                    <option value="86400000">1 day</option>
                    <option value="604800000">7 days</option>
                    <option value="2592000000">30 days</option>
                    <option value="7776000000">90 days</option>
                    <option value="31536000000">1 year</option>
                  </select>
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
                  disabled={createSecret.isPending}
                >
                  {createSecret.isPending ? (
                    'Creating...'
                  ) : (
                    <>
                      <Lock size={16} /> Add Secret
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
