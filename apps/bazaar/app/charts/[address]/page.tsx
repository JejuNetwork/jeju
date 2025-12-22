'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { use, useEffect, useState } from 'react'
import { type Address, formatUnits } from 'viem'
import { type Candle, PriceChart } from '@/components/charts/PriceChart'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import {
  fetchPriceHistory,
  fetchToken24hStats,
  fetchTokenDetails,
} from '@/lib/data-client'

type TimeInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d'

const INTERVALS: { value: TimeInterval; label: string }[] = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1h', label: '1H' },
  { value: '4h', label: '4H' },
  { value: '1d', label: '1D' },
]

function formatNumber(num: number): string {
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`
  if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`
  return num.toFixed(2)
}

function StatCard({
  label,
  value,
  subtext,
  color,
}: {
  label: string
  value: string
  subtext?: string
  color?: 'green' | 'red' | 'default'
}) {
  return (
    <div className="card p-4">
      <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </div>
      <div
        className={`text-lg font-bold ${
          color === 'green'
            ? 'text-green-400'
            : color === 'red'
              ? 'text-red-400'
              : ''
        }`}
        style={
          color === 'default' ? { color: 'var(--text-primary)' } : undefined
        }
      >
        {value}
      </div>
      {subtext && (
        <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
          {subtext}
        </div>
      )}
    </div>
  )
}

