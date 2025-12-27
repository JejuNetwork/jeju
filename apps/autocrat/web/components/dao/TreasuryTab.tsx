/**
 * Treasury Tab - Financial Overview
 *
 * Display token balances, transactions, and funding configuration.
 */

import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTreasury } from '../../hooks/useDAO'
import type { DAODetail } from '../../types/dao'

interface TreasuryTabProps {
  dao: DAODetail
}

interface TreasuryBalance {
  token: string
  symbol: string
  balance: string
  usdValue: string
  change24h: number
}

interface TreasuryTransaction {
  id: string
  type: 'inflow' | 'outflow'
  description: string
  amount: string
  token: string
  timestamp: number
  txHash: string
  proposalId?: string
}

function BalanceCard({ balance }: { balance: TreasuryBalance }) {
  const isPositive = balance.change24h >= 0

  return (
    <div
      className="rounded-xl p-4"
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
            style={{ background: 'var(--gradient-secondary)' }}
          >
            {balance.symbol.charAt(0)}
          </div>
          <div>
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
              {balance.token}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {balance.symbol}
            </p>
          </div>
        </div>
        <div
          className="flex items-center gap-1 text-xs"
          style={{ color: isPositive ? 'var(--color-success)' : 'var(--color-error)' }}
        >
          {isPositive ? (
            <TrendingUp className="w-3 h-3" aria-hidden="true" />
          ) : (
            <TrendingDown className="w-3 h-3" aria-hidden="true" />
          )}
          {Math.abs(balance.change24h)}%
        </div>
      </div>
      <div>
        <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          {balance.balance}
        </p>
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          ${balance.usdValue} USD
        </p>
      </div>
    </div>
  )
}

