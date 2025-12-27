import {
  AlertCircle,
  Bug,
  Calendar,
  Check,
  ChevronRight,
  Clock,
  Code,
  Coins,
  Crown,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Shield,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useProposals } from '../../hooks/useDAO'
import type {
  DAODetail,
  ProposalListItem,
  ProposalStatus,
  ProposalType,
} from '../../types/dao'

interface GovernanceTabProps {
  dao: DAODetail
}

const PROPOSAL_TYPE_CONFIG: Record<
  ProposalType,
  { icon: typeof FileText; label: string; color: string }
> = {
  general: { icon: FileText, label: 'General', color: 'text-slate-400' },
  funding: { icon: Coins, label: 'Funding', color: 'text-emerald-400' },
  code: { icon: Code, label: 'Code', color: 'text-violet-400' },
  moderation: { icon: Shield, label: 'Moderation', color: 'text-amber-400' },
  bug_report: { icon: Bug, label: 'Bug Report', color: 'text-orange-400' },
}

const STATUS_CONFIG: Record<
  ProposalStatus,
  { label: string; color: string; bgColor: string }
> = {
  draft: {
    label: 'Draft',
    color: 'text-slate-400',
    bgColor: 'bg-slate-500/20 border-slate-500/30',
  },
  pending_quality: {
    label: 'Quality Review',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/20 border-amber-500/30',
  },
  submitted: {
    label: 'Submitted',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20 border-blue-500/30',
  },
  board_review: {
    label: 'Board Review',
    color: 'text-violet-400',
    bgColor: 'bg-violet-500/20 border-violet-500/30',
  },
  research: {
    label: 'Research',
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/20 border-cyan-500/30',
  },
  board_final: {
    label: 'Board Final',
    color: 'text-violet-400',
    bgColor: 'bg-violet-500/20 border-violet-500/30',
  },
  ceo_queue: {
    label: 'CEO Queue',
    color: 'text-pink-400',
    bgColor: 'bg-pink-500/20 border-pink-500/30',
  },
  approved: {
    label: 'Approved',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/20 border-emerald-500/30',
  },
  executing: {
    label: 'Executing',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20 border-blue-500/30',
  },
  completed: {
    label: 'Completed',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/20 border-emerald-500/30',
  },
  rejected: {
    label: 'Rejected',
    color: 'text-red-400',
    bgColor: 'bg-red-500/20 border-red-500/30',
  },
  vetoed: {
    label: 'Vetoed',
    color: 'text-red-400',
    bgColor: 'bg-red-500/20 border-red-500/30',
  },
}

