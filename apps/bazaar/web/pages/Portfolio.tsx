/**
 * Portfolio Page
 *
 * Display user's token balances, NFTs, and transaction history with real data.
 */

import {
  ArrowDownRight,
  ArrowUpRight,
  ExternalLink,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { zeroAddress } from 'viem'
import { useAccount } from 'wagmi'
import { EXPLORER_URL } from '../../config'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { EmptyState, Grid, PageHeader, StatCard } from '../components/ui'
import {
  type ActivityTx,
  type NFTItem,
  type PortfolioData,
  type TokenBalance,
  usePortfolio,
  useRecentActivity,
} from '../hooks/usePortfolio'
import { useETHPrice } from '../hooks/usePriceOracle'

function formatUSD(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(2)}K`
  }
  return formatUSD(value)
}

function formatTokenAmount(value: string, decimals: number = 18): string {
  const num = parseFloat(value)
  if (num === 0) return '0'
  if (num < 0.001) return '< 0.001'
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`
  return num.toFixed(Math.min(4, decimals))
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export default function PortfolioPage() {
  const { address, isConnected } = useAccount()
  const { data: portfolio, isLoading, refetch, isRefetching } = usePortfolio()
  const { data: activity, isLoading: activityLoading } = useRecentActivity()
  const { data: ethPrice } = useETHPrice()

  // Calculate real portfolio values with live ETH price
  const portfolioWithPrices = useMemo((): PortfolioData | null => {
    if (!portfolio) return null

    const ethPriceUSD = ethPrice?.priceUSD ?? 0

    // Update ETH token with real price
    const tokensWithPrice: TokenBalance[] = portfolio.tokens.map((t) => {
      if (t.token.address === zeroAddress) {
        const valueUSD = parseFloat(t.balanceFormatted) * ethPriceUSD
        return {
          ...t,
          token: { ...t.token, priceUSD: ethPriceUSD },
          valueUSD,
        }
      }
      return t
    })

    const totalValueUSD = tokensWithPrice.reduce(
      (sum, t) => sum + t.valueUSD,
      0,
    )

    return {
      ...portfolio,
      tokens: tokensWithPrice,
      totalValueUSD,
    }
  }, [portfolio, ethPrice])

  if (!isConnected) {
    return (
      <EmptyState
        icon="📊"
        title="Portfolio"
        description="Connect your wallet to view your tokens, collectibles, and trading activity."
      />
    )
  }

  const changePositive = (portfolioWithPrices?.totalChange24h ?? 0) >= 0

  return (
    <div className="animate-fade-in">
      <PageHeader
        icon="📊"
        title="Portfolio"
        description={
          <span className="font-mono">
            {address?.slice(0, 10)}...{address?.slice(-8)}
          </span>
        }
        action={
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isRefetching}
            className="btn-secondary flex items-center gap-2"
            aria-label="Refresh portfolio"
          >
            <RefreshCw
              className={`w-4 h-4 ${isRefetching ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        }
      />

      {isLoading ? (
        <div className="flex justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <>
          {/* Stats Grid */}
          <Grid cols={4} className="mb-8">
            <StatCard
              icon="💰"
              label="Total Value"
              value={formatCompact(portfolioWithPrices?.totalValueUSD ?? 0)}
            />
            <StatCard
              icon={changePositive ? '📈' : '📉'}
              label="24h Change"
              value={`${changePositive ? '+' : ''}${(portfolioWithPrices?.totalChange24h ?? 0).toFixed(2)}%`}
              trend={{
                value: `${changePositive ? '+' : ''}${(portfolioWithPrices?.totalChange24h ?? 0).toFixed(2)}%`,
                positive: changePositive,
              }}
            />
            <StatCard
              icon="🪙"
              label="Tokens"
              value={String(portfolioWithPrices?.totalTokens ?? 0)}
            />
            <StatCard
              icon="🖼️"
              label="Items"
              value={String(portfolioWithPrices?.totalNFTs ?? 0)}
            />
          </Grid>

          {/* Holdings Sections */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Tokens */}
            <section className="card p-5">
              <header className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                  🪙 Tokens
                </h2>
                <Link
                  to="/coins"
                  className="text-sm text-primary-color hover:underline"
                >
                  Browse →
                </Link>
              </header>

              {!portfolioWithPrices?.tokens.length ? (
                <div className="text-center py-8">
                  <div
                    className="text-4xl mb-3 animate-float"
                    aria-hidden="true"
                  >
                    🪙
                  </div>
                  <p className="text-tertiary mb-4">No tokens found</p>
                  <Link to="/swap" className="btn-secondary text-sm">
                    Get Your First Token
                  </Link>
                </div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {portfolioWithPrices.tokens.map((tb) => (
                    <TokenRow key={tb.token.address} tokenBalance={tb} />
                  ))}
                </div>
              )}
            </section>

            {/* Collectibles */}
            <section className="card p-5">
              <header className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                  🖼️ Collectibles
                </h2>
                <Link
                  to="/items"
                  className="text-sm text-primary-color hover:underline"
                >
                  Browse →
                </Link>
              </header>

              {!portfolioWithPrices?.nfts.length ? (
                <div className="text-center py-8">
                  <div
                    className="text-4xl mb-3 animate-float"
                    aria-hidden="true"
                  >
                    🖼️
                  </div>
                  <p className="text-tertiary mb-4">No collectibles found</p>
                  <Link to="/items" className="btn-secondary text-sm">
                    Explore Items
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 max-h-80 overflow-y-auto">
                  {portfolioWithPrices.nfts.slice(0, 9).map((nft) => (
                    <NFTCard
                      key={`${nft.contractAddress}-${nft.tokenId}`}
                      nft={nft}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Recent Activity */}
          <section className="card p-5">
            <header className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                📜 Recent Activity
              </h2>
              {EXPLORER_URL && (
                <a
                  href={`${EXPLORER_URL}/address/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary-color hover:underline flex items-center gap-1"
                >
                  View All
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </header>

            {activityLoading ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner size="md" />
              </div>
            ) : !activity?.length ? (
              <div className="text-center py-8">
                <div className="text-4xl mb-3 animate-float" aria-hidden="true">
                  📜
                </div>
                <p className="text-tertiary">No recent activity</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {activity.map((tx) => (
                  <ActivityRow key={tx.id} tx={tx} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function TokenRow({ tokenBalance }: { tokenBalance: TokenBalance }) {
  const { token, balanceFormatted, valueUSD } = tokenBalance
  const change = token.priceChange24h ?? 0
  const isPositive = change >= 0

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface-secondary transition-colors">
      {/* Token Icon */}
      <div className="w-10 h-10 rounded-full bg-gradient-warm flex items-center justify-center flex-shrink-0">
        {token.logoUrl ? (
          <img
            src={token.logoUrl}
            alt={token.symbol}
            className="w-10 h-10 rounded-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <span className="text-white font-bold text-sm">
            {token.symbol.slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>

      {/* Token Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-primary truncate">
            {token.symbol}
          </span>
          {token.verified && (
            <span className="text-xs text-success" title="Verified">
              ✓
            </span>
          )}
        </div>
        <div className="text-xs text-tertiary truncate">{token.name}</div>
      </div>

      {/* Balance */}
      <div className="text-right">
        <div className="font-semibold text-primary">
          {formatTokenAmount(balanceFormatted)}
        </div>
        <div className="text-xs text-tertiary">{formatUSD(valueUSD)}</div>
      </div>

      {/* 24h Change */}
      <div
        className={`text-xs font-medium flex items-center gap-0.5 ${
          isPositive ? 'text-success' : 'text-error'
        }`}
      >
        {isPositive ? (
          <TrendingUp className="w-3 h-3" />
        ) : (
          <TrendingDown className="w-3 h-3" />
        )}
        {isPositive ? '+' : ''}
        {change.toFixed(2)}%
      </div>
    </div>
  )
}

function NFTCard({ nft }: { nft: NFTItem }) {
  return (
    <Link
      to={`/items/${nft.contractAddress}:${nft.tokenId}`}
      className="block aspect-square rounded-xl bg-surface-secondary hover:scale-105 transition-transform overflow-hidden"
    >
      {nft.tokenURI ? (
        <img
          src={
            nft.tokenURI.startsWith('ipfs://')
              ? nft.tokenURI.replace('ipfs://', 'https://ipfs.io/ipfs/')
              : nft.tokenURI
          }
          alt={`${nft.name} #${nft.tokenId}`}
          className="w-full h-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
            const parent = e.currentTarget.parentElement
            if (parent) {
              parent.innerHTML = `<div class="w-full h-full flex items-center justify-center text-2xl">🖼️</div>`
            }
          }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-2xl">
          🖼️
        </div>
      )}
    </Link>
  )
}

function ActivityRow({ tx }: { tx: ActivityTx }) {
  const isSend = tx.type === 'send'

  return (
    <a
      href={EXPLORER_URL ? `${EXPLORER_URL}/tx/${tx.txHash}` : '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface-secondary transition-colors"
    >
      {/* Direction Icon */}
      <div
        className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
          isSend ? 'bg-error/10' : 'bg-success/10'
        }`}
      >
        {isSend ? (
          <ArrowUpRight className="w-5 h-5 text-error" />
        ) : (
          <ArrowDownRight className="w-5 h-5 text-success" />
        )}
      </div>

      {/* TX Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-primary">
            {isSend ? 'Sent' : 'Received'} {tx.token.symbol}
          </span>
        </div>
        <div className="text-xs text-tertiary">
          {isSend ? 'To: ' : 'From: '}
          {(isSend ? tx.to : tx.from).slice(0, 8)}...
          {(isSend ? tx.to : tx.from).slice(-6)}
        </div>
      </div>

      {/* Amount */}
      <div className="text-right">
        <div
          className={`font-semibold ${isSend ? 'text-error' : 'text-success'}`}
        >
          {isSend ? '-' : '+'}
          {formatTokenAmount(tx.valueFormatted)} {tx.token.symbol}
        </div>
        <div className="text-xs text-tertiary">
          {formatTimeAgo(tx.timestamp)}
        </div>
      </div>

      <ExternalLink className="w-4 h-4 text-tertiary" />
    </a>
  )
}
