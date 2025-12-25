/**
 * Perps Detail Page
 * Converted from Next.js to React Router
 */

import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeft,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import { AuthButton } from '../components/auth/AuthButton'
import { LoadingSpinner } from '../components/LoadingSpinner'

interface PerpMarket {
  ticker: string
  name: string
  currentPrice: number
  change24h: number
  changePercent24h: number
  high24h: number
  low24h: number
  volume24h: number
  minOrderSize: number
  maxLeverage: number
  fundingRate: { rate: number }
}

export default function PerpsDetailPage() {
  const { ticker } = useParams<{ ticker?: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { isConnected } = useAccount()

  const [side, setSide] = useState<'long' | 'short'>('long')
  const [size, setSize] = useState('100')
  const [leverage, setLeverage] = useState(10)

  const { data: market, isLoading: loading } = useQuery({
    queryKey: ['perpMarket', ticker],
    queryFn: async (): Promise<PerpMarket | null> => {
      const response = await fetch(`/api/markets/perps/${ticker}`)
      if (!response.ok) return null
      return response.json() as Promise<PerpMarket>
    },
    enabled: !!ticker,
  })

  const from = searchParams.get('from')

  useEffect(() => {
    if (!ticker) {
      navigate('/markets/perps', { replace: true })
    }
  }, [ticker, navigate])

  useEffect(() => {
    if (!loading && !market) {
      toast.error('Market not found')
      navigate(from === 'dashboard' ? '/markets' : '/markets/perps')
    }
  }, [loading, market, navigate, from])

  if (!ticker) {
    return null
  }

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price)
  }

  const formatVolume = (v: number) => {
    if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
    if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
    return `$${(v / 1e3).toFixed(2)}K`
  }

  const sizeNum = Number.parseFloat(size) || 0
  const baseMargin = sizeNum > 0 ? sizeNum / leverage : 0
  const displayPrice = market?.currentPrice || 0
  const liquidationPrice =
    side === 'long'
      ? displayPrice * (1 - 0.9 / leverage)
      : displayPrice * (1 + 0.9 / leverage)

  const handleSubmit = () => {
    if (!isConnected) {
      toast.error('Please connect your wallet')
      return
    }

    if (!market) return

    if (sizeNum < market.minOrderSize) {
      toast.error(`Minimum order size is $${market.minOrderSize}`)
      return
    }

    toast.success('Position opened', {
      description: `Opened ${leverage}x ${side} on ${market.ticker} at ${formatPrice(displayPrice)}`,
    })
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!market) return null

  const isHighRisk = leverage > 50 || baseMargin > 1000

  return (
    <div className="max-w-4xl mx-auto">
      <button
        type="button"
        onClick={() => {
          if (from === 'dashboard') {
            navigate('/markets')
          } else {
            navigate('/markets/perps')
          }
        }}
        className="mb-4 flex items-center gap-2 text-sm"
        style={{ color: 'var(--text-secondary)' }}
      >
        <ArrowLeft className="h-4 w-4" />
        {from === 'dashboard' ? 'Back to Dashboard' : 'Back to Perps'}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1
            className="text-3xl font-bold"
            style={{ color: 'var(--text-primary)' }}
          >
            ${market.ticker}
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>{market.name}</p>
        </div>
        <div className="text-right">
          <div
            className="text-3xl font-bold"
            style={{ color: 'var(--text-primary)' }}
          >
            {formatPrice(displayPrice)}
          </div>
          <div
            className={`flex items-center justify-end gap-2 font-bold text-lg ${market.change24h >= 0 ? 'text-green-500' : 'text-red-500'}`}
          >
            {market.change24h >= 0 ? (
              <TrendingUp className="h-5 w-5" />
            ) : (
              <TrendingDown className="h-5 w-5" />
            )}
            {market.change24h >= 0 ? '+' : ''}
            {formatPrice(market.change24h)} (
            {market.changePercent24h.toFixed(2)}%)
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="card p-3">
          <div
            className="text-xs mb-1"
            style={{ color: 'var(--text-tertiary)' }}
          >
            24h High
          </div>
          <div
            className="text-lg font-bold"
            style={{ color: 'var(--text-primary)' }}
          >
            {formatPrice(market.high24h)}
          </div>
        </div>
        <div className="card p-3">
          <div
            className="text-xs mb-1"
            style={{ color: 'var(--text-tertiary)' }}
          >
            24h Low
          </div>
          <div
            className="text-lg font-bold"
            style={{ color: 'var(--text-primary)' }}
          >
            {formatPrice(market.low24h)}
          </div>
        </div>
        <div className="card p-3">
          <div
            className="text-xs mb-1"
            style={{ color: 'var(--text-tertiary)' }}
          >
            24h Volume
          </div>
          <div
            className="text-lg font-bold"
            style={{ color: 'var(--text-primary)' }}
          >
            {formatVolume(market.volume24h)}
          </div>
        </div>
        <div className="card p-3">
          <div
            className="text-xs mb-1"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Funding Rate
          </div>
          <div
            className={`text-lg font-bold ${market.fundingRate.rate >= 0 ? 'text-orange-500' : 'text-blue-500'}`}
          >
            {(market.fundingRate.rate * 100).toFixed(4)}% / 8h
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-6">
          <h2
            className="text-lg font-bold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            Trade
          </h2>

          <div className="flex gap-2 mb-4">
            <button
              type="button"
              onClick={() => setSide('long')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded font-bold transition-all ${
                side === 'long'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700'
              }`}
            >
              <TrendingUp size={18} />
              LONG
            </button>
            <button
              type="button"
              onClick={() => setSide('short')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded font-bold transition-all ${
                side === 'short'
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700'
              }`}
            >
              <TrendingDown size={18} />
              SHORT
            </button>
          </div>

          <div className="space-y-4 mb-4">
            <div>
              <label
                htmlFor="position-size"
                className="block text-sm mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                Position Size (USD)
              </label>
              <input
                id="position-size"
                type="number"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                min={market.minOrderSize}
                step="10"
                className="input w-full"
                placeholder={`Min: $${market.minOrderSize}`}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label
                  htmlFor="leverage"
                  className="text-sm"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Leverage
                </label>
                <span
                  className="font-bold text-xl"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {leverage}x
                </span>
              </div>
              <input
                id="leverage"
                type="range"
                min="1"
                max={market.maxLeverage}
                value={leverage}
                onChange={(e) =>
                  setLeverage(Number.parseInt(e.target.value, 10))
                }
                className="w-full"
              />
              <div
                className="flex justify-between text-xs mt-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                <span>1x</span>
                <span>{market.maxLeverage}x</span>
              </div>
            </div>
          </div>

          <div
            className="space-y-2 text-sm mb-4 p-4 rounded-lg"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-secondary)' }}>
                Margin Required
              </span>
              <span
                className="font-bold"
                style={{ color: 'var(--text-primary)' }}
              >
                {formatPrice(baseMargin)}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-secondary)' }}>
                Entry Price
              </span>
              <span style={{ color: 'var(--text-primary)' }}>
                {formatPrice(displayPrice)}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-secondary)' }}>
                Liquidation Price
              </span>
              <span className="text-red-500 font-bold">
                {formatPrice(liquidationPrice)}
              </span>
            </div>
          </div>

          {isHighRisk && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/15 mb-4">
              <AlertTriangle className="h-5 w-5 flex-shrink-0 text-yellow-500 mt-0.5" />
              <div className="text-sm">
                <div className="font-bold text-yellow-600 mb-1">
                  High Risk Position
                </div>
                <p style={{ color: 'var(--text-secondary)' }}>
                  {leverage > 50 && 'Leverage above 50x is extremely risky. '}
                  Small price movements can lead to liquidation.
                </p>
              </div>
            </div>
          )}

          {isConnected ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={sizeNum < market.minOrderSize}
              className={`w-full py-4 rounded-lg font-bold text-lg text-white transition-all ${
                side === 'long'
                  ? 'bg-green-600 hover:bg-green-700'
                  : 'bg-red-600 hover:bg-red-700'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {`${side === 'long' ? 'LONG' : 'SHORT'} ${market.ticker} ${leverage}x`}
            </button>
          ) : (
            <AuthButton />
          )}
        </div>

        <div className="card p-6">
          <h2
            className="text-lg font-bold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            Market Info
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            {market.fundingRate.rate >= 0
              ? 'Long positions pay shorts every 8 hours'
              : 'Short positions pay longs every 8 hours'}
          </p>
        </div>
      </div>
    </div>
  )
}
