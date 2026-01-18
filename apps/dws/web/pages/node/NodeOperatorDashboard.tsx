import { WalletButton } from '@jejunetwork/ui'
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Award,
  Clock,
  Cpu,
  DollarSign,
  Globe,
  HardDrive,
  RefreshCw,
  Server,
  TrendingUp,
  Users,
  Wallet,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { SkeletonStatCard } from '../../components/Skeleton'
import { useConfirm, useToast } from '../../context/AppContext'
import {
  useClaimRewards,
  useDeregisterNode,
  useUpdateNodePerformance,
} from '../../hooks'
import {
  type EarningsHistoryItem,
  type NodeInfo,
  useAggregateStats,
  useEarningsHistory,
  useOperatorStats,
} from '../../hooks/useStaking'

export default function NodeOperatorDashboard() {
  const { isConnected, address } = useAccount()
  const { showSuccess, showError } = useToast()
  const confirm = useConfirm()
  const claimRewards = useClaimRewards()
  const deregisterNode = useDeregisterNode()
  const updatePerformance = useUpdateNodePerformance()
  const {
    data: operatorStats,
    isLoading: statsLoading,
    refetch: refetchStats,
  } = useOperatorStats()
  const { isLoading: aggregateLoading, data: stats } = useAggregateStats()
  const { data: earningsHistory } = useEarningsHistory()
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [claimingNode, setClaimingNode] = useState<string | null>(null)
  const [updatingNode, setUpdatingNode] = useState<string | null>(null)
  const [deregisteringNode, setDeregisteringNode] = useState<string | null>(
    null,
  )

  const handleClaimRewards = async (nodeId: string, nodeName: string) => {
    const confirmed = await confirm({
      title: 'Claim Rewards',
      message: `Claim all pending rewards for node ${nodeName}? This will transfer the rewards to your wallet.`,
      confirmText: 'Claim',
      cancelText: 'Cancel',
    })

    if (!confirmed) return

    setClaimingNode(nodeId)
    try {
      const result = await claimRewards.mutateAsync(nodeId)
      showSuccess(
        'Rewards claimed',
        `Successfully claimed ${result.claimed} tokens`,
      )
      refetchStats()
    } catch (error) {
      showError(
        'Claim failed',
        error instanceof Error ? error.message : 'Failed to claim rewards',
      )
    } finally {
      setClaimingNode(null)
    }
  }

  const handleClaimAllRewards = async () => {
    const nodes = operatorStats?.nodes ?? []
    const nodesWithRewards = nodes.filter(
      (n) => parseFloat(n.pendingRewards) > 0,
    )

    if (nodesWithRewards.length === 0) {
      showError('No rewards', 'No pending rewards to claim')
      return
    }

    const confirmed = await confirm({
      title: 'Claim All Rewards',
      message: `Claim rewards from ${nodesWithRewards.length} node(s)? This will transfer all pending rewards to your wallet.`,
      confirmText: 'Claim All',
      cancelText: 'Cancel',
    })

    if (!confirmed) return

    let successCount = 0
    let failCount = 0

    for (const node of nodesWithRewards) {
      try {
        await claimRewards.mutateAsync(node.nodeId)
        successCount++
      } catch {
        failCount++
      }
    }

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

  const handleDeregisterNode = async (nodeId: string, nodeName: string) => {
    const confirmed = await confirm({
      title: 'Deregister Node',
      message: `Are you sure you want to deregister node ${nodeName}? Your stake will be returned after a cooldown period.`,
      confirmText: 'Deregister',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (!confirmed) return

    setDeregisteringNode(nodeId)
    try {
      await deregisterNode.mutateAsync(nodeId)
      showSuccess('Node deregistered', `Node ${nodeName} has been deregistered`)
      refetchStats()
      setSelectedNode(null)
    } catch (error) {
      showError(
        'Deregistration failed',
        error instanceof Error ? error.message : 'Failed to deregister node',
      )
    } finally {
      setDeregisteringNode(null)
    }
  }

  const handleUpdatePerformance = async (nodeId: string, nodeName: string) => {
    setUpdatingNode(nodeId)
    try {
      await updatePerformance.mutateAsync(nodeId)
      showSuccess(
        'Performance updated',
        `Node ${nodeName} performance metrics refreshed`,
      )
      refetchStats()
    } catch (error) {
      showError(
        'Update failed',
        error instanceof Error ? error.message : 'Failed to update performance',
      )
    } finally {
      setUpdatingNode(null)
    }
  }

  if (!isConnected || !address) {
    return (
      <div className="empty-state" style={{ paddingTop: '4rem' }}>
        <Server size={64} />
        <h3>Connect wallet to view your nodes</h3>
        <p style={{ marginBottom: '1rem' }}>
          View your registered nodes, earnings, and performance
        </p>
        <WalletButton />
      </div>
    )
  }

  const isLoading = statsLoading || aggregateLoading
  const nodes = operatorStats?.nodes ?? []

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
          <h1 className="page-title">Node Operator Dashboard</h1>
          <p className="page-subtitle">
            Manage your nodes, track earnings, and claim rewards
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => refetchStats()}
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      {/* Stats Overview */}
      <div className="stats-grid">
        {isLoading ? (
          <>
            <SkeletonStatCard />
            <SkeletonStatCard />
            <SkeletonStatCard />
            <SkeletonStatCard />
          </>
        ) : (
          <>
            <StatCard
              icon={<Server size={24} />}
              iconClass="compute"
              label="Active Nodes"
              value={stats?.operator.nodesActive.toString() ?? '0'}
              change={`${stats?.operator.networkSharePercent ?? '0'}% of network`}
              changeType="neutral"
            />
            <StatCard
              icon={<DollarSign size={24} />}
              iconClass="storage"
              label="Total Staked"
              value={`$${formatNumber(stats?.operator.totalStakedUSD ?? '0')}`}
              change="USD value"
              changeType="neutral"
            />
            <StatCard
              icon={<TrendingUp size={24} />}
              iconClass="network"
              label="Est. Monthly"
              value={`$${stats?.earnings.estimatedMonthlyUSD ?? '0'}`}
              change={`$${stats?.earnings.estimatedDailyUSD ?? '0'}/day`}
              changeType="positive"
            />
            <StatCard
              icon={<Award size={24} />}
              iconClass="ai"
              label="Pending Rewards"
              value={`$${stats?.earnings.totalPendingUSD ?? '0'}`}
              change="Claimable now"
              changeType="positive"
            />
          </>
        )}
      </div>

      <div
        className="node-dashboard-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(300px, 1fr)',
          gap: '1.5rem',
          marginTop: '1.5rem',
        }}
      >
        {/* Nodes List */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <HardDrive size={18} /> Your Nodes
            </h3>
            <a href="/settings" className="btn btn-sm btn-primary">
              <Server size={14} /> Register Node
            </a>
          </div>

          {nodes.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem' }}>
              <Server size={48} />
              <h4>No nodes registered</h4>
              <p>Register a node to start earning rewards</p>
              <a
                href="/settings"
                className="btn btn-primary"
                style={{ marginTop: '1rem' }}
              >
                Register Your First Node
              </a>
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Node ID</th>
                    <th>Region</th>
                    <th>Status</th>
                    <th>Uptime</th>
                    <th>Staked</th>
                    <th>Pending</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map((node) => (
                    <NodeRow
                      key={node.nodeId}
                      node={node}
                      isSelected={selectedNode === node.nodeId}
                      isClaiming={claimingNode === node.nodeId}
                      onSelect={() =>
                        setSelectedNode(
                          selectedNode === node.nodeId ? null : node.nodeId,
                        )
                      }
                      onClaim={() =>
                        handleClaimRewards(
                          node.nodeId,
                          node.nodeId.slice(0, 10),
                        )
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Sidebar */}
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
        >
          {/* Earnings Summary */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                <Wallet size={18} /> Earnings
              </h3>
            </div>
            <div style={{ display: 'grid', gap: '1rem' }}>
              <EarningsRow
                label="Lifetime Earned"
                value={`$${formatNumber(stats?.operator.lifetimeRewardsUSD ?? '0')}`}
              />
              <EarningsRow
                label="Pending Rewards"
                value={`$${stats?.earnings.totalPendingUSD ?? '0'}`}
                highlight
              />
              <EarningsRow
                label="Est. Monthly"
                value={`$${stats?.earnings.estimatedMonthlyUSD ?? '0'}`}
              />
              <EarningsRow
                label="Est. Daily"
                value={`$${stats?.earnings.estimatedDailyUSD ?? '0'}`}
              />
              {nodes.length > 0 &&
                parseFloat(stats?.earnings.totalPendingUSD ?? '0') > 0 && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ marginTop: '0.5rem' }}
                    onClick={handleClaimAllRewards}
                    disabled={claimRewards.isPending}
                  >
                    {claimRewards.isPending ? (
                      'Claiming...'
                    ) : (
                      <>
                        <DollarSign size={16} /> Claim All Rewards
                      </>
                    )}
                  </button>
                )}
            </div>
          </div>

          {/* Performance Summary */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                <Activity size={18} /> Performance
              </h3>
            </div>
            <div style={{ display: 'grid', gap: '1rem' }}>
              <PerformanceMetric
                label="Avg. Uptime"
                value={`${stats?.operator.avgUptimePercent ?? '0'}%`}
                icon={<Clock size={16} />}
                status={
                  parseFloat(stats?.operator.avgUptimePercent ?? '0') >= 99
                    ? 'good'
                    : parseFloat(stats?.operator.avgUptimePercent ?? '0') >= 95
                      ? 'warning'
                      : 'bad'
                }
              />
              <PerformanceMetric
                label="Requests Served"
                value={formatNumber(
                  stats?.operator.totalRequestsServed?.toString() ?? '0',
                )}
                icon={<Zap size={16} />}
                status="neutral"
              />
              <PerformanceMetric
                label="Network Share"
                value={`${stats?.operator.networkSharePercent ?? '0'}%`}
                icon={<Globe size={16} />}
                status="neutral"
              />
            </div>
          </div>

          {/* Network Stats */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                <Users size={18} /> Network
              </h3>
            </div>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <NetworkStat
                label="Total Nodes"
                value={stats?.network.totalNodes.toString() ?? '0'}
              />
              <NetworkStat
                label="Total Staked"
                value={`$${formatNumber(stats?.network.totalStakedUSD ?? '0')}`}
              />
              <NetworkStat
                label="Min. Stake"
                value={`$${formatNumber(stats?.network.minStakeUSD ?? '0')}`}
              />
              <NetworkStat
                label="Base Reward"
                value={`$${formatNumber(stats?.network.baseRewardPerMonthUSD ?? '0')}/mo`}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Selected Node Details */}
      {selectedNode && (
        <NodeDetailsPanel
          node={nodes.find((n) => n.nodeId === selectedNode)}
          onClose={() => setSelectedNode(null)}
          onClaim={handleClaimRewards}
          onDeregister={handleDeregisterNode}
          onUpdatePerformance={handleUpdatePerformance}
          isClaiming={claimingNode === selectedNode}
          isDeregistering={deregisteringNode === selectedNode}
          isUpdating={updatingNode === selectedNode}
        />
      )}

      {/* Recent Activity */}
      {earningsHistory && earningsHistory.history.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <div className="card-header">
            <h3 className="card-title">
              <RefreshCw size={18} /> Recent Activity
            </h3>
          </div>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Node</th>
                  <th>Amount</th>
                  <th>Block</th>
                  <th>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {earningsHistory.history.slice(0, 10).map((item) => (
                  <ActivityRow
                    key={`${item.nodeId}-${item.blockNumber}`}
                    item={item}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// Helper Components

function StatCard({
  icon,
  iconClass,
  label,
  value,
  change,
  changeType,
}: {
  icon: React.ReactNode
  iconClass: string
  label: string
  value: string
  change: string
  changeType: 'positive' | 'negative' | 'neutral'
}) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${iconClass}`}>{icon}</div>
      <div className="stat-content">
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        <div className={`stat-change ${changeType}`}>{change}</div>
      </div>
    </div>
  )
}

function NodeRow({
  node,
  isSelected,
  isClaiming,
  onSelect,
  onClaim,
}: {
  node: NodeInfo
  isSelected: boolean
  isClaiming: boolean
  onSelect: () => void
  onClaim: () => void
}) {
  const hasPendingRewards = parseFloat(node.pendingRewards) > 0

  const handleRowClick = (e: React.MouseEvent) => {
    // Don't trigger row click when clicking buttons
    if ((e.target as HTMLElement).closest('button')) return
    onSelect()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }

  return (
    <tr
      style={{
        cursor: 'pointer',
        background: isSelected ? 'var(--bg-tertiary)' : undefined,
      }}
      onClick={handleRowClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      aria-selected={isSelected}
    >
      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
        {node.nodeId.slice(0, 10)}...
      </td>
      <td>{node.region}</td>
      <td>
        <span
          className={`badge ${node.isActive ? 'badge-success' : node.isSlashed ? 'badge-error' : 'badge-warning'}`}
        >
          {node.isActive ? 'Active' : node.isSlashed ? 'Slashed' : 'Inactive'}
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
      <td>${formatNumber(node.stakedValueUSD)}</td>
      <td style={{ color: 'var(--success)' }}>
        ${formatNumber(node.pendingRewards)}
      </td>
      <td>
        {hasPendingRewards ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={(e) => {
              e.stopPropagation()
              onClaim()
            }}
            disabled={isClaiming}
            title="Claim rewards"
          >
            {isClaiming ? '...' : <DollarSign size={14} />}
          </button>
        ) : (
          <ArrowUpRight
            size={16}
            style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
            onClick={onSelect}
          />
        )}
      </td>
    </tr>
  )
}

function EarningsRow({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
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
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 600,
          color: highlight ? 'var(--success)' : 'var(--text)',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function PerformanceMetric({
  label,
  value,
  icon,
  status,
}: {
  label: string
  value: string
  icon: React.ReactNode
  status: 'good' | 'warning' | 'bad' | 'neutral'
}) {
  const statusColors = {
    good: 'var(--success)',
    warning: 'var(--warning)',
    bad: 'var(--error)',
    neutral: 'var(--text-secondary)',
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.5rem 0',
      }}
    >
      <div style={{ color: statusColors[status] }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          {label}
        </div>
        <div
          style={{
            fontWeight: 600,
            color: statusColors[status],
          }}
        >
          {value}
        </div>
      </div>
    </div>
  )
}

function NetworkStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
        {value}
      </span>
    </div>
  )
}

function NodeDetailsPanel({
  node,
  onClose,
  onClaim,
  onDeregister,
  onUpdatePerformance,
  isClaiming,
  isDeregistering,
  isUpdating,
}: {
  node: NodeInfo | undefined
  onClose: () => void
  onClaim: (nodeId: string, nodeName: string) => void
  onDeregister: (nodeId: string, nodeName: string) => void
  onUpdatePerformance: (nodeId: string, nodeName: string) => void
  isClaiming: boolean
  isDeregistering: boolean
  isUpdating: boolean
}) {
  if (!node) return null

  const hasPendingRewards = parseFloat(node.pendingRewards) > 0
  const nodeName = node.nodeId.slice(0, 10)

  return (
    <div
      className="card"
      style={{
        marginTop: '1.5rem',
        border: '1px solid var(--accent)',
        position: 'relative',
      }}
    >
      <button
        type="button"
        onClick={onClose}
        style={{
          position: 'absolute',
          top: '1rem',
          right: '1rem',
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: '1.25rem',
        }}
      >
        ×
      </button>

      <div className="card-header">
        <h3 className="card-title">
          <Cpu size={18} /> Node Details
        </h3>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '1.5rem',
        }}
      >
        <div>
          <h4 style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
            General
          </h4>
          <DetailRow label="Node ID" value={node.nodeId} mono />
          <DetailRow label="Region" value={node.region} />
          <DetailRow
            label="Status"
            value={
              node.isActive ? 'Active' : node.isSlashed ? 'Slashed' : 'Inactive'
            }
          />
          <DetailRow label="RPC URL" value={node.rpcUrl} mono small />
          <DetailRow
            label="Registered"
            value={new Date(node.registrationTime * 1000).toLocaleDateString()}
          />
        </div>

        <div>
          <h4 style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
            Staking
          </h4>
          <DetailRow
            label="Staked Amount"
            value={`${node.stakedAmount} tokens`}
          />
          <DetailRow
            label="Staked Value"
            value={`$${formatNumber(node.stakedValueUSD)}`}
          />
          <DetailRow label="Reward Token" value={node.rewardToken} mono small />
          <DetailRow
            label="Last Claim"
            value={new Date(node.lastClaimTime * 1000).toLocaleDateString()}
          />
          <DetailRow
            label="Total Claimed"
            value={`$${formatNumber(node.totalRewardsClaimed)}`}
          />
        </div>

        <div>
          <h4 style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
            Performance
          </h4>
          <DetailRow
            label="Uptime Score"
            value={`${(node.performance.uptimeScore / 100).toFixed(2)}%`}
          />
          <DetailRow
            label="Requests Served"
            value={formatNumber(node.performance.requestsServed.toString())}
          />
          <DetailRow
            label="Avg Response Time"
            value={`${node.performance.avgResponseTime}ms`}
          />
          <DetailRow
            label="Last Update"
            value={new Date(
              node.performance.lastUpdateTime * 1000,
            ).toLocaleString()}
          />
          <DetailRow
            label="Pending Rewards"
            value={`$${formatNumber(node.pendingRewards)}`}
            highlight
          />
        </div>
      </div>

      <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem' }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onClaim(node.nodeId, nodeName)}
          disabled={!hasPendingRewards || isClaiming}
        >
          {isClaiming ? (
            'Claiming...'
          ) : (
            <>
              <DollarSign size={16} /> Claim Rewards
            </>
          )}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onUpdatePerformance(node.nodeId, nodeName)}
          disabled={isUpdating}
        >
          {isUpdating ? (
            'Updating...'
          ) : (
            <>
              <RefreshCw size={16} /> Update Performance
            </>
          )}
        </button>
        {!node.isSlashed && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ color: 'var(--warning)' }}
            onClick={() => onDeregister(node.nodeId, nodeName)}
            disabled={isDeregistering}
          >
            {isDeregistering ? (
              'Deregistering...'
            ) : (
              <>
                <AlertTriangle size={16} /> Deregister Node
              </>
            )}
          </button>
        )}
      </div>
    </div>
  )
}

function DetailRow({
  label,
  value,
  mono,
  small,
  highlight,
}: {
  label: string
  value: string
  mono?: boolean
  small?: boolean
  highlight?: boolean
}) {
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          fontSize: small ? '0.8rem' : '0.9rem',
          color: highlight ? 'var(--success)' : 'var(--text)',
          fontWeight: highlight ? 600 : undefined,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </div>
    </div>
  )
}

function ActivityRow({ item }: { item: EarningsHistoryItem }) {
  return (
    <tr>
      <td>
        <span
          className={`badge ${item.type === 'claim' ? 'badge-success' : 'badge-info'}`}
        >
          {item.type === 'claim' ? 'Reward Claim' : 'Node Registered'}
        </span>
      </td>
      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
        {item.nodeId.slice(0, 10)}...
      </td>
      <td>
        {item.type === 'claim'
          ? `$${formatNumber(item.amount ?? '0')}`
          : `$${formatNumber(item.stakedValueUSD ?? '0')} staked`}
      </td>
      <td style={{ fontFamily: 'var(--font-mono)' }}>{item.blockNumber}</td>
      <td>
        <a
          href={`https://etherscan.io/tx/${item.transactionHash}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--accent)' }}
        >
          {item.transactionHash.slice(0, 10)}...
        </a>
      </td>
    </tr>
  )
}

// Utility functions

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
