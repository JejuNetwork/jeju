import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileSignature,
  Loader2,
  RefreshCw,
  Shield,
  Users,
  Wallet,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import type { Address, Hex } from 'viem'
import {
  useAccount,
  useSendTransaction,
  useSignMessage,
  useWaitForTransactionReceipt,
} from 'wagmi'
import {
  useConfirmTransaction,
  useSafeInfo,
  useSafeTransactions,
} from '../../hooks/useSafe'
import type { DAODetail } from '../../types/dao'

interface SafeTransactionsTabProps {
  dao: DAODetail
  safeAddress: Address
}

interface SafeTransaction {
  safeTxHash: Hex
  to: Address
  value: string
  data: Hex
  operation: number
  nonce: number
  confirmations: Array<{
    owner: Address
    signature: Hex
    submissionDate: string
  }>
  confirmationsRequired: number
  isExecuted: boolean
  proposer: Address
  submissionDate: string
  executionDate?: string
  transactionHash?: Hex
}

type TransactionStatus =
  | 'pending'
  | 'awaiting_confirmations'
  | 'ready_to_execute'
  | 'executed'

function getTransactionStatus(tx: SafeTransaction): TransactionStatus {
  if (tx.isExecuted) return 'executed'
  if (tx.confirmations.length >= tx.confirmationsRequired)
    return 'ready_to_execute'
  if (tx.confirmations.length > 0) return 'awaiting_confirmations'
  return 'pending'
}

function StatusBadge({ status }: { status: TransactionStatus }) {
  const config = {
    pending: {
      label: 'Pending',
      bg: 'rgba(251, 191, 36, 0.12)',
      color: '#FBBF24',
      icon: Clock,
    },
    awaiting_confirmations: {
      label: 'Awaiting Signatures',
      bg: 'rgba(59, 130, 246, 0.12)',
      color: '#3B82F6',
      icon: FileSignature,
    },
    ready_to_execute: {
      label: 'Ready to Execute',
      bg: 'rgba(16, 185, 129, 0.12)',
      color: '#10B981',
      icon: CheckCircle2,
    },
    executed: {
      label: 'Executed',
      bg: 'rgba(107, 114, 128, 0.12)',
      color: '#6B7280',
      icon: CheckCircle2,
    },
  }[status]

  const Icon = config.icon

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full"
      style={{ backgroundColor: config.bg, color: config.color }}
    >
      <Icon className="w-3 h-3" aria-hidden="true" />
      {config.label}
    </span>
  )
}

