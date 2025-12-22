import { motion } from 'framer-motion'
import {
  Activity,
  Bot,
  Clock,
  Cpu,
  DollarSign,
  HardDrive,
  Server,
  TrendingUp,
  Zap,
} from 'lucide-react'
import { useAppStore } from '../store'
import { formatDuration, formatEther, formatUsd } from '../utils'
import { EarningsChart } from './EarningsChart'

export function Dashboard() {
  const { hardware, services, bots, earnings, projectedEarnings, staking } =
    useAppStore()

  const runningServices = services.filter((s) => s.status.running)
  const runningBots = bots.filter((b) => b.status.running)
  const totalUptime = runningServices.reduce(
    (acc, s) => acc + s.status.uptime_seconds,
    0,
  )

  const stats = [
    {
      label: "Today's Earnings",
      value: formatUsd(earnings?.earnings_today_usd || 0),
      change: '+12%',
      icon: <DollarSign size={20} />,
      color: 'text-jeju-400',
    },
    {
      label: 'Active Services',
      value: `${runningServices.length} / ${services.length}`,
      icon: <Server size={20} />,
      color: 'text-blue-400',
    },
    {
      label: 'Trading Bots',
      value: `${runningBots.length} active`,
      icon: <Bot size={20} />,
      color: 'text-purple-400',
    },
    {
      label: 'Projected Monthly',
      value: formatUsd(projectedEarnings?.monthly_usd || 0),
      icon: <TrendingUp size={20} />,
      color: 'text-emerald-400',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-volcanic-400 mt-1">
          Overview of your Network Node performance
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="card"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-volcanic-400">{stat.label}</p>
                <p className="text-2xl font-bold mt-1">{stat.value}</p>
                {stat.change && (
                  <p className="text-sm text-jeju-400 mt-1">{stat.change}</p>
                )}
              </div>
              <div
                className={`p-2 rounded-lg bg-volcanic-800/50 ${stat.color}`}
              >
                {stat.icon}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Earnings Chart */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Earnings Over Time</h2>
            <div className="flex gap-2">
              <button className="btn-ghost text-sm">24h</button>
              <button className="btn-secondary text-sm">7d</button>
              <button className="btn-ghost text-sm">30d</button>
            </div>
          </div>
          <EarningsChart />
        </div>

        {/* Quick Stats */}
        <div className="space-y-4">
          {/* Hardware Status */}
          <div className="card">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Activity size={18} className="text-jeju-400" />
              System Status
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-volcanic-400 flex items-center gap-2">
                  <Cpu size={14} />
                  CPU
                </span>
                <span>{hardware?.cpu.cores_physical || 0} cores</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-volcanic-400 flex items-center gap-2">
                  <HardDrive size={14} />
                  Memory
                </span>
                <span>
                  {((hardware?.memory.total_mb || 0) / 1024).toFixed(0)} GB
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-volcanic-400 flex items-center gap-2">
                  <Zap size={14} />
                  GPUs
                </span>
                <span>{hardware?.gpus.length || 0} detected</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-volcanic-400 flex items-center gap-2">
                  <Clock size={14} />
                  Uptime
                </span>
                <span>{formatDuration(totalUptime)}</span>
              </div>
            </div>
          </div>

          {/* Staking Summary */}
          <div className="card">
            <h3 className="font-semibold mb-3">Staking Summary</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-volcanic-400">Total Staked</span>
                <span className="font-medium">
                  {formatEther(staking?.total_staked_wei || '0')} ETH
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-volcanic-400">Pending Rewards</span>
                <span className="font-medium text-jeju-400">
                  {formatEther(staking?.pending_rewards_wei || '0')} ETH
                </span>
              </div>
              {staking?.auto_claim_enabled && (
                <div className="text-xs text-volcanic-500 mt-2">
                  Auto-claim enabled
                </div>
              )}
            </div>
          </div>

          {/* Active Services */}
          <div className="card">
            <h3 className="font-semibold mb-3">Active Services</h3>
            {runningServices.length > 0 ? (
              <div className="space-y-2">
                {runningServices.slice(0, 4).map((service) => (
                  <div
                    key={service.metadata.id}
                    className="flex items-center justify-between py-2 border-b border-volcanic-800 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className="status-healthy" />
                      <span className="text-sm">{service.metadata.name}</span>
                    </div>
                    <span className="text-xs text-volcanic-400">
                      {formatDuration(service.status.uptime_seconds)}
                    </span>
                  </div>
                ))}
                {runningServices.length > 4 && (
                  <p className="text-xs text-volcanic-500 text-center pt-2">
                    +{runningServices.length - 4} more
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-volcanic-500 text-center py-4">
                No services running
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Earnings Projections */}
      {projectedEarnings && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Earnings Projections</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <p className="text-sm text-volcanic-400">Hourly</p>
              <p className="text-xl font-bold text-jeju-400">
                {formatUsd(projectedEarnings.hourly_usd)}
              </p>
            </div>
            <div>
              <p className="text-sm text-volcanic-400">Daily</p>
              <p className="text-xl font-bold">
                {formatUsd(projectedEarnings.daily_usd)}
              </p>
            </div>
            <div>
              <p className="text-sm text-volcanic-400">Weekly</p>
              <p className="text-xl font-bold">
                {formatUsd(projectedEarnings.weekly_usd)}
              </p>
            </div>
            <div>
              <p className="text-sm text-volcanic-400">Monthly</p>
              <p className="text-xl font-bold text-jeju-400">
                {formatUsd(projectedEarnings.monthly_usd)}
              </p>
            </div>
            <div>
              <p className="text-sm text-volcanic-400">Yearly</p>
              <p className="text-xl font-bold">
                {formatUsd(projectedEarnings.yearly_usd)}
              </p>
            </div>
          </div>
          <p className="text-xs text-volcanic-500 mt-4">
            * Projections based on current configuration and network averages
          </p>
        </div>
      )}
    </div>
  )
}