function TransactionRow({ tx }: { tx: TreasuryTransaction }) {
  const isInflow = tx.type === 'inflow'

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <div
      className="flex items-center gap-4 p-4 rounded-xl transition-colors"
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center"
        style={{
          backgroundColor: isInflow
            ? 'rgba(16, 185, 129, 0.12)'
            : 'rgba(239, 68, 68, 0.12)',
        }}
      >
        {isInflow ? (
          <ArrowDownLeft
            className="w-5 h-5"
            style={{ color: 'var(--color-success)' }}
            aria-hidden="true"
          />
        ) : (
          <ArrowUpRight
            className="w-5 h-5"
            style={{ color: 'var(--color-error)' }}
            aria-hidden="true"
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="line-clamp-1" style={{ color: 'var(--text-primary)' }}>
          {tx.description}
        </p>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {formatDate(tx.timestamp)}
        </p>
      </div>
      <div className="text-right">
        <p
          className="font-medium"
          style={{ color: isInflow ? 'var(--color-success)' : 'var(--color-error)' }}
        >
          {isInflow ? '+' : '-'}{tx.amount} {tx.token}
        </p>
        <a
          href={`https://etherscan.io/tx/${tx.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs transition-colors"
          style={{ color: 'var(--text-tertiary)' }}
        >
          View tx
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
      </div>
    </div>
  )
}

export function TreasuryTab({ dao }: TreasuryTabProps) {
  const { data: treasuryData, isLoading, isError, error, refetch } = useTreasury(dao.daoId)

  const balances: TreasuryBalance[] = treasuryData?.balances ?? []
  const transactions: TreasuryTransaction[] = treasuryData?.transactions ?? []

  const totalUsdValue = useMemo(() => {
    if (treasuryData?.totalUsdValue) {
      return Number.parseFloat(treasuryData.totalUsdValue.replace(/,/g, ''))
    }
    return balances.reduce(
      (sum, b) => sum + Number.parseFloat(b.usdValue.replace(/,/g, '')),
      0
    )
  }, [treasuryData, balances])

  const handleRetry = useCallback(() => {
    refetch()
  }, [refetch])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2
          className="w-8 h-8 animate-spin"
          style={{ color: 'var(--color-primary)' }}
        />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div
          className="w-16 h-16 mb-4 rounded-2xl flex items-center justify-center"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
          }}
        >
          <AlertCircle className="w-8 h-8" style={{ color: 'var(--color-error)' }} />
        </div>
        <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
          Failed to load treasury
        </h3>
        <p
          className="mb-4 text-center max-w-md"
          style={{ color: 'var(--text-secondary)' }}
        >
          {error instanceof Error ? error.message : 'Connection error'}
        </p>
        <button
          type="button"
          onClick={handleRetry}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl transition-colors"
          style={{
            backgroundColor: 'var(--surface)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
          }}
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div>
      {/* Total Value */}
      <div
        className="mb-6 rounded-2xl p-6"
        style={{
          background: 'var(--gradient-hero)',
        }}
      >
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.2)' }}
          >
            <Wallet className="w-7 h-7 text-white" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm text-white/70">Total Treasury Value</p>
            <p className="text-3xl font-bold text-white">
              ${totalUsdValue.toLocaleString()}
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-4 text-sm text-white/70">
          <span>
            Treasury Address:{' '}
            <a
              href={`https://etherscan.io/address/${dao.treasury}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/90 hover:text-white"
            >
              {dao.treasury.slice(0, 6)}...{dao.treasury.slice(-4)}
            </a>
          </span>
        </div>
      </div>

      {/* Token Balances */}
      <div className="mb-8">
        <h3
          className="text-sm font-medium uppercase tracking-wider mb-4"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Token Balances
        </h3>
        {balances.length === 0 ? (
          <div
            className="rounded-xl p-8 text-center"
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
          >
            <p style={{ color: 'var(--text-tertiary)' }}>No tokens held</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {balances.map((balance) => (
              <BalanceCard key={balance.token} balance={balance} />
            ))}
          </div>
        )}
      </div>

      {/* Funding Config */}
      <div className="mb-8">
        <h3
          className="text-sm font-medium uppercase tracking-wider mb-4"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Funding Configuration
        </h3>
        <div
          className="rounded-xl p-5"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
                Min Stake
              </p>
              <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {dao.fundingConfig.minStake} ETH
              </p>
            </div>
            <div>
              <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
                Max Stake
              </p>
              <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {dao.fundingConfig.maxStake} ETH
              </p>
            </div>
            <div>
              <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
                Matching Multiplier
              </p>
              <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {dao.fundingConfig.matchingMultiplier}x
              </p>
            </div>
            <div>
              <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
                Treasury Fee
              </p>
              <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {dao.fundingConfig.treasuryFeePercent}%
              </p>
            </div>
          </div>
          <div
            className="mt-4 pt-4 border-t flex items-center gap-4 text-sm"
            style={{ borderColor: 'var(--border)' }}
          >
            <span
              className="px-3 py-1 rounded-lg"
              style={{
                backgroundColor: dao.fundingConfig.quadraticEnabled
                  ? 'rgba(16, 185, 129, 0.12)'
                  : 'var(--bg-secondary)',
                color: dao.fundingConfig.quadraticEnabled
                  ? 'var(--color-success)'
                  : 'var(--text-tertiary)',
              }}
            >
              Quadratic Funding: {dao.fundingConfig.quadraticEnabled ? 'Enabled' : 'Disabled'}
            </span>
            <span style={{ color: 'var(--text-tertiary)' }}>
              CEO Weight Cap: {dao.fundingConfig.ceoWeightCap}%
            </span>
          </div>
        </div>
      </div>

      {/* Recent Transactions */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3
            className="text-sm font-medium uppercase tracking-wider"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Recent Transactions
          </h3>
          {transactions.length > 0 && (
            <button
              type="button"
              className="text-sm transition-colors"
              style={{ color: 'var(--color-primary)' }}
            >
              View All
            </button>
          )}
        </div>
        {transactions.length === 0 ? (
          <div
            className="rounded-xl p-8 text-center"
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
          >
            <p style={{ color: 'var(--text-tertiary)' }}>No transaction history</p>
          </div>
        ) : (
          <div className="space-y-3">
            {transactions.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
