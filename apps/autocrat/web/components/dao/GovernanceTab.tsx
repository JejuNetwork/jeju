/**
 * Governance Tab - Proposals and Voting
 *
 * Display and filter proposals with quick actions for creating new ones.
 */

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
import { useCallback, useMemo, useState } from 'react'
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
  { icon: typeof FileText; label: string; color: string; bg: string }
> = {
  general: {
    icon: FileText,
    label: 'General',
    color: 'var(--text-secondary)',
    bg: 'rgba(148, 163, 184, 0.12)',
  },
  funding: {
    icon: Coins,
    label: 'Funding',
    color: 'var(--color-success)',
    bg: 'rgba(16, 185, 129, 0.12)',
  },
  code: {
    icon: Code,
    label: 'Code',
    color: 'var(--color-secondary)',
    bg: 'rgba(139, 92, 246, 0.12)',
  },
  moderation: {
    icon: Shield,
    label: 'Moderation',
    color: 'var(--color-warning)',
    bg: 'rgba(245, 158, 11, 0.12)',
  },
  bug_report: {
    icon: Bug,
    label: 'Bug Report',
    color: 'var(--color-accent)',
    bg: 'rgba(255, 107, 107, 0.12)',
  },
}

const STATUS_CONFIG: Record<
  ProposalStatus,
  { label: string; color: string; bg: string }
> = {
  draft: {
    label: 'Draft',
    color: 'var(--text-tertiary)',
    bg: 'rgba(148, 163, 184, 0.12)',
  },
  pending_quality: {
    label: 'Quality Review',
    color: 'var(--color-warning)',
    bg: 'rgba(245, 158, 11, 0.12)',
  },
  submitted: {
    label: 'Submitted',
    color: 'var(--color-info)',
    bg: 'rgba(59, 130, 246, 0.12)',
  },
  board_review: {
    label: 'Board Review',
    color: 'var(--color-secondary)',
    bg: 'rgba(139, 92, 246, 0.12)',
  },
  research: {
    label: 'Research',
    color: '#06B6D4',
    bg: 'rgba(6, 182, 212, 0.12)',
  },
  board_final: {
    label: 'Board Final',
    color: 'var(--color-secondary)',
    bg: 'rgba(139, 92, 246, 0.12)',
  },
  ceo_queue: {
    label: 'CEO Queue',
    color: 'var(--color-accent)',
    bg: 'rgba(255, 107, 107, 0.12)',
  },
  approved: {
    label: 'Approved',
    color: 'var(--color-success)',
    bg: 'rgba(16, 185, 129, 0.12)',
  },
  executing: {
    label: 'Executing',
    color: 'var(--color-info)',
    bg: 'rgba(59, 130, 246, 0.12)',
  },
  completed: {
    label: 'Completed',
    color: 'var(--color-success)',
    bg: 'rgba(16, 185, 129, 0.12)',
  },
  rejected: {
    label: 'Rejected',
    color: 'var(--color-error)',
    bg: 'rgba(239, 68, 68, 0.12)',
  },
  vetoed: {
    label: 'Vetoed',
    color: 'var(--color-error)',
    bg: 'rgba(239, 68, 68, 0.12)',
  },
  executed: {
    label: 'Executed',
    color: 'var(--color-success)',
    bg: 'rgba(16, 185, 129, 0.12)',
  },
  cancelled: {
    label: 'Cancelled',
    color: 'var(--text-tertiary)',
    bg: 'rgba(148, 163, 184, 0.12)',
  },
}

interface ProposalCardProps {
  proposal: ProposalListItem
  daoId: string
}

