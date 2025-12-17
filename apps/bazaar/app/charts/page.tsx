'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { fetchTokens, type Token } from '@/lib/data-client'
import { LoadingSpinner } from '@/components/LoadingSpinner'

function formatMarketCap(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`
  return `$${value.toFixed(2)}`
}

function formatVolume(value: bigint | number): string {
  const n = typeof value === 'bigint' ? Number(value) : value
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`
  return n.toFixed(2)
}

function TokenRow({ token, rank }: { token: Token; rank: number }) {
  const priceChange = token.priceChange24h
  const price = token.price
  const volume = token.volume24h
  const marketCap = price !== undefined ? price * Number(token.totalSupply) / 1e18 : undefined

  return (
    <Link 
      href={`/charts/${token.address}`}
      className="grid grid-cols-12 gap-2 items-center p-3 rounded-xl transition-colors hover:bg-opacity-50"
      style={{ backgroundColor: 'var(--bg-secondary)' }}
    >
      <div className="col-span-1 text-center" style={{ color: 'var(--text-tertiary)' }}>
        {rank}
      </div>
      <div className="col-span-3 flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-bazaar-primary to-purple-500 flex items-center justify-center text-white text-xs font-bold">
          {token.symbol.slice(0, 2)}
        </div>
        <div>
          <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{token.symbol}</div>
          <div className="text-xs truncate max-w-[100px]" style={{ color: 'var(--text-tertiary)' }}>
            {token.name}
          </div>
        </div>
      </div>
      <div className="col-span-2 text-right font-mono" style={{ color: 'var(--text-primary)' }}>
        {price !== undefined ? `$${price.toFixed(price < 1 ? 6 : 2)}` : '—'}
      </div>
      <div className={`col-span-2 text-right font-semibold ${priceChange !== undefined && priceChange >= 0 ? 'text-green-400' : priceChange !== undefined ? 'text-red-400' : ''}`} style={priceChange === undefined ? { color: 'var(--text-tertiary)' } : undefined}>
        {priceChange !== undefined ? `${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%` : '—'}
      </div>
      <div className="col-span-2 text-right" style={{ color: 'var(--text-secondary)' }}>
        {volume !== undefined ? `$${formatVolume(volume)}` : '—'}
      </div>
      <div className="col-span-2 text-right" style={{ color: 'var(--text-secondary)' }}>
        {marketCap !== undefined ? formatMarketCap(marketCap) : '—'}
      </div>
    </Link>
  )
}

