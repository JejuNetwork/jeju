'use client'

import { useState } from 'react'
import { useAccount } from 'wagmi'
import { type Address } from 'viem'
import {
  useTFMMPools,
  useTFMMPoolState,
  useTFMMUserBalance,
  formatWeight,
  type TFMMPool,
} from '@/hooks/tfmm/useTFMMPools'
import {
  useTFMMStrategies,
  useStrategyPerformance,
  formatStrategyParam,
  type StrategyType,
  STRATEGY_CONFIGS,
} from '@/hooks/tfmm/useTFMMStrategies'
import {
  useTFMMOracles,
  formatPrice,
  formatDeviation,
  getOracleTypeIcon,
  getOracleTypeName,
  getOracleTypeColor,
  type OracleConfig,
} from '@/hooks/tfmm/useTFMMOracles'
import {
  useTFMMGovernance,
  formatFee,
  formatInterval,
} from '@/hooks/tfmm/useTFMMGovernance'

type TabType = 'pools' | 'strategies' | 'oracles' | 'governance'

export default function TFMMPage() {
  const { isConnected, address } = useAccount()
  const [activeTab, setActiveTab] = useState<TabType>('pools')
  const [selectedPool, setSelectedPool] = useState<Address | null>(null)
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyType>('momentum')

  const { pools, isLoading: poolsLoading } = useTFMMPools()
  const { strategies, isLoading: strategiesLoading } = useTFMMStrategies(null)
  const { oracles, isLoading: oraclesLoading } = useTFMMOracles(null)
  const { isGovernor } = useTFMMGovernance(null)
  const strategyPerformance = useStrategyPerformance(selectedStrategy)

  const tabs: { id: TabType; label: string; icon: string }[] = [
    { id: 'pools', label: 'Pools', icon: '💧' },
    { id: 'strategies', label: 'Strategies', icon: '🎯' },
    { id: 'oracles', label: 'Oracles', icon: '🔮' },
    { id: 'governance', label: 'Governance', icon: '⚙️' },
  ]

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          📈 TFMM Management
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Temporal Function Market Maker - Dynamic weight rebalancing powered by on-chain strategies
        </p>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard title="Total TVL" value="$4.19M" icon="💰" />
        <StatCard title="Active Pools" value="3" icon="🏊" />
        <StatCard title="24h Volume" value="$1.55M" icon="📊" />
        <StatCard title="Avg APY" value="12.0%" icon="📈" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-8 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-3 rounded-xl font-semibold whitespace-nowrap transition-all flex items-center gap-2 ${
              activeTab === tab.id
                ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white'
                : 'btn-secondary'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'pools' && (
        <PoolsTab
          pools={pools}
          selectedPool={selectedPool}
          onSelectPool={setSelectedPool}
          isLoading={poolsLoading}
        />
      )}

      {activeTab === 'strategies' && (
        <StrategiesTab
          strategies={strategies}
          selectedStrategy={selectedStrategy}
          onSelectStrategy={setSelectedStrategy}
          performance={strategyPerformance}
          isLoading={strategiesLoading}
        />
      )}

      {activeTab === 'oracles' && (
        <OraclesTab oracles={oracles} isLoading={oraclesLoading} />
      )}

      {activeTab === 'governance' && (
        <GovernanceTab isGovernor={isGovernor} isConnected={isConnected} />
      )}
    </div>
  )
}

function StatCard({ title, value, icon }: { title: string; value: string; icon: string }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">{icon}</span>
        <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          {title}
        </span>
      </div>
      <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
        {value}
      </div>
    </div>
  )
}

