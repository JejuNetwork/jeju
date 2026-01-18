import { useCallback, useEffect, useMemo, useState } from 'react'

// ============================================
// TYPES
// ============================================

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

type Theme = 'dark' | 'light'
type TabId = 'overview' | 'blocks' | 'transactions' | 'graphql'

interface TabConfig {
  id: TabId
  label: string
  ariaLabel: string
}

interface StatConfig {
  key: keyof Pick<
    NetworkStats,
    | 'totalBlocks'
    | 'totalTransactions'
    | 'totalAccounts'
    | 'totalContracts'
    | 'totalTokenTransfers'
    | 'totalAgents'
  >
  icon: string
  label: string
  colorClass: string
}

// ============================================
// CONSTANTS
// ============================================

const LOCALHOST_HOST =
  typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1'

const API_BASE =
  typeof window !== 'undefined' && window.location.port === '4355'
    ? `http://${LOCALHOST_HOST}:4352`
    : '' // No /api prefix - routes are at root

const GRAPHQL_URL =
  typeof window !== 'undefined' && window.location.port === '4355'
    ? `http://${LOCALHOST_HOST}:4350/graphql`
    : '/graphql'

const TABS: TabConfig[] = [
  { id: 'overview', label: 'Overview', ariaLabel: 'View network overview' },
  { id: 'blocks', label: 'Blocks', ariaLabel: 'View all blocks' },
  {
    id: 'transactions',
    label: 'Transactions',
    ariaLabel: 'View all transactions',
  },
  { id: 'graphql', label: 'GraphQL', ariaLabel: 'GraphQL API documentation' },
]

const STAT_CONFIGS: StatConfig[] = [
  {
    key: 'totalBlocks',
    icon: '📦',
    label: 'Blocks',
    colorClass: 'blocks',
  },
  {
    key: 'totalTransactions',
    icon: '⚡',
    label: 'Transactions',
    colorClass: 'txs',
  },
  {
    key: 'totalAccounts',
    icon: '👥',
    label: 'Accounts',
    colorClass: 'accounts',
  },
  {
    key: 'totalContracts',
    icon: '📜',
    label: 'Contracts',
    colorClass: 'contracts',
  },
  {
    key: 'totalTokenTransfers',
    icon: '💎',
    label: 'Transfers',
    colorClass: 'transfers',
  },
  {
    key: 'totalAgents',
    icon: '🤖',
    label: 'Agents',
    colorClass: 'agents',
  },
]

const GRAPHQL_QUERIES = [
  { name: 'blocks', desc: 'Block height, hash, timestamp, gas' },
  { name: 'transactions', desc: 'Tx hash, sender, recipient, value' },
  { name: 'accounts', desc: 'Addresses, balances, nonces' },
  { name: 'contracts', desc: 'Deployed bytecode and ABIs' },
  { name: 'tokenTransfers', desc: 'ERC-20, ERC-721, ERC-1155 events' },
  { name: 'decodedEvents', desc: 'Parsed logs with signatures' },
  { name: 'registeredAgents', desc: 'On-chain AI agent metadata' },
  { name: 'oracleFeeds', desc: 'Price feeds and oracle data' },
] as const

// ============================================
// UTILITIES
// ============================================

const formatNumber = (n: number | undefined): string => {
  if (n === undefined) return '—'
  return new Intl.NumberFormat().format(n)
}

const shortenHash = (hash: string): string => {
  if (!hash) return '—'
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
}

