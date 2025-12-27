/**
 * Proposal Page
 *
 * View proposal details or create a new proposal.
 */

import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Clock,
  Crown,
  DollarSign,
  FileCode2,
  FileText,
  GitBranch,
  Loader2,
  RefreshCw,
  Shield,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useCreateProposal, useProposal } from '../hooks/useDAO'
import type {
  BountySeverity,
  ProposalDetail,
  ProposalStatus,
  ProposalType,
  VulnerabilityType,
} from '../types/dao'

const PROPOSAL_TYPE_CONFIG: Record<
  ProposalType,
  {
    label: string
    icon: typeof FileText
    color: string
    description: string
  }
> = {
  general: {
    label: 'General',
    icon: FileText,
    color: 'text-[var(--text-secondary)] bg-[var(--bg-secondary)]',
    description: 'Governance proposal',
  },
  funding: {
    label: 'Funding',
    icon: DollarSign,
    color: 'text-[var(--color-success)] bg-[var(--color-success)]/20',
    description: 'Treasury allocation request',
  },
  code: {
    label: 'Code Change',
    icon: GitBranch,
    color: 'text-[var(--color-accent)] bg-[var(--color-accent)]/20',
    description: 'Contract or codebase update',
  },
  moderation: {
    label: 'Moderation',
    icon: Shield,
    color: 'text-[var(--color-warning)] bg-[var(--color-warning)]/20',
    description: 'Content or member action',
  },
  bug_report: {
    label: 'Bug Report',
    icon: FileCode2,
    color: 'text-[var(--color-error)] bg-[var(--color-error)]/20',
    description: 'Security disclosure',
  },
}

const STATUS_CONFIG: Record<ProposalStatus, { label: string; color: string }> =
  {
    draft: { label: 'Draft', color: 'badge-primary' },
    pending_quality: { label: 'Pending Quality', color: 'badge-warning' },
    submitted: { label: 'Submitted', color: 'badge-primary' },
    board_review: { label: 'Board Review', color: 'badge-primary' },
    research: { label: 'Research', color: 'badge-primary' },
    board_final: { label: 'Final Review', color: 'badge-primary' },
    ceo_queue: { label: 'CEO Queue', color: 'badge-warning' },
    approved: { label: 'Approved', color: 'badge-success' },
    executing: { label: 'Executing', color: 'badge-primary' },
    completed: { label: 'Completed', color: 'badge-success' },
    rejected: { label: 'Rejected', color: 'badge-error' },
    vetoed: { label: 'Vetoed', color: 'badge-error' },
    executed: { label: 'Executed', color: 'badge-success' },
    cancelled: { label: 'Cancelled', color: 'badge-primary' },
  }

const SEVERITY_CONFIG: Record<
  BountySeverity,
  { label: string; color: string; reward: string }
> = {
  critical: {
    label: 'Critical',
    color: 'text-[var(--color-error)] bg-[var(--color-error)]/20 border-[var(--color-error)]/50',
    reward: '$5,000 - $50,000',
  },
  high: {
    label: 'High',
    color: 'text-[var(--color-warning)] bg-[var(--color-warning)]/20 border-[var(--color-warning)]/50',
    reward: '$1,000 - $5,000',
  },
  medium: {
    label: 'Medium',
    color: 'text-[var(--color-warning)] bg-[var(--color-warning)]/20 border-[var(--color-warning)]/50',
    reward: '$250 - $1,000',
  },
  low: {
    label: 'Low',
    color: 'text-[var(--color-primary)] bg-[var(--color-primary)]/20 border-[var(--color-primary)]/50',
    reward: '$50 - $250',
  },
  informational: {
    label: 'Informational',
    color: 'text-[var(--text-secondary)] bg-[var(--bg-secondary)] border-[var(--border)]',
    reward: 'Recognition',
  },
}

const VULN_TYPES: { value: VulnerabilityType; label: string }[] = [
  { value: 'reentrancy', label: 'Reentrancy' },
  { value: 'access_control', label: 'Access Control' },
  { value: 'overflow', label: 'Integer Overflow/Underflow' },
  { value: 'oracle', label: 'Oracle Manipulation' },
  { value: 'front_running', label: 'Front-Running' },
  { value: 'dos', label: 'Denial of Service' },
  { value: 'logic', label: 'Logic Error' },
  { value: 'other', label: 'Other' },
]

