/**
 * Prediction Detail Page
 * Converted from Next.js to React Router
 */

import { useMutation, useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  CheckCircle,
  Clock,
  TrendingUp,
  Users,
  XCircle,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import { AuthButton } from '../components/auth/AuthButton'
import { LoadingSpinner } from '../components/LoadingSpinner'

interface PredictionMarket {
  id: number | string
  text: string
  status: 'active' | 'resolved' | 'cancelled'
  resolutionDate?: string
  yesShares?: number
  noShares?: number
  liquidity?: number
  resolved?: boolean
  resolution?: boolean | null
}

export default function PredictionDetailPage() {
  const { id: marketId } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { isConnected } = useAccount()
  const [side, setSide] = useState<'yes' | 'no'>('yes')
  const [amount, setAmount] = useState('10')

  const {
    data: market,
    isLoading: loading,
    refetch,
  } = useQuery({
    queryKey: ['predictionMarket', marketId],
    queryFn: async (): Promise<PredictionMarket | null> => {
      const response = await fetch(`/api/markets/predictions`)
      const data = await response.json()
      const foundMarket = data.questions?.find(
        (q: PredictionMarket) => q.id.toString() === marketId,
      )
      return foundMarket || null
    },
    enabled: !!marketId,
  })

  const buyMutation = useMutation({
    mutationFn: async ({
      buyingSide,
      buyingAmount,
    }: {
      buyingSide: 'yes' | 'no'
      buyingAmount: number
    }) => {
      const response = await fetch(`/api/markets/predictions/${marketId}/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ side: buyingSide, amount: buyingAmount }),
      })
      if (!response.ok) throw new Error('Failed to buy shares')
      return response.json()
    },
    onSuccess: () => {
      toast.success(`Bought ${side.toUpperCase()} shares`)
      refetch()
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const from = searchParams.get('from')

  useEffect(() => {
    if (!marketId) {
      navigate('/markets/predictions', { replace: true })
    }
  }, [marketId, navigate])

  useEffect(() => {
    if (!loading && !market) {
      toast.error('Market not found')
      navigate(from === 'dashboard' ? '/markets' : '/markets/predictions')
    }
  }, [loading, market, navigate, from])

  if (!marketId) {
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

  const getTimeUntilResolution = () => {
    if (!market?.resolutionDate) return null
    const now = Date.now()
    const resolutionTime = new Date(market.resolutionDate).getTime()
    const diff = resolutionTime - now

    if (diff < 0) return 'Ended'

    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))

    if (days > 0) return hours > 0 ? `${days}d ${hours}h left` : `${days}d left`
    if (hours > 0) return `${hours}h left`
    const minutes = Math.floor(diff / (1000 * 60))
    return `${minutes}m left`
  }

  const handleSubmit = () => {
    if (!isConnected) {
      toast.error('Please connect your wallet')
      return
    }

    if (!market) return

    const amountNum = Number.parseFloat(amount) || 0
    if (amountNum < 1) {
      toast.error('Minimum bet is $1')
      return
    }

    buyMutation.mutate({ buyingSide: side, buyingAmount: amountNum })
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!market) return null

  const yesShares = market.yesShares ?? 100
  const noShares = market.noShares ?? 100
  const totalShares = yesShares + noShares
  const yesPrice = yesShares / totalShares
  const noPrice = noShares / totalShares
  const timeLeft = getTimeUntilResolution()
  const totalVolume = yesShares + noShares
  const amountNum = Number.parseFloat(amount) || 0

  return (
    <div className="max-w-4xl mx-auto">
      <button
        type="button"
        onClick={() => {
          if (from === 'dashboard') {
            navigate('/markets')
          } else {
            navigate('/markets/predictions')
          }
        }}
        className="mb-4 flex items-center gap-2 text-sm"
        style={{ color: 'var(--text-secondary)' }}
      >
        <ArrowLeft className="h-4 w-4" />
        {from === 'dashboard' ? 'Back to Dashboard' : 'Back to Predictions'}
      </button>

      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h1
            className="flex-1 text-2xl font-bold"
            style={{ color: 'var(--text-primary)' }}
          >
            {market.text}
          </h1>
          {timeLeft && (
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-secondary)',
              }}
            >
              <Clock className="h-4 w-4" />
              <span className="font-medium">{timeLeft}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div
            className="p-3 rounded-lg"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <div
              className="flex items-center gap-2 text-xs mb-1"
              style={{ color: 'var(--text-tertiary)' }}
            >
              <TrendingUp className="h-3 w-3" />
              Volume
            </div>
            <div
              className="text-lg font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              {formatPrice(totalVolume)}
            </div>
          </div>
          <div
            className="p-3 rounded-lg"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <div
              className="flex items-center gap-2 text-xs mb-1"
              style={{ color: 'var(--text-tertiary)' }}
            >
              <Users className="h-3 w-3" />
              Trades
            </div>
            <div
              className="text-lg font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              {Math.floor(totalVolume / 10)}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-green-600/15">
            <div className="flex items-center gap-2 text-xs text-green-600 mb-1">
              <CheckCircle className="h-3 w-3" />
              YES
            </div>
            <div className="text-2xl font-bold text-green-600">
              {(yesPrice * 100).toFixed(1)}%
            </div>
          </div>
          <div className="p-3 rounded-lg bg-red-600/15">
            <div className="flex items-center gap-2 text-xs text-red-600 mb-1">
              <XCircle className="h-3 w-3" />
              NO
            </div>
            <div className="text-2xl font-bold text-red-600">
              {(noPrice * 100).toFixed(1)}%
            </div>
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

          <div className="flex gap-3 mb-4">
            <button
              type="button"
              onClick={() => setSide('yes')}
              className={`flex-1 flex items-center justify-center gap-3 py-3 rounded font-bold transition-all ${
                side === 'yes'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700'
              }`}
            >
              <CheckCircle size={18} />
              YES
            </button>
            <button
              type="button"
              onClick={() => setSide('no')}
              className={`flex-1 flex items-center justify-center gap-3 py-3 rounded font-bold transition-all ${
                side === 'no'
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700'
              }`}
            >
              <XCircle size={18} />
              NO
            </button>
          </div>

          <div className="mb-4">
            <label
              htmlFor="prediction-amount-input"
              className="block text-sm mb-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              Amount (USD)
            </label>
            <input
              id="prediction-amount-input"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="1"
              step="1"
              className="input w-full"
              placeholder="Min: $1"
            />
          </div>

          {amountNum > 0 && (
            <div
              className="p-4 rounded-lg mb-4"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <h3
                className="text-sm font-bold mb-3"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Trade Preview
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-secondary)' }}>Cost</span>
                  <span
                    className="font-bold"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {formatPrice(amountNum)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-secondary)' }}>
                    If {side.toUpperCase()} Wins
                  </span>
                  <span className="font-bold text-green-600">
                    {formatPrice(
                      amountNum / (side === 'yes' ? yesPrice : noPrice),
                    )}
                  </span>
                </div>
              </div>
            </div>
          )}

          {isConnected ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={buyMutation.isPending || amountNum < 1}
              className={`w-full py-4 rounded-lg font-bold text-lg text-white transition-all ${
                side === 'yes'
                  ? 'bg-green-600 hover:bg-green-700'
                  : 'bg-red-600 hover:bg-red-700'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {buyMutation.isPending
                ? 'Buying...'
                : `BUY ${side.toUpperCase()} - ${formatPrice(amountNum)}`}
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
            How it works
          </h2>
          <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
            Buy YES shares if you think this will happen, NO shares if you think
            it won't.
          </p>
          <p style={{ color: 'var(--text-secondary)' }}>
            If you're right, you'll receive $1 per share. The current price
            reflects the market's probability.
          </p>
        </div>
      </div>
    </div>
  )
}
