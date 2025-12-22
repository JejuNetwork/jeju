'use client'

import { TokenLaunchpadAbi } from '@jejunetwork/contracts'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { type Address, formatEther } from 'viem'
import { useAccount, useReadContract } from 'wagmi'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { getLaunchpadContracts, hasLaunchpad } from '@/config/contracts'
import {
  formatBondingCurvePrice,
  formatProgress,
  formatTimeRemaining,
  useBondingCurve,
  useBondingCurveQuote,
  useICOPresale,
} from '@/hooks/launchpad'
import {
  getContractDetails,
  getTokenHolders,
  getTokenTransfers,
} from '@/lib/indexer-client'

interface PageProps {
  params: Promise<{
    chainId: string
    address: string
  }>
}

function BondingCurvePanel({
  bondingCurveAddress,
  tokenAddress,
}: {
  bondingCurveAddress: Address
  tokenAddress: string
}) {
  const { isConnected } = useAccount()
  const [buyAmount, setBuyAmount] = useState('')
  const [sellAmount, setSellAmount] = useState('')
  const [mode, setMode] = useState<'buy' | 'sell'>('buy')

  const {
    stats,
    graduated,
    lpPair,
    graduationTarget,
    txHash,
    isPending,
    isSuccess,
    error,
    buy,
    sell,
  } = useBondingCurve(bondingCurveAddress)

  const { tokensOut, priceImpact } = useBondingCurveQuote(
    bondingCurveAddress,
    mode === 'buy' ? buyAmount : sellAmount,
    mode,
  )

  useEffect(() => {
    if (isSuccess && txHash) {
      toast.success(mode === 'buy' ? 'Tokens purchased.' : 'Tokens sold.')
      setBuyAmount('')
      setSellAmount('')
    }
  }, [isSuccess, txHash, mode])

  useEffect(() => {
    if (error) {
      toast.error('Transaction failed', { description: error.message })
    }
  }, [error])

  const handleBuy = () => {
    if (!buyAmount || parseFloat(buyAmount) <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    buy(buyAmount, '0')
  }

  const handleSell = () => {
    if (!sellAmount || parseFloat(sellAmount) <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    sell(sellAmount, '0')
  }

  if (graduated) {
    return (
      <div className="card p-5 md:p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">🎓</span>
          <h2
            className="text-xl font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            Graduated to LP
          </h2>
        </div>
        <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
          This token has graduated from the bonding curve and now trades on the
          LP pool.
        </p>
        {lpPair && (
          <p
            className="text-sm font-mono"
            style={{ color: 'var(--text-tertiary)' }}
          >
            LP Pair: {lpPair}
          </p>
        )}
        <a
          href={`/swap?token=${tokenAddress}`}
          className="btn-primary mt-4 inline-block"
        >
          Trade on DEX
        </a>
      </div>
    )
  }

  return (
    <div className="card p-5 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2
          className="text-xl font-semibold"
          style={{ color: 'var(--text-primary)' }}
        >
          📈 Bonding Curve
        </h2>
        {stats && (
          <span className="px-3 py-1 rounded-full text-sm font-medium bg-bazaar-primary/20 text-bazaar-primary">
            {formatProgress(stats.progress)} to graduation
          </span>
        )}
      </div>

      {/* Progress Bar */}
      {stats && graduationTarget && (
        <div className="mb-6">
          <div
            className="flex justify-between text-sm mb-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span>{formatEther(stats.ethCollected)} ETH raised</span>
            <span>{formatEther(graduationTarget)} ETH target</span>
          </div>
          <div className="h-3 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-bazaar-primary to-bazaar-accent transition-all duration-500"
              style={{ width: `${Math.min(stats.progress / 100, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="p-3 rounded-xl bg-[var(--bg-secondary)]">
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Current Price
            </p>
            <p
              className="font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              {formatBondingCurvePrice(stats.price)} ETH
            </p>
          </div>
          <div className="p-3 rounded-xl bg-[var(--bg-secondary)]">
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Tokens Available
            </p>
            <p
              className="font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              {Number(formatEther(stats.tokensRemaining)).toLocaleString(
                undefined,
                { maximumFractionDigits: 0 },
              )}
            </p>
          </div>
        </div>
      )}

      {/* Trade Tabs */}
      <div className="flex mb-4 border-b border-[var(--border-primary)]">
        <button
          onClick={() => setMode('buy')}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            mode === 'buy'
              ? 'text-bazaar-accent border-b-2 border-bazaar-accent'
              : 'text-[var(--text-tertiary)]'
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setMode('sell')}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            mode === 'sell'
              ? 'text-bazaar-error border-b-2 border-bazaar-error'
              : 'text-[var(--text-tertiary)]'
          }`}
        >
          Sell
        </button>
      </div>

      {/* Buy Section */}
      {mode === 'buy' && (
        <div>
          <label
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            ETH Amount
          </label>
          <input
            type="number"
            value={buyAmount}
            onChange={(e) => setBuyAmount(e.target.value)}
            placeholder="0.0"
            className="input w-full mb-2"
          />
          {tokensOut && buyAmount && (
            <p
              className="text-sm mb-4"
              style={{ color: 'var(--text-secondary)' }}
            >
              You will receive ~
              {Number(formatEther(tokensOut)).toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}{' '}
              tokens
              {priceImpact > 1 && (
                <span className="text-bazaar-warning ml-2">
                  ({priceImpact.toFixed(2)}% slippage)
                </span>
              )}
            </p>
          )}
          <button
            onClick={handleBuy}
            disabled={!isConnected || isPending || !buyAmount}
            className="btn-accent w-full py-3 disabled:opacity-50"
          >
            {isPending ? 'Buying...' : 'Buy Tokens'}
          </button>
        </div>
      )}

      {/* Sell Section */}
      {mode === 'sell' && (
        <div>
          <label
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Token Amount
          </label>
          <input
            type="number"
            value={sellAmount}
            onChange={(e) => setSellAmount(e.target.value)}
            placeholder="0.0"
            className="input w-full mb-4"
          />
          <button
            onClick={handleSell}
            disabled={!isConnected || isPending || !sellAmount}
            className="w-full py-3 rounded-xl font-semibold bg-bazaar-error text-white hover:bg-bazaar-error/80 transition-all disabled:opacity-50"
          >
            {isPending ? 'Selling...' : 'Sell Tokens'}
          </button>
        </div>
      )}
    </div>
  )
}

function PresalePanel({ presaleAddress }: { presaleAddress: Address }) {
  const { isConnected } = useAccount()
  const [contributeAmount, setContributeAmount] = useState('')

  const {
    status,
    contribution,
    config,
    canClaim,
    canRefund,
    txHash,
    isPending,
    isSuccess,
    error,
    contribute,
    claim,
    refund,
    finalize,
  } = useICOPresale(presaleAddress)

  useEffect(() => {
    if (isSuccess && txHash) {
      toast.success('Transaction successful.')
      setContributeAmount('')
    }
  }, [isSuccess, txHash])

  useEffect(() => {
    if (error) {
      toast.error('Transaction failed', { description: error.message })
    }
  }, [error])

  const handleContribute = () => {
    if (!contributeAmount || parseFloat(contributeAmount) <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    contribute(contributeAmount)
  }

  if (!status) {
    return <LoadingSpinner />
  }

  return (
    <div className="card p-5 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2
          className="text-xl font-semibold"
          style={{ color: 'var(--text-primary)' }}
        >
          💰 Presale
        </h2>
        {status.isActive && (
          <span className="px-3 py-1 rounded-full text-sm font-medium bg-green-500/20 text-green-400">
            Live
          </span>
        )}
        {status.isFinalized && !status.isFailed && (
          <span className="px-3 py-1 rounded-full text-sm font-medium bg-bazaar-primary/20 text-bazaar-primary">
            Successful
          </span>
        )}
        {status.isFailed && (
          <span className="px-3 py-1 rounded-full text-sm font-medium bg-bazaar-error/20 text-bazaar-error">
            Failed
          </span>
        )}
      </div>

      {/* Progress */}
      <div className="mb-6">
        <div
          className="flex justify-between text-sm mb-2"
          style={{ color: 'var(--text-secondary)' }}
        >
          <span>{formatEther(status.raised)} ETH raised</span>
          <span>{config ? formatEther(config.hardCap) : '?'} ETH hard cap</span>
        </div>
        <div className="h-3 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-bazaar-primary to-bazaar-accent transition-all"
            style={{ width: `${Math.min(status.progress / 100, 100)}%` }}
          />
        </div>
        {status.timeRemaining > 0n && (
          <p className="text-sm mt-2" style={{ color: 'var(--text-tertiary)' }}>
            {formatTimeRemaining(status.timeRemaining)} remaining
          </p>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-3 rounded-xl bg-[var(--bg-secondary)]">
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Participants
          </p>
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            {status.participants.toString()}
          </p>
        </div>
        <div className="p-3 rounded-xl bg-[var(--bg-secondary)]">
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Price
          </p>
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            {config ? formatEther(config.presalePrice) : '?'} ETH
          </p>
        </div>
      </div>

      {/* User Contribution */}
      {contribution !== undefined && contribution.ethAmount > 0n ? (
        <div className="p-4 rounded-xl bg-bazaar-primary/10 border border-bazaar-primary/30 mb-4">
          <p
            className="text-sm font-medium mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Your Contribution
          </p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {formatEther(contribution.ethAmount)} ETH →{' '}
            {Number(formatEther(contribution.tokenAllocation)).toLocaleString()}{' '}
            tokens
          </p>
          {contribution.claimable > 0n && (
            <p className="text-sm text-bazaar-accent mt-1">
              {Number(formatEther(contribution.claimable)).toLocaleString()}{' '}
              tokens claimable
            </p>
          )}
        </div>
      ) : null}

      {/* Actions */}
      {status.isActive && (
        <div>
          <label
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Contribute ETH
          </label>
          <input
            type="number"
            value={contributeAmount}
            onChange={(e) => setContributeAmount(e.target.value)}
            placeholder="0.0"
            className="input w-full mb-4"
          />
          <button
            onClick={handleContribute}
            disabled={!isConnected || isPending || !contributeAmount}
            className="btn-primary w-full py-3 disabled:opacity-50"
          >
            {isPending ? 'Processing...' : 'Contribute'}
          </button>
        </div>
      )}

      {canClaim && (
        <button
          onClick={() => claim()}
          disabled={isPending}
          className="btn-accent w-full py-3 disabled:opacity-50"
        >
          {isPending ? 'Claiming...' : 'Claim Tokens'}
        </button>
      )}

      {canRefund && (
        <button
          onClick={() => refund()}
          disabled={isPending}
          className="w-full py-3 rounded-xl font-semibold bg-bazaar-error text-white hover:bg-bazaar-error/80 transition-all disabled:opacity-50"
        >
          {isPending ? 'Processing...' : 'Claim Refund'}
        </button>
      )}

      {!status.isActive && !status.isFinalized && (
        <button
          onClick={() => finalize()}
          disabled={isPending}
          className="btn-secondary w-full py-3 disabled:opacity-50"
        >
          {isPending ? 'Finalizing...' : 'Finalize Presale'}
        </button>
      )}
    </div>
  )
}

import { use } from 'react'

export default function TokenDetailPage({ params }: PageProps) {
  const resolvedParams = use(params)
  useAccount()
  const chainId = parseInt(resolvedParams.chainId, 10)
  const tokenAddress = resolvedParams.address as Address

  // Check if token was launched via launchpad
  const launchpadContracts = getLaunchpadContracts(chainId)
  const { data: rawLaunchId } = useReadContract({
    address: launchpadContracts?.tokenLaunchpad,
    abi: TokenLaunchpadAbi,
    functionName: 'tokenToLaunchId',
    args: [tokenAddress],
    query: {
      enabled: !!launchpadContracts?.tokenLaunchpad && hasLaunchpad(chainId),
    },
  })
  const launchId = rawLaunchId as bigint | undefined

  // Get launch info if exists
  const { data: launchInfo } = useReadContract({
    address: launchpadContracts?.tokenLaunchpad,
    abi: TokenLaunchpadAbi,
    functionName: 'getLaunch',
    args: launchId && launchId > 0n ? [launchId] : undefined,
    query: { enabled: !!launchId && launchId > 0n },
  })

  const { data: tokenData, isLoading: isLoadingToken } = useQuery({
    queryKey: ['token-details', resolvedParams.address],
    queryFn: () => getContractDetails(resolvedParams.address),
    refetchInterval: 10000,
  })

  const { data: transfers, isLoading: isLoadingTransfers } = useQuery({
    queryKey: ['token-transfers', resolvedParams.address],
    queryFn: () => getTokenTransfers(resolvedParams.address, 20),
    refetchInterval: 10000,
  })

  const { data: holders, isLoading: isLoadingHolders } = useQuery({
    queryKey: ['token-holders', resolvedParams.address],
    queryFn: () => getTokenHolders(resolvedParams.address, 20),
    refetchInterval: 10000,
  })

  if (isLoadingToken) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!tokenData) {
    return (
      <div className="text-center py-20">
        <div className="text-6xl md:text-7xl mb-4">❌</div>
        <h2
          className="text-xl md:text-2xl font-semibold mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Token Not Found
        </h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          This token hasn't been indexed yet or doesn't exist
        </p>
      </div>
    )
  }

  // Parse launch info
  const isLaunchpadToken = launchId && launchId > 0n
  const launch = launchInfo as
    | {
        launchType: number
        bondingCurve: Address
        presale: Address
        feeConfig: { creatorFeeBps: number; communityFeeBps: number }
        graduated: boolean
      }
    | undefined
  const hasBondingCurve =
    launch?.bondingCurve &&
    launch.bondingCurve !== '0x0000000000000000000000000000000000000000'
  const hasPresale =
    launch?.presale &&
    launch.presale !== '0x0000000000000000000000000000000000000000'

  return (
    <div>
      {/* Token Header */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-gradient-to-br from-bazaar-primary to-bazaar-purple flex items-center justify-center text-2xl md:text-3xl font-bold text-white">
            {tokenData.address.slice(2, 4).toUpperCase()}
          </div>
          <div>
            <h1
              className="text-2xl md:text-4xl font-bold mb-1"
              style={{ color: 'var(--text-primary)' }}
            >
              {tokenData.address.slice(0, 6)}...{tokenData.address.slice(-4)}
            </h1>
            <div className="flex items-center gap-2">
              <p style={{ color: 'var(--text-secondary)' }}>
                ERC20 Token on Jeju
              </p>
              {isLaunchpadToken && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-bazaar-primary/20 text-bazaar-primary">
                  {launch?.launchType === 0 ? 'Pump Style' : 'ICO'}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <div className="stat-card">
            <p className="stat-label">Contract</p>
            <p
              className="font-mono text-sm truncate"
              style={{ color: 'var(--text-primary)' }}
            >
              {tokenData.address.slice(0, 10)}...
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Creator</p>
            <p
              className="font-mono text-sm truncate"
              style={{ color: 'var(--text-primary)' }}
            >
              {tokenData.creator.address.slice(0, 10)}...
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Created</p>
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
              {new Date(tokenData.creationBlock.timestamp).toLocaleDateString()}
            </p>
          </div>
          {isLaunchpadToken && launch && (
            <div className="stat-card">
              <p className="stat-label">Fee Split</p>
              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {launch.feeConfig.creatorFeeBps / 100}% /{' '}
                {launch.feeConfig.communityFeeBps / 100}%
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trading Panel */}
        <div className="lg:col-span-2 space-y-6">
          {/* Bonding Curve Panel */}
          {hasBondingCurve && launch && (
            <BondingCurvePanel
              bondingCurveAddress={launch.bondingCurve}
              tokenAddress={resolvedParams.address}
            />
          )}

          {/* Presale Panel */}
          {hasPresale && launch && (
            <PresalePanel presaleAddress={launch.presale} />
          )}

          {/* Standard Trade Panel (for non-launchpad or graduated tokens) */}
          {(!isLaunchpadToken || launch?.graduated) &&
            !hasBondingCurve &&
            !hasPresale && (
              <div className="card p-5 md:p-6">
                <h2
                  className="text-xl md:text-2xl font-semibold mb-6"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Trade
                </h2>
                <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
                  This token trades on the DEX. Use the swap interface to buy or
                  sell.
                </p>
                <a
                  href={`/swap?token=${resolvedParams.address}`}
                  className="btn-primary inline-block"
                >
                  Go to Swap
                </a>
              </div>
            )}

          {/* Recent Transfers */}
          <div className="card p-5 md:p-6">
            <h2
              className="text-lg md:text-xl font-semibold mb-4"
              style={{ color: 'var(--text-primary)' }}
            >
              Recent Transfers
            </h2>
            {isLoadingTransfers && <LoadingSpinner />}
            {transfers && transfers.length === 0 && (
              <p
                className="text-center py-8"
                style={{ color: 'var(--text-tertiary)' }}
              >
                No transfers yet
              </p>
            )}
            {transfers && transfers.length > 0 && (
              <div className="space-y-3">
                {transfers.map((transfer) => (
                  <div
                    key={transfer.id}
                    className="p-4 rounded-xl"
                    style={{ backgroundColor: 'var(--bg-secondary)' }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span
                          className="font-mono"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {transfer.from.address.slice(0, 6)}...
                        </span>
                        <span style={{ color: 'var(--text-tertiary)' }}>→</span>
                        <span
                          className="font-mono"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {transfer.to.address.slice(0, 6)}...
                        </span>
                      </div>
                      <span
                        className="text-xs"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        {new Date(transfer.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span
                        className="font-semibold"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {Number(transfer.value) / 1e18} tokens
                      </span>
                      <a
                        href={`http://localhost:4004/tx/${transfer.transaction.hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-bazaar-primary hover:underline"
                      >
                        View Tx
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Holders Panel */}
        <div className="card p-5 md:p-6 h-fit">
          <h2
            className="text-lg md:text-xl font-semibold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            Top Holders
          </h2>
          {isLoadingHolders && <LoadingSpinner />}
          {holders && holders.length === 0 && (
            <p
              className="text-center py-8"
              style={{ color: 'var(--text-tertiary)' }}
            >
              No holders yet
            </p>
          )}
          {holders && holders.length > 0 && (
            <div className="space-y-3">
              {holders.map((holder, index) => (
                <div
                  key={holder.id}
                  className="flex items-center justify-between p-3 rounded-xl"
                  style={{ backgroundColor: 'var(--bg-secondary)' }}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="text-sm font-semibold"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      #{index + 1}
                    </span>
                    <span
                      className="text-sm font-mono"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {holder.account.address.slice(0, 6)}...
                      {holder.account.address.slice(-4)}
                    </span>
                  </div>
                  <div className="text-right">
                    <p
                      className="text-sm font-semibold"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {(Number(holder.balance) / 1e18).toLocaleString(
                        undefined,
                        {
                          maximumFractionDigits: 2,
                        },
                      )}
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {holder.transferCount} transfers
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
