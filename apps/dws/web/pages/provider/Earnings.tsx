import { WalletButton } from '@jejunetwork/ui'
import {
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  Clock,
  DollarSign,
  Download,
  RefreshCw,
  Server,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { SkeletonStatCard } from '../../components/Skeleton'
import { useConfirm, useToast } from '../../context/AppContext'
import { useClaimRewards } from '../../hooks'
import {
  useAggregateStats,
  useEarningsHistory,
  useOperatorStats,
} from '../../hooks/useStaking'

// Extend the earnings history with computed timestamp
interface EarningsHistoryWithTimestamp {
  type: 'claim' | 'register'
  nodeId: string
  rewardToken?: string
  amount?: string
  feesPaid?: string
  stakedToken?: string
  stakedAmount?: string
  stakedValueUSD?: string
  blockNumber: number
  transactionHash: string
  timestamp: number
}

type TimeRange = '7d' | '30d' | '90d' | 'all'

export default function EarningsPage() {
  const { isConnected, address } = useAccount()
  const { showSuccess, showError } = useToast()
  const confirm = useConfirm()
  const claimRewards = useClaimRewards()
  const {
    data: operatorStats,
    isLoading: statsLoading,
    refetch: refetchStats,
  } = useOperatorStats()
  const { data: aggregateStats, isLoading: aggregateLoading } =
    useAggregateStats()
  const { data: earningsHistory, isLoading: historyLoading } =
    useEarningsHistory()
  const [timeRange, setTimeRange] = useState<TimeRange>('30d')
  const [claimingAll, setClaimingAll] = useState(false)

  const handleClaimAll = async () => {
    const nodes = operatorStats?.nodes ?? []
    const nodesWithRewards = nodes.filter(
      (n) => parseFloat(n.pendingRewards) > 0,
    )

    if (nodesWithRewards.length === 0) {
      showError('No rewards', 'No pending rewards to claim')
      return
    }

    const totalPending = nodesWithRewards.reduce(
      (sum, n) => sum + parseFloat(n.pendingRewards),
      0,
    )

    const confirmed = await confirm({
      title: 'Claim All Rewards',
      message: `Claim $${totalPending.toFixed(2)} in rewards from ${nodesWithRewards.length} node(s)? This will transfer all pending rewards to your wallet.`,
      confirmText: 'Claim All',
      cancelText: 'Cancel',
    })

    if (!confirmed) return

    setClaimingAll(true)
    let successCount = 0
    let failCount = 0

    for (const node of nodesWithRewards) {
      const result = await claimRewards
        .mutateAsync(node.nodeId)
        .catch(() => null)
      if (result) {
        successCount++
      } else {
        failCount++
      }
    }

    setClaimingAll(false)

    if (successCount > 0) {
      showSuccess(
        'Rewards claimed',
        `Successfully claimed from ${successCount} node(s)`,
      )
      refetchStats()
    }

    if (failCount > 0) {
      showError('Partial failure', `Failed to claim from ${failCount} node(s)`)
    }
  }

  if (!isConnected || !address) {
    return (
      <div className="empty-state" style={{ paddingTop: '4rem' }}>
        <Wallet size={64} />
        <h3>Connect wallet to view earnings</h3>
        <p style={{ marginBottom: '1rem' }}>
          Track your node earnings, pending rewards, and payout history
        </p>
        <WalletButton />
      </div>
    )
  }

  const isLoading = statsLoading || aggregateLoading
  const stats = aggregateStats
  const nodes = operatorStats?.nodes ?? []

  // Convert history items to include approximate timestamps
  // Assuming ~12 second block time, calculate timestamp from current block
  const rawHistory = earningsHistory?.history ?? []
  const history: EarningsHistoryWithTimestamp[] = rawHistory.map((item) => ({
    ...item,
    // Estimate timestamp based on block number (rough approximation)
    timestamp: Date.now() - (20000000 - item.blockNumber) * 12000,
  }))

  const totalPending = nodes.reduce(
    (sum, n) => sum + parseFloat(n.pendingRewards),
    0,
  )

  const filterHistoryByRange = (
    items: EarningsHistoryWithTimestamp[],
  ): EarningsHistoryWithTimestamp[] => {
    const now = Date.now()
    const ranges: Record<TimeRange, number> = {
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000,
      all: Number.POSITIVE_INFINITY,
    }
    const cutoff = now - ranges[timeRange]
    return items.filter((item) => item.timestamp > cutoff)
  }

  const filteredHistory = filterHistoryByRange(history)

  const calculateTotalForRange = (): number => {
    return filteredHistory
      .filter((item) => item.type === 'claim')
      .reduce((sum, item) => sum + parseFloat(item.amount ?? '0'), 0)
  }

  const rangeTotal = calculateTotalForRange()

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
          <h1 className="page-title">Earnings</h1>
          <p className="page-subtitle">
            Track your node earnings, pending rewards, and payout history
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => refetchStats()}
          >
            <RefreshCw size={16} /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleClaimAll}
            disabled={totalPending === 0 || claimingAll}
          >
            {claimingAll ? (
              'Claiming...'
            ) : (
              <>
                <DollarSign size={16} /> Claim All (${totalPending.toFixed(2)})
              </>
            )}
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        {isLoading ? (
          <>
            <SkeletonStatCard />
            <SkeletonStatCard />
            <SkeletonStatCard />
            <SkeletonStatCard />
          </>
        ) : (
          <>
            <div className="stat-card">
              <div className="stat-icon compute">
                <TrendingUp size={24} />
              </div>
              <div className="stat-content">
                <div className="stat-label">Lifetime Earnings</div>
                <div className="stat-value">
                  ${formatNumber(stats?.operator.lifetimeRewardsUSD ?? '0')}
                </div>
                <div className="stat-change positive">All time</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon storage">
                <DollarSign size={24} />
              </div>
              <div className="stat-content">
                <div className="stat-label">Pending Rewards</div>
                <div className="stat-value" style={{ color: 'var(--success)' }}>
                  ${stats?.earnings.totalPendingUSD ?? '0'}
                </div>
                <div className="stat-change positive">Claimable now</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon network">
                <Calendar size={24} />
              </div>
              <div className="stat-content">
                <div className="stat-label">Est. Monthly</div>
                <div className="stat-value">
                  ${stats?.earnings.estimatedMonthlyUSD ?? '0'}
                </div>
                <div className="stat-change">
                  ${stats?.earnings.estimatedDailyUSD ?? '0'}/day
                </div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon ai">
                <Server size={24} />
              </div>
              <div className="stat-content">
                <div className="stat-label">Active Nodes</div>
                <div className="stat-value">
                  {stats?.operator.nodesActive ?? 0}
                </div>
                <div className="stat-change">
                  {stats?.operator.networkSharePercent ?? '0'}% of network
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Main Content */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(300px, 1fr)',
          gap: '1.5rem',
        }}
      >
        {/* Earnings by Node */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Server size={18} /> Earnings by Node
            </h3>
          </div>
          {nodes.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem' }}>
              <Server size={48} />
              <h4>No nodes registered</h4>
              <p>Register a node to start earning rewards</p>
              <a
                href="/provider/node"
                className="btn btn-primary"
                style={{ marginTop: '1rem' }}
              >
                <Download size={16} /> Run a Node
              </a>
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Node ID</th>
                    <th>Status</th>
                    <th>Uptime</th>
                    <th>Lifetime</th>
                    <th>Pending</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map((node) => {
                    const hasPending = parseFloat(node.pendingRewards) > 0
                    return (
                      <tr key={node.nodeId}>
                        <td
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.85rem',
                          }}
                        >
                          {node.nodeId.slice(0, 10)}...
                        </td>
                        <td>
                          <span
                            className={`badge ${node.isActive ? 'badge-success' : 'badge-warning'}`}
                          >
                            {node.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td>
                          <span
                            style={{
                              color:
                                node.performance.uptimeScore >= 9900
                                  ? 'var(--success)'
                                  : node.performance.uptimeScore >= 9500
                                    ? 'var(--warning)'
                                    : 'var(--error)',
                            }}
                          >
                            {(node.performance.uptimeScore / 100).toFixed(1)}%
                          </span>
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>
                          ${formatNumber(node.totalRewardsClaimed)}
                        </td>
                        <td
                          style={{
                            fontFamily: 'var(--font-mono)',
                            color: hasPending ? 'var(--success)' : undefined,
                            fontWeight: hasPending ? 600 : undefined,
                          }}
                        >
                          ${formatNumber(node.pendingRewards)}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={async () => {
                              const result = await claimRewards
                                .mutateAsync(node.nodeId)
                                .catch(() => null)
                              if (result) {
                                showSuccess(
                                  'Claimed',
                                  `Claimed ${result.claimed} tokens`,
                                )
                                refetchStats()
                              } else {
                                showError('Failed', 'Could not claim rewards')
                              }
                            }}
                            disabled={!hasPending || claimRewards.isPending}
                          >
                            <DollarSign size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Sidebar */}
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
        >
          {/* Quick Stats */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                <Wallet size={18} /> Quick Stats
              </h3>
            </div>
            <div style={{ display: 'grid', gap: '1rem' }}>
              <QuickStat
                label="Total Staked"
                value={`$${formatNumber(stats?.operator.totalStakedUSD ?? '0')}`}
              />
              <QuickStat
                label="Network Min. Stake"
                value={`$${formatNumber(stats?.network.minStakeUSD ?? '0')}`}
              />
              <QuickStat
                label="Base Reward Rate"
                value={`$${formatNumber(stats?.network.baseRewardPerMonthUSD ?? '0')}/mo`}
              />
              <QuickStat
                label="Total Requests Served"
                value={formatNumber(
                  stats?.operator.totalRequestsServed?.toString() ?? '0',
                )}
              />
            </div>
          </div>

          {/* Projected Earnings */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                <TrendingUp size={18} /> Projected
              </h3>
            </div>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <ProjectionRow
                period="Today"
                amount={`$${stats?.earnings.estimatedDailyUSD ?? '0'}`}
              />
              <ProjectionRow
                period="This Week"
                amount={`$${(parseFloat(stats?.earnings.estimatedDailyUSD ?? '0') * 7).toFixed(2)}`}
              />
              <ProjectionRow
                period="This Month"
                amount={`$${stats?.earnings.estimatedMonthlyUSD ?? '0'}`}
                highlight
              />
              <ProjectionRow
                period="This Year"
                amount={`$${(parseFloat(stats?.earnings.estimatedMonthlyUSD ?? '0') * 12).toFixed(2)}`}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Earnings History */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div className="card-header">
          <h3 className="card-title">
            <Clock size={18} /> Payout History
          </h3>
          <div className="tabs" style={{ marginBottom: 0 }}>
            <button
              type="button"
              className={`tab ${timeRange === '7d' ? 'active' : ''}`}
              onClick={() => setTimeRange('7d')}
            >
              7D
            </button>
            <button
              type="button"
              className={`tab ${timeRange === '30d' ? 'active' : ''}`}
              onClick={() => setTimeRange('30d')}
            >
              30D
            </button>
            <button
              type="button"
              className={`tab ${timeRange === '90d' ? 'active' : ''}`}
              onClick={() => setTimeRange('90d')}
            >
              90D
            </button>
            <button
              type="button"
              className={`tab ${timeRange === 'all' ? 'active' : ''}`}
              onClick={() => setTimeRange('all')}
            >
              All
            </button>
          </div>
        </div>

        {filteredHistory.length > 0 && (
          <div
            style={{
              padding: '1rem',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
              marginBottom: '1rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ color: 'var(--text-secondary)' }}>
              Total for period
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                color: 'var(--success)',
                fontSize: '1.1rem',
              }}
            >
              ${rangeTotal.toFixed(2)}
            </span>
          </div>
        )}

        {historyLoading ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: '2rem',
            }}
          >
            <div className="spinner" />
          </div>
        ) : filteredHistory.length === 0 ? (
          <div className="empty-state" style={{ padding: '2rem' }}>
            <Clock size={48} />
            <h4>No payouts in this period</h4>
            <p>Your payout history will appear here</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Node</th>
                  <th>Amount</th>
                  <th>Date</th>
                  <th>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((item) => (
                  <tr key={`${item.nodeId}-${item.blockNumber}`}>
                    <td>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                        }}
                      >
                        {item.type === 'claim' ? (
                          <>
                            <ArrowUpRight
                              size={16}
                              style={{ color: 'var(--success)' }}
                            />
                            <span className="badge badge-success">Claim</span>
                          </>
                        ) : (
                          <>
                            <ArrowDownRight
                              size={16}
                              style={{ color: 'var(--info)' }}
                            />
                            <span className="badge badge-info">Registered</span>
                          </>
                        )}
                      </span>
                    </td>
                    <td
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.85rem',
                      }}
                    >
                      {item.nodeId.slice(0, 10)}...
                    </td>
                    <td
                      style={{
                        fontFamily: 'var(--font-mono)',
                        color:
                          item.type === 'claim' ? 'var(--success)' : undefined,
                        fontWeight: item.type === 'claim' ? 600 : undefined,
                      }}
                    >
                      {item.type === 'claim'
                        ? `+$${formatNumber(item.amount ?? '0')}`
                        : `$${formatNumber(item.stakedValueUSD ?? '0')} staked`}
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>
                      {new Date(item.timestamp).toLocaleDateString()}
                    </td>
                    <td>
                      <a
                        href={`https://etherscan.io/tx/${item.transactionHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: 'var(--accent)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.85rem',
                        }}
                      >
                        {item.transactionHash.slice(0, 10)}...
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function QuickStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '0.5rem 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
        {value}
      </span>
    </div>
  )
}

function ProjectionRow({
  period,
  amount,
  highlight,
}: {
  period: string
  amount: string
  highlight?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '0.75rem',
        background: highlight ? 'rgba(34, 197, 94, 0.1)' : 'var(--bg-tertiary)',
        borderRadius: 'var(--radius-md)',
        border: highlight ? '1px solid var(--success)' : undefined,
      }}
    >
      <span style={{ color: 'var(--text-secondary)' }}>{period}</span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 600,
          color: highlight ? 'var(--success)' : 'var(--text)',
        }}
      >
        {amount}
      </span>
    </div>
  )
}

function formatNumber(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (Number.isNaN(num)) return '0'

  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(2)}M`
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(2)}K`
  }
  return num.toFixed(2)
}
