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
  X,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { Skeleton, SkeletonTable } from '../../components/Skeleton'
import { useConfirm, useToast } from '../../context/AppContext'
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
  const { showSuccess, showError } = useToast()
  const confirm = useConfirm()
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
  const [isDragging, setIsDragging] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    visibility: 'private',
    region: 'us-east-1',
  })

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
      showSuccess('Bucket created', `Created bucket "${formData.name}"`)
      setShowCreateModal(false)
      setFormData({ name: '', visibility: 'private', region: 'us-east-1' })
    } catch (error) {
      showError(
        'Failed to create bucket',
        error instanceof Error ? error.message : 'Unknown error',
      )
    }
  }

  const handleDeleteBucket = async (bucketName: string) => {
    const confirmed = await confirm({
      title: 'Delete Bucket',
      message: `Are you sure you want to delete "${bucketName}"? This action cannot be undone and all objects in the bucket will be permanently deleted.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (!confirmed) return

    try {
      await deleteBucket.mutateAsync(bucketName)
      showSuccess('Bucket deleted', `Deleted bucket "${bucketName}"`)
      if (selectedBucket === bucketName) {
        setSelectedBucket(null)
      }
    } catch (error) {
      showError(
        'Failed to delete bucket',
        error instanceof Error ? error.message : 'Unknown error',
      )
    }
  }

  const uploadFile = useCallback(
    async (file: File) => {
      if (!selectedBucket) return

      try {
        await uploadObject.mutateAsync({
          bucket: selectedBucket,
          key: file.name,
          file,
        })
        showSuccess('File uploaded', `Uploaded "${file.name}"`)
        refetchObjects()
      } catch (error) {
        showError(
          'Upload failed',
          error instanceof Error ? error.message : 'Failed to upload file',
        )
      }
    },
    [selectedBucket, uploadObject, showSuccess, showError, refetchObjects],
  )

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadFile(file)
    e.target.value = ''
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      if (!selectedBucket) return

      const files = Array.from(e.dataTransfer.files)
      for (const file of files) {
        await uploadFile(file)
      }
    },
    [selectedBucket, uploadFile],
  )

  const handleDeleteObject = async (key: string) => {
    if (!selectedBucket) return

    const confirmed = await confirm({
      title: 'Delete Object',
      message: `Are you sure you want to delete "${key}"? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (!confirmed) return

    try {
      await deleteObject.mutateAsync({ bucket: selectedBucket, key })
      showSuccess('Object deleted', `Deleted "${key}"`)
    } catch (error) {
      showError(
        'Failed to delete object',
        error instanceof Error ? error.message : 'Unknown error',
      )
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
      showError(
        'Download failed',
        error instanceof Error ? error.message : 'Failed to generate link',
      )
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
  const filteredObjects = objects.filter((o) =>
    o.Key.toLowerCase().includes(searchQuery.toLowerCase()),
  )

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
            S3-compatible object storage with multi-backend support
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
            <div className="stat-value">
              {bucketsLoading ? (
                <Skeleton width={40} height={28} />
              ) : (
                buckets.length
              )}
            </div>
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
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} height={60} />
              ))}
            </div>
          ) : buckets.length === 0 ? (
            <div className="empty-state">
              <Database size={48} />
              <h3>No buckets yet</h3>
              <p>Create your first bucket to start storing files</p>
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
                      color: 'inherit',
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
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Drag and drop zone */}
            <button
              type="button"
              className={`drop-zone ${isDragging ? 'active' : ''}`}
              style={{ margin: '0 0 1rem 0', width: '100%', cursor: 'pointer' }}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="drop-zone-icon">
                <Upload size={24} />
              </div>
              <div className="drop-zone-title">
                {isDragging ? 'Drop files here' : 'Drag and drop files'}
              </div>
              <div className="drop-zone-subtitle">
                or click to browse from your computer
              </div>
            </button>

            {objectsLoading ? (
              <SkeletonTable rows={5} cols={5} />
            ) : filteredObjects.length === 0 ? (
              objects.length === 0 ? (
                <div className="empty-state" style={{ padding: '2rem' }}>
                  <File size={32} />
                  <h3>Bucket is empty</h3>
                  <p>Drop files above or click to upload</p>
                </div>
              ) : (
                <div className="empty-state" style={{ padding: '2rem' }}>
                  <Search size={32} />
                  <h3>No matching objects</h3>
                  <p>Try a different search term</p>
                </div>
              )
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
                    {filteredObjects.map((obj) => (
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
                            {obj.StorageClass ?? 'STANDARD'}
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
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <button
            type="button"
            className="modal-backdrop"
            onClick={() => setShowCreateModal(false)}
            tabIndex={-1}
            aria-label="Close"
          />
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title">Create Bucket</h3>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setShowCreateModal(false)}
              >
                <X size={18} />
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
