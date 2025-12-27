import { Cloud, Code, Globe, Play, Plus, RefreshCw, Search } from 'lucide-react'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import {
  useScrape,
  useScrapingHealth,
  useScrapingNodes,
  useScrapingSessions,
} from '../../hooks'

export default function ScrapingPage() {
  const { isConnected } = useAccount()
  const { data: healthData, refetch: refetchHealth } = useScrapingHealth()
  const {
    data: nodesData,
    isLoading: nodesLoading,
    refetch: refetchNodes,
  } = useScrapingNodes()
  const {
    data: sessionsData,
    isLoading: sessionsLoading,
    refetch: refetchSessions,
  } = useScrapingSessions()
  const scrape = useScrape()

  const [showScrapeModal, setShowScrapeModal] = useState(false)
  const [scrapeResult, setScrapeResult] = useState<{
    html?: string
    title?: string
    statusCode?: number
    timing?: { loadTime: number }
  } | null>(null)
  const [scrapeData, setScrapeData] = useState({
    url: '',
    waitFor: '',
    javascript: true,
  })

  const handleScrape = async (e: React.FormEvent) => {
    e.preventDefault()
    setScrapeResult(null)
    try {
      const result = await scrape.mutateAsync({
        url: scrapeData.url,
        waitFor: scrapeData.waitFor || undefined,
        javascript: scrapeData.javascript,
      })
      setScrapeResult(result)
    } catch (error) {
      console.error('Scrape failed:', error)
    }
  }

  const handleRefreshAll = () => {
    refetchHealth()
    refetchNodes()
    refetchSessions()
  }

  const nodes = nodesData?.nodes ?? []
  const activeSessions =
    sessionsData?.sessions.filter((s) => s.status === 'active').length ?? 0
  const totalCapacity = healthData?.nodes.capacity ?? 0
  const inUse = healthData?.nodes.inUse ?? 0

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
          <h1 className="page-title">Web Scraping</h1>
          <p className="page-subtitle">
            Browserless-compatible web scraping with distributed browser pool
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRefreshAll}
          >
            <RefreshCw size={16} /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowScrapeModal(true)}
            disabled={!isConnected}
          >
            <Plus size={16} /> New Scrape
          </button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon compute">
            <Cloud size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Total Nodes</div>
            <div className="stat-value">{healthData?.nodes.total ?? 0}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network">
            <Globe size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Active Sessions</div>
            <div className="stat-value">{activeSessions}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage">
            <Code size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Total Capacity</div>
            <div className="stat-value">{totalCapacity}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon ai">
            <Play size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">In Use</div>
            <div className="stat-value">{inUse}</div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
          gap: '1.5rem',
        }}
      >
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Cloud size={18} /> Scraping Nodes
            </h3>
          </div>

          {nodesLoading ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                padding: '3rem',
              }}
            >
              <div className="spinner" />
            </div>
          ) : nodes.length === 0 ? (
            <div className="empty-state">
              <Cloud size={48} />
              <h3>Nodes initializing</h3>
              <p>Browser pool is starting up. Check back shortly.</p>
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Node ID</th>
                    <th>Region</th>
                    <th>Browser</th>
                    <th>Status</th>
                    <th>Capacity</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map((node) => (
                    <tr key={node.id}>
                      <td
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.85rem',
                        }}
                      >
                        {node.id.slice(0, 8)}...
                      </td>
                      <td>{node.region}</td>
                      <td>
                        <span className="badge badge-neutral">
                          {node.browserType}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            node.status === 'active'
                              ? 'badge-success'
                              : node.status === 'busy'
                                ? 'badge-warning'
                                : 'badge-error'
                          }`}
                        >
                          {node.status}
                        </span>
                      </td>
                      <td>
                        {node.currentSessions}/{node.maxConcurrent}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Code size={18} /> Quick Scrape
            </h3>
          </div>
          <div style={{ padding: '1rem' }}>
            <form onSubmit={handleScrape}>
              <div className="form-group">
                <label htmlFor="scrape-url" className="form-label">
                  URL *
                </label>
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
                    id="scrape-url"
                    className="input"
                    placeholder="https://example.com"
                    value={scrapeData.url}
                    onChange={(e) =>
                      setScrapeData({ ...scrapeData, url: e.target.value })
                    }
                    style={{ paddingLeft: '2.25rem' }}
                    required
                  />
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="scrape-wait" className="form-label">
                  Wait for Selector (optional)
                </label>
                <input
                  id="scrape-wait"
                  className="input"
                  placeholder="#content, .article, etc."
                  value={scrapeData.waitFor}
                  onChange={(e) =>
                    setScrapeData({ ...scrapeData, waitFor: e.target.value })
                  }
                />
              </div>
              <div className="form-group">
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={scrapeData.javascript}
                    onChange={(e) =>
                      setScrapeData({
                        ...scrapeData,
                        javascript: e.target.checked,
                      })
                    }
                  />
                  Enable JavaScript
                </label>
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={scrape.isPending || !scrapeData.url}
                style={{ width: '100%' }}
              >
                {scrape.isPending ? (
                  'Scraping...'
                ) : (
                  <>
                    <Play size={16} /> Scrape URL
                  </>
                )}
              </button>
            </form>

            {scrape.error && (
              <div
                style={{
                  marginTop: '1rem',
                  padding: '0.75rem',
                  background: 'var(--error-soft)',
                  color: 'var(--error)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {scrape.error instanceof Error
                  ? scrape.error.message
                  : 'Scrape failed'}
              </div>
            )}

            {scrapeResult && (
              <div
                style={{
                  marginTop: '1rem',
                  padding: '1rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: '0.5rem',
                  }}
                >
                  <span style={{ fontWeight: 500 }}>
                    {scrapeResult.title ?? '(Untitled)'}
                  </span>
                  <span className="badge badge-success">
                    {scrapeResult.statusCode}
                  </span>
                </div>
                {scrapeResult.timing && (
                  <div
                    style={{
                      fontSize: '0.85rem',
                      color: 'var(--text-muted)',
                      marginBottom: '0.5rem',
                    }}
                  >
                    Load time: {scrapeResult.timing.loadTime}ms
                  </div>
                )}
                {scrapeResult.html && (
                  <pre
                    style={{
                      maxHeight: '200px',
                      overflow: 'auto',
                      fontSize: '0.8rem',
                      fontFamily: 'var(--font-mono)',
                      padding: '0.5rem',
                      background: 'var(--bg-secondary)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    {scrapeResult.html.slice(0, 2000)}
                    {scrapeResult.html.length > 2000 && '...'}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Globe size={18} /> Active Sessions
            </h3>
          </div>

          {sessionsLoading ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                padding: '3rem',
              }}
            >
              <div className="spinner" />
            </div>
          ) : !sessionsData?.sessions || sessionsData.sessions.length === 0 ? (
            <div className="empty-state">
              <Globe size={48} />
              <h3>Ready to browse</h3>
              <p>Create a session for persistent browser automation</p>
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Session ID</th>
                    <th>Browser</th>
                    <th>Status</th>
                    <th>Pages</th>
                    <th>Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionsData.sessions.map((session) => (
                    <tr key={session.id}>
                      <td
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.85rem',
                        }}
                      >
                        {session.id.slice(0, 8)}...
                      </td>
                      <td>{session.browserType}</td>
                      <td>
                        <span
                          className={`badge ${
                            session.status === 'active'
                              ? 'badge-success'
                              : 'badge-warning'
                          }`}
                        >
                          {session.status}
                        </span>
                      </td>
                      <td>{session.pageLoads}</td>
                      <td>
                        {new Date(session.expiresAt).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Code size={18} /> API Endpoints
            </h3>
          </div>
          <div style={{ padding: '1rem' }}>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {[
                {
                  method: 'POST',
                  path: '/scraping/content',
                  desc: 'Get page HTML content',
                },
                {
                  method: 'POST',
                  path: '/scraping/screenshot',
                  desc: 'Capture page screenshot',
                },
                {
                  method: 'POST',
                  path: '/scraping/pdf',
                  desc: 'Generate PDF from page',
                },
                {
                  method: 'POST',
                  path: '/scraping/scrape',
                  desc: 'Scrape with selectors',
                },
                {
                  method: 'GET',
                  path: '/scraping/fetch?url=...',
                  desc: 'Quick fetch URL',
                },
              ].map((endpoint) => (
                <div
                  key={endpoint.path}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.5rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <span
                    className={`badge ${
                      endpoint.method === 'POST'
                        ? 'badge-success'
                        : 'badge-info'
                    }`}
                    style={{ fontSize: '0.7rem' }}
                  >
                    {endpoint.method}
                  </span>
                  <code
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.8rem',
                      flex: 1,
                    }}
                  >
                    {endpoint.path}
                  </code>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showScrapeModal && (
        <div className="modal-overlay">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => setShowScrapeModal(false)}
            aria-label="Close modal"
          />
          <div
            className="modal"
            style={{ maxWidth: '600px' }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') {
                setShowScrapeModal(false)
              }
            }}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <h3 className="modal-title">Advanced Scrape</h3>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setShowScrapeModal(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-muted)' }}>
                For advanced scraping with persistent sessions, custom headers,
                and screenshots, use the API directly or create a scraping
                session.
              </p>
              <div
                style={{
                  marginTop: '1rem',
                  padding: '1rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-md)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.85rem',
                }}
              >
                <pre style={{ margin: 0 }}>
                  {`POST /scraping/sessions
{
  "browserType": "chromium",
  "region": "us-east",
  "duration": 3600
}`}
                </pre>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowScrapeModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
