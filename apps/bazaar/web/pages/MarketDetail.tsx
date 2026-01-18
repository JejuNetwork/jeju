import {
  type AttestationStatus,
  type TEEPlatform,
  TrustCenterWidget,
} from '@jejunetwork/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { formatUnits, parseAbi, parseEther } from 'viem'
import {
  useAccount,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { PREDICTION_MARKET_ADDRESS } from '../../config'
import {
  fetchPredictionMarkets,
  type PredictionMarket,
} from '../../lib/data-client'
import { LoadingSpinner } from '../components/LoadingSpinner'

const PREDICTION_MARKET_ABI = parseAbi([
  'function buyShares(bytes32 sessionId, bool isYes, uint256 amount) payable',
])

export default function MarketDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { address, isConnected } = useAccount()
  const [selectedOutcome, setSelectedOutcome] = useState<'yes' | 'no' | null>(
    null,
  )
  const [amount, setAmount] = useState('')

  const {
    data: market,
    isLoading,
    error,
  } = useQuery<PredictionMarket | undefined>({
    queryKey: ['prediction-market', id],
    queryFn: async () => {
      const markets = await fetchPredictionMarkets({ limit: 100 })
      return markets.find((m) => m.id === id)
    },
    enabled: Boolean(id),
    refetchInterval: 15000,
    staleTime: 10000,
  })

  const { writeContract, data: txHash, isPending } = useWriteContract()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  if (isSuccess) {
    toast.success('Shares purchased successfully.')
  }

  const handleBuy = () => {
    if (!isConnected || !address) {
      toast.error('Connect your wallet first')
      return
    }

    if (!selectedOutcome) {
      toast.error('Select an outcome')
      return
    }

    const amountNum = parseFloat(amount)
    if (Number.isNaN(amountNum) || amountNum <= 0) {
      toast.error('Enter a valid amount')
      return
    }

    if (
      !PREDICTION_MARKET_ADDRESS ||
      PREDICTION_MARKET_ADDRESS === '0x0000000000000000000000000000000000000000'
    ) {
      toast.error('Prediction market not deployed')
      return
    }

    writeContract({
      address: PREDICTION_MARKET_ADDRESS,
      abi: PREDICTION_MARKET_ABI,
      functionName: 'buyShares',
      args: [
        id as `0x${string}`,
        selectedOutcome === 'yes',
        parseEther(amount),
      ],
      value: parseEther(amount),
    })
  }

  const isBuying = isPending || isConfirming

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (error || !market) {
    return (
      <div className="max-w-2xl mx-auto">
        <Link
          to="/markets"
          className="text-sm mb-4 inline-block"
          style={{ color: 'var(--text-secondary)' }}
        >
          ← Back to Markets
        </Link>
        <div className="card p-6 border-red-500/30 bg-red-500/10">
          <p className="font-semibold mb-1 text-red-400">
            {error ? 'Failed to load market' : 'Market not found'}
          </p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {error ? String(error) : `Market ID: ${id}`}
          </p>
        </div>
      </div>
    )
  }

  const yesPercent = Math.round(market.yesPrice * 100)
  const noPercent = Math.round(market.noPrice * 100)

  function formatVolume(volume: bigint): string {
    const n = Number(formatUnits(volume, 18))
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
    if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`
    return `$${n.toFixed(2)}`
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        to="/markets"
        className="text-sm mb-4 inline-block"
        style={{ color: 'var(--text-secondary)' }}
      >
        ← Back to Markets
      </Link>

      <div className="card p-6">
        <div className="mb-6">
          <span
            className={`badge mb-2 ${market.resolved ? 'badge-secondary' : 'badge-info'}`}
          >
            {market.resolved ? 'Ended' : 'Live'}
          </span>
          <h1
            className="text-2xl font-bold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            {market.question}
          </h1>
          <div
            className="flex gap-4 text-sm"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <span>Volume: {formatVolume(market.totalVolume)}</span>
            <span>Liquidity: {formatVolume(market.liquidity)}</span>
          </div>
        </div>

        {market.resolved ? (
          <div
            className="card p-4 text-center mb-6"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <p
              className="text-sm mb-1"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Resolved Outcome
            </p>
            <p
              className={`text-2xl font-bold ${market.outcome ? 'text-green-400' : 'text-red-400'}`}
            >
              {market.outcome ? 'YES' : 'NO'}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <button
                type="button"
                onClick={() => setSelectedOutcome('yes')}
                className={`card p-4 text-center transition-all ${
                  selectedOutcome === 'yes'
                    ? 'border-green-500 bg-green-500/10'
                    : 'border-green-500/30 hover:bg-green-500/10'
                }`}
              >
                <p
                  className="text-sm"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Yes
                </p>
                <p className="text-2xl font-bold text-green-400">
                  {yesPercent}%
                </p>
                <p
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  ${market.yesPrice.toFixed(2)}
                </p>
              </button>
              <button
                type="button"
                onClick={() => setSelectedOutcome('no')}
                className={`card p-4 text-center transition-all ${
                  selectedOutcome === 'no'
                    ? 'border-red-500 bg-red-500/10'
                    : 'border-red-500/30 hover:bg-red-500/10'
                }`}
              >
                <p
                  className="text-sm"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  No
                </p>
                <p className="text-2xl font-bold text-red-400">{noPercent}%</p>
                <p
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  ${market.noPrice.toFixed(2)}
                </p>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="amount-input"
                  className="text-sm block mb-1.5"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Amount (USDC)
                </label>
                <input
                  id="amount-input"
                  type="number"
                  placeholder="10"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="input"
                  min="0"
                  step="0.01"
                />
              </div>

              <button
                type="button"
                onClick={handleBuy}
                className="btn-primary w-full py-3 disabled:opacity-50"
                disabled={
                  !selectedOutcome ||
                  !amount ||
                  Number(amount) <= 0 ||
                  isBuying ||
                  !isConnected
                }
              >
                {!isConnected
                  ? 'Sign In'
                  : isBuying
                    ? 'Buying...'
                    : selectedOutcome
                      ? `Buy ${selectedOutcome.toUpperCase()} for $${amount || '0'}`
                      : 'Select an outcome'}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="card p-4 mt-4">
        <h3
          className="text-sm font-semibold mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Market Details
        </h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div style={{ color: 'var(--text-tertiary)' }}>Market ID</div>
          <div
            className="font-mono text-xs truncate"
            style={{ color: 'var(--text-secondary)' }}
          >
            {market.id}
          </div>
          <div style={{ color: 'var(--text-tertiary)' }}>Created</div>
          <div style={{ color: 'var(--text-secondary)' }}>
            {market.createdAt.toLocaleDateString()}
          </div>
          {market.resolutionTime && (
            <>
              <div style={{ color: 'var(--text-tertiary)' }}>Resolution</div>
              <div style={{ color: 'var(--text-secondary)' }}>
                {market.resolutionTime.toLocaleDateString()}
              </div>
            </>
          )}
        </div>
      </div>

      {/* TEE Oracle Verification - full widget when attestation data available */}
      {market.tee?.enabled && market.tee.mrEnclave && market.tee.mrSigner && (
        <div className="mt-4">
          <TrustCenterWidget
            provider={{
              name: 'Market Oracle',
              address: market.tee.oracleAddress,
              endpoint: 'On-chain Oracle',
              teePlatform: (market.tee.platform ?? 'unknown') as TEEPlatform,
              mrEnclave: market.tee.mrEnclave,
              mrSigner: market.tee.mrSigner,
            }}
            status={market.tee.status as AttestationStatus}
            expiresAt={market.tee.expiresAt}
            defaultExpanded={false}
          />
        </div>
      )}

      {/* TEE Pending - simple badge when attestation data incomplete */}
      {market.tee?.enabled &&
        (!market.tee.mrEnclave || !market.tee.mrSigner) && (
          <div className="card p-4 mt-4">
            <div className="flex items-center gap-2">
              <span className="text-lg">🔒</span>
              <div>
                <h3
                  className="text-sm font-semibold"
                  style={{ color: 'var(--text-primary)' }}
                >
                  TEE-Backed Oracle
                </h3>
                <p
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {market.tee.status === 'pending'
                    ? 'Attestation pending verification'
                    : 'Awaiting attestation data'}
                </p>
              </div>
            </div>
          </div>
        )}
    </div>
  )
}
