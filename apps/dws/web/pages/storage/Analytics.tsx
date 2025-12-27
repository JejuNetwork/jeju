import {
  Activity,
  ArrowDown,
  ArrowUp,
  BarChart2,
  Clock,
  Database,
  DollarSign,
  Download,
  Eye,
  Globe,
  HardDrive,
  RefreshCw,
  Server,
  TrendingUp,
  Upload,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { useStorageAnalytics } from '../../hooks'

interface ContentRanking {
  cid: string
  name: string
  requests24h: number
  bandwidth24h: number
  tier: string
  category: string
  trendDirection: 'up' | 'down' | 'stable'
}

interface BackendMetric {
  backend: string
  storageBytes: number
  contentCount: number
  requests24h: number
  bandwidth24h: number
  avgLatencyMs: number
  successRate: number
  status: 'healthy' | 'degraded' | 'down'
}

interface RegionalMetric {
  region: string
  nodeCount: number
  storageBytes: number
  bandwidth24h: number
  requests24h: number
  avgLatencyMs: number
}

export default function StorageAnalyticsPage() {
  const { data: analyticsData, refetch } = useStorageAnalytics()
  const [selectedTimeRange, setSelectedTimeRange] = useState<
    '24h' | '7d' | '30d'
  >('24h')
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    await refetch()
    setRefreshing(false)
  }

  // Mock data for demonstration (would come from API)
  const mockAnalytics = {
    global: {
      totalStorageBytes: 1024 * 1024 * 1024 * 50, // 50GB
      totalBandwidthBytes24h: 1024 * 1024 * 1024 * 10, // 10GB
      totalRequests24h: 15000,
      totalUploads24h: 500,
      totalDownloads24h: 14500,
      activeNodes: 12,
      activeUsers: 150,
      contentCount: 25000,
      avgResponseTimeMs: 45,
      errorRate: 0.002,
    },
    performance: {
      p50LatencyMs: 35,
      p95LatencyMs: 120,
      p99LatencyMs: 250,
      cacheHitRate: 0.85,
    },
    costs: {
      storageCost24h: '0.05',
      bandwidthCost24h: '0.01',
      totalCost24h: '0.06',
      projectedMonthlyCost: '1.80',
    },
    trends: {
      storageGrowthRate: 5.2,
      bandwidthTrend: 12.5,
      requestTrend: 8.3,
      costTrend: 3.1,
    },
    backends: [
      {
        backend: 'ipfs',
        storageBytes: 30 * 1024 * 1024 * 1024,
        contentCount: 15000,
        requests24h: 8000,
        bandwidth24h: 5 * 1024 * 1024 * 1024,
        avgLatencyMs: 40,
        successRate: 0.998,
        status: 'healthy' as const,
      },
      {
        backend: 'arweave',
        storageBytes: 10 * 1024 * 1024 * 1024,
        contentCount: 5000,
        requests24h: 3000,
        bandwidth24h: 2 * 1024 * 1024 * 1024,
        avgLatencyMs: 80,
        successRate: 0.995,
        status: 'healthy' as const,
      },
      {
        backend: 'filecoin',
        storageBytes: 8 * 1024 * 1024 * 1024,
        contentCount: 3000,
        requests24h: 2000,
        bandwidth24h: 2 * 1024 * 1024 * 1024,
        avgLatencyMs: 150,
        successRate: 0.99,
        status: 'healthy' as const,
      },
      {
        backend: 'webtorrent',
        storageBytes: 2 * 1024 * 1024 * 1024,
        contentCount: 2000,
        requests24h: 2000,
        bandwidth24h: 1 * 1024 * 1024 * 1024,
        avgLatencyMs: 60,
        successRate: 0.97,
        status: 'degraded' as const,
      },
    ],
    regions: [
      {
        region: 'us-east-1',
        nodeCount: 5,
        storageBytes: 20 * 1024 * 1024 * 1024,
        bandwidth24h: 4 * 1024 * 1024 * 1024,
        requests24h: 6000,
        avgLatencyMs: 30,
      },
      {
        region: 'eu-west-1',
        nodeCount: 3,
        storageBytes: 15 * 1024 * 1024 * 1024,
        bandwidth24h: 3 * 1024 * 1024 * 1024,
        requests24h: 5000,
        avgLatencyMs: 45,
      },
      {
        region: 'ap-northeast-1',
        nodeCount: 2,
        storageBytes: 10 * 1024 * 1024 * 1024,
        bandwidth24h: 2 * 1024 * 1024 * 1024,
        requests24h: 3000,
        avgLatencyMs: 80,
      },
      {
        region: 'ap-southeast-1',
        nodeCount: 2,
        storageBytes: 5 * 1024 * 1024 * 1024,
        bandwidth24h: 1 * 1024 * 1024 * 1024,
        requests24h: 1000,
        avgLatencyMs: 70,
      },
    ],
    topContent: [
      {
        cid: 'QmXoypiz...',
        name: 'wallet-v3.2.0.bundle.js',
        requests24h: 5000,
        bandwidth24h: 500 * 1024 * 1024,
        tier: 'system',
        category: 'app-bundle',
        trendDirection: 'up' as const,
      },
      {
        cid: 'QmYhKnls...',
        name: 'gateway-api.json',
        requests24h: 3500,
        bandwidth24h: 35 * 1024 * 1024,
        tier: 'system',
        category: 'contract-abi',
        trendDirection: 'stable' as const,
      },
      {
        cid: 'QmZjWqpk...',
        name: 'hero-banner.webp',
        requests24h: 2800,
        bandwidth24h: 280 * 1024 * 1024,
        tier: 'popular',
        category: 'media',
        trendDirection: 'up' as const,
      },
      {
        cid: 'QmAbCdEf...',
        name: 'docs-index.json',
        requests24h: 2200,
        bandwidth24h: 22 * 1024 * 1024,
        tier: 'system',
        category: 'documentation',
        trendDirection: 'down' as const,
      },
      {
        cid: 'QmGhIjKl...',
        name: 'user-avatar-collection.zip',
        requests24h: 1500,
        bandwidth24h: 750 * 1024 * 1024,
        tier: 'popular',
        category: 'user-content',
        trendDirection: 'up' as const,
      },
    ],
  }

  const analytics = analyticsData ?? mockAnalytics

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  const formatLatency = (ms: number) => {
    if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
    return `${ms.toFixed(0)}ms`
  }

  const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`

  const getTrendIcon = (direction: 'up' | 'down' | 'stable') => {
    if (direction === 'up')
      return <ArrowUp size={14} style={{ color: 'var(--success)' }} />
    if (direction === 'down')
      return <ArrowDown size={14} style={{ color: 'var(--error)' }} />
    return (
      <span style={{ width: 14, height: 14, display: 'inline-block' }}>—</span>
    )
  }

  const getStatusBadge = (status: 'healthy' | 'degraded' | 'down') => {
    const classes = {
      healthy: 'badge-success',
      degraded: 'badge-warning',
      down: 'badge-error',
    }
    return <span className={`badge ${classes[status]}`}>{status}</span>
  }

  const getTierBadge = (tier: string) => {
    const classes: Record<string, string> = {
      system: 'badge-info',
      popular: 'badge-success',
      private: 'badge-warning',
    }
    return (
      <span className={`badge ${classes[tier] ?? 'badge-neutral'}`}>
        {tier}
      </span>
    )
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
          <h1 className="page-title">Storage Analytics</h1>
          <p className="page-subtitle">
            Monitor storage usage, bandwidth, and performance across all
            backends
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <div className="btn-group">
            {(['24h', '7d', '30d'] as const).map((range) => (
              <button
                key={range}
                type="button"
                className={`btn btn-sm ${selectedTimeRange === range ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setSelectedTimeRange(range)}
              >
                {range}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />{' '}
            Refresh
          </button>
        </div>
      </div>

      {/* Primary Stats */}
      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon storage">
            <Database size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Total Storage</div>
            <div className="stat-value">
              {formatBytes(analytics.global.totalStorageBytes)}
            </div>
            <div className="stat-change positive">
              <TrendingUp size={14} style={{ marginRight: '0.25rem' }} />+
              {analytics.trends.storageGrowthRate.toFixed(1)}% growth
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon network">
            <Activity size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Bandwidth (24h)</div>
            <div className="stat-value">
              {formatBytes(analytics.global.totalBandwidthBytes24h)}
            </div>
            <div
              className={`stat-change ${analytics.trends.bandwidthTrend >= 0 ? 'positive' : 'negative'}`}
            >
              {analytics.trends.bandwidthTrend >= 0 ? (
                <ArrowUp size={14} />
              ) : (
                <ArrowDown size={14} />
              )}
              {Math.abs(analytics.trends.bandwidthTrend).toFixed(1)}%
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon compute">
            <Eye size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Requests (24h)</div>
            <div className="stat-value">
              {formatNumber(analytics.global.totalRequests24h)}
            </div>
            <div
              className={`stat-change ${analytics.trends.requestTrend >= 0 ? 'positive' : 'negative'}`}
            >
              {analytics.trends.requestTrend >= 0 ? (
                <ArrowUp size={14} />
              ) : (
                <ArrowDown size={14} />
              )}
              {Math.abs(analytics.trends.requestTrend).toFixed(1)}%
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon ai">
            <Zap size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Avg Latency</div>
            <div className="stat-value">
              {formatLatency(analytics.global.avgResponseTimeMs)}
            </div>
            <div className="stat-change">
              P95: {formatLatency(analytics.performance.p95LatencyMs)}
            </div>
          </div>
        </div>
      </div>

      {/* Secondary Stats Row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div className="card" style={{ padding: '1rem' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
          >
            <Upload size={20} style={{ color: 'var(--success)' }} />
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Uploads
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>
                {formatNumber(analytics.global.totalUploads24h)}
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '1rem' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
          >
            <Download size={20} style={{ color: 'var(--info)' }} />
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Downloads
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>
                {formatNumber(analytics.global.totalDownloads24h)}
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '1rem' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
          >
            <Server size={20} style={{ color: 'var(--accent)' }} />
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Active Nodes
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>
                {analytics.global.activeNodes}
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '1rem' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
          >
            <HardDrive size={20} style={{ color: 'var(--warning)' }} />
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Content Items
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>
                {formatNumber(analytics.global.contentCount)}
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '1rem' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
          >
            <BarChart2 size={20} style={{ color: 'var(--success)' }} />
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Cache Hit Rate
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>
                {formatPercent(analytics.performance.cacheHitRate)}
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '1rem' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
          >
            <DollarSign size={20} style={{ color: 'var(--accent)' }} />
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Est. Monthly Cost
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>
                {analytics.costs.projectedMonthlyCost} ETH
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))',
          gap: '1.5rem',
        }}
      >
        {/* Backend Metrics */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Database size={18} /> Storage Backends
            </h3>
          </div>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Backend</th>
                  <th>Storage</th>
                  <th>Requests</th>
                  <th>Latency</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {analytics.backends.map((backend: BackendMetric) => (
                  <tr key={backend.backend}>
                    <td style={{ fontWeight: 500, textTransform: 'uppercase' }}>
                      {backend.backend}
                    </td>
                    <td>
                      <div>{formatBytes(backend.storageBytes)}</div>
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {formatNumber(backend.contentCount)} items
                      </div>
                    </td>
                    <td>
                      <div>{formatNumber(backend.requests24h)}</div>
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {formatBytes(backend.bandwidth24h)}
                      </div>
                    </td>
                    <td>
                      <div>{formatLatency(backend.avgLatencyMs)}</div>
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {formatPercent(backend.successRate)} success
                      </div>
                    </td>
                    <td>{getStatusBadge(backend.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Regional Distribution */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Globe size={18} /> Regional Distribution
            </h3>
          </div>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Region</th>
                  <th>Nodes</th>
                  <th>Storage</th>
                  <th>Bandwidth</th>
                  <th>Latency</th>
                </tr>
              </thead>
              <tbody>
                {analytics.regions.map((region: RegionalMetric) => (
                  <tr key={region.region}>
                    <td style={{ fontWeight: 500 }}>{region.region}</td>
                    <td>{region.nodeCount}</td>
                    <td>{formatBytes(region.storageBytes)}</td>
                    <td>
                      <div>{formatBytes(region.bandwidth24h)}</div>
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {formatNumber(region.requests24h)} req
                      </div>
                    </td>
                    <td>{formatLatency(region.avgLatencyMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Content */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <TrendingUp size={18} /> Top Content
            </h3>
          </div>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Content</th>
                  <th>Tier</th>
                  <th>Requests</th>
                  <th>Bandwidth</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                {analytics.topContent.map((content: ContentRanking) => (
                  <tr key={content.cid}>
                    <td>
                      <div
                        style={{
                          maxWidth: '200px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={content.name}
                      >
                        {content.name}
                      </div>
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {content.category}
                      </div>
                    </td>
                    <td>{getTierBadge(content.tier)}</td>
                    <td>{formatNumber(content.requests24h)}</td>
                    <td>{formatBytes(content.bandwidth24h)}</td>
                    <td>{getTrendIcon(content.trendDirection)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Performance Metrics */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Clock size={18} /> Performance Metrics
            </h3>
          </div>
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '0.5rem',
                }}
              >
                <span style={{ color: 'var(--text-secondary)' }}>
                  P50 Latency
                </span>
                <span
                  style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}
                >
                  {formatLatency(analytics.performance.p50LatencyMs)}
                </span>
              </div>
              <div
                style={{
                  height: '8px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min((analytics.performance.p50LatencyMs / 200) * 100, 100)}%`,
                    background: 'var(--success)',
                    borderRadius: '4px',
                  }}
                />
              </div>
            </div>

            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '0.5rem',
                }}
              >
                <span style={{ color: 'var(--text-secondary)' }}>
                  P95 Latency
                </span>
                <span
                  style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}
                >
                  {formatLatency(analytics.performance.p95LatencyMs)}
                </span>
              </div>
              <div
                style={{
                  height: '8px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min((analytics.performance.p95LatencyMs / 200) * 100, 100)}%`,
                    background: 'var(--warning)',
                    borderRadius: '4px',
                  }}
                />
              </div>
            </div>

            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '0.5rem',
                }}
              >
                <span style={{ color: 'var(--text-secondary)' }}>
                  P99 Latency
                </span>
                <span
                  style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}
                >
                  {formatLatency(analytics.performance.p99LatencyMs)}
                </span>
              </div>
              <div
                style={{
                  height: '8px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min((analytics.performance.p99LatencyMs / 200) * 100, 100)}%`,
                    background: 'var(--error)',
                    borderRadius: '4px',
                  }}
                />
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '0.75rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                marginTop: '0.5rem',
              }}
            >
              <span>Error Rate</span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 600,
                  color:
                    analytics.global.errorRate > 0.01
                      ? 'var(--error)'
                      : 'var(--success)',
                }}
              >
                {formatPercent(analytics.global.errorRate)}
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '0.75rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <span>Active Users</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                {analytics.global.activeUsers}
              </span>
            </div>
          </div>
        </div>

        {/* Cost Breakdown */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <DollarSign size={18} /> Cost Breakdown (24h)
            </h3>
          </div>
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '0.75rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <span>Storage Cost</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                {analytics.costs.storageCost24h} ETH
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '0.75rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <span>Bandwidth Cost</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                {analytics.costs.bandwidthCost24h} ETH
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '1rem',
                background: 'var(--accent-soft)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--accent)',
              }}
            >
              <span style={{ fontWeight: 600 }}>Total (24h)</span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  fontSize: '1.1rem',
                }}
              >
                {analytics.costs.totalCost24h} ETH
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '0.75rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <span>Projected Monthly</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                {analytics.costs.projectedMonthlyCost} ETH
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.85rem',
                color: 'var(--text-muted)',
                marginTop: '0.5rem',
              }}
            >
              <TrendingUp size={14} />
              <span>
                Cost trend: +{analytics.trends.costTrend.toFixed(1)}% vs last
                period
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