function TransactionCard({
  tx,
  onSign,
  onExecute,
  userAddress,
  isConnected,
  isSigning,
  isExecuting,
}: {
  tx: SafeTransaction
  onSign: (safeTxHash: Hex) => void
  onExecute: (safeTxHash: Hex) => void
  userAddress?: Address
  isConnected: boolean
  isSigning: boolean
  isExecuting: boolean
}) {
  const status = getTransactionStatus(tx)
  const isOwner =
    userAddress &&
    tx.confirmations.some(
      (c) => c.owner.toLowerCase() === userAddress.toLowerCase(),
    )
  const canSign =
    isConnected && userAddress && status !== 'executed' && !isOwner
  const canExecute = isConnected && status === 'ready_to_execute'

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatAddress = (addr: Address) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`

  const formatValue = (value: string) => {
    const eth = Number.parseFloat(value) / 1e18
    return eth > 0 ? `${eth.toFixed(4)} ETH` : '0 ETH'
  }

  return (
    <div
      className="rounded-xl p-5 transition-all"
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-xs font-mono px-2 py-0.5 rounded"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-tertiary)',
              }}
            >
              #{tx.nonce}
            </span>
            <StatusBadge status={status} />
          </div>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            Proposed by {formatAddress(tx.proposer)}
          </p>
        </div>
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          {formatDate(tx.submissionDate)}
        </p>
      </div>

      {/* Transaction Details */}
      <div
        className="rounded-lg p-4 mb-4"
        style={{ backgroundColor: 'var(--bg-secondary)' }}
      >
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="mb-1" style={{ color: 'var(--text-tertiary)' }}>
              To
            </p>
            <p className="font-mono" style={{ color: 'var(--text-primary)' }}>
              {formatAddress(tx.to)}
            </p>
          </div>
          <div>
            <p className="mb-1" style={{ color: 'var(--text-tertiary)' }}>
              Value
            </p>
            <p style={{ color: 'var(--text-primary)' }}>
              {formatValue(tx.value)}
            </p>
          </div>
          {tx.data !== '0x' && (
            <div className="col-span-2">
              <p className="mb-1" style={{ color: 'var(--text-tertiary)' }}>
                Data
              </p>
              <p
                className="font-mono text-xs truncate"
                style={{ color: 'var(--text-secondary)' }}
              >
                {tx.data.slice(0, 66)}...
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Signatures Progress */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Signatures
          </p>
          <p
            className="text-sm font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            {tx.confirmations.length} / {tx.confirmationsRequired}
          </p>
        </div>
        <div
          className="h-2 rounded-full overflow-hidden"
          style={{ backgroundColor: 'var(--bg-secondary)' }}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${(tx.confirmations.length / tx.confirmationsRequired) * 100}%`,
              backgroundColor:
                tx.confirmations.length >= tx.confirmationsRequired
                  ? 'var(--color-success)'
                  : 'var(--color-primary)',
            }}
          />
        </div>
        {/* Signer list */}
        <div className="flex flex-wrap gap-2 mt-3">
          {tx.confirmations.map((conf) => (
            <span
              key={conf.owner}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg"
              style={{
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                color: 'var(--color-success)',
              }}
            >
              <CheckCircle2 className="w-3 h-3" />
              {formatAddress(conf.owner)}
            </span>
          ))}
        </div>
      </div>

      {/* Actions */}
      {status !== 'executed' && (
        <div className="flex gap-3">
          {canSign && (
            <button
              type="button"
              onClick={() => onSign(tx.safeTxHash)}
              disabled={isSigning}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundColor: 'var(--surface)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
              }}
            >
              {isSigning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing...
                </>
              ) : (
                <>
                  <FileSignature className="w-4 h-4" />
                  Sign
                </>
              )}
            </button>
          )}
          {canExecute && (
            <button
              type="button"
              onClick={() => onExecute(tx.safeTxHash)}
              disabled={isSigning || isExecuting}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'var(--gradient-primary)' }}
            >
              {isExecuting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Executing...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Execute
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Executed info */}
      {status === 'executed' && tx.transactionHash && (
        <a
          href={`https://basescan.org/tx/${tx.transactionHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm transition-colors"
          style={{ color: 'var(--color-primary)' }}
        >
          View on Explorer
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  )
}

function SafeInfoCard({ safeAddress }: { safeAddress: Address }) {
  const { data: safeInfo, isLoading, error } = useSafeInfo(safeAddress)

  if (isLoading) {
    return (
      <div
        className="rounded-xl p-5"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
        }}
      >
        <div className="flex items-center gap-3">
          <Loader2
            className="w-5 h-5 animate-spin"
            style={{ color: 'var(--color-primary)' }}
          />
          <span style={{ color: 'var(--text-secondary)' }}>
            Loading Safe info...
          </span>
        </div>
      </div>
    )
  }

  if (error || !safeInfo) {
    return (
      <div
        className="rounded-xl p-5"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
        }}
      >
        <div className="flex items-center gap-3">
          <AlertCircle
            className="w-5 h-5"
            style={{ color: 'var(--color-error)' }}
          />
          <span style={{ color: 'var(--text-secondary)' }}>
            {error?.message ?? 'Failed to load Safe info'}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--gradient-hero)',
      }}
    >
      <div className="flex items-center gap-4 mb-4">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: 'rgba(255, 255, 255, 0.2)' }}
        >
          <Shield className="w-6 h-6 text-white" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-white">Gnosis Safe</h3>
          <p className="text-sm text-white/70 font-mono">
            {safeAddress.slice(0, 10)}...{safeAddress.slice(-8)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-white/60 mb-1">Threshold</p>
          <p className="text-xl font-bold text-white">
            {safeInfo.threshold} of {safeInfo.owners.length}
          </p>
        </div>
        <div>
          <p className="text-xs text-white/60 mb-1">Owners</p>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-white" />
            <span className="text-xl font-bold text-white">
              {safeInfo.owners.length}
            </span>
          </div>
        </div>
        <div>
          <p className="text-xs text-white/60 mb-1">Nonce</p>
          <p className="text-xl font-bold text-white">{safeInfo.nonce}</p>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-white/10">
        <p className="text-xs text-white/60 mb-2">Safe Owners</p>
        <div className="flex flex-wrap gap-2">
          {safeInfo.owners.map((owner: Address) => (
            <span
              key={owner}
              className="text-xs font-mono px-2 py-1 rounded-lg bg-white/10 text-white/90"
            >
              {owner.slice(0, 6)}...{owner.slice(-4)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export function SafeTransactionsTab({ safeAddress }: SafeTransactionsTabProps) {
  const [filter, setFilter] = useState<'pending' | 'executed' | 'all'>(
    'pending',
  )
  const [signingTx, setSigningTx] = useState<Hex | null>(null)
  const [executingTx, setExecutingTx] = useState<Hex | null>(null)
  const [signError, setSignError] = useState<string | null>(null)
  const [pendingTxHash, setPendingTxHash] = useState<Hex | null>(null)

  const { address: userAddress, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const { sendTransactionAsync } = useSendTransaction()
  const confirmMutation = useConfirmTransaction()

  // Watch for transaction confirmation
  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({
      hash: pendingTxHash ?? undefined,
    })

  const {
    data: transactionsData,
    isLoading,
    isError,
    error,
    refetch,
  } = useSafeTransactions(safeAddress, filter === 'executed')

  const handleSign = useCallback(
    async (safeTxHash: Hex) => {
      if (!userAddress) {
        setSignError('Please connect your wallet to sign')
        return
      }

      setSigningTx(safeTxHash)
      setSignError(null)

      try {
        // Sign the Safe transaction hash with the connected wallet
        const signature = await signMessageAsync({
          message: { raw: safeTxHash },
        })

        // Submit the signature to the API
        await confirmMutation.mutateAsync({
          safeTxHash,
          signer: userAddress,
          signature,
        })

        // Refresh the transaction list
        refetch()
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to sign transaction'
        setSignError(message)
        console.error('Sign error:', err)
      } finally {
        setSigningTx(null)
      }
    },
    [userAddress, signMessageAsync, confirmMutation, refetch],
  )

  const handleExecute = useCallback(
    async (safeTxHash: Hex) => {
      if (!userAddress) {
        setSignError('Please connect your wallet to execute')
        return
      }

      setExecutingTx(safeTxHash)
      setSignError(null)

      try {
        // Build execute transaction from the API
        const baseUrl =
          import.meta.env.VITE_AUTOCRAT_API_URL ?? 'http://localhost:3001'
        const response = await fetch(
          `${baseUrl}/api/v1/safe/transactions/${safeTxHash}/execute`,
        )
        const json = await response.json()

        if (!json.success) {
          throw new Error(json.error ?? 'Failed to build execute transaction')
        }

        // Send the transaction via wagmi
        const txHash = await sendTransactionAsync({
          to: json.data.to as Address,
          data: json.data.data as Hex,
          value: BigInt(json.data.value ?? '0'),
        })

        setPendingTxHash(txHash)

        // Wait for confirmation then refresh
        refetch()
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to execute transaction'
        setSignError(message)
        console.error('Execute error:', err)
      } finally {
        setExecutingTx(null)
      }
    },
    [userAddress, sendTransactionAsync, refetch],
  )

  const handleRetry = useCallback(() => {
    refetch()
  }, [refetch])

  const transactions = useMemo(() => {
    return (transactionsData?.transactions ?? []) as SafeTransaction[]
  }, [transactionsData])

  const pendingCount = useMemo(() => {
    return transactions.filter((tx) => !tx.isExecuted).length
  }, [transactions])

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
          <AlertCircle
            className="w-8 h-8"
            style={{ color: 'var(--color-error)' }}
          />
        </div>
        <h3
          className="text-lg font-medium mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Failed to load transactions
        </h3>
        <p
          className="mb-4 text-center"
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
          <RefreshCw className="w-4 h-4" />
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div>
      {/* Safe Info */}
      <div className="mb-6">
        <SafeInfoCard safeAddress={safeAddress} />
      </div>

      {/* Wallet Connection Status */}
      {!isConnected && (
        <div
          className="mb-6 rounded-xl p-4 flex items-center gap-3"
          style={{
            backgroundColor: 'rgba(251, 191, 36, 0.12)',
            border: '1px solid rgba(251, 191, 36, 0.3)',
          }}
        >
          <Wallet className="w-5 h-5" style={{ color: '#FBBF24' }} />
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
            Connect your wallet to sign or execute Safe transactions
          </p>
        </div>
      )}

      {/* Error Message */}
      {signError && (
        <div
          className="mb-6 rounded-xl p-4 flex items-center gap-3"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
          }}
        >
          <AlertCircle
            className="w-5 h-5"
            style={{ color: 'var(--color-error)' }}
          />
          <p
            className="text-sm flex-1"
            style={{ color: 'var(--text-primary)' }}
          >
            {signError}
          </p>
          <button
            type="button"
            onClick={() => setSignError(null)}
            className="text-sm"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Transaction Pending Confirmation */}
      {pendingTxHash && isConfirming && (
        <div
          className="mb-6 rounded-xl p-4 flex items-center gap-3"
          style={{
            backgroundColor: 'rgba(59, 130, 246, 0.12)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
          }}
        >
          <Loader2
            className="w-5 h-5 animate-spin"
            style={{ color: '#3B82F6' }}
          />
          <p
            className="text-sm flex-1"
            style={{ color: 'var(--text-primary)' }}
          >
            Waiting for transaction confirmation...
          </p>
          <a
            href={`https://basescan.org/tx/${pendingTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm flex items-center gap-1"
            style={{ color: '#3B82F6' }}
          >
            View <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      {/* Transaction Confirmed */}
      {pendingTxHash && isConfirmed && (
        <div
          className="mb-6 rounded-xl p-4 flex items-center gap-3"
          style={{
            backgroundColor: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
          }}
        >
          <CheckCircle2
            className="w-5 h-5"
            style={{ color: 'var(--color-success)' }}
          />
          <p
            className="text-sm flex-1"
            style={{ color: 'var(--text-primary)' }}
          >
            Transaction executed successfully.
          </p>
          <a
            href={`https://basescan.org/tx/${pendingTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm flex items-center gap-1"
            style={{ color: 'var(--color-success)' }}
          >
            View <ExternalLink className="w-3 h-3" />
          </a>
          <button
            type="button"
            onClick={() => setPendingTxHash(null)}
            className="text-sm"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFilter('pending')}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-colors"
            style={{
              backgroundColor:
                filter === 'pending'
                  ? 'var(--color-primary)'
                  : 'var(--surface)',
              color: filter === 'pending' ? 'white' : 'var(--text-secondary)',
              border: filter !== 'pending' ? '1px solid var(--border)' : 'none',
            }}
          >
            Pending {pendingCount > 0 && `(${pendingCount})`}
          </button>
          <button
            type="button"
            onClick={() => setFilter('executed')}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-colors"
            style={{
              backgroundColor:
                filter === 'executed'
                  ? 'var(--color-primary)'
                  : 'var(--surface)',
              color: filter === 'executed' ? 'white' : 'var(--text-secondary)',
              border:
                filter !== 'executed' ? '1px solid var(--border)' : 'none',
            }}
          >
            Executed
          </button>
        </div>
        <button
          type="button"
          onClick={handleRetry}
          className="p-2 rounded-lg transition-colors"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
        >
          <RefreshCw
            className="w-4 h-4"
            style={{ color: 'var(--text-secondary)' }}
          />
        </button>
      </div>

      {/* Transactions List */}
      {transactions.length === 0 ? (
        <div
          className="rounded-xl p-12 text-center"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
        >
          <div
            className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <FileSignature
              className="w-8 h-8"
              style={{ color: 'var(--text-tertiary)' }}
            />
          </div>
          <h3
            className="text-lg font-medium mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            No {filter === 'pending' ? 'pending' : 'executed'} transactions
          </h3>
          <p style={{ color: 'var(--text-tertiary)' }}>
            {filter === 'pending'
              ? 'All transactions have been processed'
              : 'No transaction history yet'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {transactions.map((tx) => (
            <TransactionCard
              key={tx.safeTxHash}
              tx={tx}
              onSign={handleSign}
              onExecute={handleExecute}
              userAddress={userAddress}
              isConnected={isConnected}
              isSigning={signingTx === tx.safeTxHash}
              isExecuting={executingTx === tx.safeTxHash}
            />
          ))}
        </div>
      )}
    </div>
  )
}
