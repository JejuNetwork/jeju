'use client'

import { useState } from 'react'
import { useAccount } from 'wagmi'
import { type Address } from 'viem'
import {
  useTFMMPools,
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
  const { isConnected } = useAccount()
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          📈 TFMM Management
        </h1>
        <p className="text-sm sm:text-base" style={{ color: 'var(--text-secondary)' }}>
          Temporal Function Market Maker - Dynamic weight rebalancing powered by on-chain strategies
        </p>
      </div>

      {/* Stats Overview - 2x2 on mobile, 4 on desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 md:mb-8">
        <StatCard title="Total TVL" value="$4.19M" icon="💰" />
        <StatCard title="Active Pools" value="3" icon="🏊" />
        <StatCard title="24h Volume" value="$1.55M" icon="📊" />
        <StatCard title="Avg APY" value="12.0%" icon="📈" />
      </div>

      {/* Tabs - Scrollable on mobile */}
      <div className="flex gap-2 mb-6 md:mb-8 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 sm:gap-2 text-sm sm:text-base ${
              activeTab === tab.id
                ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg'
                : 'btn-secondary'
            }`}
          >
            <span className="text-base sm:text-lg">{tab.icon}</span>
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
    <div className="card p-3 sm:p-4">
      <div className="flex items-center gap-1.5 sm:gap-2 mb-1 sm:mb-2">
        <span className="text-lg sm:text-xl">{icon}</span>
        <span className="text-xs sm:text-sm truncate" style={{ color: 'var(--text-tertiary)' }}>
          {title}
        </span>
      </div>
      <div className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
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
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
      {pools.map((pool) => (
        <div
          key={pool.address}
          onClick={() => onSelectPool(pool.address)}
          className={`card p-4 sm:p-5 cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98] ${
            selectedPool === pool.address ? 'ring-2 ring-purple-500' : ''
          }`}
        >
          <div className="flex items-start justify-between gap-2 mb-3 sm:mb-4">
            <h3 className="font-bold text-base sm:text-lg leading-tight" style={{ color: 'var(--text-primary)' }}>
              {pool.name}
            </h3>
            <span className="badge-success text-xs shrink-0">{pool.strategy}</span>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-3 text-xs sm:text-sm mb-3 sm:mb-4">
            <div>
              <div className="truncate" style={{ color: 'var(--text-tertiary)' }}>TVL</div>
              <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                {pool.tvl}
              </div>
            </div>
            <div>
              <div style={{ color: 'var(--text-tertiary)' }}>APY</div>
              <div className="font-semibold text-green-400">{pool.apy}</div>
            </div>
            <div>
              <div className="truncate" style={{ color: 'var(--text-tertiary)' }}>24h Vol</div>
              <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                {pool.volume24h}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button className="btn-primary flex-1 py-2 text-xs sm:text-sm">Add Liquidity</button>
            <button className="btn-secondary flex-1 py-2 text-xs sm:text-sm">Details</button>
          </div>
        </div>
      ))}

      {pools.length === 0 && (
        <div className="col-span-full text-center py-12 sm:py-16">
          <div className="text-5xl sm:text-6xl mb-3 sm:mb-4">🏊</div>
          <h3 className="text-lg sm:text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            No TFMM Pools Yet
          </h3>
          <p className="text-sm sm:text-base" style={{ color: 'var(--text-secondary)' }}>
            Create the first TFMM pool to get started
          </p>
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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
      {/* Strategy Selection */}
      <div className="space-y-3 sm:space-y-4">
        <h3 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4" style={{ color: 'var(--text-primary)' }}>
          Available Strategies
        </h3>
        {strategies.map((strategy) => (
          <div
            key={strategy.type}
            onClick={() => onSelectStrategy(strategy.type)}
            className={`card p-3 sm:p-4 cursor-pointer transition-all active:scale-[0.98] ${
              selectedStrategy === strategy.type
                ? 'ring-2 ring-purple-500 bg-purple-500/10'
                : 'hover:bg-[var(--bg-secondary)]'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <h4 className="font-semibold text-sm sm:text-base" style={{ color: 'var(--text-primary)' }}>
                {strategy.name}
              </h4>
              <span
                className={`px-2 py-0.5 sm:py-1 rounded text-xs shrink-0 ${
                  strategy.enabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                }`}
              >
                {strategy.enabled ? 'Active' : 'Inactive'}
              </span>
            </div>
            <p className="text-xs sm:text-sm mb-3 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
              {strategy.description}
            </p>
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2 text-xs">
              <div className="p-1.5 sm:p-2 rounded" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <div className="truncate" style={{ color: 'var(--text-tertiary)' }}>Lookback</div>
                <div className="font-semibold">{formatStrategyParam(strategy.lookbackPeriod, 'days')}</div>
              </div>
              <div className="p-1.5 sm:p-2 rounded" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <div className="truncate" style={{ color: 'var(--text-tertiary)' }}>Interval</div>
                <div className="font-semibold">{formatStrategyParam(strategy.updateInterval, 'time')}</div>
              </div>
              <div className="p-1.5 sm:p-2 rounded" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <div className="truncate" style={{ color: 'var(--text-tertiary)' }}>Max Δ</div>
                <div className="font-semibold">{formatStrategyParam(strategy.maxWeightChange, 'bps')}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Strategy Performance */}
      <div className="card p-4 sm:p-6">
        <h3 className="text-lg sm:text-xl font-semibold mb-4 sm:mb-6" style={{ color: 'var(--text-primary)' }}>
          {STRATEGY_CONFIGS[selectedStrategy].name} Performance
        </h3>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-4 sm:mb-6">
          <MetricCard label="Total Return" value={`${performance.totalReturn}%`} positive={performance.totalReturn > 0} />
          <MetricCard label="Sharpe Ratio" value={performance.sharpeRatio.toFixed(2)} positive={performance.sharpeRatio > 1} />
          <MetricCard label="Max Drawdown" value={`${performance.maxDrawdown}%`} positive={false} isNegativeGood />
          <MetricCard label="Win Rate" value={`${performance.winRate}%`} positive={performance.winRate > 50} />
        </div>

        <div className="p-3 sm:p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <div className="flex justify-between items-center text-sm sm:text-base">
            <span style={{ color: 'var(--text-tertiary)' }}>Total Rebalances</span>
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              {performance.rebalanceCount}
            </span>
          </div>
        </div>

        <div className="mt-4 sm:mt-6 p-3 sm:p-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10">
          <div className="flex items-start gap-2 sm:gap-3">
            <span className="text-lg sm:text-xl">⚠️</span>
            <div className="text-xs sm:text-sm">
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
    <div className="p-3 sm:p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      <div className="text-xs sm:text-sm mb-1" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </div>
      <div className={`text-lg sm:text-xl font-bold ${colorClass}`}>{value}</div>
    </div>
  )
}

