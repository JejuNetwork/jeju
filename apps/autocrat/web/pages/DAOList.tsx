/**
 * DAO Discovery Page - The new home page
 *
 * Lists all DAOs on the network with search, filter, and create functionality.
 */

import {
  AlertCircle,
  Building2,
  Crown,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDAOs } from '../hooks/useDAO'
import type { DAOListItem, DAOStatus } from '../types/dao'

interface DAOCardProps {
  dao: DAOListItem
}

function DAOCard({ dao }: DAOCardProps) {
  const statusColors: Record<DAOStatus, string> = {
    active: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    pending: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    paused: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
    archived: 'bg-red-500/20 text-red-400 border-red-500/30',
  }

  return (
    <Link
      to={`/dao/${dao.daoId}`}
      className="group block bg-slate-900/50 border border-slate-700/50 rounded-2xl p-5 hover:border-violet-500/50 hover:bg-slate-800/50 transition-all duration-300"
    >
      <div className="flex items-start gap-4">
        {/* DAO Avatar */}
        <div className="relative shrink-0">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center text-2xl font-bold text-white shadow-lg shadow-violet-500/20">
            {dao.displayName.charAt(0).toUpperCase()}
          </div>
          {dao.isNetworkDAO && (
            <div className="absolute -top-1 -right-1 w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center">
              <Shield className="w-3 h-3 text-amber-950" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-100 group-hover:text-violet-300 transition-colors truncate">
                {dao.displayName}
              </h3>
              <p className="text-sm text-slate-500">@{dao.name}</p>
            </div>
            <span
              className={`px-2 py-0.5 text-xs font-medium rounded-full border ${statusColors[dao.status]}`}
            >
              {dao.status}
            </span>
          </div>

          <p className="mt-2 text-sm text-slate-400 line-clamp-2">
            {dao.description}
          </p>

          {/* CEO Info */}
          <div className="mt-3 flex items-center gap-2 text-sm">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center">
              <Crown className="w-3 h-3 text-white" />
            </div>
            <span className="text-slate-300">{dao.ceoName}</span>
            <span className="text-slate-600">•</span>
            <span className="text-slate-500">
              {dao.boardMemberCount} board members
            </span>
          </div>

          {/* Stats */}
          <div className="mt-4 flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5 text-slate-400">
              <Building2 className="w-3.5 h-3.5" />
              <span>{dao.proposalCount} proposals</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-400">
              <Users className="w-3.5 h-3.5" />
              <span>{dao.memberCount.toLocaleString()} members</span>
            </div>
            {dao.activeProposalCount > 0 && (
              <div className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
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
                  className="px-2 py-0.5 text-xs bg-slate-800 text-slate-400 rounded-md"
                >
                  {tag}
                </span>
              ))}
              {dao.tags.length > 4 && (
                <span className="px-2 py-0.5 text-xs text-slate-500">
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
    <div className="text-center py-16">
      <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-slate-800/50 border border-slate-700 flex items-center justify-center">
        <Building2 className="w-10 h-10 text-slate-600" />
      </div>
      <h3 className="text-lg font-medium text-slate-300 mb-2">No DAOs found</h3>
      <p className="text-slate-500 mb-6 max-w-md mx-auto">
        No DAOs match your search criteria. Try adjusting your filters or create
        a new DAO to get started.
      </p>
      <Link
        to="/create"
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl font-medium transition-colors"
      >
        <Plus className="w-4 h-4" />
        Create DAO
      </Link>
    </div>
  )
}

export default function DAOListPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<DAOStatus | 'all'>('all')
  const [showNetworkOnly, setShowNetworkOnly] = useState(false)

  // Use the real API hook - filtering is done server-side and in the hook
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

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Hero Section */}
      <div className="border-b border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950">
        <div className="container mx-auto px-4 py-12">
          <div className="max-w-3xl">
            <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              AI-Powered DAOs
            </h1>
            <p className="text-lg text-slate-400 mb-8">
              Discover and join autonomous organizations governed by AI agents.
              Each DAO has a CEO and board of directors powered by customizable
              AI models.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/create"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl font-medium transition-colors shadow-lg shadow-violet-500/20"
              >
                <Plus className="w-4 h-4" />
                Create DAO
              </Link>
              <Link
                to="/my-daos"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-medium transition-colors border border-slate-700"
              >
                <Users className="w-4 h-4" />
                My DAOs
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="sticky top-14 z-40 bg-slate-950/95 backdrop-blur-xl border-b border-slate-800">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search DAOs by name, description, or tags..."
                className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
              />
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-500 sm:hidden" />
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as DAOStatus | 'all')
                }
                className="px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-200 focus:outline-none focus:border-violet-500"
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
                className={`px-4 py-2.5 rounded-xl border font-medium transition-colors ${
                  showNetworkOnly
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Shield className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* DAO Grid */}
      <div className="container mx-auto px-4 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-red-500/20 border border-red-500/30 flex items-center justify-center">
              <AlertCircle className="w-10 h-10 text-red-400" />
            </div>
            <h3 className="text-lg font-medium text-slate-300 mb-2">
              Failed to load DAOs
            </h3>
            <p className="text-slate-500 mb-6 max-w-md mx-auto">
              {error instanceof Error ? error.message : 'An unknown error occurred'}
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-medium transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
          </div>
        ) : daos.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="flex items-center justify-between mb-6">
              <p className="text-sm text-slate-500">
                {daos.length} DAO{daos.length !== 1 ? 's' : ''} found
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                className="p-2 text-slate-500 hover:text-slate-300 transition-colors"
                title="Refresh"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
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
