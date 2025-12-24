/**
 * Pools Page - Display liquidity pools with metrics and management
 */

import { ArrowUpDown, Droplets, Search, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { type Address, formatUnits } from 'viem'
import { useAccount } from 'wagmi'
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

  const strategyColors: Record<string, string> = {
    momentum: 'var(--accent-blue)',
    'mean-reversion': 'var(--accent-purple)',
    volatility: 'var(--accent-orange)',
  }

  return (
    <button
      type="button"
      className="card"
      style={{
        padding: '1rem 1.25rem',
        marginBottom: '0.75rem',
        cursor: 'pointer',
        border: isSelected
          ? '2px solid var(--accent)'
          : '1px solid var(--border)',
        transition: 'all 0.2s ease',
        width: '100%',
        textAlign: 'left',
        background: 'inherit',
      }}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-4">
        {/* Pool Info */}
        <div style={{ flex: '2', minWidth: 0 }}>
          <div className="flex items-center gap-2">
            <Droplets size={20} style={{ color: 'var(--accent)' }} />
            <h3
              style={{
                fontSize: '1rem',
                fontWeight: '600',
                margin: 0,
                color: 'var(--text-primary)',
              }}
            >
              {name}
            </h3>
          </div>
          <div
            style={{
              display: 'inline-block',
              padding: '0.125rem 0.5rem',
              borderRadius: '4px',
              fontSize: '0.7rem',
              fontWeight: '500',
              marginTop: '0.375rem',
              background: `${strategyColors[strategy] ?? 'var(--accent)'}20`,
              color: strategyColors[strategy] ?? 'var(--accent)',
              textTransform: 'uppercase',
            }}
          >
            {strategy}
          </div>
        </div>

        {/* TVL */}
        <div style={{ flex: '1', textAlign: 'right' }}>
          <p
            style={{
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              margin: 0,
              textTransform: 'uppercase',
            }}
          >
            TVL
          </p>
          <p
            style={{
              fontSize: '1rem',
              fontWeight: '600',
              margin: '0.125rem 0 0',
              color: 'var(--text-primary)',
            }}
          >
            {tvl}
          </p>
        </div>

        {/* APY */}
        <div style={{ flex: '1', textAlign: 'right' }}>
          <p
            style={{
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              margin: 0,
              textTransform: 'uppercase',
            }}
          >
            APY
          </p>
          <p
            style={{
              fontSize: '1rem',
              fontWeight: '600',
              margin: '0.125rem 0 0',
              color: 'var(--success)',
            }}
          >
            {apy}
          </p>
        </div>

        {/* 24h Volume */}
        <div style={{ flex: '1', textAlign: 'right' }}>
          <p
            style={{
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              margin: 0,
              textTransform: 'uppercase',
            }}
          >
            24h Vol
          </p>
          <p
            style={{
              fontSize: '1rem',
              fontWeight: '600',
              margin: '0.125rem 0 0',
              color: 'var(--text-primary)',
            }}
          >
            {volume24h}
          </p>
        </div>

        {/* Action */}
        <div style={{ flex: '0 0 auto' }}>
          <Link
            to={`/liquidity?pool=${address}`}
            className="btn-primary"
            style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
            onClick={(e) => e.stopPropagation()}
          >
            Add
          </Link>
        </div>
      </div>

      {/* Expanded Details */}
      {isSelected && poolState && (
        <div
          style={{
            marginTop: '1rem',
            paddingTop: '1rem',
            borderTop: '1px solid var(--border)',
          }}
        >
          <div className="grid grid-4" style={{ gap: '1rem' }}>
            <div>
              <p
                style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-muted)',
                  margin: 0,
                }}
              >
                Tokens
              </p>
              <p
                style={{
                  fontSize: '0.875rem',
                  fontWeight: '500',
                  margin: '0.25rem 0 0',
                }}
              >
                {poolState.tokens.length} assets
              </p>
            </div>
            <div>
              <p
                style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-muted)',
                  margin: 0,
                }}
              >
                Swap Fee
              </p>
              <p
                style={{
                  fontSize: '0.875rem',
                  fontWeight: '500',
                  margin: '0.25rem 0 0',
                }}
              >
                {Number(formatUnits(poolState.swapFee, 16)).toFixed(2)}%
              </p>
            </div>
            <div>
              <p
                style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-muted)',
                  margin: 0,
                }}
              >
                Total Supply
              </p>
              <p
                style={{
                  fontSize: '0.875rem',
                  fontWeight: '500',
                  margin: '0.25rem 0 0',
                }}
              >
                {Number(
                  formatUnits(poolState.totalSupply, 18),
                ).toLocaleString()}{' '}
                LP
              </p>
            </div>
            <div>
              <p
                style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-muted)',
                  margin: 0,
                }}
              >
                Your Balance
              </p>
              <p
                style={{
                  fontSize: '0.875rem',
                  fontWeight: '500',
                  margin: '0.25rem 0 0',
                  color:
                    userBalance > 0n
                      ? 'var(--success)'
                      : 'var(--text-secondary)',
                }}
              >
                {Number(formatUnits(userBalance, 18)).toLocaleString()} LP
              </p>
            </div>
          </div>

          {/* Token Weights */}
          {poolState.weights.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <p
                style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-muted)',
                  margin: '0 0 0.5rem',
                }}
              >
                Token Weights
              </p>
              <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                {poolState.weights.map((weight, i) => (
                  <span
                    key={poolState.tokens[i]}
                    style={{
                      padding: '0.25rem 0.5rem',
                      background: 'var(--surface-elevated)',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontFamily: 'monospace',
                    }}
                  >
                    Token {i + 1}: {formatWeight(weight)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </button>
  )
}

function StatsCard({
  label,
  value,
  icon: Icon,
  trend,
}: {
  label: string
  value: string
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>
  trend?: string
}) {
  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      <div className="flex items-center gap-3">
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            background: 'var(--accent-soft)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={20} style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <p
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              margin: 0,
            }}
          >
            {label}
          </p>
          <div className="flex items-center gap-2">
            <p
              style={{
                fontSize: '1.5rem',
                fontWeight: '700',
                margin: '0.125rem 0 0',
              }}
            >
              {value}
            </p>
            {trend && (
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--success)',
                  fontWeight: '500',
                }}
              >
                {trend}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PoolsPage() {
  const { isConnected } = useAccount()
  const { pools, selectedPool, setSelectedPool, isLoading } = useTFMMPools()
  const [searchQuery, setSearchQuery] = useState('')
  const [sortField, setSortField] = useState<SortField>('tvl')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  // Filter and sort pools
  const filteredPools = pools
    .filter(
      (pool) =>
        pool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pool.strategy.toLowerCase().includes(searchQuery.toLowerCase()),
    )
    .sort((a, b) => {
      const parseValue = (val: string) => {
        const num = parseFloat(val.replace(/[$%,KMB]/g, ''))
        if (val.includes('B')) return num * 1e9
        if (val.includes('M')) return num * 1e6
        if (val.includes('K')) return num * 1e3
        return num
      }

      let aVal: number | string = 0
      let bVal: number | string = 0

      switch (sortField) {
        case 'tvl':
          aVal = parseValue(a.tvl)
          bVal = parseValue(b.tvl)
          break
        case 'apy':
          aVal = parseValue(a.apy)
          bVal = parseValue(b.apy)
          break
        case 'volume':
          aVal = parseValue(a.volume24h)
          bVal = parseValue(b.volume24h)
          break
        case 'name':
          aVal = a.name
          bVal = b.name
          break
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal)
      }

      return sortDirection === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number)
    })

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  // Calculate aggregate stats
  const totalTVL = pools.reduce((sum, p) => {
    const val = parseFloat(p.tvl.replace(/[$,KMB]/g, ''))
    const mult = p.tvl.includes('M') ? 1e6 : p.tvl.includes('K') ? 1e3 : 1
    return sum + val * mult
  }, 0)

  const avgAPY =
    pools.reduce((sum, p) => sum + parseFloat(p.apy.replace('%', '')), 0) /
    (pools.length || 1)

  const totalVolume = pools.reduce((sum, p) => {
    const val = parseFloat(p.volume24h.replace(/[$,KMB]/g, ''))
    const mult = p.volume24h.includes('M')
      ? 1e6
      : p.volume24h.includes('K')
        ? 1e3
        : 1
    return sum + val * mult
  }, 0)

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1
            className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1"
            style={{ color: 'var(--text-primary)' }}
          >
            💧 Pools
          </h1>
          <p
            className="text-sm sm:text-base"
            style={{ color: 'var(--text-secondary)' }}
          >
            Provide liquidity and earn fees on every trade
          </p>
        </div>
        <Link
          to="/liquidity"
          className="btn-primary w-full md:w-auto text-center"
        >
          + Add Liquidity
        </Link>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-3 mb-6" style={{ gap: '1rem' }}>
        <StatsCard
          label="Total Value Locked"
          value={`$${(totalTVL / 1e6).toFixed(2)}M`}
          icon={Droplets}
          trend="+5.2%"
        />
        <StatsCard
          label="Average APY"
          value={`${avgAPY.toFixed(1)}%`}
          icon={TrendingUp}
        />
        <StatsCard
          label="24h Volume"
          value={`$${(totalVolume / 1e6).toFixed(2)}M`}
          icon={ArrowUpDown}
        />
      </div>

      {/* Search and Sort */}
      <div
        className="flex flex-col sm:flex-row gap-3 mb-4"
        style={{ alignItems: 'stretch' }}
      >
        <div style={{ position: 'relative', flex: '1' }}>
          <Search
            size={18}
            style={{
              position: 'absolute',
              left: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
            }}
          />
          <input
            type="text"
            placeholder="Search pools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '0.75rem 0.75rem 0.75rem 2.5rem',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-primary)',
              fontSize: '0.875rem',
            }}
          />
        </div>

        <div className="flex gap-2">
          {(['tvl', 'apy', 'volume'] as SortField[]).map((field) => (
            <button
              key={field}
              type="button"
              onClick={() => toggleSort(field)}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background:
                  sortField === field ? 'var(--accent-soft)' : 'var(--surface)',
                color:
                  sortField === field
                    ? 'var(--accent)'
                    : 'var(--text-secondary)',
                fontSize: '0.75rem',
                fontWeight: '500',
                textTransform: 'uppercase',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              {field === 'volume' ? '24h Vol' : field}
              {sortField === field && (
                <span style={{ fontSize: '0.6rem' }}>
                  {sortDirection === 'desc' ? '↓' : '↑'}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Pool List */}
      {isLoading ? (
        <div className="card p-6 text-center">
          <div
            style={{
              width: '32px',
              height: '32px',
              border: '3px solid var(--border)',
              borderTopColor: 'var(--accent)',
              borderRadius: '50%',
              margin: '0 auto 1rem',
              animation: 'spin 1s linear infinite',
            }}
          />
          <p style={{ color: 'var(--text-secondary)' }}>Loading pools...</p>
        </div>
      ) : filteredPools.length === 0 ? (
        <div className="card p-6 text-center">
          <div className="text-5xl mb-4">🔍</div>
          <h3
            className="text-lg font-semibold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            No Pools Found
          </h3>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {searchQuery
              ? 'Try adjusting your search criteria'
              : 'No pools available at this time'}
          </p>
        </div>
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

      {/* Connect Wallet CTA */}
      {!isConnected && (
        <div
          className="card"
          style={{
            marginTop: '1.5rem',
            padding: '1.5rem',
            textAlign: 'center',
            background: 'var(--accent-soft)',
            border: '1px solid var(--accent)',
          }}
        >
          <h3
            style={{
              fontSize: '1.125rem',
              fontWeight: '600',
              marginBottom: '0.5rem',
              color: 'var(--text-primary)',
            }}
          >
            Connect to View Your Positions
          </h3>
          <p
            style={{
              fontSize: '0.875rem',
              color: 'var(--text-secondary)',
              margin: 0,
            }}
          >
            Connect your wallet to see your LP positions and manage liquidity
          </p>
        </div>
      )}
    </div>
  )
}
