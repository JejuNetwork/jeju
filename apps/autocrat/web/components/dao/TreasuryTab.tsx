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
    <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-bold">
            {balance.symbol.charAt(0)}
          </div>
          <div>
            <p className="font-medium text-slate-200">{balance.token}</p>
            <p className="text-xs text-slate-500">{balance.symbol}</p>
          </div>
        </div>
        <div
          className={`flex items-center gap-1 text-xs ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}
        >
          {isPositive ? (
            <TrendingUp className="w-3 h-3" />
          ) : (
            <TrendingDown className="w-3 h-3" />
          )}
          {Math.abs(balance.change24h)}%
        </div>
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{balance.balance}</p>
        <p className="text-sm text-slate-500">${balance.usdValue} USD</p>
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
    <div className="flex items-center gap-4 p-4 bg-slate-900/50 border border-slate-700/50 rounded-xl hover:border-slate-600 transition-colors">
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center ${
          isInflow ? 'bg-emerald-500/20' : 'bg-red-500/20'
        }`}
      >
        {isInflow ? (
          <ArrowDownLeft className="w-5 h-5 text-emerald-400" />
        ) : (
          <ArrowUpRight className="w-5 h-5 text-red-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-slate-200 line-clamp-1">{tx.description}</p>
        <p className="text-xs text-slate-500">{formatDate(tx.timestamp)}</p>
      </div>
      <div className="text-right">
        <p
          className={`font-medium ${isInflow ? 'text-emerald-400' : 'text-red-400'}`}
        >
          {isInflow ? '+' : '-'}
          {tx.amount} {tx.token}
        </p>
        <a
          href={`https://etherscan.io/tx/${tx.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300"
        >
          View tx
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  )
}

export function TreasuryTab({ dao }: TreasuryTabProps) {
  const {
    data: treasuryData,
    isLoading,
    isError,
    error,
    refetch,
  } = useTreasury(dao.daoId)

  const balances: TreasuryBalance[] = treasuryData?.balances ?? []
  const transactions: TreasuryTransaction[] = treasuryData?.transactions ?? []

  const totalUsdValue = treasuryData?.totalUsdValue
    ? Number.parseFloat(treasuryData.totalUsdValue.replace(/,/g, ''))
    : balances.reduce(
        (sum, b) => sum + Number.parseFloat(b.usdValue.replace(/,/g, '')),
        0,
      )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="w-16 h-16 mb-4 rounded-2xl bg-red-500/20 border border-red-500/30 flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-red-400" />
        </div>
        <h3 className="text-lg font-medium text-slate-300 mb-2">
          Failed to load treasury
        </h3>
        <p className="text-slate-500 mb-4 text-center max-w-md">
          {error instanceof Error ? error.message : 'Treasury data unavailable'}
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div>
      {/* Total Value */}
      <div className="mb-6 bg-gradient-to-br from-violet-600/20 to-indigo-600/20 border border-violet-500/30 rounded-2xl p-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-violet-500/20 flex items-center justify-center">
            <Wallet className="w-7 h-7 text-violet-400" />
          </div>
          <div>
            <p className="text-sm text-violet-300">Total Treasury Value</p>
            <p className="text-3xl font-bold text-white">
              ${totalUsdValue.toLocaleString()}
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-4 text-sm text-slate-400">
          <span>
            Treasury Address:{' '}
            <a
              href={`https://etherscan.io/address/${dao.treasury}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet-400 hover:text-violet-300"
            >
              {dao.treasury.slice(0, 6)}...{dao.treasury.slice(-4)}
            </a>
          </span>
        </div>
      </div>

      {/* Token Balances */}
      <div className="mb-8">
        <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">
          Token Balances
        </h3>
        {balances.length === 0 ? (
          <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-8 text-center">
            <p className="text-slate-500">No token balances found</p>
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
        <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">
          Funding Configuration
        </h3>
        <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-slate-500 mb-1">Min Stake</p>
              <p className="text-lg font-semibold text-slate-200">
                {dao.fundingConfig.minStake} ETH
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Max Stake</p>
              <p className="text-lg font-semibold text-slate-200">
                {dao.fundingConfig.maxStake} ETH
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Matching Multiplier</p>
              <p className="text-lg font-semibold text-slate-200">
                {dao.fundingConfig.matchingMultiplier}x
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Treasury Fee</p>
              <p className="text-lg font-semibold text-slate-200">
                {dao.fundingConfig.treasuryFeePercent}%
              </p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-700 flex items-center gap-4 text-sm">
            <span
              className={`px-3 py-1 rounded-lg ${
                dao.fundingConfig.quadraticEnabled
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-slate-700 text-slate-400'
              }`}
            >
              Quadratic Funding:{' '}
              {dao.fundingConfig.quadraticEnabled ? 'Enabled' : 'Disabled'}
            </span>
            <span className="text-slate-500">
              CEO Weight Cap: {dao.fundingConfig.ceoWeightCap}%
            </span>
          </div>
        </div>
      </div>

      {/* Recent Transactions */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
            Recent Transactions
          </h3>
          {transactions.length > 0 && (
            <button
              type="button"
              className="text-sm text-violet-400 hover:text-violet-300 transition-colors"
            >
              View All
            </button>
          )}
        </div>
        {transactions.length === 0 ? (
          <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-8 text-center">
            <p className="text-slate-500">No transactions yet</p>
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