function ProposalCard({
  proposal,
  daoId,
}: {
  proposal: ProposalListItem
  daoId: string
}) {
  const typeConfig =
    PROPOSAL_TYPE_CONFIG[proposal.proposalType] ?? PROPOSAL_TYPE_CONFIG.general
  const statusConfig = STATUS_CONFIG[proposal.status] ?? STATUS_CONFIG.draft
  const Icon = typeConfig.icon

  return (
    <Link
      to={`/dao/${daoId}/proposal/${proposal.proposalId}`}
      className="group block bg-slate-900/50 border border-slate-700/50 rounded-xl p-4 hover:border-violet-500/30 transition-all"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center">
          <Icon className={`w-5 h-5 ${typeConfig.color}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="font-medium text-slate-200 group-hover:text-violet-300 transition-colors line-clamp-1">
                {proposal.title}
              </h4>
              <p className="text-xs text-slate-500 mt-0.5">
                {typeConfig.label} •{' '}
                {new Date(proposal.createdAt).toLocaleDateString()}
              </p>
            </div>
            <span
              className={`shrink-0 px-2 py-0.5 text-xs font-medium rounded-full border ${statusConfig.bgColor} ${statusConfig.color}`}
            >
              {statusConfig.label}
            </span>
          </div>

          <p className="text-sm text-slate-400 mt-2 line-clamp-2">
            {proposal.summary}
          </p>

          <div className="mt-3 flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <div
                className={`w-2 h-2 rounded-full ${proposal.qualityScore >= 80 ? 'bg-emerald-400' : proposal.qualityScore >= 60 ? 'bg-amber-400' : 'bg-red-400'}`}
              />
              <span className="text-slate-400">
                Quality: {proposal.qualityScore}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-400">
              <Shield className="w-3.5 h-3.5" />
              <span>
                {proposal.boardApprovals}/{proposal.totalBoardMembers} board
              </span>
            </div>
            {proposal.ceoApproved !== undefined && (
              <div className="flex items-center gap-1.5">
                <Crown className="w-3.5 h-3.5" />
                <span
                  className={
                    proposal.ceoApproved ? 'text-emerald-400' : 'text-red-400'
                  }
                >
                  CEO {proposal.ceoApproved ? 'Approved' : 'Rejected'}
                </span>
              </div>
            )}
          </div>

          {proposal.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {proposal.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 text-xs bg-slate-800 text-slate-500 rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <ChevronRight className="shrink-0 w-5 h-5 text-slate-600 group-hover:text-slate-400 transition-colors" />
      </div>
    </Link>
  )
}

export function GovernanceTab({ dao }: GovernanceTabProps) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ProposalStatus | 'all'>(
    'all',
  )
  const [typeFilter, setTypeFilter] = useState<ProposalType | 'all'>('all')

  const {
    data: proposals = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useProposals({
    daoId: dao.daoId,
    status: statusFilter,
    type: typeFilter,
    search,
  })

  const filteredProposals = proposals.filter((p) => {
    if (search) {
      const searchLower = search.toLowerCase()
      return (
        p.title.toLowerCase().includes(searchLower) ||
        p.summary.toLowerCase().includes(searchLower)
      )
    }
    return true
  })

  const activeCount = proposals.filter(
    (p) => !['completed', 'rejected', 'vetoed', 'draft'].includes(p.status),
  ).length

  return (
    <div>
      {/* Quick Actions */}
      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Link
          to={`/dao/${dao.daoId}/proposal/new?type=general`}
          className="flex items-center gap-3 p-4 bg-slate-900/50 border border-slate-700/50 rounded-xl hover:border-violet-500/30 transition-colors"
        >
          <div className="w-10 h-10 rounded-lg bg-slate-500/20 flex items-center justify-center">
            <FileText className="w-5 h-5 text-slate-400" />
          </div>
          <div>
            <p className="font-medium text-slate-200">New Proposal</p>
            <p className="text-xs text-slate-500">General</p>
          </div>
        </Link>
        <Link
          to={`/dao/${dao.daoId}/proposal/new?type=bug_report`}
          className="flex items-center gap-3 p-4 bg-slate-900/50 border border-slate-700/50 rounded-xl hover:border-orange-500/30 transition-colors"
        >
          <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
            <Bug className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <p className="font-medium text-slate-200">Report Bug</p>
            <p className="text-xs text-slate-500">Earn bounty</p>
          </div>
        </Link>
        <Link
          to={`/dao/${dao.daoId}/proposal/new?type=funding`}
          className="flex items-center gap-3 p-4 bg-slate-900/50 border border-slate-700/50 rounded-xl hover:border-emerald-500/30 transition-colors"
        >
          <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <Coins className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <p className="font-medium text-slate-200">Request Funding</p>
            <p className="text-xs text-slate-500">Treasury</p>
          </div>
        </Link>
        <Link
          to={`/dao/${dao.daoId}/proposal/new?type=code`}
          className="flex items-center gap-3 p-4 bg-slate-900/50 border border-slate-700/50 rounded-xl hover:border-violet-500/30 transition-colors"
        >
          <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center">
            <Code className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <p className="font-medium text-slate-200">Code Change</p>
            <p className="text-xs text-slate-500">Contract</p>
          </div>
        </Link>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <Clock className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{activeCount}</p>
              <p className="text-xs text-slate-500">Active</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center">
              <Check className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">
                {dao.stats.approvedProposals}
              </p>
              <p className="text-xs text-slate-500">Approved</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-500/20 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-slate-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">
                {dao.stats.averageApprovalTime.toFixed(1)}d
              </p>
              <p className="text-xs text-slate-500">Avg Time</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search proposals..."
            className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as ProposalStatus | 'all')
            }
            className="px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-200 focus:outline-none focus:border-violet-500"
          >
            <option value="all">All Status</option>
            {Object.entries(STATUS_CONFIG).map(([status, config]) => (
              <option key={status} value={status}>
                {config.label}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(e.target.value as ProposalType | 'all')
            }
            className="px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-200 focus:outline-none focus:border-violet-500"
          >
            <option value="all">All Types</option>
            {Object.entries(PROPOSAL_TYPE_CONFIG).map(([type, config]) => (
              <option key={type} value={type}>
                {config.label}
              </option>
            ))}
          </select>
          <Link
            to={`/dao/${dao.daoId}/proposal/new`}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            New
          </Link>
        </div>
      </div>

      {/* Proposals List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
        </div>
      ) : isError ? (
        <div className="text-center py-16 bg-slate-900/50 border border-slate-700/50 rounded-xl">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-300 mb-2">
            Failed to load proposals
          </h3>
          <p className="text-slate-500 mb-4">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      ) : filteredProposals.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/50 border border-slate-700/50 rounded-xl">
          <FileText className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-300 mb-2">
            No proposals found
          </h3>
          <p className="text-slate-500 mb-4">
            {search || statusFilter !== 'all' || typeFilter !== 'all'
              ? 'Try adjusting your filters'
              : 'Be the first to create a proposal'}
          </p>
          <Link
            to={`/dao/${dao.daoId}/proposal/new`}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Proposal
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredProposals.map((proposal) => (
            <ProposalCard
              key={proposal.proposalId}
              proposal={proposal}
              daoId={dao.daoId}
            />
          ))}
        </div>
      )}
    </div>
  )
}
