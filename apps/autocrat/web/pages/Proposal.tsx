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
    color: 'text-slate-400 bg-slate-500/20',
    description: 'General governance proposal',
  },
  funding: {
    label: 'Funding',
    icon: DollarSign,
    color: 'text-green-400 bg-green-500/20',
    description: 'Request treasury funding',
  },
  code: {
    label: 'Code Change',
    icon: GitBranch,
    color: 'text-violet-400 bg-violet-500/20',
    description: 'Technical implementation',
  },
  moderation: {
    label: 'Moderation',
    icon: Shield,
    color: 'text-orange-400 bg-orange-500/20',
    description: 'Content or user moderation',
  },
  bug_report: {
    label: 'Bug Report',
    icon: FileCode2,
    color: 'text-red-400 bg-red-500/20',
    description: 'Security or bug disclosure',
  },
}

const STATUS_CONFIG: Record<ProposalStatus, { label: string; color: string }> =
  {
    draft: { label: 'Draft', color: 'text-slate-400 bg-slate-500/20' },
    pending_quality: {
      label: 'Pending Quality',
      color: 'text-yellow-400 bg-yellow-500/20',
    },
    submitted: { label: 'Submitted', color: 'text-blue-400 bg-blue-500/20' },
    board_review: {
      label: 'Board Review',
      color: 'text-purple-400 bg-purple-500/20',
    },
    research: { label: 'Research', color: 'text-indigo-400 bg-indigo-500/20' },
    board_final: {
      label: 'Final Review',
      color: 'text-cyan-400 bg-cyan-500/20',
    },
    ceo_queue: {
      label: 'CEO Queue',
      color: 'text-orange-400 bg-orange-500/20',
    },
    approved: { label: 'Approved', color: 'text-green-400 bg-green-500/20' },
    executing: { label: 'Executing', color: 'text-teal-400 bg-teal-500/20' },
    completed: {
      label: 'Completed',
      color: 'text-emerald-400 bg-emerald-500/20',
    },
    rejected: { label: 'Rejected', color: 'text-red-400 bg-red-500/20' },
    vetoed: { label: 'Vetoed', color: 'text-red-400 bg-red-500/20' },
    executed: {
      label: 'Executed',
      color: 'text-emerald-400 bg-emerald-500/20',
    },
    cancelled: { label: 'Cancelled', color: 'text-slate-400 bg-slate-500/20' },
  }

const SEVERITY_CONFIG: Record<
  BountySeverity,
  { label: string; color: string; reward: string }
