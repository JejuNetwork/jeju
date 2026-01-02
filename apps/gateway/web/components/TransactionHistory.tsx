import { useQuery } from '@tanstack/react-query'
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle,
  Clock,
  ExternalLink,
  type LucideProps,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { z } from 'zod'
import { EXPLORER_URL, INDEXER_URL } from '../../lib/config'
import { Skeleton, SkeletonCard } from './Skeleton'

const ArrowUpRightIcon = ArrowUpRight as ComponentType<LucideProps>
const ArrowDownRightIcon = ArrowDownRight as ComponentType<LucideProps>
const CheckCircleIcon = CheckCircle as ComponentType<LucideProps>
const ClockIcon = Clock as ComponentType<LucideProps>
const XCircleIcon = XCircle as ComponentType<LucideProps>
const RefreshCwIcon = RefreshCw as ComponentType<LucideProps>
const ExternalLinkIcon = ExternalLink as ComponentType<LucideProps>

// Zod schema for transaction history response
const TransactionSchema = z.object({
  id: z.string(),
  type: z.enum([
    'transfer',
    'deposit',
    'withdraw',
    'stake',
    'unstake',
    'register',
    'claim',
    'bridge',
    'swap',
  ]),
  hash: z.string(),
  from: z.string(),
  to: z.string().optional(),
  amount: z.string(),
  tokenSymbol: z.string(),
  tokenAddress: z.string().optional(),
  status: z.enum(['pending', 'confirmed', 'failed']),
  timestamp: z.string(),
  chainId: z.number().optional(),
  destinationChainId: z.number().optional(),
  blockNumber: z.number().optional(),
})

const TransactionsResponseSchema = z.object({
  transactions: z.array(TransactionSchema),
})

type Transaction = z.infer<typeof TransactionSchema>

async function fetchTransactionHistory(
  address: string,
): Promise<Transaction[]> {
  const query = `
    query UserTransactions($address: String!) {
      transactions(
        where: { from_eq: $address }
        orderBy: timestamp_DESC
        limit: 50
      ) {
        id
        type
        hash
        from
        to
        amount
        tokenSymbol
        tokenAddress
        status
        timestamp
        chainId
        destinationChainId
        blockNumber
      }
    }
  `

  const response = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: { address: address.toLowerCase() },
    }),
  })

  if (!response.ok) {
    return []
  }

  const { data } = await response.json()
  const result = TransactionsResponseSchema.safeParse(data)
  if (!result.success) {
    // Return empty array if validation fails - indexer might not have this query yet
    return []
  }

  return result.data.transactions
}

