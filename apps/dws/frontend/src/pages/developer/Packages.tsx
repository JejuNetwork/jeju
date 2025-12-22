import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Package,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react'
import { useState } from 'react'
import { usePackages } from '../../hooks'

export default function PackagesPage() {
  const { data: packagesData, isLoading, refetch } = usePackages(50)
  const [searchQuery, setSearchQuery] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null)

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const packages = packagesData?.packages ?? []
  const filteredPackages = packages.filter(
    (pkg) =>
      pkg.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pkg.description.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const totalDownloads = packages.reduce((sum, p) => sum + p.downloads, 0)
  const selectedPkg = packages.find((p) => p.id === selectedPackage)

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
          <h1 className="page-title">Package Registry</h1>
          <p className="page-subtitle">
            Host and discover packages with decentralized distribution
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary" onClick={() => refetch()}>
            <RefreshCw size={16} /> Refresh
          </button>
          <button className="btn btn-primary">
            <Plus size={16} /> Publish Package
          </button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon compute">
            <Package size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Packages</div>
            <div className="stat-value">{packages.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage">
            <Download size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Total Downloads</div>
            <div className="stat-value">{totalDownloads.toLocaleString()}</div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: selectedPackage ? '1fr 350px' : '1fr',
          gap: '1.5rem',
        }}
      >
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Package size={18} /> Packages
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
                  placeholder="Search packages..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ paddingLeft: '2.25rem' }}
                />
              </div>
            </div>
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
          ) : filteredPackages.length === 0 ? (
            <div className="empty-state">
              <Package size={48} />
              <h3>{searchQuery ? 'No packages found' : 'No packages yet'}</h3>
              <p>
                {searchQuery
                  ? 'Try a different search term'
                  : 'Publish your first package'}
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {filteredPackages.map((pkg) => (
                <div
                  key={pkg.id}
                  onClick={() => setSelectedPackage(pkg.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    padding: '1rem',
                    background:
                      selectedPackage === pkg.id
                        ? 'var(--accent-soft)'
                        : 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                    border: `1px solid ${selectedPackage === pkg.id ? 'var(--accent)' : 'var(--border)'}`,
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  <Package size={24} style={{ color: 'var(--accent)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{pkg.name}</span>
                      <span className="badge badge-neutral">
                        v{pkg.version}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: '0.85rem',
                        color: 'var(--text-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {pkg.description}
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      color: 'var(--text-muted)',
                      fontSize: '0.85rem',
                    }}
                  >
                    <Download size={14} /> {pkg.downloads.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedPackage && selectedPkg && (
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Package Details</h3>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setSelectedPackage(null)}
              >
                ×
              </button>
            </div>
            <div style={{ display: 'grid', gap: '1.25rem' }}>
              <div>
                <div
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: 600,
                    marginBottom: '0.25rem',
                  }}
                >
                  {selectedPkg.name}
                </div>
                <span className="badge badge-accent">
                  v{selectedPkg.version}
                </span>
              </div>

              <div>
                <div
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                    marginBottom: '0.25rem',
                  }}
                >
                  Description
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>
                  {selectedPkg.description}
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                    marginBottom: '0.5rem',
                  }}
                >
                  Install
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    background: 'var(--bg-tertiary)',
                    padding: '0.75rem',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <code style={{ flex: 1, fontSize: '0.85rem' }}>
                    bun add {selectedPkg.name}
                  </code>
                  <button
                    className="btn btn-ghost btn-icon"
                    style={{ padding: '0.25rem' }}
                    onClick={() =>
                      handleCopy(`bun add ${selectedPkg.name}`, 'install')
                    }
                  >
                    {copied === 'install' ? (
                      <Check size={14} />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '1rem',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-muted)',
                      marginBottom: '0.25rem',
                    }}
                  >
                    Downloads
                  </div>
                  <div
                    style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}
                  >
                    {selectedPkg.downloads.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-muted)',
                      marginBottom: '0.25rem',
                    }}
                  >
                    Published
                  </div>
                  <div>
                    {new Date(selectedPkg.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                    marginBottom: '0.5rem',
                  }}
                >
                  IPFS CID
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    background: 'var(--bg-tertiary)',
                    padding: '0.75rem',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <code
                    style={{
                      flex: 1,
                      fontSize: '0.8rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {selectedPkg.cid}
                  </code>
                  <button
                    className="btn btn-ghost btn-icon"
                    style={{ padding: '0.25rem' }}
                    onClick={() => handleCopy(selectedPkg.cid, 'cid')}
                  >
                    {copied === 'cid' ? (
                      <Check size={14} />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <a
                  href={`https://ipfs.jejunetwork.org/ipfs/${selectedPkg.cid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                >
                  <ExternalLink size={16} /> View on IPFS
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
