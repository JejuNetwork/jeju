'use client'

import Link from 'next/link'
import { Clock, Users, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import type { Proposal } from '@/config/api'

const STATUS_CONFIG: Record<string, { badge: string; icon: typeof CheckCircle }> = {
  SUBMITTED: { badge: 'badge-primary', icon: Clock },
  COUNCIL_REVIEW: { badge: 'badge-accent', icon: Users },
  RESEARCH_PENDING: { badge: 'badge-warning', icon: Clock },
  COUNCIL_FINAL: { badge: 'badge-accent', icon: Users },
  CEO_QUEUE: { badge: 'badge-primary', icon: Clock },
  APPROVED: { badge: 'badge-success', icon: CheckCircle },
  COMPLETED: { badge: 'badge-success', icon: CheckCircle },
  REJECTED: { badge: 'badge-error', icon: XCircle },
  VETOED: { badge: 'badge-error', icon: AlertCircle },
}

const TYPE_EMOJI: Record<string, string> = {
  PARAMETER_CHANGE: '⚙️',
  TREASURY_ALLOCATION: '💰',
  CODE_UPGRADE: '🔧',
  BOUNTY: '🎯',
  GRANT: '🎁',
  PARTNERSHIP: '🤝',
  POLICY: '📜',
  EMERGENCY: '🚨',
}

interface ProposalCardProps {
  proposal: Proposal
}

export function ProposalCard({ proposal }: ProposalCardProps) {
  const statusConfig = STATUS_CONFIG[proposal.status] || STATUS_CONFIG.SUBMITTED
  const StatusIcon = statusConfig.icon
  const emoji = TYPE_EMOJI[proposal.proposalType] || '📋'

  return (
    <Link href={`/proposals/${proposal.proposalId}`}>
      <div className="card p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2 mb-1.5 sm:mb-2">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <span className="text-sm sm:text-base shrink-0">{emoji}</span>
            <span className={`${statusConfig.badge} shrink-0`}>
              <StatusIcon size={10} className="sm:w-3 sm:h-3" />
              <span className="hidden xs:inline">{proposal.status.replace(/_/g, ' ')}</span>
            </span>
          </div>
          <span 
            className="text-xs font-mono shrink-0"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {proposal.proposalId.slice(0, 8)}...
          </span>
        </div>

        <div className="flex items-center justify-between text-xs sm:text-sm">
          <span style={{ color: 'var(--text-secondary)' }}>
            Score: {proposal.qualityScore}%
          </span>
          <span style={{ color: 'var(--text-tertiary)' }}>
            {new Date(proposal.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>
    </Link>
  )
}