const formatTime = (timestamp: string): string => {
  if (!timestamp) return '—'
  const date = new Date(timestamp)
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const formatValue = (value: string): string => {
  if (!value) return '0'
  const wei = BigInt(value)
  const eth = Number(wei) / 1e18
  if (eth === 0) return '0'
  if (eth < 0.0001) return '< 0.0001'
  return eth.toFixed(4)
}

// ============================================
// COMPONENTS
// ============================================

function StatCard({
  icon,
  label,
  value,
  loading,
  colorClass,
}: {
  icon: string
  label: string
  value: string
  loading: boolean
  colorClass: string
}) {
  return (
    <article className="stat-card" aria-label={`${label}: ${value}`}>
      <div className={`stat-icon ${colorClass}`} aria-hidden="true">
        {icon}
      </div>
      <div className="stat-content">
        <div className="stat-label">{label}</div>
        {loading ? (
          <output className="skeleton stat-skeleton" aria-label="Loading" />
        ) : (
          <div className="stat-value">{value}</div>
        )}
      </div>
    </article>
  )
}

function SkeletonList({ count = 3 }: { count?: number }) {
  const skeletonKeys = useMemo(
    () => Array.from({ length: count }, () => crypto.randomUUID()),
    [count],
  )

  return (
    <output className="skeleton-list" aria-label="Loading content">
      {skeletonKeys.map((key) => (
        <div
          key={key}
          className="skeleton"
          style={{ height: 52, marginBottom: 8 }}
        />
      ))}
    </output>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <tr>
      <td colSpan={100} className="empty-cell">
        {message}
      </td>
    </tr>
  )
}

function StatusBadge({ status }: { status: 'online' | 'loading' | 'error' }) {
  const labels = {
    online: 'Live',
    loading: 'Syncing',
    error: 'Disconnected',
  }

  return (
    <output
      className="status-badge"
      aria-live="polite"
      aria-label={`Connection status: ${labels[status]}`}
    >
      <span className={`status-dot ${status}`} aria-hidden="true" />
      <span>{labels[status]}</span>
    </output>
  )
}

// ============================================
// MAIN APP
// ============================================

export default function App() {
  const [stats, setStats] = useState<NetworkStats | null>(null)
  const [blocks, setBlocks] = useState<Block[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>('dark')
  const [activeTab, setActiveTab] = useState<TabId>('overview')

  // Computed status
  const connectionStatus = useMemo(() => {
    if (error) return 'error' as const
    if (loading) return 'loading' as const
    return 'online' as const
  }, [error, loading])

  // Theme toggle
  const toggleTheme = useCallback(() => {
    const newTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(newTheme)
    document.documentElement.setAttribute('data-theme', newTheme)
    localStorage.setItem('theme', newTheme)
  }, [theme])

  // Initialize theme from localStorage or system preference
  useEffect(() => {
    const saved = localStorage.getItem('theme') as Theme | null
    const systemPrefersDark = window.matchMedia(
      '(prefers-color-scheme: dark)',
    ).matches
    const initial = saved ?? (systemPrefersDark ? 'dark' : 'light')
    setTheme(initial)
    document.documentElement.setAttribute('data-theme', initial)
  }, [])

  // Fetch data
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
        setBlocks(blocksResult.value.blocks ?? [])
      }

      if (txsResult.status === 'fulfilled') {
        setTransactions(txsResult.value.transactions ?? [])
      }

      // Check for database errors in responses
      const hasDbError =
        (blocksResult.status === 'fulfilled' && blocksResult.value.error) ||
        (txsResult.status === 'fulfilled' && txsResult.value.error)

      if (results.every((r) => r.status === 'rejected')) {
        setError(
          'Unable to reach the indexer. Verify the API server is running.',
        )
      } else if (hasDbError) {
        setError(
          'Indexer database is currently unavailable. Data may be limited.',
        )
      }

      setLoading(false)
    }

    fetchData()
    const interval = setInterval(fetchData, 15000)
    return () => clearInterval(interval)
  }, [])

  // Memoized recent items for overview
  const recentBlocks = useMemo(() => blocks.slice(0, 5), [blocks])
  const recentTransactions = useMemo(
    () => transactions.slice(0, 5),
    [transactions],
  )

  return (
    <div className="app">
      {/* Skip link for keyboard users */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* Header */}
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <div className="logo-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <span className="logo-text">Jeju Indexer</span>
          </div>
        </div>

        <div className="header-right">
          <a
            href={GRAPHQL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary btn-sm"
            aria-label="Open GraphQL Playground in new tab"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ width: 16, height: 16 }}
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M8 12h8M12 8v8" />
            </svg>
            Playground
          </a>

          <button
            type="button"
            className="btn-icon"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          <StatusBadge status={connectionStatus} />
        </div>
      </header>

      {/* Navigation */}
      <div className="tabs-nav" role="tablist" aria-label="Main navigation">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            aria-selected={activeTab === tab.id}
            aria-label={tab.ariaLabel}
            tabIndex={activeTab === tab.id ? 0 : -1}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <main
        id="main-content"
        className="main-content"
        aria-label="Blockchain data"
      >
        {/* Error Banner */}
        {error && (
          <div className="error-banner" role="alert" aria-live="assertive">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </div>
        )}

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div
            className="overview-content"
            role="tabpanel"
            aria-label="Network overview"
          >
            {/* Stats Grid */}
            <section className="stats-grid" aria-label="Network statistics">
              {STAT_CONFIGS.map((config) => (
                <StatCard
                  key={config.key}
                  icon={config.icon}
                  label={config.label}
                  value={formatNumber(stats?.[config.key])}
                  loading={loading}
                  colorClass={config.colorClass}
                />
              ))}
            </section>

            {/* Latest Block Hero */}
            <section
              className="card latest-block"
              aria-label="Latest block information"
            >
              <div className="card-header">
                <h2 className="card-title">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M3 9h18M9 21V9" />
                  </svg>
                  Latest Block
                </h2>
              </div>
              {loading ? (
                <output
                  className="skeleton"
                  style={{ height: 100, display: 'block' }}
                  aria-label="Loading latest block"
                />
              ) : (
                <div className="latest-block-info">
                  <div className="block-hero-number">
                    #{formatNumber(stats?.latestBlockNumber)}
                  </div>
                  <div className="block-hero-label">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 6v6l4 2" />
                    </svg>
                    {formatTime(stats?.latestBlockTimestamp ?? '')}
                  </div>
                </div>
              )}
            </section>

            {/* Recent Activity */}
            <div className="two-col-grid">
              {/* Recent Blocks */}
              <section className="card" aria-label="Recent blocks">
                <div className="card-header">
                  <h3 className="card-title">Recent Blocks</h3>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setActiveTab('blocks')}
                    aria-label="View all blocks"
                  >
                    View All →
                  </button>
                </div>
                {loading ? (
                  <SkeletonList />
                ) : (
                  <ul className="mini-list">
                    {recentBlocks.map((block) => (
                      <li key={block.hash} className="mini-list-item">
                        <div className="item-main">
                          <span className="block-num">#{block.number}</span>
                          <code className="hash">
                            {shortenHash(block.hash)}
                          </code>
                        </div>
                        <div className="item-meta">
                          {block.transactionCount} txs
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Recent Transactions */}
              <section className="card" aria-label="Recent transactions">
                <div className="card-header">
                  <h3 className="card-title">Recent Transactions</h3>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setActiveTab('transactions')}
                    aria-label="View all transactions"
                  >
                    View All →
                  </button>
                </div>
                {loading ? (
                  <SkeletonList />
                ) : (
                  <ul className="mini-list">
                    {recentTransactions.map((tx) => (
                      <li key={tx.hash} className="mini-list-item">
                        <div className="item-main">
                          <code className="hash">{shortenHash(tx.hash)}</code>
                          <span
                            className={`badge ${tx.status === 'SUCCESS' ? 'badge-success' : 'badge-error'}`}
                          >
                            {tx.status === 'SUCCESS' ? 'Success' : 'Failed'}
                          </span>
                        </div>
                        <div className="item-meta">
                          {formatValue(tx.value)} ETH
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        )}

        {/* Blocks Tab */}
        {activeTab === 'blocks' && (
          <section className="card" role="tabpanel" aria-label="Blocks table">
            <div className="card-header">
              <h2 className="card-title">Blocks</h2>
            </div>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Block</th>
                    <th scope="col">Hash</th>
                    <th scope="col">Timestamp</th>
                    <th scope="col">Transactions</th>
                    <th scope="col">Gas Used</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={5}>
                        <output
                          className="skeleton"
                          style={{ height: 40, display: 'block' }}
                          aria-label="Loading blocks"
                        />
                      </td>
                    </tr>
                  ) : blocks.length === 0 ? (
                    <EmptyState message="No blocks indexed yet" />
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
                          {formatNumber(parseInt(block.gasUsed ?? '0', 10))}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Transactions Tab */}
        {activeTab === 'transactions' && (
          <section
            className="card"
            role="tabpanel"
            aria-label="Transactions table"
          >
            <div className="card-header">
              <h2 className="card-title">Transactions</h2>
            </div>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Hash</th>
                    <th scope="col">Block</th>
                    <th scope="col">From</th>
                    <th scope="col">To</th>
                    <th scope="col">Value</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6}>
                        <output
                          className="skeleton"
                          style={{ height: 40, display: 'block' }}
                          aria-label="Loading transactions"
                        />
                      </td>
                    </tr>
                  ) : transactions.length === 0 ? (
                    <EmptyState message="No transactions indexed yet" />
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
                            {tx.to ? shortenHash(tx.to) : 'Contract Deploy'}
                          </code>
                        </td>
                        <td>{formatValue(tx.value)} ETH</td>
                        <td>
                          <span
                            className={`badge ${tx.status === 'SUCCESS' ? 'badge-success' : 'badge-error'}`}
                          >
                            {tx.status === 'SUCCESS' ? 'Success' : 'Failed'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* GraphQL Tab */}
        {activeTab === 'graphql' && (
          <div
            className="graphql-section"
            role="tabpanel"
            aria-label="GraphQL API documentation"
          >
            <section className="card" aria-label="API endpoints">
              <div className="card-header">
                <h2 className="card-title">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M8 12h8M12 8v8" />
                  </svg>
                  GraphQL API
                </h2>
              </div>
              <div className="graphql-info">
                <p className="graphql-intro">
                  Access the full indexed dataset through GraphQL. Filter by
                  block range, address, or time. Results support cursor-based
                  pagination.
                </p>

                <ul className="endpoints-list" aria-label="API endpoints">
                  <li className="endpoint-item">
                    <span className="endpoint-label">GraphQL Endpoint</span>
                    <code className="endpoint-url">{GRAPHQL_URL}</code>
                  </li>
                  <li className="endpoint-item">
                    <span className="endpoint-label">REST API</span>
                    <code className="endpoint-url">{API_BASE}</code>
                  </li>
                </ul>

                <a
                  href={GRAPHQL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                  aria-label="Open GraphQL Playground in new tab"
                >
                  Open Playground →
                </a>

                <figure className="example-query">
                  <figcaption id="example-query-heading">
                    Example Query
                  </figcaption>
                  <pre>
                    {`query {
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
}`}
                  </pre>
                </figure>
              </div>
            </section>

            <section className="card" aria-label="Available queries">
              <div className="card-header">
                <h2 className="card-title">Available Queries</h2>
              </div>
              <ul className="query-list">
                {GRAPHQL_QUERIES.map((q) => (
                  <li key={q.name} className="query-item">
                    <code className="query-name">{q.name}</code>
                    <span className="query-desc">{q.desc}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="footer">
        <nav className="footer-content" aria-label="Footer links">
          <span>Jeju Indexer</span>
          <span className="separator" aria-hidden="true">
            •
          </span>
          <a
            href={GRAPHQL_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open GraphQL Playground"
          >
            GraphQL
          </a>
          <span className="separator" aria-hidden="true">
            •
          </span>
          <a
            href={`${API_BASE}/health`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Check API health status"
          >
            Health
          </a>
        </nav>
      </footer>
    </div>
  )
}
