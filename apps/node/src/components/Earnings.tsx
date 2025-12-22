import clsx from 'clsx'
import { ArrowUpRight, Bot, Download, Server, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { useAppStore } from '../store'
import { formatEther, formatUsd } from '../utils'
import { EarningsChart } from './EarningsChart'

type TimeRange = '24h' | '7d' | '30d' | 'all'

export function Earnings() {
  const { earnings, projectedEarnings, services, bots } = useAppStore()
  const [timeRange, setTimeRange] = useState<TimeRange>('7d')

  const totalEarningsUsd = earnings?.total_earnings_usd || 0
  const todayEarningsUsd = earnings?.earnings_today_usd || 0
  const weekEarningsUsd = earnings?.earnings_this_week_usd || 0
  const monthEarningsUsd = earnings?.earnings_this_month_usd || 0

  const timeRangeOptions: { value: TimeRange; label: string }[] = [
    { value: '24h', label: '24 Hours' },
    { value: '7d', label: '7 Days' },
    { value: '30d', label: '30 Days' },
    { value: 'all', label: 'All Time' },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Earnings</h1>
          <p className="text-volcanic-400 mt-1">
            Track your node earnings and performance
          </p>
        </div>

        <button className="btn-secondary flex items-center gap-2">
          <Download size={16} />
          Export
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card">
          <div className="flex items-center justify-between">
            <p className="text-sm text-volcanic-400">Today</p>
            <div className="flex items-center text-jeju-400 text-sm">
              <ArrowUpRight size={14} />
              +12%
            </div>
          </div>
          <p className="text-2xl font-bold mt-2">
            {formatUsd(todayEarningsUsd)}
          </p>
          <p className="text-xs text-volcanic-500 mt-1">
            {formatEther(earnings?.earnings_today_wei || '0')} ETH
          </p>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <p className="text-sm text-volcanic-400">This Week</p>
            <div className="flex items-center text-jeju-400 text-sm">
              <ArrowUpRight size={14} />
              +8%
            </div>
          </div>
          <p className="text-2xl font-bold mt-2">
            {formatUsd(weekEarningsUsd)}
          </p>
          <p className="text-xs text-volcanic-500 mt-1">
            {formatEther(earnings?.earnings_this_week_wei || '0')} ETH
          </p>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <p className="text-sm text-volcanic-400">This Month</p>
          </div>
          <p className="text-2xl font-bold mt-2">
            {formatUsd(monthEarningsUsd)}
          </p>
          <p className="text-xs text-volcanic-500 mt-1">
            {formatEther(earnings?.earnings_this_month_wei || '0')} ETH
          </p>
        </div>

        <div className="card bg-gradient-to-br from-jeju-600/20 to-jeju-700/10 border-jeju-500/30">
          <p className="text-sm text-jeju-300">Total Earnings</p>
          <p className="text-2xl font-bold mt-2 text-jeju-400">
            {formatUsd(totalEarningsUsd)}
          </p>
          <p className="text-xs text-jeju-400/70 mt-1">
            {formatEther(earnings?.total_earnings_wei || '0')} ETH
          </p>
        </div>
      </div>

      {/* Chart Section */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Earnings Over Time</h2>
          <div className="flex gap-1 bg-volcanic-800 rounded-lg p-1">
            {timeRangeOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setTimeRange(option.value)}
                className={clsx(
                  'px-3 py-1.5 text-sm rounded-md transition-all',
                  timeRange === option.value
                    ? 'bg-volcanic-700 text-white'
                    : 'text-volcanic-400 hover:text-volcanic-200',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="h-80">
          <EarningsChart />
        </div>
      </div>

      {/* Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Service */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Server size={18} className="text-volcanic-400" />
            Earnings by Service
          </h2>

          <div className="space-y-3">
            {services
              .filter((s) => s.status.running)
              .map((service) => {
                const serviceEarnings = earnings?.earnings_by_service.find(
                  (e) => e.service_id === service.metadata.id,
                )

                return (
                  <div
                    key={service.metadata.id}
                    className="flex items-center justify-between py-2 border-b border-volcanic-800 last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <span className="status-healthy" />
                      <span>{service.metadata.name}</span>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">
                        {formatUsd(serviceEarnings?.today_usd || 0)}
                      </p>
                      <p className="text-xs text-volcanic-500">today</p>
                    </div>
                  </div>
                )
              })}

            {services.filter((s) => s.status.running).length === 0 && (
              <p className="text-center text-volcanic-500 py-4">
                No active services
              </p>
            )}
          </div>
        </div>

        {/* By Bot */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Bot size={18} className="text-volcanic-400" />
            Bot Profits
          </h2>

          <div className="space-y-3">
            {bots
              .filter((b) => b.status.running)
              .map((bot) => {
                const botEarnings = earnings?.earnings_by_bot.find(
                  (e) => e.bot_id === bot.metadata.id,
                )

                return (
                  <div
                    key={bot.metadata.id}
                    className="flex items-center justify-between py-2 border-b border-volcanic-800 last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <span className="status-healthy" />
                      <span>{bot.metadata.name}</span>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-jeju-400">
                        {formatEther(botEarnings?.net_profit_wei || '0')} ETH
                      </p>
                      <p className="text-xs text-purple-400">
                        {formatEther(botEarnings?.treasury_share_wei || '0')} to
                        treasury
                      </p>
                    </div>
                  </div>
                )
              })}

            {bots.filter((b) => b.status.running).length === 0 && (
              <p className="text-center text-volcanic-500 py-4">
                No active bots
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Projections */}
      {projectedEarnings && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <TrendingUp size={18} className="text-volcanic-400" />
            Earnings Projections
          </h2>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
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

          <div className="bg-volcanic-800/50 rounded-lg p-4">
            <p className="text-sm text-volcanic-400 mb-2">Assumptions:</p>
            <ul className="text-xs text-volcanic-500 space-y-1">
              {projectedEarnings.assumptions.map((assumption, i) => (
                <li key={i}>• {assumption}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
