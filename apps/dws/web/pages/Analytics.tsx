import {
  Activity,
  BarChart3,
  Box,
  Brain,
  Clock,
  Database,
  DollarSign,
  Globe,
  RefreshCw,
  TrendingUp,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import {
  useCDNStats,
  useContainers,
  useHealth,
  useJobs,
  useStorageHealth,
  useUserAccount,
  useWorkers,
} from '../hooks'
import type { ComputeJob, Container, WorkerFunction } from '../types'

type TimeRange = '1h' | '24h' | '7d' | '30d'

export default function AnalyticsPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>('24h')

  const { data: health, refetch: refetchHealth } = useHealth()
  const { data: account } = useUserAccount()
  const { data: storageHealth } = useStorageHealth()
  const { data: cdnStats } = useCDNStats()
  const { data: containersData } = useContainers()
  const { data: workersData } = useWorkers()
  const { data: jobsData } = useJobs()

  const handleRefresh = () => {
    refetchHealth()
  }

  const containers = containersData?.executions ?? []
  const workers = workersData?.functions ?? []
  const jobs = jobsData?.jobs ?? []

  const runningContainers = containers.filter(
    (c: Container) => c.status === 'running',
  ).length
  const completedContainers = containers.filter(
    (c: Container) => c.status === 'completed',
  ).length
  const activeWorkers = workers.filter(
    (w: WorkerFunction) => w.status === 'active',
  ).length
  const totalInvocations = workers.reduce(
    (sum: number, w: WorkerFunction) => sum + w.invocationCount,
    0,
  )
  const runningJobs = jobs.filter(
    (j: ComputeJob) => j.status === 'running',
  ).length
  const completedJobs = jobs.filter(
    (j: ComputeJob) => j.status === 'completed',
  ).length

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
          <h1 className="page-title">Analytics & Monitoring</h1>
          <p className="page-subtitle">
            Monitor usage, performance, and costs across all DWS services
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <div
            style={{
              display: 'flex',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
              padding: '0.25rem',
            }}
          >
            {(['1h', '24h', '7d', '30d'] as TimeRange[]).map((range) => (
              <button
                key={range}
                type="button"
                className={`btn btn-sm ${timeRange === range ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setTimeRange(range)}
              >
                {range}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRefresh}
          >
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>

      {/* Overview Stats */}
      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon compute">
            <TrendingUp size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Total Requests</div>
            <div className="stat-value">
              {account
                ? parseInt(account.totalRequests, 10).toLocaleString()
                : '—'}
            </div>
            <div className="stat-change positive">
              <TrendingUp size={14} /> This {timeRange}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage">
            <DollarSign size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Total Spent</div>
            <div className="stat-value">
              {account
                ? `${(parseFloat(account.totalSpent) / 1e18).toFixed(4)} ETH`
                : '—'}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network">
            <Activity size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Active Services</div>
            <div className="stat-value">
              {runningContainers + activeWorkers + runningJobs}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon ai">
            <Clock size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Uptime</div>
            <div className="stat-value">
              {health ? `${Math.floor(health.uptime / 3600000)}h` : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Service Breakdown */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
          gap: '1.5rem',
          marginBottom: '1.5rem',
        }}
      >
        {/* Compute Usage */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Box size={18} /> Compute
            </h3>
          </div>
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                }}
              >
                <Box size={20} style={{ color: 'var(--accent)' }} />
                <div>
                  <div style={{ fontWeight: 500 }}>Containers</div>
                  <div
                    style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}
                  >
                    {runningContainers} running
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div
                  style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}
                >
                  {completedContainers}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  completed
                </div>
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                }}
              >
                <Zap size={20} style={{ color: 'var(--success)' }} />
                <div>
                  <div style={{ fontWeight: 500 }}>Workers</div>
                  <div
                    style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}
                  >
                    {activeWorkers} active
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div
                  style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}
                >
                  {totalInvocations.toLocaleString()}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  invocations
                </div>
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                }}
              >
                <Activity size={20} style={{ color: 'var(--warning)' }} />
                <div>
                  <div style={{ fontWeight: 500 }}>Jobs</div>
                  <div
                    style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}
                  >
                    {runningJobs} running
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div
                  style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}
                >
                  {completedJobs}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  completed
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Storage Usage */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Database size={18} /> Storage
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
                  Used Storage
                </span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>
                  {storageHealth ? (
                    formatBytes(storageHealth.stats.sizeBytes ?? 0)
                  ) : (
                    <span className="shimmer inline-block w-12 h-5 rounded" />
                  )}
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
                    width: `${
                      storageHealth?.stats.maxSizeBytes
                        ? (
                            (storageHealth.stats.sizeBytes ?? 0) /
                              storageHealth.stats.maxSizeBytes
                          ) * 100
                        : 0
                    }%`,
                    background: 'var(--accent)',
                    borderRadius: '4px',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Objects</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {storageHealth ? (
                  (storageHealth.stats.entries ?? 0)
                ) : (
                  <span className="shimmer inline-block w-8 h-5 rounded" />
                )}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Backends</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {storageHealth ? (
                  (storageHealth.backends.length ?? 0)
                ) : (
                  <span className="shimmer inline-block w-6 h-5 rounded" />
                )}
              </span>
            </div>
          </div>
        </div>

        {/* CDN Usage */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Globe size={18} /> CDN
            </h3>
          </div>
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                Cache Entries
              </span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {cdnStats ? (
                  (cdnStats.entries ?? 0)
                ) : (
                  <span className="shimmer inline-block w-8 h-5 rounded" />
                )}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Cache Size</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {cdnStats ? (
                  formatBytes(cdnStats.sizeBytes ?? 0)
                ) : (
                  <span className="shimmer inline-block w-12 h-5 rounded" />
                )}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Hit Rate</span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  color: cdnStats
                    ? (cdnStats.hitRate ?? 0) > 0.8
                      ? 'var(--success)'
                      : 'var(--warning)'
                    : 'var(--text-muted)',
                }}
              >
                {cdnStats ? (
                  `${((cdnStats.hitRate ?? 0) * 100).toFixed(1)}%`
                ) : (
                  <span className="shimmer inline-block w-10 h-5 rounded" />
                )}
              </span>
            </div>
          </div>
        </div>

        {/* AI/ML Usage */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Brain size={18} /> AI/ML
            </h3>
          </div>
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                Inference Requests
              </span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {health?.services.compute?.status === 'healthy'
                  ? 'Active'
                  : '—'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                Embedding Requests
              </span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>—</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                Training Runs
              </span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>—</span>
            </div>
          </div>
        </div>
      </div>

      {/* Service Health */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">
            <BarChart3 size={18} /> Service Health
          </h3>
        </div>
        {health ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '0.75rem',
            }}
          >
            {(
              Object.entries(health.services) as [string, { status: string }][]
            ).map(([name, service]) => (
              <div
                key={name}
                style={{
                  padding: '1rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ textTransform: 'capitalize', fontWeight: 500 }}>
                  {name}
                </span>
                <span
                  className={`badge ${
                    service.status === 'healthy'
                      ? 'badge-success'
                      : service.status === 'degraded'
                        ? 'badge-warning'
                        : service.status === 'available'
                          ? 'badge-success'
                          : service.status === 'not-configured'
                            ? 'badge-neutral'
                            : 'badge-error'
                  }`}
                >
                  {service.status}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: '3rem',
            }}
          >
            <div className="spinner" />
          </div>
        )}
      </div>

      {/* Network Info */}
      {health && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <div className="card-header">
            <h3 className="card-title">
              <Globe size={18} /> Network Status
            </h3>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
            }}
          >
            <div
              style={{
                padding: '1rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)',
                  marginBottom: '0.5rem',
                }}
              >
                Registered Nodes
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.25rem',
                  fontWeight: 600,
                }}
              >
                {health.decentralized.registeredNodes}
              </div>
            </div>
            <div
              style={{
                padding: '1rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)',
                  marginBottom: '0.5rem',
                }}
              >
                Connected Peers
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.25rem',
                  fontWeight: 600,
                }}
              >
                {health.decentralized.connectedPeers}
              </div>
            </div>
            <div
              style={{
                padding: '1rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)',
                  marginBottom: '0.5rem',
                }}
              >
                P2P Status
              </div>
              <span
                className={`badge ${health.decentralized.p2pEnabled ? 'badge-success' : 'badge-neutral'}`}
              >
                {health.decentralized.p2pEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div
              style={{
                padding: '1rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)',
                  marginBottom: '0.5rem',
                }}
              >
                Storage Backends
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.25rem',
                  fontWeight: 600,
                }}
              >
                {health.backends.available.length}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
