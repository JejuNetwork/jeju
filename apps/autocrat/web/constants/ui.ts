import {
  Bot,
  Crown,
  type LucideIcon,
  MessageSquare,
  Shield,
} from 'lucide-react'
import type { AgentRole, DAOStatus, ProposalStatus } from '../types/dao'

// =========================================================
// DAO Status Configuration
// =========================================================

export interface StatusStyle {
  bg: string
  text: string
  label: string
}

export const DAO_STATUS_STYLES: Record<DAOStatus, StatusStyle> = {
  active: {
    bg: 'rgba(6, 214, 160, 0.15)',
    text: 'var(--color-success)',
    label: 'Active',
  },
  paused: {
    bg: 'rgba(245, 158, 11, 0.15)',
    text: 'var(--color-warning)',
    label: 'Paused',
  },
  archived: {
    bg: 'var(--bg-secondary)',
    text: 'var(--text-tertiary)',
    label: 'Archived',
  },
  pending: {
    bg: 'rgba(59, 130, 246, 0.15)',
    text: 'var(--color-info)',
    label: 'Pending',
  },
}

// =========================================================
// Proposal Status Configuration
// =========================================================

export interface ProposalStatusConfig {
  label: string
  color: string
  bg: string
}

export const PROPOSAL_STATUS_CONFIG: Record<
  ProposalStatus,
  ProposalStatusConfig
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
  director_queue: {
    label: 'Director Queue',
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

// =========================================================
// Agent Role Configuration
// =========================================================

export const AGENT_ROLE_ICONS: Record<AgentRole, LucideIcon> = {
  Director: Crown,
  TREASURY: Shield,
  CODE: Bot,
  COMMUNITY: MessageSquare,
  SECURITY: Shield,
  LEGAL: Shield,
  CUSTOM: Bot,
}

export const AGENT_ROLE_GRADIENTS: Record<AgentRole, string> = {
  Director: 'var(--gradient-accent)',
  TREASURY: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
  CODE: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)',
  COMMUNITY: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
  SECURITY: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)',
  LEGAL: 'linear-gradient(135deg, #6B7280 0%, #4B5563 100%)',
  CUSTOM: 'var(--gradient-secondary)',
}

export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  Director: 'Chief Executive Officer',
  TREASURY: 'Treasury Manager',
  CODE: 'Code Reviewer',
  COMMUNITY: 'Community Manager',
  SECURITY: 'Security Auditor',
  LEGAL: 'Legal Advisor',
  CUSTOM: 'Custom Role',
}

// =========================================================
// Utility function to get status config safely
// =========================================================

export function getProposalStatusConfig(
  status: ProposalStatus,
): ProposalStatusConfig {
  return PROPOSAL_STATUS_CONFIG[status] ?? PROPOSAL_STATUS_CONFIG.draft
}

export function getDAOStatusStyle(status: DAOStatus): StatusStyle {
  return DAO_STATUS_STYLES[status] ?? DAO_STATUS_STYLES.active
}