function OraclesTab({ oracles, isLoading }: { oracles: OracleConfig[]; isLoading: boolean }) {
  if (isLoading) {
    return <div className="text-center py-12" style={{ color: 'var(--text-tertiary)' }}>Loading oracles...</div>
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Oracle Priority - Vertical on mobile, horizontal on tablet+ */}
      <div className="card p-4 sm:p-6">
        <h3 className="text-lg sm:text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Oracle Priority Chain
        </h3>
        
        {/* Mobile: Vertical layout */}
        <div className="flex flex-col sm:hidden gap-3">
          <OraclePriorityCard
            icon="🔮"
            name="Pyth Network"
            subtitle="Primary (Permissionless)"
            colorClass="bg-purple-500/20 border-purple-500/30"
            textClass="text-purple-400"
          />
          <div className="flex justify-center text-xl" style={{ color: 'var(--text-tertiary)' }}>↓</div>
          <OraclePriorityCard
            icon="🔗"
            name="Chainlink"
            subtitle="Secondary"
            colorClass="bg-blue-500/20 border-blue-500/30"
            textClass="text-blue-400"
          />
          <div className="flex justify-center text-xl" style={{ color: 'var(--text-tertiary)' }}>↓</div>
          <OraclePriorityCard
            icon="📊"
            name="Uniswap TWAP"
            subtitle="Fallback (On-chain)"
            colorClass="bg-orange-500/20 border-orange-500/30"
            textClass="text-orange-400"
          />
        </div>

        {/* Tablet/Desktop: Horizontal layout */}
        <div className="hidden sm:flex items-center gap-2 md:gap-4">
          <div className="flex-1 p-3 md:p-4 rounded-xl bg-purple-500/20 border border-purple-500/30 text-center">
            <div className="text-xl md:text-2xl mb-1 md:mb-2">🔮</div>
            <div className="font-semibold text-purple-400 text-sm md:text-base">Pyth Network</div>
            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Primary (Permissionless)
            </div>
          </div>
          <div className="text-xl md:text-2xl shrink-0" style={{ color: 'var(--text-tertiary)' }}>→</div>
          <div className="flex-1 p-3 md:p-4 rounded-xl bg-blue-500/20 border border-blue-500/30 text-center">
            <div className="text-xl md:text-2xl mb-1 md:mb-2">🔗</div>
            <div className="font-semibold text-blue-400 text-sm md:text-base">Chainlink</div>
            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Secondary</div>
          </div>
          <div className="text-xl md:text-2xl shrink-0" style={{ color: 'var(--text-tertiary)' }}>→</div>
          <div className="flex-1 p-3 md:p-4 rounded-xl bg-orange-500/20 border border-orange-500/30 text-center">
            <div className="text-xl md:text-2xl mb-1 md:mb-2">📊</div>
            <div className="font-semibold text-orange-400 text-sm md:text-base">Uniswap TWAP</div>
            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Fallback (On-chain)</div>
          </div>
        </div>
      </div>

      {/* Oracle Status - Cards on mobile, table on desktop */}
      <div className="card p-4 sm:p-6">
        <h3 className="text-lg sm:text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Price Feeds
        </h3>
        
        {/* Mobile: Card layout */}
        <div className="space-y-3 sm:hidden">
          {oracles.map((oracle) => (
            <div
              key={oracle.token}
              className="p-3 rounded-xl border"
              style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-r from-purple-500 to-blue-500" />
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {oracle.symbol}
                  </span>
                </div>
                {oracle.isStale ? (
                  <span className="px-2 py-1 rounded text-xs bg-red-500/20 text-red-400">Stale</span>
                ) : oracle.active ? (
                  <span className="px-2 py-1 rounded text-xs bg-green-500/20 text-green-400">Active</span>
                ) : (
                  <span className="px-2 py-1 rounded text-xs bg-gray-500/20 text-gray-400">Inactive</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div style={{ color: 'var(--text-tertiary)' }}>Source</div>
                  <div className={`font-semibold flex items-center gap-1 ${getOracleTypeColor(oracle.oracleType)}`}>
                    <span>{getOracleTypeIcon(oracle.oracleType)}</span>
                    <span className="truncate">{getOracleTypeName(oracle.oracleType).split(' ')[0]}</span>
                  </div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-tertiary)' }}>Price</div>
                  <div className="font-semibold font-mono" style={{ color: 'var(--text-primary)' }}>
                    {formatPrice(oracle.price)}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-tertiary)' }}>Heartbeat</div>
                  <div className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    {formatInterval(oracle.heartbeat)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Tablet/Desktop: Table layout */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full min-w-[500px]">
            <thead>
              <tr className="text-left text-sm" style={{ color: 'var(--text-tertiary)' }}>
                <th className="pb-4">Asset</th>
                <th className="pb-4">Source</th>
                <th className="pb-4">Price</th>
                <th className="pb-4 hidden md:table-cell">Heartbeat</th>
                <th className="pb-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {oracles.map((oracle) => (
                <tr key={oracle.token} className="border-t border-[var(--border)]">
                  <td className="py-3 md:py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-gradient-to-r from-purple-500 to-blue-500" />
                      <span className="font-semibold text-sm md:text-base" style={{ color: 'var(--text-primary)' }}>
                        {oracle.symbol}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 md:py-4">
                    <div className="flex items-center gap-1 md:gap-2 text-sm">
                      <span>{getOracleTypeIcon(oracle.oracleType)}</span>
                      <span className={getOracleTypeColor(oracle.oracleType)}>
                        {getOracleTypeName(oracle.oracleType)}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 md:py-4 font-mono text-sm md:text-base" style={{ color: 'var(--text-primary)' }}>
                    {formatPrice(oracle.price)}
                  </td>
                  <td className="py-3 md:py-4 text-sm hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>
                    {formatInterval(oracle.heartbeat)}
                  </td>
                  <td className="py-3 md:py-4 text-right">
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

function OraclePriorityCard({
  icon,
  name,
  subtitle,
  colorClass,
  textClass,
}: {
  icon: string
  name: string
  subtitle: string
  colorClass: string
  textClass: string
}) {
  return (
    <div className={`p-4 rounded-xl border ${colorClass} text-center`}>
      <div className="text-2xl mb-2">{icon}</div>
      <div className={`font-semibold ${textClass}`}>{name}</div>
      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        {subtitle}
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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
      {/* Access Control */}
      <div className="card p-4 sm:p-6">
        <h3 className="text-lg sm:text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Access Control
        </h3>
        {!isConnected ? (
          <div className="p-3 sm:p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-center">
            <span className="text-yellow-400 text-sm sm:text-base">Connect wallet to view governance status</span>
          </div>
        ) : isGovernor ? (
          <div className="p-3 sm:p-4 rounded-xl bg-green-500/10 border border-green-500/30">
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="text-xl sm:text-2xl">✅</span>
              <div>
                <div className="font-semibold text-green-400 text-sm sm:text-base">Governor Access</div>
                <div className="text-xs sm:text-sm" style={{ color: 'var(--text-secondary)' }}>
                  You can modify pool parameters and fees
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-3 sm:p-4 rounded-xl bg-gray-500/10 border border-gray-500/30">
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="text-xl sm:text-2xl">🔒</span>
              <div>
                <div className="font-semibold text-sm sm:text-base" style={{ color: 'var(--text-primary)' }}>
                  View Only
                </div>
                <div className="text-xs sm:text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Contact governance for parameter changes
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 sm:mt-6 space-y-2 sm:space-y-3">
          <RoleCard role="CEO/Council" permission="Can set fees & pause" />
          <RoleCard role="Governor" permission="Can set guard rails" />
          <RoleCard role="Strategy Keeper" permission="Can trigger rebalances" />
        </div>
      </div>

      {/* Fee Configuration */}
      <div className="card p-4 sm:p-6">
        <h3 className="text-lg sm:text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Fee Configuration
        </h3>
        <div className="space-y-3 sm:space-y-4">
          <InputField
            label="Swap Fee (bps)"
            value={swapFee}
            onChange={setSwapFee}
            disabled={!isGovernor}
            hint={`Current: ${formatFee(Number(swapFee))}`}
          />
          <InputField
            label="Protocol Fee (bps)"
            value={protocolFee}
            onChange={setProtocolFee}
            disabled={!isGovernor}
          />
          <InputField
            label="Max Weight Change (bps)"
            value={maxWeightChange}
            onChange={setMaxWeightChange}
            disabled={!isGovernor}
          />
          <InputField
            label="Min Update Interval (seconds)"
            value={minUpdateInterval}
            onChange={setMinUpdateInterval}
            disabled={!isGovernor}
            hint={`Current: ${formatInterval(Number(minUpdateInterval))}`}
          />

          <button
            disabled={!isGovernor}
            className="btn-primary w-full py-2.5 sm:py-3 text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Update Parameters
          </button>
        </div>
      </div>
    </div>
  )
}

function RoleCard({ role, permission }: { role: string; permission: string }) {
  return (
    <div className="flex items-center justify-between p-2.5 sm:p-3 rounded-xl text-sm" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      <span style={{ color: 'var(--text-secondary)' }}>{role}</span>
      <span className="font-mono text-xs sm:text-sm text-right" style={{ color: 'var(--text-primary)' }}>
        {permission}
      </span>
    </div>
  )
}

function InputField({
  label,
  value,
  onChange,
  disabled,
  hint,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
  hint?: string
}) {
  return (
    <div>
      <label className="text-xs sm:text-sm mb-1.5 sm:mb-2 block" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="input text-sm sm:text-base"
      />
      {hint && (
        <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
          {hint}
        </div>
      )}
    </div>
  )
}