function PoolsTab({
  pools,
  selectedPool,
  onSelectPool,
  isLoading,
}: {
  pools: TFMMPool[]
  selectedPool: Address | null
  onSelectPool: (pool: Address | null) => void
  isLoading: boolean
}) {
  if (isLoading) {
    return <div className="text-center py-12" style={{ color: 'var(--text-tertiary)' }}>Loading pools...</div>
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {pools.map((pool) => (
        <div
          key={pool.address}
          onClick={() => onSelectPool(pool.address)}
          className={`card p-5 cursor-pointer transition-all hover:scale-[1.02] ${
            selectedPool === pool.address ? 'ring-2 ring-purple-500' : ''
          }`}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
              {pool.name}
            </h3>
            <span className="badge-success text-xs">{pool.strategy}</span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-sm mb-4">
            <div>
              <div style={{ color: 'var(--text-tertiary)' }}>TVL</div>
              <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                {pool.tvl}
              </div>
            </div>
            <div>
              <div style={{ color: 'var(--text-tertiary)' }}>APY</div>
              <div className="font-semibold text-green-400">{pool.apy}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-tertiary)' }}>24h Vol</div>
              <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                {pool.volume24h}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button className="btn-primary flex-1 py-2 text-sm">Add Liquidity</button>
            <button className="btn-secondary flex-1 py-2 text-sm">Details</button>
          </div>
        </div>
      ))}

      {pools.length === 0 && (
        <div className="col-span-full text-center py-16">
          <div className="text-6xl mb-4">🏊</div>
          <h3 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            No TFMM Pools Yet
          </h3>
          <p style={{ color: 'var(--text-secondary)' }}>Create the first TFMM pool to get started</p>
        </div>
      )}
    </div>
  )
}

