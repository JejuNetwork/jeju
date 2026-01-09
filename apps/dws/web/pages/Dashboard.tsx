import { WalletButton } from '@jejunetwork/ui'
import {
  Activity,
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Box,
  Brain,
  CheckCircle2,
  ChevronDown,
  Clock,
  Cpu,
  Database,
  DollarSign,
  Globe,
  HardDrive,
  Layers,
  Play,
  Plus,
  Rocket,
  Server,
  Sparkles,
  TrendingUp,
  Upload,
  Wallet,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { SkeletonCard, SkeletonStatCard } from '../components/Skeleton'
import { useViewMode } from '../context/AppContext'
import {
  useCacheStats,
  useContainers,
  useHealth,
  useJobs,
  useProviderStats,
  useS3Buckets,
  useUserAccount,
  useWorkers,
} from '../hooks'
import { useBanStatus } from '../hooks/useBanStatus'

export default function Dashboard() {
  const { isConnected, address } = useAccount()
  const { viewMode } = useViewMode()
  const { isBanned, banRecord } = useBanStatus()
  const { data: health, isLoading: healthLoading } = useHealth()
  const { data: containersData, isLoading: containersLoading } = useContainers()
  const { data: workersData, isLoading: workersLoading } = useWorkers()
  const { data: jobsData, isLoading: jobsLoading } = useJobs()
  const { data: account, isLoading: accountLoading } = useUserAccount()
  const { data: buckets } = useS3Buckets()
  const { data: cacheStats } = useCacheStats()
  const { data: providerStats } = useProviderStats()

  const isDataLoading =
    containersLoading || workersLoading || jobsLoading || accountLoading

  // Check if user has any resources
  const executions = containersData?.executions ?? []
  const workerFunctions = workersData?.functions ?? []
  const jobsList = jobsData?.jobs ?? []
  const bucketsList = buckets?.Buckets ?? []

  const runningContainers = executions.filter(
    (e) => e.status === 'running',
  ).length
  const activeWorkers = workerFunctions.filter(
    (f) => f.status === 'active',
  ).length
  const runningJobs = jobsList.filter((j) => j.status === 'running').length
  const totalResources =
    executions.length + workerFunctions.length + bucketsList.length

  const isNewUser = isConnected && totalResources === 0

  if (!isConnected || !address) {
    return <ConnectWalletState />
  }

  if (isBanned) {
    return <BannedState banRecord={banRecord} />
  }

  if (isDataLoading) {
    return <LoadingState />
  }

  // New user gets onboarding experience
  if (isNewUser) {
    return (
      <NewUserDashboard
        address={address}
        health={health}
        healthLoading={healthLoading}
      />
    )
  }

  // Existing user gets resource overview
  return (
    <ExistingUserDashboard
      address={address}
      account={account}
      runningContainers={runningContainers}
      activeWorkers={activeWorkers}
      runningJobs={runningJobs}
      totalContainers={executions.length}
      totalWorkers={workerFunctions.length}
      totalBuckets={bucketsList.length}
      health={health}
      healthLoading={healthLoading}
      cacheStats={cacheStats}
      containersData={containersData}
      workersData={workersData}
      jobsData={jobsData}
      viewMode={viewMode}
      providerStats={providerStats}
    />
  )
}

// Connect wallet state
function ConnectWalletState() {
  return (
    <div className="dashboard-welcome">
      <div className="welcome-hero">
        <div className="welcome-glow" />
        <div className="welcome-content">
          <div className="welcome-icon">
            <Layers size={48} />
          </div>
          <h1 className="welcome-title">Decentralized Web Services</h1>
          <p className="welcome-subtitle">
            Deploy containers, workers, storage, and AI inference on the
            decentralized cloud. Connect your wallet to get started.
          </p>
          <WalletButton />
        </div>
      </div>

      <div className="features-grid">
        <FeatureCard
          icon={<Box />}
          title="Containers"
          description="Run Docker containers on decentralized compute nodes"
          color="cyan"
        />
        <FeatureCard
          icon={<Zap />}
          title="Workers"
          description="Deploy serverless functions at the edge"
          color="coral"
        />
        <FeatureCard
          icon={<Database />}
          title="Storage"
          description="S3-compatible storage with IPFS backend"
          color="green"
        />
        <FeatureCard
          icon={<Brain />}
          title="AI Inference"
          description="Access LLMs and embeddings via API"
          color="purple"
        />
      </div>
    </div>
  )
}

// Banned state
interface BanRecord {
  reason?: string
  expiresAt?: bigint
}

function BannedState({ banRecord }: { banRecord: BanRecord | null }) {
  return (
    <div className="dashboard-banned">
      <div className="banned-card">
        <div className="banned-icon">
          <AlertCircle size={32} />
        </div>
        <h2>Account Suspended</h2>
        <p>Your account has been suspended from using DWS services.</p>
        {banRecord && (
          <div className="banned-details">
            <p>
              <strong>Reason:</strong> {banRecord.reason ?? 'Not specified'}
            </p>
            {banRecord.expiresAt && banRecord.expiresAt > 0n && (
              <p>
                <strong>Expires:</strong>{' '}
                {new Date(Number(banRecord.expiresAt) * 1000).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Loading state
function LoadingState() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
      </div>
      <div className="stats-grid">
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
      </div>
      <div className="dashboard-grid">
        <SkeletonCard height="300px" />
        <SkeletonCard height="300px" />
      </div>
    </div>
  )
}

// Feature card for welcome screen
function FeatureCard({
  icon,
  title,
  description,
  color,
}: {
  icon: React.ReactNode
  title: string
  description: string
  color: 'cyan' | 'coral' | 'green' | 'purple'
}) {
  return (
    <div className={`feature-card feature-${color}`}>
      <div className="feature-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  )
}

// New user dashboard with onboarding
interface DWSHealth {
  status: string
  services?: Record<string, { status: string }>
}

function NewUserDashboard({
  address,
  health,
  healthLoading,
}: {
  address: string
  health: DWSHealth | undefined
  healthLoading: boolean
}) {
  return (
    <div className="dashboard-new-user">
      <div className="new-user-hero">
        <div className="hero-glow" />
        <div className="hero-badge">
          <Sparkles size={14} />
          <span>Welcome to DWS</span>
        </div>
        <h1>
          Let's deploy something
          <span className="hero-gradient">amazing</span>
        </h1>
        <p>
          You're connected as{' '}
          <code>
            {address.slice(0, 6)}...{address.slice(-4)}
          </code>
          . Choose how you want to get started.
        </p>
      </div>

      <div className="getting-started-grid">
        <GettingStartedCard
          icon={<Box size={24} />}
          title="Run a Container"
          description="Deploy any Docker image on our decentralized compute network"
          action="Start Container"
          href="/compute/containers"
          color="cyan"
          time="~30 seconds"
        />
        <GettingStartedCard
          icon={<Zap size={24} />}
          title="Deploy a Worker"
          description="Create a serverless function that runs at the edge"
          action="Deploy Worker"
          href="/compute/workers"
          color="coral"
          time="~10 seconds"
        />
        <GettingStartedCard
          icon={<Upload size={24} />}
          title="Upload Files"
          description="Store files on S3-compatible decentralized storage"
          action="Create Bucket"
          href="/storage/buckets"
          color="green"
          time="~5 seconds"
        />
        <GettingStartedCard
          icon={<Brain size={24} />}
          title="Try AI Inference"
          description="Chat with LLMs or generate embeddings via API"
          action="Open Playground"
          href="/ai/inference"
          color="purple"
          time="Instant"
        />
      </div>

      <div className="new-user-sections">
        <div className="explore-section">
          <h2>
            <Globe size={20} />
            Explore Services
          </h2>
          <div className="explore-grid">
            <ExploreItem
              icon={<Server />}
              label="RPC Gateway"
              href="/network/rpc"
            />
            <ExploreItem
              icon={<HardDrive />}
              label="IPFS Storage"
              href="/storage/ipfs"
            />
            <ExploreItem icon={<Bot />} label="AI Agents" href="/agents" />
            <ExploreItem icon={<Layers />} label="CDN" href="/storage/cdn" />
          </div>
        </div>

        <SystemStatusCompact health={health} loading={healthLoading} />
      </div>

      <div className="earn-cta">
        <div className="earn-content">
          <div className="earn-icon">
            <DollarSign size={24} />
          </div>
          <div>
            <h3>Earn by running a node</h3>
            <p>
              Turn your hardware into passive income. Run compute, storage, or
              VPN services.
            </p>
          </div>
        </div>
        <Link to="/provider/node" className="btn btn-secondary">
          Learn More <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}

function GettingStartedCard({
  icon,
  title,
  description,
  action,
  href,
  color,
  time,
}: {
  icon: React.ReactNode
  title: string
  description: string
  action: string
  href: string
  color: string
  time: string
}) {
  return (
    <Link to={href} className={`getting-started-card gs-${color}`}>
      <div className="gs-header">
        <div className="gs-icon">{icon}</div>
        <span className="gs-time">
          <Clock size={12} />
          {time}
        </span>
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      <div className="gs-action">
        {action}
        <ArrowUpRight size={16} />
      </div>
    </Link>
  )
}

function ExploreItem({
  icon,
  label,
  href,
}: {
  icon: React.ReactNode
  label: string
  href: string
}) {
  return (
    <Link to={href} className="explore-item">
      {icon}
      <span>{label}</span>
      <ArrowRight size={14} />
    </Link>
  )
}

interface ProviderStats {
  totalNodesActive: number
  totalStakedUSD: string
  lifetimeRewardsUSD: string
  nodes: Array<{
    nodeId: string
    pendingRewards: string
    performance: { uptimeScore: number }
  }>
}

interface ContainersData {
  executions: Array<{
    executionId: string
    image: string
    status: string
    startedAt: number | null
    submittedAt: number
  }>
}

interface WorkersData {
  functions: Array<{
    id: string
    name: string
    status: string
    updatedAt: number
  }>
}

interface JobsData {
  jobs: Array<{
    jobId: string
    command: string
    status: string
    startedAt: number | null
  }>
}

interface CacheStats {
  shared: {
    totalKeys: number
    usedMemoryBytes: number
    hitRate: number
  }
  global: {
    totalNodes: number
  }
}

interface UserAccount {
  balance: string
  totalSpent: string
  tier: string
}

// Existing user dashboard with resource overview
function ExistingUserDashboard({
  address,
  account,
  runningContainers,
  activeWorkers,
  runningJobs,
  totalContainers,
  totalWorkers,
  totalBuckets,
  health,
  healthLoading,
  cacheStats,
  containersData,
  workersData,
  jobsData,
  viewMode,
  providerStats,
}: {
  address: string
  account: UserAccount | undefined
  runningContainers: number
  activeWorkers: number
  runningJobs: number
  totalContainers: number
  totalWorkers: number
  totalBuckets: number
  health: DWSHealth | undefined
  healthLoading: boolean
  cacheStats: CacheStats | undefined
  containersData: ContainersData | undefined
  workersData: WorkersData | undefined
  jobsData: JobsData | undefined
  viewMode: 'consumer' | 'provider'
  providerStats: ProviderStats | undefined
}) {
  const totalActive = runningContainers + activeWorkers + runningJobs
  const balanceEth = account
    ? (Number(account.balance) / 1e18).toFixed(4)
    : '0.0000'

  return (
    <div className="dashboard-existing">
      <header className="dashboard-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="dashboard-address">
            <Wallet size={14} />
            {address.slice(0, 6)}...{address.slice(-4)}
          </p>
        </div>
        <div className="dashboard-header-actions">
          <Link to="/compute/containers" className="btn btn-primary btn-sm">
            <Plus size={16} />
            Deploy
          </Link>
        </div>
      </header>

      {/* Primary stats */}
      <div className="dashboard-stats">
        <StatCard
          icon={<Activity size={24} />}
          label="Active Resources"
          value={totalActive}
          subtext={
            totalActive > 0
              ? `${runningContainers} containers, ${activeWorkers} workers, ${runningJobs} jobs`
              : 'No running resources'
          }
          color="cyan"
          trend={totalActive > 0 ? 'positive' : undefined}
        />
        <StatCard
          icon={<Layers size={24} />}
          label="Total Resources"
          value={totalContainers + totalWorkers + totalBuckets}
          subtext={`${totalContainers} containers, ${totalWorkers} workers, ${totalBuckets} buckets`}
          color="purple"
        />
        <StatCard
          icon={<Wallet size={24} />}
          label="Balance"
          value={`${balanceEth} ETH`}
          subtext={account ? `${account.tier} tier` : 'x402 Credits'}
          color="green"
          valueSize="small"
        />
        <SystemHealthCard health={health} loading={healthLoading} />
      </div>

      {/* Main grid */}
      <div className="dashboard-grid">
        {/* Left column: Activity */}
        <div className="dashboard-main">
          <RecentActivityCard
            containersData={containersData}
            workersData={workersData}
            jobsData={jobsData}
          />
        </div>

        {/* Right column: Quick actions & system */}
        <div className="dashboard-aside">
          <QuickActionsCard />

          {viewMode === 'provider' && providerStats && (
            <ProviderEarningsCard stats={providerStats} />
          )}

          {cacheStats && <CacheStatsCard stats={cacheStats} />}
        </div>
      </div>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  subtext,
  color,
  trend,
  valueSize = 'normal',
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  subtext: string
  color: string
  trend?: 'positive' | 'negative'
  valueSize?: 'normal' | 'small'
}) {
  return (
    <div className={`stat-card-v2 stat-${color}`}>
      <div className="stat-card-icon">{icon}</div>
      <div className="stat-card-content">
        <span className="stat-card-label">{label}</span>
        <span
          className={`stat-card-value ${valueSize === 'small' ? 'stat-value-sm' : ''}`}
        >
          {value}
          {trend === 'positive' && (
            <TrendingUp size={16} className="trend-up" />
          )}
        </span>
        <span className="stat-card-subtext">{subtext}</span>
      </div>
    </div>
  )
}

function SystemHealthCard({
  health,
  loading,
}: {
  health: DWSHealth | undefined
  loading: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const services = health?.services ?? {}
  const serviceList = Object.entries(services)
  const healthyCount = serviceList.filter(
    ([, s]) => s.status === 'healthy',
  ).length
  const totalCount = serviceList.length
  const allHealthy = healthyCount === totalCount && totalCount > 0

  return (
    <div
      className={`stat-card-v2 stat-health ${allHealthy ? 'stat-healthy' : 'stat-degraded'}`}
    >
      <div className="stat-card-icon">
        {allHealthy ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />}
      </div>
      <div className="stat-card-content">
        <span className="stat-card-label">System Status</span>
        <span className="stat-card-value">
          {loading ? '...' : allHealthy ? 'Healthy' : 'Degraded'}
        </span>
        <button
          type="button"
          className="stat-card-expand"
          onClick={() => setExpanded(!expanded)}
        >
          {healthyCount}/{totalCount} services
          <ChevronDown
            size={14}
            style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}
          />
        </button>
      </div>

      {expanded && (
        <div className="health-dropdown">
          {serviceList.slice(0, 10).map(([name, service]) => (
            <div key={name} className="health-item">
              <span className="health-name">{name}</span>
              <span
                className={`health-status ${service.status === 'healthy' ? 'status-healthy' : 'status-unhealthy'}`}
              >
                {service.status}
              </span>
            </div>
          ))}
          {serviceList.length > 10 && (
            <div className="health-more">
              +{serviceList.length - 10} more services
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function QuickActionsCard() {
  return (
    <div className="card quick-actions-card">
      <h3 className="card-title-sm">
        <Rocket size={16} />
        Quick Actions
      </h3>
      <div className="quick-actions-list">
        <Link to="/compute/containers" className="quick-action">
          <Box size={18} />
          <span>Run Container</span>
          <ArrowRight size={14} />
        </Link>
        <Link to="/compute/workers" className="quick-action">
          <Zap size={18} />
          <span>Deploy Worker</span>
          <ArrowRight size={14} />
        </Link>
        <Link to="/storage/buckets" className="quick-action">
          <Database size={18} />
          <span>Upload Files</span>
          <ArrowRight size={14} />
        </Link>
        <Link to="/ai/inference" className="quick-action">
          <Brain size={18} />
          <span>AI Inference</span>
          <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  )
}

function RecentActivityCard({
  containersData,
  workersData,
  jobsData,
}: {
  containersData: ContainersData | undefined
  workersData: WorkersData | undefined
  jobsData: JobsData | undefined
}) {
  const activities: Array<{
    id: string
    type: 'container' | 'worker' | 'job'
    name: string
    status: string
    timestamp: number
  }> = []

  const executions = containersData?.executions ?? []
  const functions = workersData?.functions ?? []
  const jobs = jobsData?.jobs ?? []

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

  for (const w of functions) {
    activities.push({
      id: w.id,
      type: 'worker',
      name: w.name,
      status: w.status,
      timestamp: w.updatedAt,
    })
  }

  for (const j of jobs) {
    if (j.startedAt === null) continue
    activities.push({
      id: j.jobId,
      type: 'job',
      name: j.command.slice(0, 30) + (j.command.length > 30 ? '...' : ''),
      status: j.status,
      timestamp: j.startedAt,
    })
  }

  const recentActivities = activities
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 10)

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'running':
      case 'active':
        return 'status-running'
      case 'completed':
        return 'status-completed'
      case 'pending':
      case 'queued':
        return 'status-pending'
      case 'failed':
      case 'cancelled':
        return 'status-failed'
      default:
        return 'status-default'
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'container':
        return <Box size={16} />
      case 'worker':
        return <Zap size={16} />
      case 'job':
        return <Cpu size={16} />
      default:
        return <Activity size={16} />
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
    <div className="card activity-card">
      <h3 className="card-title-sm">
        <Clock size={16} />
        Recent Activity
      </h3>

      {recentActivities.length === 0 ? (
        <div className="activity-empty">
          <Activity size={32} />
          <p>No recent activity</p>
          <Link to="/compute/containers" className="btn btn-sm btn-secondary">
            <Play size={14} />
            Run your first container
          </Link>
        </div>
      ) : (
        <div className="activity-list">
          {recentActivities.map((activity) => (
            <div
              key={`${activity.type}-${activity.id}`}
              className="activity-item"
            >
              <div className={`activity-icon activity-${activity.type}`}>
                {getTypeIcon(activity.type)}
              </div>
              <div className="activity-content">
                <span className="activity-name">{activity.name}</span>
                <span className="activity-type">{activity.type}</span>
              </div>
              <span
                className={`activity-status ${getStatusClass(activity.status)}`}
              >
                {activity.status}
              </span>
              <span className="activity-time">
                {formatTime(activity.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ProviderEarningsCard({ stats }: { stats: ProviderStats }) {
  const pendingRewards = stats.nodes.reduce((sum, n) => {
    return sum + Number(n.pendingRewards || 0) / 1e18
  }, 0)

  return (
    <div className="card provider-card">
      <h3 className="card-title-sm">
        <DollarSign size={16} />
        Provider Earnings
      </h3>
      <div className="provider-stats">
        <div className="provider-stat">
          <span className="provider-label">Active Nodes</span>
          <span className="provider-value">{stats.totalNodesActive}</span>
        </div>
        <div className="provider-stat">
          <span className="provider-label">Staked Value</span>
          <span className="provider-value">${stats.totalStakedUSD}</span>
        </div>
        <div className="provider-stat">
          <span className="provider-label">Pending Rewards</span>
          <span className="provider-value highlight">
            {pendingRewards.toFixed(4)} ETH
          </span>
        </div>
        <div className="provider-stat">
          <span className="provider-label">Lifetime Earnings</span>
          <span className="provider-value">${stats.lifetimeRewardsUSD}</span>
        </div>
      </div>
      <Link to="/provider/earnings" className="btn btn-sm btn-secondary">
        View Earnings
        <ArrowRight size={14} />
      </Link>
    </div>
  )
}

function CacheStatsCard({ stats }: { stats: CacheStats }) {
  return (
    <div className="card cache-card">
      <h3 className="card-title-sm">
        <Database size={16} />
        Cache
      </h3>
      <div className="cache-stats">
        <div className="cache-stat">
          <span>{stats.shared.totalKeys.toLocaleString()}</span>
          <span>Keys</span>
        </div>
        <div className="cache-stat">
          <span>{(stats.shared.hitRate * 100).toFixed(0)}%</span>
          <span>Hit Rate</span>
        </div>
        <div className="cache-stat">
          <span>
            {(stats.shared.usedMemoryBytes / (1024 * 1024)).toFixed(1)}
          </span>
          <span>MB Used</span>
        </div>
      </div>
    </div>
  )
}

function SystemStatusCompact({
  health,
  loading,
}: {
  health: DWSHealth | undefined
  loading: boolean
}) {
  const services = health?.services ?? {}
  const serviceList = Object.entries(services)
  const healthyCount = serviceList.filter(
    ([, s]) => s.status === 'healthy',
  ).length

  return (
    <div className="system-status-compact">
      <h2>
        <Activity size={20} />
        System Status
      </h2>
      {loading ? (
        <div className="status-loading">Checking services...</div>
      ) : (
        <div className="status-indicator">
          <div
            className={`status-dot ${healthyCount === serviceList.length ? 'dot-healthy' : 'dot-degraded'}`}
          />
          <span>
            {healthyCount}/{serviceList.length} services healthy
          </span>
        </div>
      )}
    </div>
  )
}
