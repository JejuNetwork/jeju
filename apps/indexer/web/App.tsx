import { useCallback, useEffect, useState } from 'react'

interface NetworkStats {
  totalBlocks: number
  totalTransactions: number
  totalAccounts: number
  totalContracts: number
  totalTokenTransfers: number
  totalAgents: number
  latestBlockNumber: number
  latestBlockTimestamp: string
}

interface Block {
  number: number
  hash: string
  timestamp: string
  transactionCount: number
  gasUsed: string
}

interface Transaction {
  hash: string
  blockNumber: number
  from: string
  to: string | null
  value: string
  status: string
}

const API_BASE =
  typeof window !== 'undefined' && window.location.port === '4355'
    ? 'http://localhost:4352'
    : '/api'

const GRAPHQL_URL =
  typeof window !== 'undefined' && window.location.port === '4355'
    ? 'http://localhost:4350/graphql'
    : '/graphql'

export default function App() {
  const [stats, setStats] = useState<NetworkStats | null>(null)
  const [blocks, setBlocks] = useState<Block[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [activeTab, setActiveTab] = useState<
    'overview' | 'blocks' | 'transactions' | 'graphql'
  >('overview')

  const toggleTheme = useCallback(() => {
    const newTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(newTheme)
    document.documentElement.setAttribute('data-theme', newTheme)
    localStorage.setItem('theme', newTheme)
  }, [theme])

  useEffect(() => {
    const saved = localStorage.getItem('theme') as 'dark' | 'light' | null
    if (saved) {
      setTheme(saved)
      document.documentElement.setAttribute('data-theme', saved)
    }
  }, [])

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setError(null)

      const results = await Promise.allSettled([
        fetch(`${API_BASE}/stats`).then((r) => r.json()),
        fetch(`${API_BASE}/blocks?limit=10`).then((r) => r.json()),
        fetch(`${API_BASE}/transactions?limit=10`).then((r) => r.json()),
      ])

      const [statsResult, blocksResult, txsResult] = results

      if (statsResult.status === 'fulfilled') {
        setStats(statsResult.value)
      }

      if (blocksResult.status === 'fulfilled') {
        setBlocks(blocksResult.value.blocks || [])
      }

      if (txsResult.status === 'fulfilled') {
        setTransactions(txsResult.value.transactions || [])
      }

      if (results.every((r) => r.status === 'rejected')) {
        setError(
          'Failed to connect to indexer API. Make sure the backend is running.',
        )
      }

      setLoading(false)
    }

    fetchData()
    const interval = setInterval(fetchData, 15000)
    return () => clearInterval(interval)
  }, [])

  const formatNumber = (n: number | undefined) => {
    if (n === undefined) return '—'
    return new Intl.NumberFormat().format(n)
  }

  const shortenHash = (hash: string) => {
    if (!hash) return '—'
    return `${hash.slice(0, 8)}...${hash.slice(-6)}`
  }

  const formatTime = (timestamp: string) => {
    if (!timestamp) return '—'
    const date = new Date(timestamp)
    return date.toLocaleString()
  }

  const formatValue = (value: string) => {
    if (!value) return '0'
    const wei = BigInt(value)
    const eth = Number(wei) / 1e18
    if (eth === 0) return '0'
    if (eth < 0.0001) return '< 0.0001'
    return eth.toFixed(4)
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <div className="logo-icon">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-label="Network Indexer Logo"
              >
                <title>Network Indexer Logo</title>
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <span>Network Indexer</span>
          </div>
        </div>
        <div className="header-right">
          <a
            href={GRAPHQL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary btn-sm"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ width: 16, height: 16 }}
              aria-label="GraphQL Playground"
            >
              <title>GraphQL Playground</title>
              <circle cx="12" cy="12" r="10" />
              <path d="M8 12h8M12 8v8" />
            </svg>
            GraphQL Playground
          </a>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={toggleTheme}
            title="Toggle theme"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <div
            className={`status-indicator ${error ? 'error' : loading ? 'loading' : 'online'}`}
          />
        </div>
      </header>

      <nav className="tabs-nav">
        <button
          type="button"
          className={`tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button
          type="button"
          className={`tab ${activeTab === 'blocks' ? 'active' : ''}`}
          onClick={() => setActiveTab('blocks')}
        >
          Blocks
        </button>
        <button
          type="button"
          className={`tab ${activeTab === 'transactions' ? 'active' : ''}`}
          onClick={() => setActiveTab('transactions')}
        >
          Transactions
        </button>
        <button
          type="button"
          className={`tab ${activeTab === 'graphql' ? 'active' : ''}`}
          onClick={() => setActiveTab('graphql')}
        >
          GraphQL
        </button>
      </nav>

      <main className="main-content">
        {error && (
          <div className="error-banner">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-label="Error"
            >
              <title>Error</title>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </div>
        )}

        {activeTab === 'overview' && (
          <div className="overview-content">
            <div className="stats-grid">
              <StatCard
                icon="📦"
                label="Total Blocks"
                value={formatNumber(stats?.totalBlocks)}
                loading={loading}
              />
              <StatCard
                icon="📝"
                label="Transactions"
                value={formatNumber(stats?.totalTransactions)}
                loading={loading}
              />
              <StatCard
                icon="👤"
                label="Accounts"
                value={formatNumber(stats?.totalAccounts)}
                loading={loading}
              />
              <StatCard
                icon="📄"
                label="Contracts"
                value={formatNumber(stats?.totalContracts)}
                loading={loading}
              />
              <StatCard
                icon="💸"
                label="Token Transfers"
                value={formatNumber(stats?.totalTokenTransfers)}
                loading={loading}
              />
              <StatCard
                icon="🤖"
                label="Agents"
                value={formatNumber(stats?.totalAgents)}
                loading={loading}
              />
            </div>

            <div className="card latest-block">
              <div className="card-header">
                <h3 className="card-title">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-label="Latest Block"
                  >
                    <title>Latest Block</title>
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M3 9h18M9 21V9" />
                  </svg>
                  Latest Block
                </h3>
              </div>
              {loading ? (
                <div className="skeleton" style={{ height: 80 }} />
              ) : (
                <div className="latest-block-info">
                  <div className="block-number">
                    #{formatNumber(stats?.latestBlockNumber)}
                  </div>
                  <div className="block-time">
                    {formatTime(stats?.latestBlockTimestamp ?? '')}
                  </div>
                </div>
              )}
            </div>

            <div className="two-col-grid">
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Recent Blocks</h3>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setActiveTab('blocks')}
                  >
                    View All →
                  </button>
                </div>
                {loading ? (
                  <div className="skeleton-list">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="skeleton"
                        style={{ height: 48, marginBottom: 8 }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="mini-list">
                    {blocks.slice(0, 5).map((block) => (
                      <div key={block.hash} className="mini-list-item">
                        <div className="item-main">
                          <span className="block-num">#{block.number}</span>
                          <span className="hash">
                            {shortenHash(block.hash)}
                          </span>
                        </div>
                        <div className="item-meta">
                          <span>{block.transactionCount} txs</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Recent Transactions</h3>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setActiveTab('transactions')}
                  >
                    View All →
                  </button>
                </div>
                {loading ? (
                  <div className="skeleton-list">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="skeleton"
                        style={{ height: 48, marginBottom: 8 }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="mini-list">
                    {transactions.slice(0, 5).map((tx) => (
                      <div key={tx.hash} className="mini-list-item">
                        <div className="item-main">
                          <span className="hash">{shortenHash(tx.hash)}</span>
                          <span
                            className={`badge ${tx.status === 'SUCCESS' ? 'badge-success' : 'badge-error'}`}
                          >
                            {tx.status}
                          </span>
                        </div>
                        <div className="item-meta">
                          <span>{formatValue(tx.value)} ETH</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'blocks' && (
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Blocks</h3>
            </div>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Block</th>
                    <th>Hash</th>
                    <th>Timestamp</th>
                    <th>Transactions</th>
                    <th>Gas Used</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={5}>
                        <div className="skeleton" style={{ height: 40 }} />
                      </td>
                    </tr>
                  ) : blocks.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="empty-cell">
                        No blocks indexed yet
                      </td>
                    </tr>
                  ) : (
                    blocks.map((block) => (
                      <tr key={block.hash}>
                        <td>
                          <span className="block-num">#{block.number}</span>
                        </td>
                        <td>
                          <code className="hash">
                            {shortenHash(block.hash)}
                          </code>
                        </td>
                        <td>{formatTime(block.timestamp)}</td>
                        <td>{block.transactionCount}</td>
                        <td>
                          {formatNumber(parseInt(block.gasUsed || '0', 10))}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'transactions' && (
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Transactions</h3>
            </div>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Hash</th>
                    <th>Block</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Value</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="skeleton" style={{ height: 40 }} />
                      </td>
                    </tr>
                  ) : transactions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="empty-cell">
                        No transactions indexed yet
                      </td>
                    </tr>
                  ) : (
                    transactions.map((tx) => (
                      <tr key={tx.hash}>
                        <td>
                          <code className="hash">{shortenHash(tx.hash)}</code>
                        </td>
                        <td>{tx.blockNumber}</td>
                        <td>
                          <code className="address">
                            {shortenHash(tx.from)}
                          </code>
                        </td>
                        <td>
                          <code className="address">
                            {tx.to ? shortenHash(tx.to) : 'Contract Creation'}
                          </code>
                        </td>
                        <td>{formatValue(tx.value)} ETH</td>
                        <td>
                          <span
                            className={`badge ${tx.status === 'SUCCESS' ? 'badge-success' : 'badge-error'}`}
                          >
                            {tx.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'graphql' && (
          <div className="graphql-section">
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-label="GraphQL API"
                  >
                    <title>GraphQL API</title>
                    <circle cx="12" cy="12" r="10" />
                    <path d="M8 12h8M12 8v8" />
                  </svg>
                  GraphQL API
                </h3>
              </div>
              <div className="graphql-info">
                <p>
                  The Network Indexer provides a powerful GraphQL API for
                  querying blockchain data.
                </p>

                <div className="endpoints-list">
                  <div className="endpoint-item">
                    <span className="endpoint-label">GraphQL Endpoint</span>
                    <code className="endpoint-url">{GRAPHQL_URL}</code>
                  </div>
                  <div className="endpoint-item">
                    <span className="endpoint-label">REST API</span>
                    <code className="endpoint-url">{API_BASE}</code>
                  </div>
                </div>

                <a
                  href={GRAPHQL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                >
                  Open GraphQL Playground →
                </a>

                <div className="example-query">
                  <h4>Example Query</h4>
                  <pre>{`query {
  blocks(limit: 5, orderBy: number_DESC) {
    number
    hash
    timestamp
    transactionCount
  }
  transactions(limit: 5) {
    hash
    value
    from { address }
    to { address }
  }
}`}</pre>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Available Queries</h3>
              </div>
              <div className="query-list">
                {[
                  { name: 'blocks', desc: 'Query indexed blocks' },
                  { name: 'transactions', desc: 'Query transactions' },
                  { name: 'accounts', desc: 'Query accounts and balances' },
                  { name: 'contracts', desc: 'Query smart contracts' },
                  {
                    name: 'tokenTransfers',
                    desc: 'Query ERC20/721/1155 transfers',
                  },
                  {
                    name: 'decodedEvents',
                    desc: 'Query decoded contract events',
                  },
                  {
                    name: 'registeredAgents',
                    desc: 'Query registered AI agents',
                  },
                  { name: 'oracleFeeds', desc: 'Query oracle data feeds' },
                ].map((q) => (
                  <div key={q.name} className="query-item">
                    <code className="query-name">{q.name}</code>
                    <span className="query-desc">{q.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="footer">
        <div className="footer-content">
          <span>Network Indexer v1.0.0</span>
          <span className="separator">•</span>
          <a href={GRAPHQL_URL} target="_blank" rel="noopener noreferrer">
            GraphQL
          </a>
          <span className="separator">•</span>
          <a
            href={`${API_BASE}/health`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Health
          </a>
        </div>
      </footer>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  loading,
}: {
  icon: string
  label: string
  value: string
  loading: boolean
}) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div className="stat-content">
        <div className="stat-label">{label}</div>
        {loading ? (
          <div className="skeleton stat-skeleton" />
        ) : (
          <div className="stat-value">{value}</div>
        )}
      </div>
    </div>
  )
}