function StrategiesTab({
  strategies,
  selectedStrategy,
  onSelectStrategy,
  performance,
  isLoading,
}: {
  strategies: { type: StrategyType; name: string; description: string; lookbackPeriod: number; updateInterval: number; maxWeightChange: number; enabled: boolean }[]
  selectedStrategy: StrategyType
  onSelectStrategy: (strategy: StrategyType) => void
  performance: { totalReturn: number; sharpeRatio: number; maxDrawdown: number; winRate: number; rebalanceCount: number }
  isLoading: boolean
}) {
  if (isLoading) {
    return <div className="text-center py-12" style={{ color: 'var(--text-tertiary)' }}>Loading strategies...</div>
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Strategy Selection */}
      <div className="space-y-4">
        <h3 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Available Strategies
        </h3>
        {strategies.map((strategy) => (
          <div
            key={strategy.type}
            onClick={() => onSelectStrategy(strategy.type)}
            className={`card p-4 cursor-pointer transition-all ${
              selectedStrategy === strategy.type
                ? 'ring-2 ring-purple-500 bg-purple-500/10'
                : 'hover:bg-[var(--bg-secondary)]'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                {strategy.name}
              </h4>
              <span
                className={`px-2 py-1 rounded text-xs ${
                  strategy.enabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                }`}
              >
                {strategy.enabled ? 'Active' : 'Inactive'}
              </span>
            </div>
            <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
              {strategy.description}
            </p>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="p-2 rounded" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <div style={{ color: 'var(--text-tertiary)' }}>Lookback</div>
                <div className="font-semibold">{formatStrategyParam(strategy.lookbackPeriod, 'days')}</div>
              </div>
              <div className="p-2 rounded" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <div style={{ color: 'var(--text-tertiary)' }}>Interval</div>
                <div className="font-semibold">{formatStrategyParam(strategy.updateInterval, 'time')}</div>
              </div>
              <div className="p-2 rounded" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <div style={{ color: 'var(--text-tertiary)' }}>Max Δ</div>
                <div className="font-semibold">{formatStrategyParam(strategy.maxWeightChange, 'bps')}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Strategy Performance */}
      <div className="card p-6">
        <h3 className="text-xl font-semibold mb-6" style={{ color: 'var(--text-primary)' }}>
          {STRATEGY_CONFIGS[selectedStrategy].name} Performance
        </h3>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <MetricCard label="Total Return" value={`${performance.totalReturn}%`} positive={performance.totalReturn > 0} />
          <MetricCard label="Sharpe Ratio" value={performance.sharpeRatio.toFixed(2)} positive={performance.sharpeRatio > 1} />
          <MetricCard label="Max Drawdown" value={`${performance.maxDrawdown}%`} positive={false} isNegativeGood />
          <MetricCard label="Win Rate" value={`${performance.winRate}%`} positive={performance.winRate > 50} />
        </div>

        <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <div className="flex justify-between items-center">
            <span style={{ color: 'var(--text-tertiary)' }}>Total Rebalances</span>
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              {performance.rebalanceCount}
            </span>
          </div>
        </div>

        <div className="mt-6 p-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10">
          <div className="flex items-start gap-3">
            <span className="text-xl">⚠️</span>
            <div className="text-sm">
              <p className="font-semibold text-yellow-400 mb-1">Backtested Performance</p>
              <p style={{ color: 'var(--text-secondary)' }}>
                Past performance does not guarantee future results. Strategies are tested using historical data.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MetricCard({
  label,
  value,
  positive,
  isNegativeGood = false,
}: {
  label: string
  value: string
  positive: boolean
  isNegativeGood?: boolean
}) {
  const colorClass = isNegativeGood
    ? positive
      ? 'text-red-400'
      : 'text-green-400'
    : positive
    ? 'text-green-400'
    : 'text-red-400'

  return (
    <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      <div className="text-sm mb-1" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </div>
      <div className={`text-xl font-bold ${colorClass}`}>{value}</div>
    </div>
  )
}

function OraclesTab({ oracles, isLoading }: { oracles: OracleConfig[]; isLoading: boolean }) {
  if (isLoading) {
    return <div className="text-center py-12" style={{ color: 'var(--text-tertiary)' }}>Loading oracles...</div>
  }

  return (
    <div className="space-y-6">
      {/* Oracle Priority */}
      <div className="card p-6">
        <h3 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Oracle Priority Chain
        </h3>
        <div className="flex items-center gap-4">
          <div className="flex-1 p-4 rounded-xl bg-purple-500/20 border border-purple-500/30 text-center">
            <div className="text-2xl mb-2">🔮</div>
            <div className="font-semibold text-purple-400">Pyth Network</div>
            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Primary (Permissionless)
            </div>
          </div>
          <div className="text-2xl" style={{ color: 'var(--text-tertiary)' }}>
            →
          </div>
          <div className="flex-1 p-4 rounded-xl bg-blue-500/20 border border-blue-500/30 text-center">
            <div className="text-2xl mb-2">🔗</div>
            <div className="font-semibold text-blue-400">Chainlink</div>
            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Secondary
            </div>
          </div>
          <div className="text-2xl" style={{ color: 'var(--text-tertiary)' }}>
            →
          </div>
          <div className="flex-1 p-4 rounded-xl bg-orange-500/20 border border-orange-500/30 text-center">
            <div className="text-2xl mb-2">📊</div>
            <div className="font-semibold text-orange-400">Uniswap TWAP</div>
            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Fallback (On-chain)
            </div>
          </div>
        </div>
      </div>

      {/* Oracle Status */}
      <div className="card p-6">
        <h3 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Price Feeds
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm" style={{ color: 'var(--text-tertiary)' }}>
                <th className="pb-4">Asset</th>
                <th className="pb-4">Source</th>
                <th className="pb-4">Price</th>
                <th className="pb-4">Heartbeat</th>
                <th className="pb-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {oracles.map((oracle) => (
                <tr key={oracle.token} className="border-t border-[var(--border)]">
                  <td className="py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-r from-purple-500 to-blue-500" />
                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {oracle.symbol}
                      </span>
                    </div>
                  </td>
                  <td className="py-4">
                    <div className="flex items-center gap-2">
                      <span>{getOracleTypeIcon(oracle.oracleType)}</span>
                      <span className={getOracleTypeColor(oracle.oracleType)}>
                        {getOracleTypeName(oracle.oracleType)}
                      </span>
                    </div>
                  </td>
                  <td className="py-4 font-mono" style={{ color: 'var(--text-primary)' }}>
                    {formatPrice(oracle.price)}
                  </td>
                  <td className="py-4" style={{ color: 'var(--text-secondary)' }}>
                    {formatInterval(oracle.heartbeat)}
                  </td>
                  <td className="py-4">
                    {oracle.isStale ? (
                      <span className="px-2 py-1 rounded text-xs bg-red-500/20 text-red-400">Stale</span>
                    ) : oracle.active ? (
                      <span className="px-2 py-1 rounded text-xs bg-green-500/20 text-green-400">Active</span>
                    ) : (
                      <span className="px-2 py-1 rounded text-xs bg-gray-500/20 text-gray-400">Inactive</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function GovernanceTab({ isGovernor, isConnected }: { isGovernor: boolean; isConnected: boolean }) {
  const [swapFee, setSwapFee] = useState('30')
  const [protocolFee, setProtocolFee] = useState('10')
  const [maxWeightChange, setMaxWeightChange] = useState('250')
  const [minUpdateInterval, setMinUpdateInterval] = useState('3600')

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Access Control */}
      <div className="card p-6">
        <h3 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Access Control
        </h3>
        {!isConnected ? (
          <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-center">
            <span className="text-yellow-400">Connect wallet to view governance status</span>
          </div>
        ) : isGovernor ? (
          <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/30">
            <div className="flex items-center gap-3">
              <span className="text-2xl">✅</span>
              <div>
                <div className="font-semibold text-green-400">Governor Access</div>
                <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  You can modify pool parameters and fees
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-gray-500/10 border border-gray-500/30">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🔒</span>
              <div>
                <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  View Only
                </div>
                <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Contact governance for parameter changes
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between p-3 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>CEO/Council</span>
            <span className="font-mono text-sm" style={{ color: 'var(--text-primary)' }}>
              Can set fees & pause
            </span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Governor</span>
            <span className="font-mono text-sm" style={{ color: 'var(--text-primary)' }}>
              Can set guard rails
            </span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Strategy Keeper</span>
            <span className="font-mono text-sm" style={{ color: 'var(--text-primary)' }}>
              Can trigger rebalances
            </span>
          </div>
        </div>
      </div>

      {/* Fee Configuration */}
      <div className="card p-6">
        <h3 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Fee Configuration
        </h3>
        <div className="space-y-4">
          <div>
            <label className="text-sm mb-2 block" style={{ color: 'var(--text-secondary)' }}>
              Swap Fee (bps)
            </label>
            <input
              type="number"
              value={swapFee}
              onChange={(e) => setSwapFee(e.target.value)}
              disabled={!isGovernor}
              className="input"
            />
            <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Current: {formatFee(Number(swapFee))}
            </div>
          </div>

          <div>
            <label className="text-sm mb-2 block" style={{ color: 'var(--text-secondary)' }}>
              Protocol Fee (bps)
            </label>
            <input
              type="number"
              value={protocolFee}
              onChange={(e) => setProtocolFee(e.target.value)}
              disabled={!isGovernor}
              className="input"
            />
          </div>

          <div>
            <label className="text-sm mb-2 block" style={{ color: 'var(--text-secondary)' }}>
              Max Weight Change (bps)
            </label>
            <input
              type="number"
              value={maxWeightChange}
              onChange={(e) => setMaxWeightChange(e.target.value)}
              disabled={!isGovernor}
              className="input"
            />
          </div>

          <div>
            <label className="text-sm mb-2 block" style={{ color: 'var(--text-secondary)' }}>
              Min Update Interval (seconds)
            </label>
            <input
              type="number"
              value={minUpdateInterval}
              onChange={(e) => setMinUpdateInterval(e.target.value)}
              disabled={!isGovernor}
              className="input"
            />
            <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Current: {formatInterval(Number(minUpdateInterval))}
            </div>
          </div>

          <button
            disabled={!isGovernor}
            className="btn-primary w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Update Parameters
          </button>
        </div>
      </div>
    </div>
  )
}

