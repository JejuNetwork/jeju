import { formatDuration, formatUsd } from '@jejunetwork/shared'
import { motion } from 'framer-motion'
import {
  Activity,
  ArrowUpRight,
  Bot,
  Clock,
  Cpu,
  DollarSign,
  HardDrive,
  PartyPopper,
  Rocket,
  Server,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react'
import { useAppStore } from '../context/AppContext'
import { formatEther } from '../utils'
import { EarningsChart } from './EarningsChart'

export function Dashboard() {
  const {
    hardware,
    services,
    bots,
    earnings,
    projectedEarnings,
    staking,
    isLoading,
  } = useAppStore()

  const runningServices = services.filter((s) => s.status.running)
  const runningBots = bots.filter((b) => b.status.running)
  const totalUptime = runningServices.reduce(
    (acc, s) => acc + s.status.uptime_seconds,
    0,
  )

  const hasEarnings = (earnings?.earnings_today_usd ?? 0) > 0

  const stats = [
    {
      label: "Today's Earnings",
      value: isLoading ? null : formatUsd(earnings?.earnings_today_usd ?? 0),
      change: '+12%',
      icon: <DollarSign size={20} />,
      color: 'text-jeju-400',
      bgColor: 'bg-jeju-500/10',
      highlight: true,
    },
    {
      label: 'Active Services',
      value: `${runningServices.length} / ${services.length}`,
      subtitle: runningServices.length > 0 ? 'Working for you' : 'Ready when you are',
      icon: <Server size={20} />,
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
    },
    {
      label: 'Trading Bots',
      value: `${runningBots.length} active`,
      subtitle: runningBots.length > 0 ? 'Finding opportunities' : 'Ready to trade',
      icon: <Bot size={20} />,
      color: 'text-purple-400',
      bgColor: 'bg-purple-500/10',
    },
    {
      label: 'Projected Monthly',
      value: isLoading ? null : formatUsd(projectedEarnings?.monthly_usd ?? 0),
      subtitle: 'Based on current activity',
      icon: <TrendingUp size={20} />,
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10',
    },
  ]

  return (
    <div className="space-y-6 lg:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            Dashboard
            {hasEarnings && <PartyPopper size={24} className="text-jeju-400 animate-float" />}
          </h1>
          <p className="text-volcanic-400 mt-1">
            {hasEarnings 
              ? 'Your node is earning rewards right now.'
              : 'Enable services to start earning.'}
          </p>
        </div>
        {runningServices.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-jeju-500/10 border border-jeju-500/20 rounded-xl">
            <div className="w-2 h-2 bg-jeju-500 rounded-full animate-pulse" />
            <span className="text-jeju-400 text-sm font-medium">Node Active</span>
          </div>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className={`stat-card ${stat.highlight ? 'ring-1 ring-jeju-500/30' : ''}`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-volcanic-400">{stat.label}</p>
                <p className="text-2xl sm:text-3xl font-bold mt-2 truncate">
                  {stat.value ?? (
                    <span className="inline-block w-20 h-8 bg-volcanic-700 rounded-lg animate-pulse" />
                  )}
                </p>
                {stat.change && (
                  <p className="text-sm text-jeju-400 mt-2 flex items-center gap-1">
                    <ArrowUpRight size={14} />
                    {stat.change} this week
                  </p>
                )}
                {stat.subtitle && !stat.change && (
                  <p className="text-xs text-volcanic-500 mt-2">{stat.subtitle}</p>
                )}
              </div>
              <div className={`p-3 rounded-xl ${stat.bgColor} ${stat.color} shrink-0`}>
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
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Sparkles size={18} className="text-jeju-400" />
                Earnings Over Time
              </h2>
              <p className="text-xs text-volcanic-500 mt-1">Your earnings history</p>
            </div>
            <div className="flex gap-1 bg-volcanic-800/50 p-1 rounded-lg">
              <button type="button" className="btn-ghost text-sm px-3 py-1.5">
                24h
              </button>
              <button type="button" className="btn-secondary text-sm px-3 py-1.5">
                7d
              </button>
              <button type="button" className="btn-ghost text-sm px-3 py-1.5">
                30d
              </button>
            </div>
          </div>
          <EarningsChart />
        </div>

        {/* Quick Stats */}
        <div className="space-y-4">
          {/* Hardware Status */}
          <div className="card">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Activity size={18} className="text-jeju-400" />
              System Status
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-volcanic-400 flex items-center gap-2">
                  <Cpu size={14} />
                  CPU
                </span>
                <span className="font-medium">
                  {hardware ? (
                    `${hardware.cpu.cores_physical} cores`
                  ) : (
                    <span className="inline-block w-12 h-4 bg-volcanic-700 rounded animate-pulse" />
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-volcanic-400 flex items-center gap-2">
                  <HardDrive size={14} />
                  Memory
                </span>
                <span className="font-medium">
                  {hardware ? (
                    `${(hardware.memory.total_mb / 1024).toFixed(0)} GB`
                  ) : (
                    <span className="inline-block w-10 h-4 bg-volcanic-700 rounded animate-pulse" />
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-volcanic-400 flex items-center gap-2">
                  <Zap size={14} />
                  GPUs
                </span>
                <span className="font-medium">
                  {hardware ? (
                    hardware.gpus.length > 0 ? (
                      <span className="text-jeju-400">{hardware.gpus.length} ready</span>
                    ) : 'None detected'
                  ) : (
                    <span className="inline-block w-14 h-4 bg-volcanic-700 rounded animate-pulse" />
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-volcanic-400 flex items-center gap-2">
                  <Clock size={14} />
                  Uptime
                </span>
                <span className="font-medium text-emerald-400">{formatDuration(totalUptime)}</span>
              </div>
            </div>
          </div>

          {/* Staking Summary */}
          <div className="card bg-gradient-to-br from-volcanic-900/60 to-jeju-950/20">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Rocket size={18} className="text-jeju-400" />
              Staking Summary
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-volcanic-400">Total Staked</span>
                <span className="font-bold">
                  {staking ? (
                    `${formatEther(staking.total_staked_wei ?? '0')} ETH`
                  ) : (
                    <span className="inline-block w-16 h-4 bg-volcanic-700 rounded animate-pulse" />
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-volcanic-400">Pending Rewards</span>
                <span className="font-bold text-jeju-400">
                  {staking ? (
                    `${formatEther(staking.pending_rewards_wei ?? '0')} ETH`
                  ) : (
                    <span className="inline-block w-16 h-4 bg-volcanic-700 rounded animate-pulse" />
                  )}
                </span>
              </div>
              {staking?.auto_claim_enabled && (
                <div className="flex items-center gap-2 text-xs text-jeju-400/80 bg-jeju-500/10 px-2 py-1.5 rounded-lg mt-2">
                  <Sparkles size={12} />
                  Auto-claim enabled
                </div>
              )}
            </div>
          </div>

          {/* Active Services */}
          <div className="card">
            <h3 className="font-semibold mb-4">Active Services</h3>
            {runningServices.length > 0 ? (
              <div className="space-y-2">
                {runningServices.slice(0, 4).map((service) => (
                  <div
                    key={service.metadata.id}
                    className="flex items-center justify-between py-2.5 px-3 bg-volcanic-800/30 rounded-lg"
                  >
                    <div className="flex items-center gap-2">
                      <span className="status-healthy" />
                      <span className="text-sm font-medium">{service.metadata.name}</span>
                    </div>
                    <span className="text-xs text-volcanic-400 bg-volcanic-800/50 px-2 py-1 rounded">
                      {formatDuration(service.status.uptime_seconds)}
                    </span>
                  </div>
                ))}
                {runningServices.length > 4 && (
                  <p className="text-xs text-volcanic-500 text-center pt-2">
                    +{runningServices.length - 4} more running
                  </p>
                )}
              </div>
            ) : (
              <div className="text-center py-6">
                <Server size={32} className="mx-auto text-volcanic-600 mb-3" />
                <p className="text-sm text-volcanic-500">No services running</p>
                <p className="text-xs text-volcanic-600 mt-1">Enable services to start earning</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Earnings Projections */}
      {projectedEarnings && (
        <div className="card-glow">
          <div className="flex items-center gap-2 mb-6">
            <div className="p-2 rounded-lg bg-jeju-500/10">
              <TrendingUp size={20} className="text-jeju-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Earnings Projections</h2>
              <p className="text-xs text-volcanic-500">Based on your current setup</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
            <div className="bg-volcanic-800/30 rounded-xl p-4">
              <p className="text-sm text-volcanic-400">Hourly</p>
              <p className="text-xl font-bold text-jeju-400 mt-1">
                {formatUsd(projectedEarnings.hourly_usd)}
              </p>
            </div>
            <div className="bg-volcanic-800/30 rounded-xl p-4">
              <p className="text-sm text-volcanic-400">Daily</p>
              <p className="text-xl font-bold mt-1">
                {formatUsd(projectedEarnings.daily_usd)}
              </p>
            </div>
            <div className="bg-volcanic-800/30 rounded-xl p-4">
              <p className="text-sm text-volcanic-400">Weekly</p>
              <p className="text-xl font-bold mt-1">
                {formatUsd(projectedEarnings.weekly_usd)}
              </p>
            </div>
            <div className="bg-gradient-to-br from-jeju-600/20 to-emerald-600/10 border border-jeju-500/20 rounded-xl p-4">
              <p className="text-sm text-jeju-400/80">Monthly</p>
              <p className="text-xl font-bold text-jeju-400 mt-1">
                {formatUsd(projectedEarnings.monthly_usd)}
              </p>
            </div>
            <div className="bg-volcanic-800/30 rounded-xl p-4">
              <p className="text-sm text-volcanic-400">Yearly</p>
              <p className="text-xl font-bold mt-1">
                {formatUsd(projectedEarnings.yearly_usd)}
              </p>
            </div>
          </div>
          <p className="text-xs text-volcanic-500 mt-4 flex items-center gap-1">
            <Sparkles size={12} className="text-volcanic-500" />
            Projections based on current configuration and network averages
          </p>
        </div>
      )}
    </div>
  )
}