function formatAmount(amount: string, decimals = 18): string {
  const value = Number(BigInt(amount)) / 10 ** decimals
  if (value < 0.001) return '< 0.001'
  if (value < 1) return value.toFixed(4)
  if (value < 1000) return value.toFixed(2)
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function getTransactionIcon(
  type: Transaction['type'],
  status: Transaction['status'],
) {
  if (status === 'failed') {
    return <XCircleIcon size={18} style={{ color: 'var(--error)' }} />
  }
  if (status === 'pending') {
    return (
      <ClockIcon
        size={18}
        style={{ color: 'var(--warning)', animation: 'pulse 2s infinite' }}
      />
    )
  }

  switch (type) {
    case 'deposit':
    case 'stake':
    case 'register':
      return (
        <ArrowDownRightIcon size={18} style={{ color: 'var(--success)' }} />
      )
    case 'withdraw':
    case 'unstake':
    case 'claim':
      return <ArrowUpRightIcon size={18} style={{ color: 'var(--info)' }} />
    case 'transfer':
    case 'bridge':
    case 'swap':
      return <CheckCircleIcon size={18} style={{ color: 'var(--primary)' }} />
    default:
      return (
        <CheckCircleIcon size={18} style={{ color: 'var(--text-muted)' }} />
      )
  }
}

function getTransactionLabel(type: Transaction['type']): string {
  switch (type) {
    case 'deposit':
      return 'Deposit'
    case 'withdraw':
      return 'Withdraw'
    case 'stake':
      return 'Stake'
    case 'unstake':
      return 'Unstake'
    case 'register':
      return 'Register'
    case 'claim':
      return 'Claim'
    case 'bridge':
      return 'Bridge'
    case 'swap':
      return 'Swap'
    default:
      return 'Transfer'
  }
}

function formatTimeAgo(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

interface TransactionHistoryProps {
  address: string | undefined
  limit?: number
  showHeader?: boolean
  emptyMessage?: string
}

export function TransactionHistory({
  address,
  limit = 10,
  showHeader = true,
  emptyMessage = 'No transactions yet',
}: TransactionHistoryProps) {
  const {
    data: transactions = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['transaction-history', address],
    queryFn: () =>
      address ? fetchTransactionHistory(address) : Promise.resolve([]),
    enabled: !!address,
    refetchInterval: 30000,
  })

  const displayTransactions = transactions.slice(0, limit)

  if (!address) {
    return (
      <div
        style={{
          padding: '2rem',
          textAlign: 'center',
          background: 'var(--surface-hover)',
          borderRadius: '12px',
        }}
      >
        <p style={{ color: 'var(--text-secondary)' }}>
          Connect your wallet to view transaction history
        </p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div>
        {showHeader && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '1rem',
            }}
          >
            <Skeleton width={120} height={24} />
            <Skeleton width={24} height={24} />
          </div>
        )}
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={`skeleton-tx-${i}`} />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div
        style={{
          padding: '1.5rem',
          textAlign: 'center',
          background: 'var(--error-soft)',
          borderRadius: '12px',
          border: '1px solid var(--error)',
        }}
      >
        <p style={{ color: 'var(--error)', marginBottom: '0.5rem' }}>
          Failed to load transactions
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          style={{
            padding: '0.5rem 1rem',
            background: 'var(--error)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '0.875rem',
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  if (displayTransactions.length === 0) {
    return (
      <div
        style={{
          padding: '2rem',
          textAlign: 'center',
          background: 'var(--surface-hover)',
          borderRadius: '12px',
        }}
      >
        <p style={{ color: 'var(--text-secondary)' }}>{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div>
      {showHeader && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
          }}
        >
          <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>
            Recent Activity
          </h3>
          <button
            type="button"
            onClick={() => refetch()}
            style={{
              padding: '0.5rem',
              background: 'var(--surface-hover)',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <RefreshCwIcon
              size={16}
              style={{ color: 'var(--text-secondary)' }}
            />
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {displayTransactions.map((tx) => (
          <a
            key={tx.id}
            href={`${EXPLORER_URL}/tx/${tx.hash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.875rem 1rem',
              background: 'var(--surface-hover)',
              borderRadius: '10px',
              textDecoration: 'none',
              color: 'inherit',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--surface-active)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--surface-hover)'
            }}
          >
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: 'var(--surface)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {getTransactionIcon(tx.type, tx.status)}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                  {getTransactionLabel(tx.type)}
                </span>
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: '0.875rem',
                    color:
                      tx.type === 'deposit' || tx.type === 'stake'
                        ? 'var(--success)'
                        : 'var(--text-primary)',
                  }}
                >
                  {tx.type === 'deposit' || tx.type === 'stake' ? '+' : ''}
                  {formatAmount(tx.amount)} {tx.tokenSymbol}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: '0.25rem',
                }}
              >
                <span
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)',
                    fontFamily: 'monospace',
                  }}
                >
                  {tx.hash.slice(0, 10)}...{tx.hash.slice(-6)}
                </span>
                <span
                  style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}
                >
                  {formatTimeAgo(tx.timestamp)}
                </span>
              </div>
            </div>

            <ExternalLinkIcon
              size={14}
              style={{ color: 'var(--text-muted)', flexShrink: 0 }}
            />
          </a>
        ))}
      </div>

      {transactions.length > limit && (
        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
          <a
            href={`${EXPLORER_URL}/address/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: '0.875rem',
              color: 'var(--primary)',
              textDecoration: 'none',
            }}
          >
            View all on Explorer →
          </a>
        </div>
      )}
    </div>
  )
}

export default TransactionHistory
