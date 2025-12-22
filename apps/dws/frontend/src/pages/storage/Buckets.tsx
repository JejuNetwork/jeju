import {
  Database,
  Download,
  Eye,
  EyeOff,
  File,
  Folder,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { useStorageHealth, useUploadFile } from '../../hooks'

interface MockBucket {
  name: string
  region: string
  visibility: 'public' | 'private'
  objectCount: number
  totalSize: number
  createdAt: number
}

interface MockObject {
  key: string
  size: number
  contentType: string
  uploadedAt: number
}

export default function BucketsPage() {
  const { isConnected } = useAccount()
  const { data: healthData } = useStorageHealth()
  const uploadFile = useUploadFile()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    visibility: 'private',
    region: 'auto',
  })

  const [buckets] = useState<MockBucket[]>([])
  const [objects] = useState<MockObject[]>([])

  const handleCreateBucket = (e: React.FormEvent) => {
    e.preventDefault()
    setShowCreateModal(false)
    setFormData({ name: '', visibility: 'private', region: 'auto' })
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      await uploadFile.mutateAsync(file)
    }
  }

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
          <h1 className="page-title">Storage Buckets</h1>
          <p className="page-subtitle">
            S3-compatible object storage backed by IPFS and decentralized nodes
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={!isConnected}
          >
            <Upload size={16} /> Upload
          </button>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowCreateModal(true)}
            disabled={!isConnected}
          >
            <Plus size={16} /> Create Bucket
          </button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon storage">
            <Database size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Buckets</div>
            <div className="stat-value">{buckets.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon compute">
            <File size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Objects</div>
            <div className="stat-value">
              {buckets.reduce((sum, b) => sum + b.objectCount, 0)}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network">
            <Folder size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Total Size</div>
            <div className="stat-value">
              {formatBytes(buckets.reduce((sum, b) => sum + b.totalSize, 0))}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon ai">
            <Database size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Backends</div>
            <div className="stat-value">
              {healthData?.backends?.length ?? 0}
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: selectedBucket ? '300px 1fr' : '1fr',
          gap: '1.5rem',
        }}
      >
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Database size={18} /> Buckets
            </h3>
          </div>

          {buckets.length === 0 ? (
            <div className="empty-state">
              <Database size={48} />
              <h3>No buckets yet</h3>
              <p>Create your first storage bucket</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowCreateModal(true)}
                disabled={!isConnected}
              >
                <Plus size={16} /> Create Bucket
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {buckets.map((bucket) => (
                <button
                  type="button"
                  key={bucket.name}
                  onClick={() => setSelectedBucket(bucket.name)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.75rem',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    background:
                      selectedBucket === bucket.name
                        ? 'var(--accent-soft)'
                        : 'transparent',
                    border: `1px solid ${selectedBucket === bucket.name ? 'var(--accent)' : 'var(--border)'}`,
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  <Folder size={20} style={{ color: 'var(--accent)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {bucket.name}
                    </div>
                    <div
                      style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}
                    >
                      {bucket.objectCount} objects ·{' '}
                      {formatBytes(bucket.totalSize)}
                    </div>
                  </div>
                  {bucket.visibility === 'public' ? (
                    <Eye size={16} style={{ color: 'var(--success)' }} />
                  ) : (
                    <EyeOff size={16} style={{ color: 'var(--text-muted)' }} />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedBucket && (
          <div className="card">
            <div className="card-header">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  flex: 1,
                }}
              >
                <h3 className="card-title" style={{ marginBottom: 0 }}>
                  <File size={18} /> {selectedBucket}
                </h3>
                <div style={{ flex: 1, maxWidth: '300px' }}>
                  <div style={{ position: 'relative' }}>
                    <Search
                      size={16}
                      style={{
                        position: 'absolute',
                        left: '0.75rem',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'var(--text-muted)',
                      }}
                    />
                    <input
                      className="input"
                      placeholder="Search objects..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={{ paddingLeft: '2.25rem' }}
                    />
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={14} /> Upload
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSelectedBucket(null)}
                >
                  ×
                </button>
              </div>
            </div>

            {objects.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem' }}>
                <File size={32} />
                <p>No objects in this bucket</p>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={14} /> Upload File
                </button>
              </div>
            ) : (
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Size</th>
                      <th>Type</th>
                      <th>Uploaded</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {objects
                      .filter((o) =>
                        o.key.toLowerCase().includes(searchQuery.toLowerCase()),
                      )
                      .map((obj) => (
                        <tr key={obj.key}>
                          <td
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '0.85rem',
                            }}
                          >
                            {obj.key}
                          </td>
                          <td>{formatBytes(obj.size)}</td>
                          <td>
                            <span className="badge badge-neutral">
                              {obj.contentType}
                            </span>
                          </td>
                          <td>
                            {new Date(obj.uploadedAt).toLocaleDateString()}
                          </td>
                          <td style={{ display: 'flex', gap: '0.25rem' }}>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              title="Download"
                            >
                              <Download size={14} />
                            </button>
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
        )}
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => setShowCreateModal(false)}
            aria-label="Close modal"
          />
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') {
                setShowCreateModal(false)
              }
            }}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <h3 className="modal-title">Create Bucket</h3>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setShowCreateModal(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleCreateBucket}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="bucket-name" className="form-label">
                    Bucket Name *
                  </label>
                  <input
                    id="bucket-name"
                    className="input"
                    placeholder="my-bucket"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    required
                    pattern="[a-z0-9-]+"
                  />
                  <div className="form-hint">
                    Lowercase letters, numbers, and hyphens only
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="bucket-visibility" className="form-label">
                    Visibility
                  </label>
                  <select
                    id="bucket-visibility"
                    className="input"
                    value={formData.visibility}
                    onChange={(e) =>
                      setFormData({ ...formData, visibility: e.target.value })
                    }
                  >
                    <option value="private">Private</option>
                    <option value="public">Public</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="bucket-region" className="form-label">
                    Region
                  </label>
                  <select
                    id="bucket-region"
                    className="input"
                    value={formData.region}
                    onChange={(e) =>
                      setFormData({ ...formData, region: e.target.value })
                    }
                  >
                    <option value="auto">Auto (closest)</option>
                    <option value="us-east">US East</option>
                    <option value="us-west">US West</option>
                    <option value="eu-west">EU West</option>
                    <option value="asia-east">Asia East</option>
                  </select>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  <Plus size={16} /> Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
