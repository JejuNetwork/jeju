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
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
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
    setFlagSubmitting(true)
    await submitModerationFlag({
      proposalId: proposal.proposalId,
      flagger: '0x0000000000000000000000000000000000000000', // Would come from wallet
      flagType,
      reason: flagReason,
    }).catch(() => null)
    setFlagSubmitting(false)
    setShowFlagForm(false)
    setFlagReason('')
    loadProposal()
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return <CheckCircle className="text-green-500" size={20} />
      case 'REJECTED':
        return <XCircle className="text-red-500" size={20} />
      case 'AUTOCRAT_REVIEW':
        return <Users className="text-blue-500" size={20} />
      case 'CEO_QUEUE':
        return <Clock className="text-yellow-500" size={20} />
      default:
        return <Clock className="text-gray-400" size={20} />
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="animate-spin" size={32} />
      </div>
    )
  }

  if (error || !proposal) {
    return (
      <div className="card-static p-8 text-center">
        <XCircle className="mx-auto mb-4 text-red-500" size={48} />
        <h2 className="text-xl font-semibold mb-2">Proposal Not Found</h2>
        <p className="text-gray-500 mb-4">
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
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
        >
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            {getStatusIcon(proposal.status)}
            Proposal {proposal.proposalId.slice(0, 10)}...
          </h1>
          <p className="text-sm text-gray-500">
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
            <h2 className="font-semibold mb-4">Proposal Details</h2>
            <dl className="space-y-3">
              <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                <dt className="text-gray-500">Proposer</dt>
                <dd className="font-mono text-sm">
                  {proposal.proposer.slice(0, 6)}...
                  {proposal.proposer.slice(-4)}
                </dd>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                <dt className="text-gray-500">Status</dt>
                <dd className="flex items-center gap-2">
                  {getStatusIcon(proposal.status)}
                  {proposal.status}
                </dd>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                <dt className="text-gray-500">Quality Score</dt>
                <dd className="font-semibold">{proposal.qualityScore}/100</dd>
              </div>
              {proposal.totalStaked && (
                <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                  <dt className="text-gray-500">Total Staked</dt>
                  <dd>{proposal.totalStaked}</dd>
                </div>
              )}
              {proposal.backerCount && (
                <div className="flex justify-between py-2">
                  <dt className="text-gray-500">Backers</dt>
                  <dd>{proposal.backerCount}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Research Section */}
          <div className="card-static p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold flex items-center gap-2">
                <FileSearch size={18} />
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
                    <Loader2 className="animate-spin" size={14} />
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
                    <Loader2 className="animate-spin" size={14} />
                  ) : (
                    'Deep Research'
                  )}
                </button>
              </div>
            </div>

            {quickScreen && (
              <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      quickScreen.recommendation === 'proceed'
                        ? 'bg-green-100 text-green-700'
                        : quickScreen.recommendation === 'reject'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    {quickScreen.recommendation.toUpperCase()}
                  </span>
                  <span className="text-sm text-gray-500">
                    {quickScreen.confidence}% confidence
                  </span>
                </div>
                {quickScreen.redFlags.length > 0 && (
                  <div className="mt-2">
                    <span className="text-xs font-medium text-red-600">
                      Red Flags:
                    </span>
                    <ul className="text-sm text-gray-600 mt-1">
                      {quickScreen.redFlags.map((flag) => (
                        <li key={flag}>• {flag}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {quickScreen.greenFlags.length > 0 && (
                  <div className="mt-2">
                    <span className="text-xs font-medium text-green-600">
                      Green Flags:
                    </span>
                    <ul className="text-sm text-gray-600 mt-1">
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
                <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800">
                  <div className="flex items-center gap-4 mb-4">
                    <span
                      className={`px-3 py-1 rounded-full text-sm font-medium ${
                        research.recommendation === 'proceed'
                          ? 'bg-green-100 text-green-700'
                          : research.recommendation === 'reject'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-yellow-100 text-yellow-700'
                      }`}
                    >
                      {research.recommendation.toUpperCase()}
                    </span>
                    <span className="text-sm">
                      Risk: <strong>{research.riskLevel}</strong>
                    </span>
                    <span className="text-sm">
                      Confidence: <strong>{research.confidenceLevel}%</strong>
                    </span>
                  </div>
                  <p className="text-sm mb-4">{research.summary}</p>
                  {research.keyFindings.length > 0 && (
                    <div className="mb-3">
                      <h4 className="text-xs font-medium uppercase text-gray-500 mb-1">
                        Key Findings
                      </h4>
                      <ul className="text-sm space-y-1">
                        {research.keyFindings.map((finding) => (
                          <li key={finding}>✓ {finding}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {research.concerns.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium uppercase text-gray-500 mb-1">
                        Concerns
                      </h4>
                      <ul className="text-sm space-y-1 text-yellow-600">
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
                    className="text-sm text-blue-500 hover:underline flex items-center gap-1"
                  >
                    View full report on IPFS
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>
            )}

            {!quickScreen && !research && (
              <p className="text-sm text-gray-500">
                Run a quick screen or deep research to analyze this proposal.
              </p>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Moderation Score */}
          <div className="card-static p-4">
            <h3 className="font-semibold flex items-center gap-2 mb-3">
              <Shield size={16} />
              Moderation
            </h3>
            {moderationScore ? (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">Score</span>
                  <span className="font-semibold">
                    {moderationScore.score}/100
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Flags</span>
                  <span
                    className={
                      moderationScore.flagCount > 0 ? 'text-red-500' : ''
                    }
                  >
                    {moderationScore.flagCount}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No moderation data</p>
            )}
          </div>

          {/* Flags */}
          <div className="card-static p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Flag size={16} />
                Flags ({flags.length})
              </h3>
              <button
                type="button"
                onClick={() => setShowFlagForm(!showFlagForm)}
                className="text-sm text-blue-500 hover:underline"
              >
                {showFlagForm ? 'Cancel' : 'Report'}
              </button>
            </div>

            {showFlagForm && (
              <div className="mb-4 p-3 border rounded-lg border-gray-200 dark:border-gray-700">
                <select
                  value={flagType}
                  onChange={(e) => setFlagType(e.target.value)}
                  className="w-full mb-2 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                >
                  <option value="spam">Spam</option>
                  <option value="inappropriate">Inappropriate</option>
                  <option value="duplicate">Duplicate</option>
                  <option value="misleading">Misleading</option>
                  <option value="other">Other</option>
                </select>
                <textarea
                  value={flagReason}
                  onChange={(e) => setFlagReason(e.target.value)}
                  placeholder="Reason for flagging..."
                  className="w-full p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                  rows={3}
                />
                <button
                  type="button"
                  onClick={handleSubmitFlag}
                  disabled={flagSubmitting || !flagReason.trim()}
                  className="btn-primary w-full mt-2 text-sm"
                >
                  {flagSubmitting ? (
                    <Loader2 className="animate-spin mx-auto" size={16} />
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
                    className="p-2 rounded bg-gray-50 dark:bg-gray-800 text-sm"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle size={14} className="text-yellow-500" />
                      <span className="font-medium">{flag.flagType}</span>
                    </div>
                    <p className="text-gray-600 dark:text-gray-400">
                      {flag.reason}
                    </p>
                    <div className="flex gap-3 mt-2 text-xs text-gray-500">
                      <span>👍 {flag.upvotes}</span>
                      <span>👎 {flag.downvotes}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No flags reported</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