function VoteCard({
  agentName,
  agentRole,
  vote,
  reasoning,
  confidence,
  votedAt,
}: {
  agentName: string
  agentRole: string
  vote: 'approve' | 'reject' | 'abstain'
  reasoning: string
  confidence: number
  votedAt: number
}) {
  const isCEO = agentRole === 'CEO'

  return (
    <div className="card">
      <div className="flex items-start gap-3">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            isCEO
              ? 'bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)]'
              : 'bg-[var(--bg-secondary)]'
          }`}
        >
          {isCEO ? (
            <Crown className="w-5 h-5 text-white" aria-hidden="true" />
          ) : (
            <Bot className="w-5 h-5 text-[var(--text-secondary)]" aria-hidden="true" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-[var(--text-primary)]">{agentName}</p>
              <p className="text-xs text-[var(--text-tertiary)]">{agentRole}</p>
            </div>
            <span
              className={`badge ${
                vote === 'approve'
                  ? 'badge-success'
                  : vote === 'reject'
                    ? 'badge-error'
                    : 'badge-primary'
              }`}
            >
              {vote === 'approve' ? (
                <ThumbsUp className="w-3 h-3" aria-hidden="true" />
              ) : vote === 'reject' ? (
                <ThumbsDown className="w-3 h-3" aria-hidden="true" />
              ) : null}
              {vote.charAt(0).toUpperCase() + vote.slice(1)}
            </span>
          </div>
          {reasoning && (
            <p className="text-sm text-[var(--text-secondary)] mt-2">{reasoning}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-[var(--text-tertiary)]">
            <span>Confidence: {Math.round(confidence * 100)}%</span>
            <span>{new Date(votedAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProposalView({
  daoId,
  proposal,
}: {
  daoId: string
  proposal: ProposalDetail
}) {
  const typeConfig =
    PROPOSAL_TYPE_CONFIG[proposal.proposalType] ?? PROPOSAL_TYPE_CONFIG.general
  const statusConfig = STATUS_CONFIG[proposal.status] ?? STATUS_CONFIG.draft
  const TypeIcon = typeConfig.icon

  const approveCount = proposal.boardVotes.filter(
    (v) => v.vote === 'approve',
  ).length
  const totalVotes = proposal.boardVotes.length
  const approvalPercent =
    totalVotes > 0 ? Math.round((approveCount / totalVotes) * 100) : 0

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] pb-24">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-[var(--surface)]/95 backdrop-blur-xl border-b border-[var(--border)]">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link
              to={`/dao/${daoId}?tab=governance`}
              className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              aria-label="Back to governance"
            >
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
            </Link>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <span
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium ${typeConfig.color}`}
                >
                  <TypeIcon className="w-3.5 h-3.5 inline-block mr-1" aria-hidden="true" />
                  {typeConfig.label}
                </span>
                <span className={`badge ${statusConfig.color}`}>
                  {statusConfig.label}
                </span>
              </div>
              <h1 className="text-xl font-bold text-[var(--text-primary)] mt-1">
                {proposal.title}
              </h1>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Description */}
            <div className="card-static p-6">
              <div className="prose prose-sm max-w-none">
                {proposal.description.split('\n').map((line, i) => {
                  const lineKey = `desc-${i}-${line.substring(0, 20)}`
                  if (line.startsWith('## ')) {
                    return (
                      <h2
                        key={lineKey}
                        className="text-lg font-semibold text-[var(--text-primary)] mt-4 mb-2"
                      >
                        {line.replace('## ', '')}
                      </h2>
                    )
                  }
                  if (line.startsWith('1. ') || line.startsWith('- ')) {
                    return (
                      <p key={lineKey} className="text-[var(--text-secondary)] ml-4">
                        {line}
                      </p>
                    )
                  }
                  return line ? (
                    <p key={lineKey} className="text-[var(--text-secondary)]">
                      {line}
                    </p>
                  ) : null
                })}
              </div>
            </div>

            {/* Board Votes */}
            <div className="card-static p-6">
              <h3 className="font-semibold text-[var(--text-primary)] mb-4">Board Votes</h3>
              <div className="space-y-3">
                {proposal.boardVotes.map((vote) => (
                  <VoteCard
                    key={vote.agentId}
                    agentName={vote.agentName}
                    agentRole={vote.agentRole}
                    vote={vote.vote}
                    reasoning={vote.reasoning}
                    confidence={vote.confidence}
                    votedAt={vote.votedAt}
                  />
                ))}
                {proposal.boardVotes.length === 0 && (
                  <div className="text-center py-6 text-[var(--text-tertiary)] text-sm">
                    Awaiting board review
                  </div>
                )}
              </div>
            </div>

            {/* Tags */}
            {proposal.tags.length > 0 && (
              <div className="card-static p-6">
                <h3 className="font-semibold text-[var(--text-primary)] mb-4">Tags</h3>
                <div className="flex flex-wrap gap-2">
                  {proposal.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-3 py-1 bg-[var(--bg-secondary)] text-[var(--text-secondary)] rounded-lg text-sm"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Status Card */}
            <div className="card-static p-5">
              <h4 className="text-sm font-medium text-[var(--text-tertiary)] mb-3">
                Voting Progress
              </h4>
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-[var(--text-secondary)]">Board Approval</span>
                  <span className="text-[var(--text-primary)]">
                    {approveCount}/{totalVotes} ({approvalPercent}%)
                  </span>
                </div>
                <div className="h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--color-success)] rounded-full transition-all duration-300"
                    style={{ width: `${approvalPercent}%` }}
                  />
                </div>
              </div>
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-[var(--text-secondary)]">CEO Decision</span>
                  <span className="text-[var(--text-primary)]">
                    {proposal.ceoDecision
                      ? proposal.ceoDecision.approved
                        ? 'Approved'
                        : 'Rejected'
                      : 'Pending'}
                  </span>
                </div>
                <div className="h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                  {proposal.ceoDecision && (
                    <div
                      className={`h-full rounded-full ${
                        proposal.ceoDecision.approved
                          ? 'bg-[var(--color-success)]'
                          : 'bg-[var(--color-error)]'
                      }`}
                      style={{ width: '100%' }}
                    />
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
                <Clock className="w-4 h-4" aria-hidden="true" />
                <span>
                  Updated {new Date(proposal.updatedAt).toLocaleDateString()}
                </span>
              </div>
            </div>

            {/* Meta */}
            <div className="card-static p-5">
              <h4 className="text-sm font-medium text-[var(--text-tertiary)] mb-3">
                Details
              </h4>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--text-tertiary)]">Created</span>
                  <span className="text-[var(--text-primary)]">
                    {new Date(proposal.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-tertiary)]">Proposer</span>
                  <span className="text-[var(--text-primary)] font-mono text-xs">
                    {proposal.proposer.slice(0, 6)}...
                    {proposal.proposer.slice(-4)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-tertiary)]">Proposal ID</span>
                  <span className="text-[var(--text-primary)]">{proposal.proposalId}</span>
                </div>
              </div>
            </div>

            {/* Actions */}
            {proposal.status === 'submitted' && (
              <button
                type="button"
                className="btn-primary w-full"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                Request Review
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function CreateProposalForm({
  daoId,
  type,
}: {
  daoId: string
  type: ProposalType
}) {
  const navigate = useNavigate()
  const createProposalMutation = useCreateProposal(daoId)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Standard proposal fields
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [linkedPRs, setLinkedPRs] = useState<string[]>([])
  const [prInput, setPrInput] = useState('')

  // Funding specific
  const [amount, setAmount] = useState('')
  const [recipient, setRecipient] = useState('')
  const [token, setToken] = useState('ETH')

  // Bug report specific
  const [severity, setSeverity] = useState<BountySeverity>('medium')
  const [vulnType, setVulnType] = useState<VulnerabilityType>('logic')
  const [affectedComponents, setAffectedComponents] = useState<string[]>([])
  const [componentInput, setComponentInput] = useState('')
  const [stepsToReproduce, setStepsToReproduce] = useState([''])
  const [poc, setPoc] = useState('')
  const [suggestedFix, setSuggestedFix] = useState('')

  const typeConfig = PROPOSAL_TYPE_CONFIG[type]
  const TypeIcon = typeConfig.icon

  const addPR = () => {
    if (prInput.trim() && !linkedPRs.includes(prInput.trim())) {
      setLinkedPRs([...linkedPRs, prInput.trim()])
      setPrInput('')
    }
  }

  const removePR = (pr: string) => {
    setLinkedPRs(linkedPRs.filter((p) => p !== pr))
  }

  const addComponent = () => {
    if (
      componentInput.trim() &&
      !affectedComponents.includes(componentInput.trim())
    ) {
      setAffectedComponents([...affectedComponents, componentInput.trim()])
      setComponentInput('')
    }
  }

  const removeComponent = (c: string) => {
    setAffectedComponents(affectedComponents.filter((x) => x !== c))
  }

  const updateStep = (index: number, value: string) => {
    const newSteps = [...stepsToReproduce]
    newSteps[index] = value
    setStepsToReproduce(newSteps)
  }

  const addStep = () => {
    setStepsToReproduce([...stepsToReproduce, ''])
  }

  const removeStep = (index: number) => {
    if (stepsToReproduce.length > 1) {
      setStepsToReproduce(stepsToReproduce.filter((_, i) => i !== index))
    }
  }

  const handleSubmit = async () => {
    setSubmitError(null)

    // Build the summary from description (first paragraph or truncated)
    const summary = description.split('\n\n')[0].slice(0, 200)

    // Build tags from linked PRs for code proposals, or general tags
    const tags = type === 'code' ? linkedPRs : []

    // Build complete proposal data including type-specific fields
    const proposalData: Parameters<typeof createProposalMutation.mutate>[0] = {
      title,
      summary,
      description,
      proposalType: type,
      tags,
    }

    // Add funding-specific fields
    if (type === 'funding' && amount && recipient) {
      proposalData.value = amount
      proposalData.targetContract = recipient as `0x${string}`
    }

    // For bug reports, include severity and vuln details in the description
    // since the API accepts standard proposal fields
    if (type === 'bug_report') {
      const bugDetails = [
        `## Vulnerability Details`,
        `**Severity:** ${severity}`,
        `**Type:** ${vulnType}`,
        affectedComponents.length > 0
          ? `**Affected Components:** ${affectedComponents.join(', ')}`
          : '',
        '',
        `## Steps to Reproduce`,
        ...stepsToReproduce
          .filter((s) => s.trim())
          .map((step, i) => `${i + 1}. ${step}`),
        poc ? `\n## Proof of Concept\n\`\`\`\n${poc}\n\`\`\`` : '',
        suggestedFix ? `\n## Suggested Fix\n${suggestedFix}` : '',
      ]
        .filter(Boolean)
        .join('\n')

      proposalData.description = `${description}\n\n${bugDetails}`
    }

    createProposalMutation.mutate(proposalData, {
      onSuccess: (newProposal) => {
        navigate(`/dao/${daoId}/proposal/${newProposal.proposalId}`)
      },
      onError: (err) => {
        setSubmitError(
          err instanceof Error ? err.message : 'Failed to create proposal',
        )
      },
    })
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] pb-24">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-[var(--surface)]/95 backdrop-blur-xl border-b border-[var(--border)]">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                to={`/dao/${daoId}?tab=governance`}
                className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                aria-label="Back to governance"
              >
                <ArrowLeft className="w-5 h-5" aria-hidden="true" />
              </Link>
              <div>
                <div className="flex items-center gap-2">
                  <span className={`p-1.5 rounded-lg ${typeConfig.color}`}>
                    <TypeIcon className="w-4 h-4" aria-hidden="true" />
                  </span>
                  <h1 className="text-xl font-bold text-[var(--text-primary)]">
                    New {typeConfig.label} Proposal
                  </h1>
                </div>
                <p className="text-sm text-[var(--text-tertiary)] mt-0.5">
                  {typeConfig.description}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {submitError && (
                <div className="flex items-center gap-2 text-[var(--color-error)] text-sm" role="alert">
                  <AlertCircle className="w-4 h-4" aria-hidden="true" />
                  {submitError}
                </div>
              )}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={
                  createProposalMutation.isPending ||
                  !title.trim() ||
                  !description.trim()
                }
                className="btn-primary disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-tertiary)] disabled:cursor-not-allowed"
              >
                {createProposalMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" aria-hidden="true" />
                    Submit Proposal
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="container mx-auto px-4 py-8 max-w-2xl space-y-6">
        {/* Basic Info */}
        <div className="card-static p-6 space-y-4">
          <div>
            <label
              htmlFor="proposal-title"
              className="block text-sm font-medium text-[var(--text-primary)] mb-2"
            >
              Title *
            </label>
            <input
              id="proposal-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief, descriptive title"
              className="input"
            />
          </div>
          <div>
            <label
              htmlFor="proposal-description"
              className="block text-sm font-medium text-[var(--text-primary)] mb-2"
            >
              Description *
            </label>
            <textarea
              id="proposal-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  type === 'bug_report'
                    ? 'Describe the vulnerability and its impact...'
                    : 'Context, motivation, and implementation details...'
                }
              rows={8}
              className="textarea"
            />
            <p className="text-xs text-[var(--text-tertiary)] mt-1">Markdown supported</p>
          </div>
        </div>

        {/* Bug Report Specific */}
        {type === 'bug_report' && (
          <>
            <div className="card-static p-6 space-y-4">
              <h3 className="font-semibold text-[var(--text-primary)]">
                Vulnerability Details
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <span className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                    Severity *
                  </span>
                  <div className="space-y-2">
                    {(
                      Object.entries(SEVERITY_CONFIG) as [
                        BountySeverity,
                        { label: string; color: string; reward: string },
                      ][]
                    ).map(([key, config]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSeverity(key)}
                        className={`w-full p-3 rounded-xl border text-left transition-colors ${
                          severity === key
                            ? config.color
                            : 'bg-[var(--bg-secondary)] border-[var(--border)] hover:border-[var(--border-strong)]'
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-medium">{config.label}</span>
                          <span className="text-xs text-[var(--text-tertiary)]">
                            {config.reward}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="vuln-type"
                    className="block text-sm font-medium text-[var(--text-primary)] mb-2"
                  >
                    Vulnerability Type *
                  </label>
                  <select
                    id="vuln-type"
                    value={vulnType}
                    onChange={(e) =>
                      setVulnType(e.target.value as VulnerabilityType)
                    }
                    className="input"
                  >
                    {VULN_TYPES.map((vt) => (
                      <option key={vt.value} value={vt.value}>
                        {vt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <span className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                  Affected Components
                </span>
                <div className="flex flex-wrap gap-2 mb-2">
                  {affectedComponents.map((c) => (
                    <span
                      key={c}
                      className="inline-flex items-center gap-1.5 px-3 py-1 bg-[var(--bg-secondary)] text-[var(--text-secondary)] rounded-lg text-sm"
                    >
                      {c}
                      <button
                        type="button"
                        onClick={() => removeComponent(c)}
                        className="hover:text-[var(--color-error)]"
                        aria-label={`Remove ${c}`}
                      >
                        <X className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={componentInput}
                    onChange={(e) => setComponentInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addComponent()}
                    placeholder="e.g., FeeDistributor.sol"
                    className="input flex-1 text-sm"
                  />
                  <button
                    type="button"
                    onClick={addComponent}
                    className="btn-secondary text-sm"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>

            <div className="card-static p-6 space-y-4">
              <h3 className="font-semibold text-[var(--text-primary)]">
                Steps to Reproduce
              </h3>
              <div className="space-y-2">
                {stepsToReproduce.map((step, index) => (
                  <div
                    key={`step-${step.slice(0, 30).replace(/\s+/g, '-')}-${index}`}
                    className="flex gap-2 items-start"
                  >
                    <span className="w-6 h-6 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center text-xs text-[var(--text-tertiary)] mt-2 shrink-0">
                      {index + 1}
                    </span>
                    <input
                      type="text"
                      value={step}
                      onChange={(e) => updateStep(index, e.target.value)}
                      placeholder={`Step ${index + 1}`}
                      className="input flex-1"
                    />
                    {stepsToReproduce.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeStep(index)}
                        className="p-2 hover:bg-[var(--color-error)]/20 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--color-error)] transition-colors"
                        aria-label={`Remove step ${index + 1}`}
                      >
                        <X className="w-4 h-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addStep}
                  className="text-sm text-[var(--color-primary)] hover:text-[var(--color-primary-dark)]"
                >
                  + Add Step
                </button>
              </div>
            </div>

            <div className="card-static p-6 space-y-4">
              <h3 className="font-semibold text-[var(--text-primary)]">
                Proof of Concept (Optional)
              </h3>
              <textarea
                value={poc}
                onChange={(e) => setPoc(e.target.value)}
                placeholder="Code snippet or detailed technical proof..."
                rows={6}
                className="textarea font-mono text-sm"
              />
            </div>

            <div className="card-static p-6 space-y-4">
              <h3 className="font-semibold text-[var(--text-primary)]">
                Suggested Fix (Optional)
              </h3>
              <textarea
                value={suggestedFix}
                onChange={(e) => setSuggestedFix(e.target.value)}
                placeholder="Recommended mitigation or fix..."
                rows={4}
                className="textarea"
              />
            </div>
          </>
        )}

        {/* Funding Specific */}
        {type === 'funding' && (
          <div className="card-static p-6 space-y-4">
            <h3 className="font-semibold text-[var(--text-primary)]">Funding Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="funding-amount"
                  className="block text-sm font-medium text-[var(--text-primary)] mb-2"
                >
                  Amount *
                </label>
                <div className="flex">
                  <input
                    id="funding-amount"
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="input rounded-r-none flex-1"
                  />
                  <select
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="input rounded-l-none border-l-0"
                  >
                    <option value="ETH">ETH</option>
                    <option value="USDC">USDC</option>
                    <option value="JEJU">JEJU</option>
                  </select>
                </div>
              </div>
              <div>
                <label
                  htmlFor="recipient-address"
                  className="block text-sm font-medium text-[var(--text-primary)] mb-2"
                >
                  Recipient Address *
                </label>
                <input
                  id="recipient-address"
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="0x..."
                  className="input font-mono"
                />
              </div>
            </div>
          </div>
        )}

        {/* Code Specific */}
        {type === 'code' && (
          <div className="card-static p-6 space-y-4">
            <h3 className="font-semibold text-[var(--text-primary)]">Linked PRs</h3>
            <div className="flex flex-wrap gap-2 mb-2">
              {linkedPRs.map((pr) => (
                <span
                  key={pr}
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-[var(--bg-secondary)] text-[var(--text-secondary)] rounded-lg text-sm"
                >
                  <GitBranch className="w-3 h-3" aria-hidden="true" />
                  {pr}
                  <button
                    type="button"
                    onClick={() => removePR(pr)}
                    className="hover:text-[var(--color-error)]"
                    aria-label={`Remove ${pr}`}
                  >
                    <X className="w-3 h-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={prInput}
                onChange={(e) => setPrInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addPR()}
                placeholder="org/repo#123"
                className="input flex-1 text-sm"
              />
              <button
                type="button"
                onClick={addPR}
                className="btn-secondary text-sm"
              >
                Add
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

export default function ProposalPage() {
  const { daoId, proposalId } = useParams<{
    daoId: string
    proposalId: string
  }>()
  const [searchParams] = useSearchParams()
  const isCreate = proposalId === 'new'
  const type = (searchParams.get('type') as ProposalType) || 'general'

  // Use real API hook for fetching proposals
  const {
    data: proposal,
    isLoading: loading,
    error,
    refetch,
  } = useProposal(
    isCreate ? undefined : daoId,
    isCreate ? undefined : proposalId,
  )

  if (!daoId) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <p className="text-[var(--text-secondary)]">DAO not found</p>
      </div>
    )
  }

  if (isCreate) {
    return <CreateProposalForm daoId={daoId} type={type} />
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[var(--color-primary)] animate-spin" aria-label="Loading" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-[var(--color-error)]/20 border border-[var(--color-error)]/30 flex items-center justify-center">
            <AlertCircle className="w-10 h-10 text-[var(--color-error)]" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
            Failed to load proposal
          </h2>
          <p className="text-[var(--text-secondary)] mb-4">
            {error instanceof Error
              ? error.message
              : 'Connection error'}
          </p>
          <div className="flex gap-3 justify-center">
            <button
              type="button"
              onClick={() => refetch()}
              className="btn-secondary"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              Try Again
            </button>
            <Link
              to={`/dao/${daoId}?tab=governance`}
              className="btn-primary"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Back to Governance
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!proposal) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
            Proposal not found
          </h2>
          <Link
            to={`/dao/${daoId}?tab=governance`}
            className="text-[var(--color-primary)] hover:text-[var(--color-primary-dark)]"
          >
            Back to Governance
          </Link>
        </div>
      </div>
    )
  }

  return <ProposalView daoId={daoId} proposal={proposal} />
}
