import {
  AlertCircle,
  Building2,
  Crown,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Shield,
  Sparkles,
  Users,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDAOs } from '../hooks/useDAO'
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

interface DAOCardProps {
  dao: DAOListItem
}

function DAOCard({ dao }: DAOCardProps) {
  const statusStyle = STATUS_STYLES[dao.status]

  return (
    <Link
      to={`/dao/${dao.daoId}`}
      className="group block rounded-2xl p-5 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      style={
        {
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-card)',
          '--tw-ring-color': 'var(--color-primary)',
        } as React.CSSProperties
      }
    >
      <div className="flex items-start gap-4">
        {/* DAO Avatar */}
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
              <Shield className="w-3 h-3 text-white" aria-hidden="true" />
            </div>
          )}
        </div>

        {/* Content */}
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

          {/* CEO Info */}
          <div className="mt-3 flex items-center gap-2 text-sm">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center"
              style={{ background: 'var(--gradient-accent)' }}
            >
              <Crown className="w-3 h-3 text-white" aria-hidden="true" />
            </div>
            <span style={{ color: 'var(--text-primary)' }}>{dao.ceoName}</span>
            <span style={{ color: 'var(--text-tertiary)' }}>·</span>
            <span style={{ color: 'var(--text-tertiary)' }}>
              {dao.boardMemberCount} board members
            </span>
          </div>

          {/* Stats */}
          <div className="mt-4 flex items-center gap-4 text-xs">
            <div
              className="flex items-center gap-1.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{dao.proposalCount} proposals</span>
            </div>
            <div
              className="flex items-center gap-1.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Users className="w-3.5 h-3.5" aria-hidden="true" />
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
                  aria-hidden="true"
                />
                <span>{dao.activeProposalCount} active</span>
              </div>
            )}
          </div>

          {/* Tags */}
          {dao.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {dao.tags.slice(0, 4).map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 text-xs rounded-md"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  {tag}
                </span>
              ))}
              {dao.tags.length > 4 && (
                <span
                  className="px-2 py-0.5 text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  +{dao.tags.length - 4}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}

function EmptyState() {
  return (
    <div className="text-center py-16 animate-in">
      <div
        className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
        }}
      >
        <Rocket
          className="w-10 h-10"
          style={{ color: 'var(--text-tertiary)' }}
        />
      </div>
      <h3
        className="text-lg font-semibold mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        No results
      </h3>
      <p
        className="mb-6 max-w-md mx-auto"
        style={{ color: 'var(--text-secondary)' }}
      >
        No DAOs match your current filters. Adjust your search or start a new
        organization.
      </p>
      <Link
        to="/create"
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-white transition-all hover:shadow-lg"
        style={{ background: 'var(--gradient-primary)' }}
      >
        <Plus className="w-4 h-4" aria-hidden="true" />
        Create DAO
      </Link>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <Loader2
        className="w-10 h-10 animate-spin mb-4"
        style={{ color: 'var(--color-primary)' }}
      />
      <p style={{ color: 'var(--text-secondary)' }}>Loading organizations...</p>
    </div>
  )
}

interface ErrorStateProps {
  error: Error
  onRetry: () => void
}

function ErrorState({ error, onRetry }: ErrorStateProps) {
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
      <p
        className="mb-6 max-w-md mx-auto"
        style={{ color: 'var(--text-secondary)' }}
      >
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
        <RefreshCw className="w-4 h-4" aria-hidden="true" />
        Try Again
      </button>
    </div>
  )
}

export default function DAOListPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<DAOStatus | 'all'>('all')
  const [showNetworkOnly, setShowNetworkOnly] = useState(false)

  const {
    data: daos = [],
    isLoading,
    error,
    refetch,
  } = useDAOs({
    status: statusFilter,
    search,
    networkOnly: showNetworkOnly,
  })

  const handleRetry = useCallback(() => {
    refetch()
  }, [refetch])

  return (
    <div style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Hero Section */}
      <section
        className="relative overflow-hidden border-b"
        style={{
          background: 'var(--gradient-hero)',
          borderColor: 'rgba(255, 255, 255, 0.1)',
        }}
      >
        {/* Decorative elements */}
        <div className="absolute inset-0 opacity-30">
          <div
            className="absolute top-1/4 left-1/4 w-64 h-64 rounded-full blur-3xl"
            style={{ backgroundColor: 'var(--color-primary)' }}
          />
          <div
            className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full blur-3xl"
            style={{ backgroundColor: 'var(--color-accent)' }}
          />
        </div>

        <div className="container mx-auto py-12 sm:py-16 relative z-10">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium mb-6 bg-white/10 text-white/90 backdrop-blur-sm">
              <Sparkles className="w-4 h-4" aria-hidden="true" />
              Autonomous Governance
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4 leading-tight">
              DAOs with AI Leadership
            </h1>
            <p className="text-lg text-white/80 mb-8 leading-relaxed max-w-2xl">
              AI-powered organizations with transparent on-chain governance.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/create"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-all hover:shadow-xl"
                style={{
                  background: 'var(--gradient-primary)',
                  color: 'white',
                }}
              >
                <Plus className="w-5 h-5" aria-hidden="true" />
                Create DAO
              </Link>
              <Link
                to="/my-daos"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold bg-white/10 text-white border border-white/20 backdrop-blur-sm transition-colors hover:bg-white/20"
              >
                <Users className="w-5 h-5" aria-hidden="true" />
                My DAOs
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Filters */}
      <section
        className="sticky top-16 z-40 backdrop-blur-xl border-b"
        style={{
          backgroundColor: 'rgba(var(--bg-primary-rgb, 250, 251, 255), 0.95)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="container mx-auto py-4">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search */}
            <div className="relative flex-1">
              <Search
                className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4"
                style={{ color: 'var(--text-tertiary)' }}
                aria-hidden="true"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search DAOs by name, description, or tags..."
                className="input pl-10"
                aria-label="Search DAOs"
              />
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2">
              <Filter
                className="w-4 h-4 sm:hidden"
                style={{ color: 'var(--text-tertiary)' }}
                aria-hidden="true"
              />
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as DAOStatus | 'all')
                }
                className="select min-w-[140px]"
                aria-label="Filter by status"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="paused">Paused</option>
                <option value="archived">Archived</option>
              </select>

              <button
                type="button"
                onClick={() => setShowNetworkOnly(!showNetworkOnly)}
                className="p-3 rounded-xl transition-all"
                style={{
                  backgroundColor: showNetworkOnly
                    ? 'rgba(245, 158, 11, 0.12)'
                    : 'var(--surface)',
                  border: showNetworkOnly
                    ? '1px solid rgba(245, 158, 11, 0.3)'
                    : '1px solid var(--border)',
                  color: showNetworkOnly
                    ? 'var(--color-warning)'
                    : 'var(--text-tertiary)',
                }}
                aria-label={
                  showNetworkOnly ? 'Show all DAOs' : 'Show network DAOs only'
                }
                aria-pressed={showNetworkOnly}
              >
                <Shield className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* DAO Grid */}
      <section className="container mx-auto py-8">
        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error as Error} onRetry={handleRetry} />
        ) : daos.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="flex items-center justify-between mb-6">
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                {daos.length} DAO{daos.length !== 1 ? 's' : ''} found
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                className="p-2 rounded-lg transition-colors"
                style={{ color: 'var(--text-tertiary)' }}
                aria-label="Refresh list"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {daos.map((dao) => (
                <DAOCard key={dao.daoId} dao={dao} />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
