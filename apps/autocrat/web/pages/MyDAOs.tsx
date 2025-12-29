import {
  AlertCircle,
  Building2,
  Crown,
  Loader2,
  Plus,
  RefreshCw,
  Shield,
  Users,
  Wallet,
} from 'lucide-react'
import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAccount, useConnect } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { useMyDAOs } from '../hooks/useDAO'
import type { DAOListItem, DAOStatus } from '../types/dao'

const STATUS_STYLES: Record<
  DAOStatus,
  { bg: string; text: string; label: string }
> = {
  active: {
    bg: 'rgba(16, 185, 129, 0.12)',
    text: 'var(--color-success)',
    label: 'Active',
  },
  pending: {
    bg: 'rgba(245, 158, 11, 0.12)',
    text: 'var(--color-warning)',
    label: 'Pending',
  },
  paused: {
    bg: 'rgba(148, 163, 184, 0.12)',
    text: 'var(--text-tertiary)',
    label: 'Paused',
  },
  archived: {
    bg: 'rgba(239, 68, 68, 0.12)',
    text: 'var(--color-error)',
    label: 'Archived',
  },
}

function DAOCard({ dao }: { dao: DAOListItem }) {
  const statusStyle = STATUS_STYLES[dao.status]

  return (
    <Link
      to={`/dao/${dao.daoId}`}
      className="group block rounded-2xl p-5 transition-all duration-300"
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl font-bold text-white shadow-lg transition-transform duration-300 group-hover:scale-105"
            style={{ background: 'var(--gradient-secondary)' }}
          >
            {dao.displayName.charAt(0).toUpperCase()}
          </div>
          {dao.isNetworkDAO && (
            <div
              className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center"
              style={{ backgroundColor: 'var(--color-warning)' }}
              title="Network DAO"
            >
              <Shield className="w-3 h-3 text-white" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3
                className="font-semibold truncate transition-colors group-hover:text-[var(--color-primary)]"
                style={{ color: 'var(--text-primary)' }}
              >
                {dao.displayName}
              </h3>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                @{dao.name}
              </p>
            </div>
            <span
              className="shrink-0 px-2.5 py-1 text-xs font-semibold rounded-full"
              style={{
                backgroundColor: statusStyle.bg,
                color: statusStyle.text,
              }}
            >
              {statusStyle.label}
            </span>
          </div>

          <p
            className="mt-2 text-sm line-clamp-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            {dao.description}
          </p>

          <div className="mt-3 flex items-center gap-2 text-sm">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center"
              style={{ background: 'var(--gradient-accent)' }}
            >
              <Crown className="w-3 h-3 text-white" />
            </div>
            <span style={{ color: 'var(--text-primary)' }}>{dao.ceoName}</span>
            <span style={{ color: 'var(--text-tertiary)' }}>·</span>
            <span style={{ color: 'var(--text-tertiary)' }}>
              {dao.boardMemberCount} board members
            </span>
          </div>

          <div className="mt-4 flex items-center gap-4 text-xs">
            <div
              className="flex items-center gap-1.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>{dao.proposalCount} proposals</span>
            </div>
            <div
              className="flex items-center gap-1.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Users className="w-3.5 h-3.5" />
              <span>{dao.memberCount.toLocaleString()} members</span>
            </div>
            {dao.activeProposalCount > 0 && (
              <div
                className="flex items-center gap-1.5"
                style={{ color: 'var(--color-success)' }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ backgroundColor: 'var(--color-success)' }}
                />
                <span>{dao.activeProposalCount} active</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <Loader2
        className="w-10 h-10 animate-spin mb-4"
        style={{ color: 'var(--color-primary)' }}
      />
      <p style={{ color: 'var(--text-secondary)' }}>
        Loading your organizations...
      </p>
    </div>
  )
}

function ErrorState({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="text-center py-16">
      <div
        className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center"
        style={{
          backgroundColor: 'rgba(239, 68, 68, 0.12)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
        }}
      >
        <AlertCircle
          className="w-10 h-10"
          style={{ color: 'var(--color-error)' }}
        />
      </div>
      <h3
        className="text-lg font-semibold mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        Something went wrong
      </h3>
      <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
        {error.message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold transition-colors"
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

function EmptyState() {
  return (
    <div className="text-center py-16">
      <div
        className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
        }}
      >
        <Building2
          className="w-10 h-10"
          style={{ color: 'var(--text-tertiary)' }}
        />
      </div>
      <h3
        className="text-lg font-semibold mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        No organizations yet
      </h3>
      <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
        Create your first AI-powered organization or join an existing one.
      </p>
      <div className="flex gap-3 justify-center">
        <Link
          to="/create"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-white"
          style={{ background: 'var(--gradient-primary)' }}
        >
          <Plus className="w-4 h-4" />
          Create DAO
        </Link>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold transition-colors"
          style={{
            backgroundColor: 'var(--surface)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
          }}
        >
          Browse DAOs
        </Link>
      </div>
    </div>
  )
}

function ConnectWalletState() {
  const { connect, isPending } = useConnect()

  const handleConnect = useCallback(() => {
    connect({ connector: injected() })
  }, [connect])

  return (
    <div className="text-center py-16">
      <div
        className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
        }}
      >
        <Wallet
          className="w-10 h-10"
          style={{ color: 'var(--text-tertiary)' }}
        />
      </div>
      <h3
        className="text-lg font-semibold mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        Connect your wallet
      </h3>
      <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
        Connect your wallet to view your organizations.
      </p>
      <button
        type="button"
        onClick={handleConnect}
        disabled={isPending}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-white disabled:opacity-60"
        style={{ background: 'var(--gradient-primary)' }}
      >
        <Wallet className="w-4 h-4" />
        {isPending ? 'Connecting...' : 'Connect Wallet'}
      </button>
    </div>
  )
}

export default function MyDAOsPage() {
  const { isConnected } = useAccount()
  const { data: daos = [], isLoading, error, refetch } = useMyDAOs()

  const handleRetry = useCallback(() => {
    refetch()
  }, [refetch])

  if (!isConnected) {
    return (
      <div style={{ backgroundColor: 'var(--bg-primary)' }}>
        <div className="container mx-auto py-8">
          <h1
            className="text-2xl font-bold mb-8"
            style={{ color: 'var(--text-primary)' }}
          >
            My Organizations
          </h1>
          <ConnectWalletState />
        </div>
      </div>
    )
  }

  return (
    <div style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="container mx-auto py-8">
        <div className="flex items-center justify-between mb-8">
          <h1
            className="text-2xl font-bold"
            style={{ color: 'var(--text-primary)' }}
          >
            My Organizations
          </h1>
          <Link
            to="/create"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-white"
            style={{ background: 'var(--gradient-primary)' }}
          >
            <Plus className="w-4 h-4" />
            Create DAO
          </Link>
        </div>

        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error as Error} onRetry={handleRetry} />
        ) : daos.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <p
              className="text-sm mb-6"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {daos.length} organization{daos.length !== 1 ? 's' : ''}
            </p>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {daos.map((dao) => (
                <DAOCard key={dao.daoId} dao={dao} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
