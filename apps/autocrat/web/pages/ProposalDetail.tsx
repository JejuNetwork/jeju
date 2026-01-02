import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Clock,
  ExternalLink,
  FileSearch,
  Flag,
  Loader2,
  Shield,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAccount } from 'wagmi'
import {
  conductResearch,
  fetchProposal,
  fetchProposalFlags,
  fetchProposalModerationScore,
  type Proposal,
  type QuickScreenResult,
  quickScreenResearch,
  type ResearchReport,
  submitModerationFlag,
} from '../config/api'

interface ModerationScore {
  score: number
  flagCount: number
  lastUpdated: number
}

interface ModerationFlag {
  id: string
  flagger: string
  flagType: string
  reason: string
  createdAt: number
  upvotes: number
  downvotes: number
}

export default function ProposalDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { address, isConnected } = useAccount()
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [moderationScore, setModerationScore] =
    useState<ModerationScore | null>(null)
  const [flags, setFlags] = useState<ModerationFlag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Research state
  const [quickScreen, setQuickScreen] = useState<QuickScreenResult | null>(null)
  const [research, setResearch] = useState<ResearchReport | null>(null)
  const [researchLoading, setResearchLoading] = useState(false)

  // Flag submission state
  const [showFlagForm, setShowFlagForm] = useState(false)
  const [flagReason, setFlagReason] = useState('')
  const [flagType, setFlagType] = useState('spam')
  const [flagSubmitting, setFlagSubmitting] = useState(false)
  const [flagError, setFlagError] = useState<string | null>(null)

  const loadProposal = useCallback(async () => {
    if (!id) return

    setLoading(true)
    setError(null)

    const [proposalData, modScore, flagsData] = await Promise.all([
      fetchProposal(id).catch((e: Error) => {
        setError(e.message)
        return null
      }),
      fetchProposalModerationScore(id).catch(() => null),
      fetchProposalFlags(id).catch(() => ({ flags: [] })),
    ])

    setProposal(proposalData)
    setModerationScore(modScore as ModerationScore | null)
    setFlags(
      (flagsData as { flags: ModerationFlag[] } | null)?.flags ??
        ([] as ModerationFlag[]),
    )
    setLoading(false)
  }, [id])

  useEffect(() => {
    loadProposal()
  }, [loadProposal])

  const handleQuickScreen = async () => {
    if (!proposal) return
    setResearchLoading(true)
    const result = await quickScreenResearch({
      proposalId: proposal.proposalId,
      title: proposal.proposalType,
      description: `Proposal ${proposal.proposalId} by ${proposal.proposer}`,
    }).catch(() => null)
    setQuickScreen(result as QuickScreenResult | null)
    setResearchLoading(false)
  }

  const handleDeepResearch = async () => {
    if (!proposal) return
    setResearchLoading(true)
    const result = await conductResearch({
      proposalId: proposal.proposalId,
      title: proposal.proposalType,
      description: `Full analysis of proposal ${proposal.proposalId}`,
      depth: 'deep',
    }).catch(() => null)
    setResearch(result as ResearchReport | null)
    setResearchLoading(false)
  }

  const handleSubmitFlag = async () => {
    if (!proposal || !flagReason.trim()) return

    if (!isConnected || !address) {
      setFlagError('Please connect your wallet to submit a flag')
      return
    }

    setFlagError(null)
    setFlagSubmitting(true)

    try {
      await submitModerationFlag({
        proposalId: proposal.proposalId,
        flagger: address,
        flagType,
        reason: flagReason,
      })
      setShowFlagForm(false)
      setFlagReason('')
      loadProposal()
    } catch (err) {
      setFlagError(err instanceof Error ? err.message : 'Failed to submit flag')
    } finally {
      setFlagSubmitting(false)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return (
          <CheckCircle
            className="text-[var(--color-success)]"
            size={20}
            aria-hidden="true"
          />
        )
      case 'REJECTED':
        return (
          <XCircle
            className="text-[var(--color-error)]"
            size={20}
            aria-hidden="true"
          />
        )
      case 'AUTOCRAT_REVIEW':
        return (
          <Users
            className="text-[var(--color-primary)]"
            size={20}
            aria-hidden="true"
          />
        )
      case 'CEO_QUEUE':
        return (
          <Clock
            className="text-[var(--color-warning)]"
            size={20}
            aria-hidden="true"
          />
        )
      default:
        return (
          <Clock
            className="text-[var(--text-tertiary)]"
            size={20}
            aria-hidden="true"
          />
        )
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2
          className="animate-spin text-[var(--color-primary)]"
          size={32}
          aria-label="Loading"
        />
      </div>
    )
  }

  if (error || !proposal) {
    return (
      <div className="card-static p-8 text-center">
        <XCircle
          className="mx-auto mb-4 text-[var(--color-error)]"
          size={48}
          aria-hidden="true"
        />
        <h2 className="text-xl font-semibold mb-2 text-[var(--text-primary)]">
          Proposal Not Found
        </h2>
        <p className="text-[var(--text-secondary)] mb-4">
          {error ?? 'Unable to load proposal'}
        </p>
        <Link to="/proposals" className="btn-secondary">
          ← Back to Proposals
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          to="/proposals"
          className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg transition-colors"
          aria-label="Back to proposals"
        >
          <ArrowLeft
            size={20}
            className="text-[var(--text-secondary)]"
            aria-hidden="true"
          />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold flex items-center gap-2 text-[var(--text-primary)]">
            {getStatusIcon(proposal.status)}
            Proposal {proposal.proposalId.slice(0, 10)}...
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            {proposal.proposalType} • Created{' '}
            {new Date(proposal.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Proposal Details */}
        <div className="lg:col-span-2 space-y-4">
          <div className="card-static p-4 sm:p-6">
            <h2 className="font-semibold mb-4 text-[var(--text-primary)]">
              Proposal Details
            </h2>
            <dl className="space-y-3">
              <div className="flex justify-between py-2 border-b border-[var(--border)]">
                <dt className="text-[var(--text-secondary)]">Proposer</dt>
                <dd className="font-mono text-sm text-[var(--text-primary)]">
                  {proposal.proposer.slice(0, 6)}...
                  {proposal.proposer.slice(-4)}
                </dd>
              </div>
              <div className="flex justify-between py-2 border-b border-[var(--border)]">
                <dt className="text-[var(--text-secondary)]">Status</dt>
                <dd className="flex items-center gap-2 text-[var(--text-primary)]">
                  {getStatusIcon(proposal.status)}
                  {proposal.status}
                </dd>
              </div>
              <div className="flex justify-between py-2 border-b border-[var(--border)]">
                <dt className="text-[var(--text-secondary)]">Quality Score</dt>
                <dd className="font-semibold text-[var(--text-primary)]">
                  {proposal.qualityScore}/100
                </dd>
              </div>
              {proposal.totalStaked && (
                <div className="flex justify-between py-2 border-b border-[var(--border)]">
                  <dt className="text-[var(--text-secondary)]">Total Staked</dt>
                  <dd className="text-[var(--text-primary)]">
                    {proposal.totalStaked}
                  </dd>
                </div>
              )}
              {proposal.backerCount && (
                <div className="flex justify-between py-2">
                  <dt className="text-[var(--text-secondary)]">Backers</dt>
                  <dd className="text-[var(--text-primary)]">
                    {proposal.backerCount}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Research Section */}
          <div className="card-static p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold flex items-center gap-2 text-[var(--text-primary)]">
                <FileSearch size={18} aria-hidden="true" />
                Research
              </h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleQuickScreen}
                  disabled={researchLoading}
                  className="btn-secondary text-sm"
                >
                  {researchLoading ? (
                    <Loader2
                      className="animate-spin"
                      size={14}
                      aria-hidden="true"
                    />
                  ) : (
                    'Quick Screen'
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleDeepResearch}
                  disabled={researchLoading}
                  className="btn-primary text-sm"
                >
                  {researchLoading ? (
                    <Loader2
                      className="animate-spin"
                      size={14}
                      aria-hidden="true"
                    />
                  ) : (
                    'Deep Research'
                  )}
                </button>
              </div>
            </div>

            {quickScreen && (
              <div className="p-4 rounded-lg bg-[var(--bg-secondary)] mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      quickScreen.recommendation === 'proceed'
                        ? 'bg-[var(--color-success)]/20 text-[var(--color-success)]'
                        : quickScreen.recommendation === 'reject'
                          ? 'bg-[var(--color-error)]/20 text-[var(--color-error)]'
                          : 'bg-[var(--color-warning)]/20 text-[var(--color-warning)]'
                    }`}
                  >
                    {quickScreen.recommendation.toUpperCase()}
                  </span>
                  <span className="text-sm text-[var(--text-secondary)]">
                    {quickScreen.confidence}% confidence
                  </span>
                </div>
                {quickScreen.redFlags.length > 0 && (
                  <div className="mt-2">
                    <span className="text-xs font-medium text-[var(--color-error)]">
                      Red Flags:
                    </span>
                    <ul className="text-sm text-[var(--text-secondary)] mt-1">
                      {quickScreen.redFlags.map((flag) => (
                        <li key={flag}>• {flag}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {quickScreen.greenFlags.length > 0 && (
                  <div className="mt-2">
                    <span className="text-xs font-medium text-[var(--color-success)]">
                      Green Flags:
                    </span>
                    <ul className="text-sm text-[var(--text-secondary)] mt-1">
                      {quickScreen.greenFlags.map((flag) => (
                        <li key={flag}>• {flag}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {research && (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-[var(--bg-secondary)]">
                  <div className="flex items-center gap-4 mb-4">
                    <span
                      className={`px-3 py-1 rounded-full text-sm font-medium ${
                        research.recommendation === 'proceed'
                          ? 'bg-[var(--color-success)]/20 text-[var(--color-success)]'
                          : research.recommendation === 'reject'
                            ? 'bg-[var(--color-error)]/20 text-[var(--color-error)]'
                            : 'bg-[var(--color-warning)]/20 text-[var(--color-warning)]'
                      }`}
                    >
                      {research.recommendation.toUpperCase()}
                    </span>
                    <span className="text-sm text-[var(--text-secondary)]">
                      Risk:{' '}
                      <strong className="text-[var(--text-primary)]">
                        {research.riskLevel}
                      </strong>
                    </span>
                    <span className="text-sm text-[var(--text-secondary)]">
                      Confidence:{' '}
                      <strong className="text-[var(--text-primary)]">
                        {research.confidenceLevel}%
                      </strong>
                    </span>
                  </div>
                  <p className="text-sm mb-4 text-[var(--text-secondary)]">
                    {research.summary}
                  </p>
                  {research.keyFindings.length > 0 && (
                    <div className="mb-3">
                      <h4 className="text-xs font-medium uppercase text-[var(--text-tertiary)] mb-1">
                        Key Findings
                      </h4>
                      <ul className="text-sm space-y-1 text-[var(--text-secondary)]">
                        {research.keyFindings.map((finding) => (
                          <li key={finding}>✓ {finding}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {research.concerns.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium uppercase text-[var(--text-tertiary)] mb-1">
                        Concerns
                      </h4>
                      <ul className="text-sm space-y-1 text-[var(--color-warning)]">
                        {research.concerns.map((concern) => (
                          <li key={concern}>⚠ {concern}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                {research.ipfsHash && (
                  <a
                    href={`https://ipfs.io/ipfs/${research.ipfsHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[var(--color-primary)] hover:text-[var(--color-primary-dark)] flex items-center gap-1"
                  >
                    View full report on IPFS
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                )}
              </div>
            )}

            {!quickScreen && !research && (
              <p className="text-sm text-[var(--text-secondary)]">
                Run a quick screen or deep research to analyze this proposal.
              </p>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Moderation Score */}
          <div className="card-static p-4">
            <h3 className="font-semibold flex items-center gap-2 mb-3 text-[var(--text-primary)]">
              <Shield size={16} aria-hidden="true" />
              Moderation
            </h3>
            {moderationScore ? (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-[var(--text-secondary)]">Score</span>
                  <span className="font-semibold text-[var(--text-primary)]">
                    {moderationScore.score}/100
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-secondary)]">Flags</span>
                  <span
                    className={
                      moderationScore.flagCount > 0
                        ? 'text-[var(--color-error)]'
                        : 'text-[var(--text-primary)]'
                    }
                  >
                    {moderationScore.flagCount}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">
                No moderation data
              </p>
            )}
          </div>

          {/* Flags */}
          <div className="card-static p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2 text-[var(--text-primary)]">
                <Flag size={16} aria-hidden="true" />
                Flags ({flags.length})
              </h3>
              <button
                type="button"
                onClick={() => setShowFlagForm(!showFlagForm)}
                className="text-sm text-[var(--color-primary)] hover:text-[var(--color-primary-dark)]"
              >
                {showFlagForm ? 'Cancel' : 'Report'}
              </button>
            </div>

            {showFlagForm && (
              <div className="mb-4 p-3 border rounded-lg border-[var(--border)] bg-[var(--bg-secondary)]">
                {!isConnected && (
                  <div className="mb-3 p-2 rounded bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30 flex items-center gap-2 text-sm text-[var(--color-warning)]">
                    <Wallet size={14} aria-hidden="true" />
                    Connect wallet to submit flags
                  </div>
                )}
                {flagError && (
                  <div className="mb-3 p-2 rounded bg-[var(--color-error)]/10 border border-[var(--color-error)]/30 text-sm text-[var(--color-error)]">
                    {flagError}
                  </div>
                )}
                <label htmlFor="flag-type" className="sr-only">
                  Flag Type
                </label>
                <select
                  id="flag-type"
                  value={flagType}
                  onChange={(e) => setFlagType(e.target.value)}
                  className="input mb-2"
                >
                  <option value="spam">Spam</option>
                  <option value="inappropriate">Inappropriate</option>
                  <option value="duplicate">Duplicate</option>
                  <option value="misleading">Misleading</option>
                  <option value="other">Other</option>
                </select>
                <label htmlFor="flag-reason" className="sr-only">
                  Reason for flagging
                </label>
                <textarea
                  id="flag-reason"
                  value={flagReason}
                  onChange={(e) => setFlagReason(e.target.value)}
                  placeholder="Reason for flagging..."
                  className="textarea text-sm"
                  rows={3}
                />
                <button
                  type="button"
                  onClick={handleSubmitFlag}
                  disabled={
                    flagSubmitting || !flagReason.trim() || !isConnected
                  }
                  className="btn-primary w-full mt-2 text-sm"
                >
                  {flagSubmitting ? (
                    <Loader2
                      className="animate-spin mx-auto"
                      size={16}
                      aria-hidden="true"
                    />
                  ) : (
                    'Submit Flag'
                  )}
                </button>
              </div>
            )}

            {flags.length > 0 ? (
              <div className="space-y-2">
                {flags.map((flag) => (
                  <div
                    key={flag.id}
                    className="p-2 rounded bg-[var(--bg-secondary)] text-sm"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle
                        size={14}
                        className="text-[var(--color-warning)]"
                        aria-hidden="true"
                      />
                      <span className="font-medium text-[var(--text-primary)]">
                        {flag.flagType}
                      </span>
                    </div>
                    <p className="text-[var(--text-secondary)]">
                      {flag.reason}
                    </p>
                    <div className="flex gap-3 mt-2 text-xs text-[var(--text-tertiary)]">
                      <span>👍 {flag.upvotes}</span>
                      <span>👎 {flag.downvotes}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">
                No flags reported
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