function ProposalCard({ proposal, daoId }: ProposalCardProps) {
  const typeConfig =
    PROPOSAL_TYPE_CONFIG[proposal.proposalType] ?? PROPOSAL_TYPE_CONFIG.general
  const statusConfig = STATUS_CONFIG[proposal.status] ?? STATUS_CONFIG.draft
  const Icon = typeConfig.icon

  return (
    <Link
      to={`/dao/${daoId}/proposal/${proposal.proposalId}`}
      className="group block rounded-xl p-4 transition-all"
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: typeConfig.bg }}
        >
          <Icon
            className="w-5 h-5"
            style={{ color: typeConfig.color }}
            aria-hidden="true"
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4
                className="font-medium transition-colors line-clamp-1"
                style={{ color: 'var(--text-primary)' }}
              >
                {proposal.title}
              </h4>
              <p
                className="text-xs mt-0.5"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {typeConfig.label} ·{' '}
                {new Date(proposal.createdAt).toLocaleDateString()}
              </p>
            </div>
            <span
              className="shrink-0 px-2 py-0.5 text-xs font-semibold rounded-full"
              style={{
                backgroundColor: statusConfig.bg,
                color: statusConfig.color,
              }}
            >
              {statusConfig.label}
            </span>
          </div>

          <p
            className="text-sm mt-2 line-clamp-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            {proposal.summary}
          </p>

          <div className="mt-3 flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <div
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor:
                    proposal.qualityScore >= 80
                      ? 'var(--color-success)'
                      : proposal.qualityScore >= 60
                        ? 'var(--color-warning)'
                        : 'var(--color-error)',
                }}
                aria-hidden="true"
              />
              <span style={{ color: 'var(--text-secondary)' }}>
                Quality: {proposal.qualityScore}
              </span>
            </div>
            <div
              className="flex items-center gap-1.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Shield className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {proposal.boardApprovals}/{proposal.totalBoardMembers} board
              </span>
            </div>
            {proposal.ceoApproved !== undefined && (
              <div className="flex items-center gap-1.5">
                <Crown className="w-3.5 h-3.5" aria-hidden="true" />
                <span
                  style={{
                    color: proposal.ceoApproved
                      ? 'var(--color-success)'
                      : 'var(--color-error)',
                  }}
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
                  className="px-2 py-0.5 text-xs rounded"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <ChevronRight
          className="shrink-0 w-5 h-5 transition-colors"
          style={{ color: 'var(--text-tertiary)' }}
          aria-hidden="true"
        />
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

  const filteredProposals = useMemo(() => {
    if (!search) return proposals
    const searchLower = search.toLowerCase()
    return proposals.filter(
      (p) =>
        p.title.toLowerCase().includes(searchLower) ||
        p.summary.toLowerCase().includes(searchLower),
    )
  }, [proposals, search])

  const activeCount = useMemo(() => {
    return proposals.filter(
      (p) =>
        !['completed', 'rejected', 'vetoed', 'draft', 'cancelled'].includes(
          p.status,
        ),
    ).length
  }, [proposals])

  const handleRetry = useCallback(() => {
    refetch()
  }, [refetch])

  return (
    <div>
      {/* Quick Actions */}
      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            type: 'general',
            label: 'Proposal',
            sub: 'General governance',
            icon: FileText,
          },
          {
            type: 'bug_report',
            label: 'Bug Report',
            sub: 'Security bounty',
            icon: Bug,
          },
          {
            type: 'funding',
            label: 'Funding',
            sub: 'Treasury request',
            icon: Coins,
          },
          {
            type: 'code',
            label: 'Code Change',
            sub: 'Contract update',
            icon: Code,
          },
        ].map((action) => {
          const config = PROPOSAL_TYPE_CONFIG[action.type as ProposalType]
          return (
            <Link
              key={action.type}
              to={`/dao/${dao.daoId}/proposal/new?type=${action.type}`}
              className="flex items-center gap-3 p-4 rounded-xl transition-all"
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
              }}
            >
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: config.bg }}
              >
                <action.icon
                  className="w-5 h-5"
                  style={{ color: config.color }}
                  aria-hidden="true"
                />
              </div>
              <div>
                <p
                  className="font-medium"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {action.label}
                </p>
                <p
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {action.sub}
                </p>
              </div>
            </Link>
          )
        })}
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <div
          className="rounded-xl p-4"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'rgba(16, 185, 129, 0.12)' }}
            >
              <Clock
                className="w-5 h-5"
                style={{ color: 'var(--color-success)' }}
                aria-hidden="true"
              />
            </div>
            <div>
              <p
                className="text-2xl font-bold"
                style={{ color: 'var(--text-primary)' }}
              >
                {activeCount}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Active
              </p>
            </div>
          </div>
        </div>
        <div
          className="rounded-xl p-4"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'rgba(139, 92, 246, 0.12)' }}
            >
              <Check
                className="w-5 h-5"
                style={{ color: 'var(--color-secondary)' }}
                aria-hidden="true"
              />
            </div>
            <div>
              <p
                className="text-2xl font-bold"
                style={{ color: 'var(--text-primary)' }}
              >
                {dao.stats.approvedProposals}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Approved
              </p>
            </div>
          </div>
        </div>
        <div
          className="rounded-xl p-4"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'rgba(148, 163, 184, 0.12)' }}
            >
              <Calendar
                className="w-5 h-5"
                style={{ color: 'var(--text-secondary)' }}
                aria-hidden="true"
              />
            </div>
            <div>
              <p
                className="text-2xl font-bold"
                style={{ color: 'var(--text-primary)' }}
              >
                {dao.stats.averageApprovalTime.toFixed(1)}d
              </p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Avg Time
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
            style={{ color: 'var(--text-tertiary)' }}
            aria-hidden="true"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search proposals..."
            className="input pl-10"
            aria-label="Search proposals"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as ProposalStatus | 'all')
            }
            className="select"
            aria-label="Filter by status"
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
            className="select"
            aria-label="Filter by type"
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
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-white"
            style={{ background: 'var(--gradient-primary)' }}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            New
          </Link>
        </div>
      </div>

      {/* Proposals List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2
            className="w-8 h-8 animate-spin"
            style={{ color: 'var(--color-primary)' }}
          />
        </div>
      ) : isError ? (
        <div
          className="text-center py-16 rounded-xl"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
        >
          <AlertCircle
            className="w-12 h-12 mx-auto mb-4"
            style={{ color: 'var(--color-error)' }}
          />
          <h3
            className="text-lg font-medium mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Failed to load proposals
          </h3>
          <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
            {error instanceof Error ? error.message : 'Connection error'}
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl transition-colors"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
            }}
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Retry
          </button>
        </div>
      ) : filteredProposals.length === 0 ? (
        <div
          className="text-center py-16 rounded-xl"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
        >
          <FileText
            className="w-12 h-12 mx-auto mb-4"
            style={{ color: 'var(--text-tertiary)' }}
          />
          <h3
            className="text-lg font-medium mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            No proposals
          </h3>
          <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
            {search || statusFilter !== 'all' || typeFilter !== 'all'
              ? 'Adjust filters to see more results'
              : 'No proposals have been submitted yet'}
          </p>
          <Link
            to={`/dao/${dao.daoId}/proposal/new`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-white"
            style={{ background: 'var(--gradient-primary)' }}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
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