function TradesList() {
  // Mock recent trades
  const trades = [
    { type: 'buy', amount: '12.5', price: '0.0234', time: '2s ago' },
    { type: 'sell', amount: '8.2', price: '0.0233', time: '5s ago' },
    { type: 'buy', amount: '25.0', price: '0.0235', time: '12s ago' },
    { type: 'buy', amount: '5.8', price: '0.0234', time: '18s ago' },
    { type: 'sell', amount: '15.3', price: '0.0232', time: '25s ago' },
  ]

  return (
    <div className="card p-4">
      <h3
        className="font-semibold mb-3"
        style={{ color: 'var(--text-primary)' }}
      >
        Recent Trades
      </h3>
      <div className="space-y-2 text-sm">
        {trades.map((trade) => (
          <div
            key={`${trade.type}-${trade.amount}-${trade.time}`}
            className="flex items-center justify-between"
          >
            <span
              className={
                trade.type === 'buy' ? 'text-green-400' : 'text-red-400'
              }
            >
              {trade.type.toUpperCase()}
            </span>
            <span style={{ color: 'var(--text-primary)' }}>{trade.amount}</span>
            <span style={{ color: 'var(--text-secondary)' }}>
              ${trade.price}
            </span>
            <span style={{ color: 'var(--text-tertiary)' }}>{trade.time}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function HoldersList() {
  // Mock top holders
  const holders = [
    { address: '0x1234...5678', balance: '25.5%', label: 'Creator' },
    { address: '0x2345...6789', balance: '12.3%', label: 'LP Pool' },
    { address: '0x3456...7890', balance: '8.7%' },
    { address: '0x4567...8901', balance: '5.2%' },
    { address: '0x5678...9012', balance: '3.1%' },
  ]

  return (
    <div className="card p-4">
      <h3
        className="font-semibold mb-3"
        style={{ color: 'var(--text-primary)' }}
      >
        Top Holders
      </h3>
      <div className="space-y-2 text-sm">
        {holders.map((holder, i) => (
          <div
            key={holder.address}
            className="flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <span style={{ color: 'var(--text-tertiary)' }}>{i + 1}</span>
              <span
                className="font-mono"
                style={{ color: 'var(--text-primary)' }}
              >
                {holder.address}
              </span>
              {holder.label && (
                <span className="px-1.5 py-0.5 rounded text-xs bg-bazaar-primary/20 text-bazaar-primary">
                  {holder.label}
                </span>
              )}
            </div>
            <span style={{ color: 'var(--text-secondary)' }}>
              {holder.balance}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function TokenChartPage({
  params,
}: {
  params: Promise<{ address: string }>
}) {
  const { address } = use(params)
  const [interval, setInterval] = useState<TimeInterval>('1h')
  const [chartWidth, setChartWidth] = useState(800)

  // Responsive chart width
  useEffect(() => {
    const updateWidth = () => {
      const container = document.getElementById('chart-container')
      if (container) {
        setChartWidth(container.offsetWidth)
      }
    }
    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  const { data: token, isLoading: tokenLoading } = useQuery({
    queryKey: ['token', address],
    queryFn: () => fetchTokenDetails(address as Address),
  })

  const { data: priceHistory, isLoading: priceLoading } = useQuery({
    queryKey: ['price-history', address, interval],
    queryFn: () => fetchPriceHistory(address as Address, interval, 100),
    refetchInterval: 30000,
  })

  const { data: stats } = useQuery({
    queryKey: ['token-stats', address],
    queryFn: () => fetchToken24hStats(address as Address),
    refetchInterval: 60000,
  })

  const candles: Candle[] = priceHistory ?? []
  const currentPrice =
    candles.length > 0 ? candles[candles.length - 1].close : 0
  const priceChange = stats?.priceChange ?? 0
  const isUp = priceChange >= 0

  if (tokenLoading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!token) {
    return (
      <div className="text-center py-20">
        <div className="text-5xl mb-4">🔍</div>
        <h2
          className="text-xl font-semibold mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Token Not Found
        </h2>
        <p className="mb-4" style={{ color: 'var(--text-tertiary)' }}>
          The token at {address.slice(0, 10)}...{address.slice(-8)} could not be
          found
        </p>
        <Link href="/charts" className="btn-primary">
          Back to Charts
        </Link>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <Link
            href="/charts"
            className="p-2 rounded-xl"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            ←
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-bazaar-primary to-purple-500 flex items-center justify-center text-white font-bold">
              {token.symbol.slice(0, 2)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1
                  className="text-xl font-bold"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {token.name}
                </h1>
                {token.verified && <span className="text-blue-400">✓</span>}
              </div>
              <div
                className="text-sm"
                style={{ color: 'var(--text-tertiary)' }}
              >
                ${token.symbol}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div
              className="text-2xl font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              ${currentPrice.toFixed(currentPrice < 1 ? 6 : 2)}
            </div>
            <div
              className={`text-sm font-semibold ${isUp ? 'text-green-400' : 'text-red-400'}`}
            >
              {isUp ? '+' : ''}
              {priceChange.toFixed(2)}%
            </div>
          </div>
          <Link href={`/swap?output=${address}`} className="btn-primary">
            Trade
          </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
        <StatCard
          label="Market Cap"
          value={`$${formatNumber(currentPrice * Number(formatUnits(token.totalSupply, token.decimals)))}`}
          color="default"
        />
        <StatCard
          label="24h Volume"
          value={`$${formatNumber(Number(stats?.volume ?? 0n))}`}
          color="default"
        />
        <StatCard
          label="24h High"
          value={`$${(stats?.high ?? 0).toFixed(4)}`}
          color="green"
        />
        <StatCard
          label="24h Low"
          value={`$${(stats?.low ?? 0).toFixed(4)}`}
          color="red"
        />
        <StatCard
          label="Trades (24h)"
          value={formatNumber(stats?.trades ?? 0)}
          color="default"
        />
        <StatCard
          label="Holders"
          value={formatNumber(token.holders ?? 0)}
          color="default"
        />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Chart */}
        <div className="lg:col-span-3">
          <div className="card p-4">
            {/* Interval Selector */}
            <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-hide">
              {INTERVALS.map((int) => (
                <button
                  key={int.value}
                  onClick={() => setInterval(int.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    interval === int.value ? 'bg-bazaar-primary text-white' : ''
                  }`}
                  style={
                    interval !== int.value
                      ? {
                          backgroundColor: 'var(--bg-secondary)',
                          color: 'var(--text-secondary)',
                        }
                      : undefined
                  }
                >
                  {int.label}
                </button>
              ))}
            </div>

            {/* Chart */}
            <div id="chart-container" className="w-full">
              {priceLoading ? (
                <div className="flex justify-center py-20">
                  <LoadingSpinner />
                </div>
              ) : (
                <PriceChart
                  candles={candles}
                  width={chartWidth - 32}
                  height={400}
                  showVolume={true}
                />
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <TradesList />
          <HoldersList />

          {/* Token Info */}
          <div className="card p-4">
            <h3
              className="font-semibold mb-3"
              style={{ color: 'var(--text-primary)' }}
            >
              Token Info
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>Contract</span>
                <span
                  className="font-mono"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {address.slice(0, 6)}...{address.slice(-4)}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>Decimals</span>
                <span style={{ color: 'var(--text-primary)' }}>
                  {token.decimals}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>
                  Total Supply
                </span>
                <span style={{ color: 'var(--text-primary)' }}>
                  {formatNumber(
                    Number(formatUnits(token.totalSupply, token.decimals)),
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>Created</span>
                <span style={{ color: 'var(--text-primary)' }}>
                  {token.createdAt.toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