> = {
  critical: {
    label: 'Critical',
    color: 'text-red-400 bg-red-500/20 border-red-500/50',
    reward: '$5,000 - $50,000',
  },
  high: {
    label: 'High',
    color: 'text-orange-400 bg-orange-500/20 border-orange-500/50',
    reward: '$1,000 - $5,000',
  },
  medium: {
    label: 'Medium',
    color: 'text-yellow-400 bg-yellow-500/20 border-yellow-500/50',
    reward: '$250 - $1,000',
  },
  low: {
    label: 'Low',
    color: 'text-blue-400 bg-blue-500/20 border-blue-500/50',
    reward: '$50 - $250',
  },
  informational: {
    label: 'Informational',
    color: 'text-slate-400 bg-slate-500/20 border-slate-500/50',
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
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            isCEO
              ? 'bg-gradient-to-br from-violet-500 to-pink-500'
              : 'bg-slate-700'
          }`}
        >
          {isCEO ? (
            <Crown className="w-5 h-5 text-white" />
          ) : (
            <Bot className="w-5 h-5 text-slate-300" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-slate-200">{agentName}</p>
              <p className="text-xs text-slate-500">{agentRole}</p>
            </div>
            <span
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${
                vote === 'approve'
                  ? 'bg-green-500/20 text-green-400'
                  : vote === 'reject'
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-slate-500/20 text-slate-400'
              }`}
            >
              {vote === 'approve' ? (
                <ThumbsUp className="w-3 h-3" />
              ) : vote === 'reject' ? (
                <ThumbsDown className="w-3 h-3" />
              ) : null}
              {vote.charAt(0).toUpperCase() + vote.slice(1)}
            </span>
          </div>
          {reasoning && (
            <p className="text-sm text-slate-400 mt-2">{reasoning}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
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
    <div className="min-h-screen bg-slate-950 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-slate-950/95 backdrop-blur-xl border-b border-slate-800">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link
              to={`/dao/${daoId}?tab=governance`}
              className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <span
                  className={`px-2 py-1 rounded-lg text-xs font-medium ${typeConfig.color}`}
                >
                  <TypeIcon className="w-3 h-3 inline-block mr-1" />
                  {typeConfig.label}
                </span>
                <span
                  className={`px-2 py-1 rounded-lg text-xs font-medium ${statusConfig.color}`}
                >
                  {statusConfig.label}
                </span>
              </div>
              <h1 className="text-xl font-bold text-white mt-1">
                {proposal.title}
              </h1>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="grid grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="col-span-2 space-y-6">
            {/* Description */}
            <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-6">
              <div className="prose prose-invert prose-sm max-w-none">
                {proposal.description.split('\n').map((line, i) => {
                  const lineKey = `desc-${i}-${line.substring(0, 20)}`
                  if (line.startsWith('## ')) {
                    return (
                      <h2
                        key={lineKey}
                        className="text-lg font-semibold text-slate-200 mt-4 mb-2"
                      >
                        {line.replace('## ', '')}
                      </h2>
                    )
                  }
                  if (line.startsWith('1. ') || line.startsWith('- ')) {
                    return (
                      <p key={lineKey} className="text-slate-400 ml-4">
                        {line}
                      </p>
                    )
                  }
                  return line ? (
                    <p key={lineKey} className="text-slate-400">
                      {line}
                    </p>
                  ) : null
                })}
              </div>
            </div>

            {/* Board Votes */}
            <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-6">
              <h3 className="font-semibold text-slate-200 mb-4">Board Votes</h3>
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
                  <div className="text-center py-6 text-slate-500 text-sm">
                    No votes yet
                  </div>
                )}
              </div>
            </div>

            {/* Tags */}
            {proposal.tags.length > 0 && (
              <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-6">
                <h3 className="font-semibold text-slate-200 mb-4">Tags</h3>
                <div className="flex flex-wrap gap-2">
                  {proposal.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-3 py-1 bg-slate-800 text-slate-300 rounded-lg text-sm"
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
            <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-5">
              <h4 className="text-sm font-medium text-slate-400 mb-3">
                Voting Progress
              </h4>
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-400">Board Approval</span>
                  <span className="text-slate-200">
                    {approveCount}/{totalVotes} ({approvalPercent}%)
                  </span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full"
                    style={{ width: `${approvalPercent}%` }}
                  />
                </div>
              </div>
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-400">CEO Decision</span>
                  <span className="text-slate-200">
                    {proposal.ceoDecision
                      ? proposal.ceoDecision.approved
                        ? 'Approved'
                        : 'Rejected'
                      : 'Pending'}
                  </span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  {proposal.ceoDecision && (
                    <div
                      className={`h-full rounded-full ${
                        proposal.ceoDecision.approved
                          ? 'bg-green-500'
                          : 'bg-red-500'
                      }`}
                      style={{ width: '100%' }}
                    />
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Clock className="w-4 h-4" />
                <span>
                  Updated {new Date(proposal.updatedAt).toLocaleDateString()}
                </span>
              </div>
            </div>

            {/* Meta */}
            <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-5">
              <h4 className="text-sm font-medium text-slate-400 mb-3">
                Details
              </h4>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Created</span>
                  <span className="text-slate-300">
                    {new Date(proposal.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Proposer</span>
                  <span className="text-slate-300 font-mono text-xs">
                    {proposal.proposer.slice(0, 6)}...
                    {proposal.proposer.slice(-4)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Proposal ID</span>
                  <span className="text-slate-300">{proposal.proposalId}</span>
                </div>
              </div>
            </div>

            {/* Actions */}
            {proposal.status === 'submitted' && (
              <button
                type="button"
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-xl font-medium transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
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
    <div className="min-h-screen bg-slate-950 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-slate-950/95 backdrop-blur-xl border-b border-slate-800">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                to={`/dao/${daoId}?tab=governance`}
                className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <div className="flex items-center gap-2">
                  <span className={`p-1.5 rounded-lg ${typeConfig.color}`}>
                    <TypeIcon className="w-4 h-4" />
                  </span>
                  <h1 className="text-xl font-bold text-white">
                    New {typeConfig.label} Proposal
                  </h1>
                </div>
                <p className="text-sm text-slate-500 mt-0.5">
                  {typeConfig.description}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {submitError && (
                <div className="flex items-center gap-2 text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4" />
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
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors"
              >
                {createProposalMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
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
        <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
          <div>
            <label
              htmlFor="proposal-title"
              className="block text-sm font-medium text-slate-300 mb-2"
            >
              Title *
            </label>
            <input
              id="proposal-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief, descriptive title"
              className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label
              htmlFor="proposal-description"
              className="block text-sm font-medium text-slate-300 mb-2"
            >
              Description *
            </label>
            <textarea
              id="proposal-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                type === 'bug_report'
                  ? 'Describe the vulnerability, its impact, and how you discovered it...'
                  : 'Provide context, motivation, and details...'
              }
              rows={8}
              className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500 resize-none"
            />
            <p className="text-xs text-slate-500 mt-1">Markdown supported</p>
          </div>
        </div>

        {/* Bug Report Specific */}
        {type === 'bug_report' && (
          <>
            <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
              <h3 className="font-semibold text-slate-200">
                Vulnerability Details
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="block text-sm font-medium text-slate-300 mb-2">
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
                            : 'bg-slate-800 border-slate-700 hover:border-slate-600'
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-medium">{config.label}</span>
                          <span className="text-xs text-slate-400">
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
                    className="block text-sm font-medium text-slate-300 mb-2"
                  >
                    Vulnerability Type *
                  </label>
                  <select
                    id="vuln-type"
                    value={vulnType}
                    onChange={(e) =>
                      setVulnType(e.target.value as VulnerabilityType)
                    }
                    className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 focus:outline-none focus:border-violet-500"
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
                <span className="block text-sm font-medium text-slate-300 mb-2">
                  Affected Components
                </span>
                <div className="flex flex-wrap gap-2 mb-2">
                  {affectedComponents.map((c) => (
                    <span
                      key={c}
                      className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-700 text-slate-300 rounded-lg text-sm"
                    >
                      {c}
                      <button
                        type="button"
                        onClick={() => removeComponent(c)}
                        className="hover:text-red-400"
                      >
                        <X className="w-3 h-3" />
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
                    className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500 text-sm"
                  />
                  <button
                    type="button"
                    onClick={addComponent}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl text-sm transition-colors"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
              <h3 className="font-semibold text-slate-200">
                Steps to Reproduce
              </h3>
              <div className="space-y-2">
                {stepsToReproduce.map((step, index) => (
                  <div
                    key={`step-${step.slice(0, 30).replace(/\s+/g, '-')}-${index}`}
                    className="flex gap-2 items-start"
                  >
                    <span className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-xs text-slate-400 mt-2 shrink-0">
                      {index + 1}
                    </span>
                    <input
                      type="text"
                      value={step}
                      onChange={(e) => updateStep(index, e.target.value)}
                      placeholder={`Step ${index + 1}`}
                      className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
                    />
                    {stepsToReproduce.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeStep(index)}
                        className="p-2 hover:bg-red-500/20 rounded-lg text-slate-500 hover:text-red-400 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addStep}
                  className="text-sm text-violet-400 hover:text-violet-300"
                >
                  + Add Step
                </button>
              </div>
            </div>

            <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
              <h3 className="font-semibold text-slate-200">
                Proof of Concept (Optional)
              </h3>
              <textarea
                value={poc}
                onChange={(e) => setPoc(e.target.value)}
                placeholder="Code snippet or detailed technical proof..."
                rows={6}
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500 resize-none font-mono text-sm"
              />
            </div>

            <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
              <h3 className="font-semibold text-slate-200">
                Suggested Fix (Optional)
              </h3>
              <textarea
                value={suggestedFix}
                onChange={(e) => setSuggestedFix(e.target.value)}
                placeholder="Recommended mitigation or fix..."
                rows={4}
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500 resize-none"
              />
            </div>
          </>
        )}

        {/* Funding Specific */}
        {type === 'funding' && (
          <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
            <h3 className="font-semibold text-slate-200">Funding Details</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="funding-amount"
                  className="block text-sm font-medium text-slate-300 mb-2"
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
                    className="flex-1 px-4 py-3 bg-slate-800 border border-slate-700 rounded-l-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
                  />
                  <select
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="px-4 py-3 bg-slate-700 border border-slate-600 rounded-r-xl text-slate-200"
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
                  className="block text-sm font-medium text-slate-300 mb-2"
                >
                  Recipient Address *
                </label>
                <input
                  id="recipient-address"
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500 font-mono"
                />
              </div>
            </div>
          </div>
        )}

        {/* Code Specific */}
        {type === 'code' && (
          <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
            <h3 className="font-semibold text-slate-200">Linked PRs</h3>
            <div className="flex flex-wrap gap-2 mb-2">
              {linkedPRs.map((pr) => (
                <span
                  key={pr}
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-700 text-slate-300 rounded-lg text-sm"
                >
                  <GitBranch className="w-3 h-3" />
                  {pr}
                  <button
                    type="button"
                    onClick={() => removePR(pr)}
                    className="hover:text-red-400"
                  >
                    <X className="w-3 h-3" />
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
                className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500 text-sm"
              />
              <button
                type="button"
                onClick={addPR}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl text-sm transition-colors"
              >
                Add
              </button>
            </div>
          </div>
        )}

        {/* Info Box */}
        <div className="bg-violet-500/10 border border-violet-500/30 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <Bot className="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-violet-300">AI Review Process</h4>
              <p className="text-sm text-violet-200/70 mt-1">
                Your proposal will be automatically reviewed by the DAO's board
                of AI agents. Each agent will analyze the proposal based on
                their expertise and vote accordingly. The CEO will make the
                final decision based on board recommendations.
              </p>
            </div>
          </div>
        </div>
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
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-slate-400">DAO not found</p>
      </div>
    )
  }

  if (isCreate) {
    return <CreateProposalForm daoId={daoId} type={type} />
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-red-500/20 border border-red-500/30 flex items-center justify-center">
            <AlertCircle className="w-10 h-10 text-red-400" />
          </div>
          <h2 className="text-xl font-semibold text-slate-200 mb-2">
            Failed to load proposal
          </h2>
          <p className="text-slate-500 mb-4">
            {error instanceof Error
              ? error.message
              : 'An unknown error occurred'}
          </p>
          <div className="flex gap-3 justify-center">
            <button
              type="button"
              onClick={() => refetch()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
            <Link
              to={`/dao/${daoId}?tab=governance`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Governance
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!proposal) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-slate-200 mb-2">
            Proposal Not Found
          </h2>
          <Link
            to={`/dao/${daoId}?tab=governance`}
            className="text-violet-400 hover:text-violet-300"
          >
            Back to Governance
          </Link>
        </div>
      </div>
    )
  }

  return <ProposalView daoId={daoId} proposal={proposal} />
}
