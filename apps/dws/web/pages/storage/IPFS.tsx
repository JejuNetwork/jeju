import {
  Check,
  Copy,
  ExternalLink,
  File,
  Globe,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { useStorageHealth, useUploadFile } from '../../hooks'

interface IPFSFile {
  cid: string
  name: string
  size: number
  type: string
  uploadedAt: number
  pinned: boolean
}

export default function IPFSPage() {
  const { isConnected } = useAccount()
  const { data: healthData } = useStorageHealth()
  const uploadFile = useUploadFile()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [files] = useState<IPFSFile[]>([])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      await uploadFile.mutateAsync(file)
    }
  }

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
  }

  const filteredFiles = files.filter(
    (f: IPFSFile) =>
      f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.cid.toLowerCase().includes(searchQuery.toLowerCase()),
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
          <h1 className="page-title">IPFS Storage</h1>
          <p className="page-subtitle">
            Content-addressed storage on the InterPlanetary File System
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="btn btn-secondary">
            <RefreshCw size={16} /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={!isConnected || uploadFile.isPending}
          >
            {uploadFile.isPending ? (
              <>
                <div className="spinner" style={{ width: 16, height: 16 }} />{' '}
                Uploading...
              </>
            ) : (
              <>
                <Upload size={16} /> Upload to IPFS
              </>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon storage">
            <Globe size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Files</div>
            <div className="stat-value">{files.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon compute">
            <File size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Total Size</div>
            <div className="stat-value">
              {formatBytes(
                files.reduce((sum: number, f: IPFSFile) => sum + f.size, 0),
              )}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network">
            <Globe size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Pinned</div>
            <div className="stat-value">
              {files.filter((f: IPFSFile) => f.pinned).length}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon ai">
            <Globe size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Status</div>
            <div className="stat-value">
              <span
                className={`badge ${healthData?.status === 'healthy' ? 'badge-success' : 'badge-warning'}`}
              >
                {healthData?.status ?? 'Unknown'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">
            <Globe size={18} /> IPFS Files
          </h3>
          <div style={{ flex: 1, maxWidth: '300px', marginLeft: '1rem' }}>
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
                placeholder="Search by name or CID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ paddingLeft: '2.25rem' }}
              />
            </div>
          </div>
        </div>

        {files.length === 0 ? (
          <div className="empty-state">
            <Globe size={48} />
            <h3>No files uploaded</h3>
            <p>
              Upload files to IPFS for decentralized, content-addressed storage
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={!isConnected}
            >
              <Upload size={16} /> Upload File
            </button>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>CID</th>
                  <th>Size</th>
                  <th>Type</th>
                  <th>Uploaded</th>
                  <th>Pinned</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredFiles.map((file: IPFSFile) => (
                  <tr key={file.cid}>
                    <td style={{ fontWeight: 500 }}>{file.name}</td>
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
                            maxWidth: '150px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {file.cid}
                        </code>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon"
                          style={{ padding: '0.25rem' }}
                          onClick={() => handleCopy(file.cid, file.cid)}
                          title="Copy CID"
                        >
                          {copied === file.cid ? (
                            <Check size={14} />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      </div>
                    </td>
                    <td
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.85rem',
                      }}
                    >
                      {formatBytes(file.size)}
                    </td>
                    <td>
                      <span className="badge badge-neutral">{file.type}</span>
                    </td>
                    <td>{new Date(file.uploadedAt).toLocaleDateString()}</td>
                    <td>
                      <span
                        className={`badge ${file.pinned ? 'badge-success' : 'badge-neutral'}`}
                      >
                        {file.pinned ? 'Pinned' : 'Unpinned'}
                      </span>
                    </td>
                    <td style={{ display: 'flex', gap: '0.25rem' }}>
                      <a
                        href={`https://ipfs.jejunetwork.org/ipfs/${file.cid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost btn-sm"
                        title="View on IPFS Gateway"
                      >
                        <ExternalLink size={14} />
                      </a>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title="Unpin"
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

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div className="card-header">
          <h3 className="card-title">
            <Globe size={18} /> IPFS Gateway
          </h3>
        </div>
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.75rem',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <span>Public Gateway</span>
            <code
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              https://ipfs.jejunetwork.org
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                style={{ padding: '0.25rem' }}
                onClick={() =>
                  handleCopy('https://ipfs.jejunetwork.org', 'gateway')
                }
              >
                {copied === 'gateway' ? (
                  <Check size={14} />
                ) : (
                  <Copy size={14} />
                )}
              </button>
            </code>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.75rem',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <span>API Endpoint</span>
            <code
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              {healthData?.backends?.[0] ?? 'Not available'}
              {healthData?.backends?.[0] && (
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  style={{ padding: '0.25rem' }}
                  onClick={() =>
                    handleCopy(healthData?.backends?.[0] ?? '', 'api')
                  }
                >
                  {copied === 'api' ? <Check size={14} /> : <Copy size={14} />}
                </button>
              )}
            </code>
          </div>
        </div>
      </div>
    </div>
  )
}
