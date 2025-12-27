import { WalletButton } from '@jejunetwork/ui'
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Box,
  Brain,
  Clock,
  Cpu,
  Database,
  DollarSign,
  Plus,
  Server,
  Zap,
} from 'lucide-react'
import { useAccount } from 'wagmi'
import {
  useContainers,
  useHealth,
  useJobs,
  useUserAccount,
  useWorkers,
} from '../hooks'
import { useBanStatus } from '../hooks/useBanStatus'
import type { ViewMode } from '../types'
import NodeOperatorDashboard from './node/NodeOperatorDashboard'

interface DashboardProps {
  viewMode: ViewMode
}

export default function Dashboard({ viewMode }: DashboardProps) {
  const { isConnected, address } = useAccount()
  const { isBanned, banRecord } = useBanStatus()
  const { data: health, isLoading: healthLoading } = useHealth()
  const { data: containersData, isLoading: containersLoading } = useContainers()
  const { data: workersData, isLoading: workersLoading } = useWorkers()
  const { data: jobsData, isLoading: jobsLoading } = useJobs()
  const { data: account, isLoading: accountLoading } = useUserAccount()

  // Show loading state while initial data loads (only for consumer mode)
  const isDataLoading =
    containersLoading || workersLoading || jobsLoading || accountLoading

  if (!isConnected || !address) {
    return (
      <div className="empty-state" style={{ paddingTop: '4rem' }}>
        <Box size={64} />
        <h3>Welcome to DWS</h3>
        <p>
          Connect your wallet to start building with decentralized compute,
          storage, and AI services
        </p>
        <WalletButton />
      </div>
    )
  }

  if (isBanned) {
    return (
      <div
        className="card"
        style={{ borderColor: 'var(--error)', background: 'var(--error-soft)' }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            marginBottom: '1rem',
          }}
        >
          <AlertCircle size={24} style={{ color: 'var(--error)' }} />
          <h2 style={{ color: 'var(--error)' }}>Account Suspended</h2>
        </div>
        <p style={{ marginBottom: '1rem' }}>
          Your account has been suspended from using DWS services.
        </p>
        {banRecord && (
          <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            <p>
              <strong>Reason:</strong> {banRecord.reason ?? 'Not specified'}
            </p>
            {banRecord.expiresAt > 0n && (
              <p>
                <strong>Expires:</strong>{' '}
                {new Date(Number(banRecord.expiresAt) * 1000).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </div>
    )
  }

  // Provider mode uses the dedicated NodeOperatorDashboard with its own loading state
  if (viewMode === 'provider') {
    return <NodeOperatorDashboard />
  }

  // Consumer mode loading state
  if (isDataLoading) {
    return (
      <div className="empty-state" style={{ paddingTop: '4rem' }}>
        <div className="spinner" style={{ width: 48, height: 48 }} />
        <p>Getting your infrastructure ready...</p>
      </div>
    )
  }

  // Data is now loaded - extract arrays (defaults handle any edge cases)
  const executions = containersData?.executions ?? []
  const workerFunctions = workersData?.functions ?? []
  const jobsList = jobsData?.jobs ?? []

  const runningContainers = executions.filter(
    (e) => e.status === 'running',
  ).length
  const activeWorkers = workerFunctions.filter(
    (f) => f.status === 'active',
  ).length
  const runningJobs = jobsList.filter((j) => j.status === 'running').length

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">
          Your decentralized infrastructure at a glance
        </p>
      </div>

      <ConsumerDashboard
        health={health}
        healthLoading={healthLoading}
        runningContainers={runningContainers}
        activeWorkers={activeWorkers}
        runningJobs={runningJobs}
        account={account}
      />
    </div>
  )
}

interface ConsumerDashboardProps {
  health: ReturnType<typeof useHealth>['data']
  healthLoading: boolean
  runningContainers: number
  activeWorkers: number
  runningJobs: number
  account: ReturnType<typeof useUserAccount>['data']
}

function ConsumerDashboard({
  health,
  healthLoading,
  runningContainers,
  activeWorkers,
  runningJobs,
  account,
}: ConsumerDashboardProps) {
  return (
    <>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon compute">
            <Box size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Containers</div>
            <div className="stat-value">{runningContainers}</div>
            <div className="stat-change positive">Running</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon compute">
            <Zap size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Workers</div>
            <div className="stat-value">{activeWorkers}</div>
            <div className="stat-change positive">Active</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon storage">
            <Cpu size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Jobs</div>
            <div className="stat-value">{runningJobs}</div>
            <div className="stat-change">Running</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon network">
            <DollarSign size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Balance</div>
            <div className="stat-value" style={{ fontSize: '1.25rem' }}>
              {account
                ? `${(Number(account.balance) / 1e18).toFixed(4)} ETH`
                : '—'}
            </div>
            <div className="stat-change">x402 Credits</div>
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
              <Activity size={18} /> Service Status
            </h3>
          </div>
          {healthLoading ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                padding: '2rem',
              }}
            >
              <div className="spinner" />
            </div>
          ) : health ? (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {Object.entries(health.services).map(([name, service]) => (
                <div
                  key={name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.5rem 0',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <span style={{ textTransform: 'capitalize' }}>{name}</span>
                  <span
                    className={`badge ${service.status === 'healthy' ? 'badge-success' : service.status === 'degraded' ? 'badge-warning' : 'badge-error'}`}
                  >
                    {service.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)' }}>
              Unable to load service status
            </p>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Plus size={18} /> Quick Actions
            </h3>
          </div>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <a
              href="/compute/containers"
              className="btn btn-secondary"
              style={{ justifyContent: 'space-between' }}
            >
              <span
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <Box size={18} /> Run Container
              </span>
              <ArrowRight size={16} />
            </a>
            <a
              href="/compute/workers"
              className="btn btn-secondary"
              style={{ justifyContent: 'space-between' }}
            >
              <span
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <Zap size={18} /> Deploy Worker
              </span>
              <ArrowRight size={16} />
            </a>
            <a
              href="/storage/buckets"
              className="btn btn-secondary"
              style={{ justifyContent: 'space-between' }}
            >
              <span
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <Database size={18} /> Upload Files
              </span>
              <ArrowRight size={16} />
            </a>
            <a
              href="/ai/inference"
              className="btn btn-secondary"
              style={{ justifyContent: 'space-between' }}
            >
              <span
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <Brain size={18} /> AI Inference
              </span>
              <ArrowRight size={16} />
            </a>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Server size={18} /> Network Stats
            </h3>
          </div>
          {health ? (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  Registered Nodes
                </span>
                <span
                  style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}
                >
                  {health.decentralized.registeredNodes}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  Connected Peers
                </span>
                <span
                  style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}
                >
                  {health.decentralized.connectedPeers}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  P2P Enabled
                </span>
                <span
                  className={`badge ${health.decentralized.p2pEnabled ? 'badge-success' : 'badge-neutral'}`}
                >
                  {health.decentralized.p2pEnabled ? 'Yes' : 'No'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  Storage Backends
                </span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>
                  {health.backends.available.length}
                </span>
              </div>
            </div>
          ) : (
            <div className="skeleton" style={{ height: '120px' }} />
          )}
        </div>

        <RecentActivity />
      </div>
    </>
  )
}

function RecentActivity() {
  const { data: containersData } = useContainers()
  const { data: workersData } = useWorkers()
  const { data: jobsData } = useJobs()

  // Combine all activity into a single sorted list
  const activities: Array<{
    id: string
    type: 'container' | 'worker' | 'job'
    name: string
    status: string
    timestamp: number
  }> = []

  // Extract arrays with defaults
  const executions = containersData?.executions ?? []
  const functions = workersData?.functions ?? []
  const jobs = jobsData?.jobs ?? []

  // Add containers
  for (const c of executions) {
    const imageParts = c.image.split('/')
    const lastPart = imageParts[imageParts.length - 1]
    const namePart = lastPart.split(':')[0]
    const name = namePart && namePart.length > 0 ? namePart : c.image
    activities.push({
      id: c.executionId,
      type: 'container',
      name,
      status: c.status,
      timestamp: c.startedAt ?? c.submittedAt,
    })
  }

  // Add workers
  for (const w of functions) {
    activities.push({
      id: w.id,
      type: 'worker',
      name: w.name,
      status: w.status,
      timestamp: w.updatedAt,
    })
  }

  // Add jobs
  for (const j of jobs) {
    if (j.startedAt === null) continue // Skip jobs that haven't started
    activities.push({
      id: j.jobId,
      type: 'job',
      name: j.command.slice(0, 30) + (j.command.length > 30 ? '...' : ''),
      status: j.status,
      timestamp: j.startedAt,
    })
  }

  // Sort by timestamp descending and take top 8
  const recentActivities = activities
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 8)

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
      case 'active':
        return 'badge-success'
      case 'completed':
        return 'badge-info'
      case 'pending':
      case 'queued':
        return 'badge-warning'
      case 'failed':
      case 'cancelled':
        return 'badge-error'
      default:
        return 'badge-neutral'
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'container':
        return <Box size={14} />
      case 'worker':
        return <Zap size={14} />
      case 'job':
        return <Cpu size={14} />
      default:
        return <Activity size={14} />
    }
  }

  const formatTime = (timestamp: number) => {
    const now = Date.now()
    const diff = now - timestamp
    if (diff < 60000) return 'Just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return new Date(timestamp).toLocaleDateString()
  }

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="card-title">
          <Clock size={18} /> Recent Activity
        </h3>
      </div>
      {recentActivities.length === 0 ? (
        <div className="empty-state" style={{ padding: '1.5rem' }}>
          <Activity size={32} />
          <p style={{ fontSize: '0.9rem', marginBottom: 0 }}>
            Your activity will show here once you start using DWS
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '0' }}>
          {recentActivities.map((activity) => (
            <div
              key={`${activity.type}-${activity.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 0',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-tertiary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-secondary)',
                }}
              >
                {getTypeIcon(activity.type)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 500,
                    fontSize: '0.9rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {activity.name}
                </div>
                <div
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                    textTransform: 'capitalize',
                  }}
                >
                  {activity.type}
                </div>
              </div>
              <span className={`badge ${getStatusColor(activity.status)}`}>
                {activity.status}
              </span>
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  minWidth: '60px',
                  textAlign: 'right',
                }}
              >
                {formatTime(activity.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
