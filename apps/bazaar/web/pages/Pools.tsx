import { ArrowUpDown, Droplets, Search, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { type Address, formatUnits } from 'viem'
import { useAccount } from 'wagmi'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { EmptyState, Grid, PageHeader, StatCard } from '../components/ui'
import {
  formatWeight,
  useTFMMPoolState,
  useTFMMPools,
  useTFMMUserBalance,
} from '../hooks/tfmm/useTFMMPools'

type SortField = 'tvl' | 'apy' | 'volume' | 'name'
type SortDirection = 'asc' | 'desc'

interface PoolRowProps {
  address: Address
  name: string
  strategy: string
  tvl: string
  apy: string
  volume24h: string
  isSelected: boolean
  onSelect: () => void
}

const STRATEGY_COLORS: Record<string, string> = {
  momentum: 'from-blue-500 to-cyan-500',
  'mean-reversion': 'from-purple-500 to-pink-500',
  volatility: 'from-orange-500 to-yellow-500',
}

function PoolRow({
  address,
  name,
  strategy,
  tvl,
  apy,
  volume24h,
  isSelected,
  onSelect,
}: PoolRowProps) {
  const { poolState } = useTFMMPoolState(isSelected ? address : null)
  const { balance: userBalance } = useTFMMUserBalance(
    isSelected ? address : null,
  )

  return (
    <article
      className={`card mb-3 transition-all duration-200 ${
        isSelected ? 'ring-2 ring-primary-color' : ''
      }`}
      style={{ borderColor: isSelected ? 'var(--color-primary)' : undefined }}
    >
      <button
        type="button"
        className="w-full p-4 text-left"
        onClick={onSelect}
        aria-expanded={isSelected}
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          {/* Pool Info */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div
              className={`w-10 h-10 rounded-xl bg-gradient-to-br ${STRATEGY_COLORS[strategy] ?? 'from-gray-500 to-gray-600'} flex items-center justify-center`}
            >
              <Droplets className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-primary truncate">{name}</h3>
              <span
                className={`inline-block px-2 py-0.5 rounded text-xs font-medium uppercase bg-gradient-to-r ${STRATEGY_COLORS[strategy] ?? 'from-gray-500 to-gray-600'} text-white`}
              >
                {strategy}
              </span>
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-3 gap-4 sm:gap-8 flex-shrink-0">
            <div className="text-right">
              <p className="text-xs text-tertiary uppercase">TVL</p>
              <p className="font-semibold text-primary">{tvl}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-tertiary uppercase">APY</p>
              <p className="font-semibold text-success">{apy}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-tertiary uppercase">24h Vol</p>
              <p className="font-semibold text-primary">{volume24h}</p>
            </div>
          </div>

          {/* Action */}
          <Link
            to={`/liquidity?pool=${address}`}
            className="btn-primary text-sm py-2 px-4 sm:ml-4"
            onClick={(e) => e.stopPropagation()}
          >
            Add
          </Link>
        </div>
      </button>

      {/* Expanded Details */}
      {isSelected && poolState && (
        <div
          className="px-4 pb-4 pt-0 border-t animate-fade-in"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4">
            <div>
              <p className="text-xs text-tertiary">Tokens</p>
              <p className="font-medium text-primary">
                {poolState.tokens.length} assets
              </p>
            </div>
            <div>
              <p className="text-xs text-tertiary">Swap Fee</p>
              <p className="font-medium text-primary">
                {Number(formatUnits(poolState.swapFee, 16)).toFixed(2)}%
              </p>
            </div>
            <div>
              <p className="text-xs text-tertiary">Total Supply</p>
              <p className="font-medium text-primary">
                {Number(
                  formatUnits(poolState.totalSupply, 18),
                ).toLocaleString()}{' '}
                LP
              </p>
            </div>
            <div>
              <p className="text-xs text-tertiary">Your Balance</p>
              <p
                className={`font-medium ${userBalance > 0n ? 'text-success' : 'text-tertiary'}`}
              >
                {Number(formatUnits(userBalance, 18)).toLocaleString()} LP
              </p>
            </div>
          </div>

          {/* Token Weights */}
          {poolState.weights.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-tertiary mb-2">Token Weights</p>
              <div className="flex flex-wrap gap-2">
                {poolState.weights.map((weight, i) => (
                  <span
                    key={poolState.tokens[i]}
                    className="px-2 py-1 bg-surface-secondary rounded text-xs font-mono"
                  >
                    Token {i + 1}: {formatWeight(weight)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  )
}

export default function PoolsPage() {
  const { isConnected } = useAccount()
  const { pools, selectedPool, setSelectedPool, isLoading } = useTFMMPools()
  const [searchQuery, setSearchQuery] = useState('')
  const [sortField, setSortField] = useState<SortField>('tvl')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  // Filter and sort pools
  const filteredPools = useMemo(() => {
    return pools
      .filter(
        (pool) =>
          pool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          pool.strategy.toLowerCase().includes(searchQuery.toLowerCase()),
      )
      .sort((a, b) => {
        if (sortField === 'name') {
          return sortDirection === 'asc'
            ? a.name.localeCompare(b.name)
            : b.name.localeCompare(a.name)
        }

        let aVal: number
        let bVal: number
        switch (sortField) {
          case 'tvl':
            aVal = a.metrics.tvlUsd
            bVal = b.metrics.tvlUsd
            break
          case 'apy':
            aVal = a.metrics.apyPercent
            bVal = b.metrics.apyPercent
            break
          case 'volume':
            aVal = a.metrics.volume24hUsd
            bVal = b.metrics.volume24hUsd
            break
        }

        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
      })
  }, [pools, searchQuery, sortField, sortDirection])

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  // Calculate aggregate stats
  const totalTVL = pools.reduce((sum, p) => sum + p.metrics.tvlUsd, 0)
  const avgAPY =
    pools.length > 0
      ? pools.reduce((sum, p) => sum + p.metrics.apyPercent, 0) / pools.length
      : 0
  const totalVolume = pools.reduce((sum, p) => sum + p.metrics.volume24hUsd, 0)

  return (
    <div className="animate-fade-in">
      <PageHeader
        icon="💧"
        title="Pools"
        description="Provide liquidity and earn trading fees on every swap"
        action={{ label: 'Add Liquidity', href: '/liquidity' }}
      />

      {/* Stats Overview */}
      <Grid cols={3} className="mb-6">
        <StatCard
          icon={Droplets}
          label="Total Value Locked"
          value={`$${(totalTVL / 1e6).toFixed(2)}M`}
          trend={{ value: '+5.2%', positive: true }}
        />
        <StatCard
          icon={TrendingUp}
          label="Average APY"
          value={`${avgAPY.toFixed(1)}%`}
        />
        <StatCard
          icon={ArrowUpDown}
          label="24h Volume"
          value={`$${(totalVolume / 1e6).toFixed(2)}M`}
        />
      </Grid>

      {/* Search and Sort */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-tertiary"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Search pools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input pl-10 w-full"
            aria-label="Search pools"
          />
        </div>

        <div className="flex gap-2">
          {(['tvl', 'apy', 'volume'] as SortField[]).map((field) => (
            <button
              key={field}
              type="button"
              onClick={() => toggleSort(field)}
              className={`px-3 py-2 rounded-lg text-xs font-medium uppercase transition-all focus-ring ${
                sortField === field
                  ? 'bg-primary-soft text-primary-color'
                  : 'bg-surface-secondary text-secondary hover:text-primary'
              }`}
            >
              {field === 'volume' ? '24h Vol' : field}
              {sortField === field && (
                <span className="ml-1">
                  {sortDirection === 'desc' ? '↓' : '↑'}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Pool List */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      ) : filteredPools.length === 0 ? (
        <EmptyState
          icon="💧"
          title={searchQuery ? 'No Pools Found' : 'No Pools Available'}
          description={
            searchQuery
              ? 'Try adjusting your search criteria'
              : 'TFMM pools will be available once deployed. Create the first pool to start earning trading fees.'
          }
          action={
            !searchQuery
              ? { label: 'Add Liquidity', href: '/liquidity' }
              : undefined
          }
        />
      ) : (
        <div>
          {filteredPools.map((pool) => (
            <PoolRow
              key={pool.address}
              address={pool.address}
              name={pool.name}
              strategy={pool.strategy}
              tvl={pool.tvl}
              apy={pool.apy}
              volume24h={pool.volume24h}
              isSelected={selectedPool === pool.address}
              onSelect={() =>
                setSelectedPool(
                  selectedPool === pool.address ? null : pool.address,
                )
              }
            />
          ))}
        </div>
      )}

      {/* Sign In CTA */}
      {!isConnected && (
        <div className="card p-6 mt-6 text-center bg-gradient-to-br from-orange-500/5 to-purple-500/5 border-dashed">
          <h3 className="text-lg font-semibold text-primary mb-2">
            Sign In to View Your Positions
          </h3>
          <p className="text-sm text-secondary">
            Sign in to see your LP positions and manage liquidity
          </p>
        </div>
      )}
    </div>
  )
}
