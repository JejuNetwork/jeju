import {
  Database,
  Download,
  File,
  Folder,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import {
  useCreateS3Bucket,
  useDeleteS3Bucket,
  useDeleteS3Object,
  useS3Buckets,
  useS3Objects,
  useS3Presign,
  useStorageHealth,
  useUploadS3Object,
} from '../../hooks'

export default function BucketsPage() {
  const { isConnected } = useAccount()
  const { data: healthData } = useStorageHealth()
  const {
    data: bucketsData,
    isLoading: bucketsLoading,
    refetch: refetchBuckets,
  } = useS3Buckets()
  const createBucket = useCreateS3Bucket()
  const deleteBucket = useDeleteS3Bucket()
  const uploadObject = useUploadS3Object()
  const deleteObject = useDeleteS3Object()
  const presign = useS3Presign()

  const fileInputRef = useRef<HTMLInputElement>(null)

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    visibility: 'private',
    region: 'us-east-1',
  })
  const [uploadError, setUploadError] = useState<string | null>(null)

  const {
    data: objectsData,
    isLoading: objectsLoading,
    refetch: refetchObjects,
  } = useS3Objects(selectedBucket ?? '')

  const buckets = bucketsData?.Buckets ?? []
  const objects = objectsData?.Contents ?? []

  const handleCreateBucket = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await createBucket.mutateAsync({
        name: formData.name,
        region: formData.region,
      })
      setShowCreateModal(false)
      setFormData({ name: '', visibility: 'private', region: 'us-east-1' })
    } catch (error) {
      console.error('Failed to create bucket:', error)
    }
  }

  const handleDeleteBucket = async (bucketName: string) => {
    if (!confirm(`Delete bucket "${bucketName}"? This cannot be undone.`))
      return
    try {
      await deleteBucket.mutateAsync(bucketName)
      if (selectedBucket === bucketName) {
        setSelectedBucket(null)
      }
    } catch (error) {
      console.error('Failed to delete bucket:', error)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selectedBucket) return

    setUploadError(null)
    try {
      await uploadObject.mutateAsync({
        bucket: selectedBucket,
        key: file.name,
        file,
      })
      refetchObjects()
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed')
    }
    e.target.value = ''
  }

  const handleDeleteObject = async (key: string) => {
    if (!selectedBucket) return
    if (!confirm(`Delete "${key}"? This cannot be undone.`)) return
    try {
      await deleteObject.mutateAsync({ bucket: selectedBucket, key })
    } catch (error) {
      console.error('Failed to delete object:', error)
    }
  }

  const handleDownload = async (key: string) => {
    if (!selectedBucket) return
    try {
      const result = await presign.mutateAsync({
        bucket: selectedBucket,
        key,
        operation: 'GET',
        expiresIn: 3600,
      })
      window.open(result.url, '_blank')
    } catch (error) {
      console.error('Failed to generate download link:', error)
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
  }

  const totalObjects = objects.length
  const totalSize = objects.reduce((sum, obj) => sum + obj.Size, 0)

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
            S3-compatible storage with built-in redundancy across the network
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => refetchBuckets()}
          >
            <RefreshCw size={16} /> Refresh
          </button>
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
            <div className="stat-value">{totalObjects}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network">
            <Folder size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Total Size</div>
            <div className="stat-value">{formatBytes(totalSize)}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon ai">
            <Database size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Backends</div>
            <div className="stat-value">{healthData?.backends.length ?? 0}</div>
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

          {bucketsLoading ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                padding: '3rem',
              }}
            >
              <div className="spinner" />
            </div>
          ) : buckets.length === 0 ? (
            <div className="empty-state">
              <Database size={48} />
              <h3>Start storing</h3>
              <p>
                Create your first bucket to store files with decentralized
                redundancy
              </p>
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
                <div
                  key={bucket.Name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.75rem',
                    borderRadius: 'var(--radius-md)',
                    background:
                      selectedBucket === bucket.Name
                        ? 'var(--accent-soft)'
                        : 'transparent',
                    border: `1px solid ${selectedBucket === bucket.Name ? 'var(--accent)' : 'var(--border)'}`,
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedBucket(bucket.Name)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      flex: 1,
                      minWidth: 0,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
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
                        {bucket.Name}
                      </div>
                      <div
                        style={{
                          fontSize: '0.8rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        Created{' '}
                        {new Date(bucket.CreationDate).toLocaleDateString()}
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    title="Delete bucket"
                    onClick={() => handleDeleteBucket(bucket.Name)}
                    disabled={deleteBucket.isPending}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
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
                  onClick={() => refetchObjects()}
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadObject.isPending}
                >
                  <Upload size={14} /> Upload
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSelectedBucket(null)}
                >
                  ×
                </button>
              </div>
            </div>

            {uploadError && (
              <div
                style={{
                  padding: '0.75rem 1rem',
                  background: 'var(--error-soft)',
                  color: 'var(--error)',
                  borderRadius: 'var(--radius-sm)',
                  margin: '0 1rem 1rem',
                }}
              >
                {uploadError}
              </div>
            )}

            {objectsLoading ? (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  padding: '3rem',
                }}
              >
                <div className="spinner" />
              </div>
            ) : objects.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem' }}>
                <File size={32} />
                <p>This bucket is empty. Upload files to get started.</p>
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
                      <th>Storage Class</th>
                      <th>Last Modified</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {objects
                      .filter((o) =>
                        o.Key.toLowerCase().includes(searchQuery.toLowerCase()),
                      )
                      .map((obj) => (
                        <tr key={obj.Key}>
                          <td
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '0.85rem',
                            }}
                          >
                            {obj.Key}
                          </td>
                          <td>{formatBytes(obj.Size)}</td>
                          <td>
                            <span className="badge badge-neutral">
                              {obj.StorageClass}
                            </span>
                          </td>
                          <td>
                            {new Date(obj.LastModified).toLocaleDateString()}
                          </td>
                          <td style={{ display: 'flex', gap: '0.25rem' }}>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              title="Download"
                              onClick={() => handleDownload(obj.Key)}
                              disabled={presign.isPending}
                            >
                              <Download size={14} />
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              title="Delete"
                              onClick={() => handleDeleteObject(obj.Key)}
                              disabled={deleteObject.isPending}
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
                    <option value="us-east-1">US East (N. Virginia)</option>
                    <option value="us-west-2">US West (Oregon)</option>
                    <option value="eu-west-1">EU West (Ireland)</option>
                    <option value="ap-northeast-1">Asia Pacific (Tokyo)</option>
                  </select>
                </div>
                {createBucket.error && (
                  <div
                    style={{
                      padding: '0.75rem',
                      background: 'var(--error-soft)',
                      color: 'var(--error)',
                      borderRadius: 'var(--radius-sm)',
                      marginTop: '0.5rem',
                    }}
                  >
                    {createBucket.error instanceof Error
                      ? createBucket.error.message
                      : 'Failed to create bucket'}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createBucket.isPending}
                >
                  {createBucket.isPending ? (
                    'Creating...'
                  ) : (
                    <>
                      <Plus size={16} /> Create
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