function TopGainers({ tokens }: { tokens: Token[] }) {
  const sorted = useMemo(() => {
    return [...tokens]
      .filter(t => t.priceChange24h !== undefined && t.priceChange24h > 0)
      .sort((a, b) => (b.priceChange24h ?? 0) - (a.priceChange24h ?? 0))
      .slice(0, 5)
  }, [tokens])

  return (
    <div className="card p-4">
      <h3 className="font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        🚀 Top Gainers
      </h3>
      <div className="space-y-2">
        {sorted.map((token, i) => (
          <Link 
            key={token.address}
            href={`/charts/${token.address}`}
            className="flex items-center justify-between p-2 rounded-lg transition-colors"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{i + 1}</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{token.symbol}</span>
            </div>
            <span className="text-green-400 font-semibold">+{(token.priceChange24h ?? 0).toFixed(2)}%</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

function TopLosers({ tokens }: { tokens: Token[] }) {
  const sorted = useMemo(() => {
    return [...tokens]
      .filter(t => t.priceChange24h !== undefined && t.priceChange24h < 0)
      .sort((a, b) => (a.priceChange24h ?? 0) - (b.priceChange24h ?? 0))
      .slice(0, 5)
  }, [tokens])

  return (
    <div className="card p-4">
      <h3 className="font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        📉 Top Losers
      </h3>
      <div className="space-y-2">
        {sorted.map((token, i) => (
          <Link 
            key={token.address}
            href={`/charts/${token.address}`}
            className="flex items-center justify-between p-2 rounded-lg transition-colors"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{i + 1}</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{token.symbol}</span>
            </div>
            <span className="text-red-400 font-semibold">{(token.priceChange24h ?? 0).toFixed(2)}%</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

function RecentlyListed({ tokens }: { tokens: Token[] }) {
  const recent = useMemo(() => {
    return [...tokens]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 5)
  }, [tokens])

  return (
    <div className="card p-4">
      <h3 className="font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        🆕 Recently Listed
      </h3>
      <div className="space-y-2">
        {recent.map((token) => (
          <Link 
            key={token.address}
            href={`/charts/${token.address}`}
            className="flex items-center justify-between p-2 rounded-lg transition-colors"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{token.symbol}</span>
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {token.createdAt.toLocaleDateString()}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}

export default function ChartsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'volume' | 'change' | 'mcap'>('volume')

  const { data: tokens, isLoading, error } = useQuery({
    queryKey: ['chart-tokens'],
    queryFn: () => fetchTokens({ limit: 100, orderBy: 'volume' }),
    refetchInterval: 30000,
  })

  const filteredTokens = useMemo(() => {
    if (!tokens) return []
    
    let filtered = tokens
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      filtered = tokens.filter(t => 
        t.symbol.toLowerCase().includes(q) || 
        t.name.toLowerCase().includes(q) ||
        t.address.toLowerCase().includes(q)
      )
    }

    return filtered.sort((a, b) => {
      if (sortBy === 'volume') {
        return Number(b.volume24h ?? 0n) - Number(a.volume24h ?? 0n)
      }
      if (sortBy === 'change') {
        return (b.priceChange24h ?? 0) - (a.priceChange24h ?? 0)
      }
      // mcap
      const aMcap = (a.price ?? 0) * Number(a.totalSupply) / 1e18
      const bMcap = (b.price ?? 0) * Number(b.totalSupply) / 1e18
      return bMcap - aMcap
    })
  }, [tokens, searchQuery, sortBy])

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          📊 Charts & Analytics
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Real-time token prices, charts, and market data
        </p>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="card p-4">
          <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Total Tokens</div>
          <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {tokens?.length ?? '—'}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>24h Volume</div>
          <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            ${tokens ? formatVolume(tokens.reduce((acc, t) => acc + Number(t.volume24h ?? 0n), 0)) : '—'}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Gainers</div>
          <div className="text-xl font-bold text-green-400">
            {tokens ? tokens.filter(t => (t.priceChange24h ?? 0) > 0).length : '—'}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Losers</div>
          <div className="text-xl font-bold text-red-400">
            {tokens ? tokens.filter(t => (t.priceChange24h ?? 0) < 0).length : '—'}
          </div>
        </div>
      </div>

      {/* Main Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Table */}
        <div className="lg:col-span-3">
          {/* Search & Sort */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tokens..."
              className="input flex-1"
            />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="input w-full sm:w-40"
            >
              <option value="volume">Top Volume</option>
              <option value="change">Top Gainers</option>
              <option value="mcap">Market Cap</option>
            </select>
          </div>

          {/* Table Header */}
          <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>
            <div className="col-span-1 text-center">#</div>
            <div className="col-span-3">Token</div>
            <div className="col-span-2 text-right">Price</div>
            <div className="col-span-2 text-right">24h %</div>
            <div className="col-span-2 text-right">Volume</div>
            <div className="col-span-2 text-right">Market Cap</div>
          </div>

          {/* Loading */}
          {isLoading && (
            <div className="flex justify-center py-12">
              <LoadingSpinner size="lg" />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="card p-6 text-center">
              <p className="text-red-400 mb-2">Failed to load tokens</p>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                {error instanceof Error ? error.message : 'Network error'}
              </p>
            </div>
          )}

          {/* Token List */}
          {!isLoading && !error && filteredTokens.length > 0 && (
            <div className="space-y-2">
              {filteredTokens.map((token, i) => (
                <TokenRow key={token.address} token={token} rank={i + 1} />
              ))}
            </div>
          )}

          {/* Empty */}
          {!isLoading && !error && filteredTokens.length === 0 && (
            <div className="card p-12 text-center">
              <div className="text-4xl mb-3">🔍</div>
              <p style={{ color: 'var(--text-tertiary)' }}>
                {searchQuery ? 'No tokens match your search' : 'No tokens found'}
              </p>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {tokens && tokens.length > 0 && (
            <>
              <TopGainers tokens={tokens} />
              <TopLosers tokens={tokens} />
              <RecentlyListed tokens={tokens} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

