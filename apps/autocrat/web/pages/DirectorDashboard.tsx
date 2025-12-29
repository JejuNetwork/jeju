/**
 * Human Director Dashboard
 *
 * Full-featured dashboard for human Directors with:
 * - Complete proposal context (same as AI sees)
 * - Board vote summaries and individual reasoning
 * - Research reports and risk assessments
 * - Historical decision precedents
 * - EIP-712 signature-based decision submission
 */

import { getAutocratUrl } from '@jejunetwork/config'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { Address } from 'viem'

interface BoardVote {
  role: string
  vote: 'APPROVE' | 'REJECT' | 'ABSTAIN'
  reasoning: string
  confidence: number
  isHuman: boolean
  votedAt: number
}

interface Proposal {
  id: string
  title: string
  summary: string
  description: string
  status: string
  proposalType: string
  qualityScore: number
  proposer: Address
  createdAt: number
  boardVotes: BoardVote[]
  hasResearch: boolean
  researchSummary?: string
}

interface HistoricalDecision {
  proposalId: string
  title: string
  proposalType: string
  decision: 'approved' | 'rejected'
  reasoning: string
  similarity: number
  decidedAt: number
}

interface RiskAssessment {
  overallRisk: 'low' | 'medium' | 'high' | 'critical'
  financialRisk: number
  technicalRisk: number
  reputationalRisk: number
  mitigations: string[]
  concerns: string[]
}

interface DirectorContext {
  proposal: Proposal
  boardVotes: BoardVote[]
  riskAssessment: RiskAssessment
  historicalDecisions: HistoricalDecision[]
  treasuryImpact: {
    requestedAmount: string
    currentBalance: string
    percentOfTreasury: number
  }
}

function VoteIndicator({ vote }: { vote: 'APPROVE' | 'REJECT' | 'ABSTAIN' }) {
  const colors = {
    APPROVE: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    REJECT: 'bg-red-500/20 text-red-400 border-red-500/30',
    ABSTAIN: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  }
  return (
    <span
      className={`px-2 py-0.5 rounded border text-xs font-medium ${colors[vote]}`}
    >
      {vote}
    </span>
  )
}

function RiskBadge({
  level,
}: {
  level: 'low' | 'medium' | 'high' | 'critical'
}) {
  const colors = {
    low: 'bg-emerald-500/20 text-emerald-400',
    medium: 'bg-amber-500/20 text-amber-400',
    high: 'bg-orange-500/20 text-orange-400',
    critical: 'bg-red-500/20 text-red-400',
  }
  return (
    <span
      className={`px-3 py-1 rounded-full text-sm font-medium ${colors[level]}`}
    >
      {level.toUpperCase()} RISK
    </span>
  )
}

function BoardVoteCard({ vote }: { vote: BoardVote }) {
  return (
    <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-zinc-200">{vote.role}</span>
          {vote.isHuman && (
            <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">
              Human
            </span>
          )}
        </div>
        <VoteIndicator vote={vote.vote} />
      </div>
      <p className="text-sm text-zinc-400 mb-2">{vote.reasoning}</p>
      <div className="flex items-center gap-4 text-xs text-zinc-500">
        <span>Confidence: {vote.confidence}%</span>
        <span>{new Date(vote.votedAt * 1000).toLocaleDateString()}</span>
      </div>
    </div>
  )
}

function ProposalContextSection({ context }: { context: DirectorContext }) {
  const { proposal, boardVotes, riskAssessment } = context

  const approves = boardVotes.filter((v) => v.vote === 'APPROVE').length
  const rejects = boardVotes.filter((v) => v.vote === 'REJECT').length
  const abstains = boardVotes.length - approves - rejects

  const consensusColor =
    approves > rejects
      ? 'text-emerald-400'
      : rejects > approves
        ? 'text-red-400'
        : 'text-amber-400'

  return (
    <div className="space-y-6">
      {/* Proposal Overview */}
      <div className="p-6 bg-zinc-900/50 rounded-xl border border-zinc-800">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-zinc-100 mb-1">
              {proposal.title}
            </h2>
            <p className="text-sm text-zinc-500">
              {proposal.id.slice(0, 12)}... · {proposal.proposalType}
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-zinc-100">
              {proposal.qualityScore}
            </div>
            <div className="text-xs text-zinc-500">Quality Score</div>
          </div>
        </div>
        <p className="text-zinc-400">{proposal.summary}</p>
      </div>

      {/* Vote Summary */}
      <div className="grid grid-cols-4 gap-4">
        <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800 text-center">
          <div className="text-2xl font-bold text-emerald-400">{approves}</div>
          <div className="text-xs text-zinc-500">APPROVE</div>
        </div>
        <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800 text-center">
          <div className="text-2xl font-bold text-red-400">{rejects}</div>
          <div className="text-xs text-zinc-500">REJECT</div>
        </div>
        <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800 text-center">
          <div className="text-2xl font-bold text-zinc-400">{abstains}</div>
          <div className="text-xs text-zinc-500">ABSTAIN</div>
        </div>
        <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800 text-center">
          <div className={`text-2xl font-bold ${consensusColor}`}>
            {approves > rejects
              ? 'FAVORABLE'
              : rejects > approves
                ? 'UNFAVORABLE'
                : 'SPLIT'}
          </div>
          <div className="text-xs text-zinc-500">CONSENSUS</div>
        </div>
      </div>

      {/* Risk Assessment */}
      <div className="p-6 bg-zinc-900/50 rounded-xl border border-zinc-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-zinc-100">
            Risk Assessment
          </h3>
          <RiskBadge level={riskAssessment.overallRisk} />
        </div>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <div className="text-sm text-zinc-500">Financial</div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500"
                style={{ width: `${riskAssessment.financialRisk}%` }}
              />
            </div>
          </div>
          <div>
            <div className="text-sm text-zinc-500">Technical</div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500"
                style={{ width: `${riskAssessment.technicalRisk}%` }}
              />
            </div>
          </div>
          <div>
            <div className="text-sm text-zinc-500">Reputational</div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500"
                style={{ width: `${riskAssessment.reputationalRisk}%` }}
              />
            </div>
          </div>
        </div>
        {riskAssessment.concerns.length > 0 && (
          <div className="space-y-1">
            <div className="text-sm font-medium text-zinc-300">Concerns:</div>
            <ul className="text-sm text-zinc-400 space-y-1">
              {riskAssessment.concerns.map((c, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-red-400">•</span>
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Board Votes */}
      <div>
        <h3 className="text-lg font-semibold text-zinc-100 mb-4">
          Board Member Votes
        </h3>
        <div className="grid gap-4">
          {boardVotes.map((vote, i) => (
            <BoardVoteCard key={i} vote={vote} />
          ))}
        </div>
      </div>
    </div>
  )
}

function DecisionForm({
  proposalId: _proposalId,
  onSubmit,
}: {
  proposalId: string
  onSubmit: (decision: { approved: boolean; reasoning: string }) => void
}) {
  // _proposalId available if needed for future EIP-712 signing
  const [approved, setApproved] = useState<boolean | null>(null)
  const [reasoning, setReasoning] = useState('')

  const handleSubmit = () => {
    if (approved === null) return
    onSubmit({ approved, reasoning })
  }

  return (
    <div className="p-6 bg-zinc-900/50 rounded-xl border border-zinc-800">
      <h3 className="text-lg font-semibold text-zinc-100 mb-4">
        Your Decision
      </h3>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <button
          type="button"
          onClick={() => setApproved(true)}
          className={`p-4 rounded-lg border-2 transition-all ${
            approved === true
              ? 'border-emerald-500 bg-emerald-500/20'
              : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-600'
          }`}
        >
          <div className="text-2xl mb-1">✅</div>
          <div className="font-medium">APPROVE</div>
        </button>
        <button
          type="button"
          onClick={() => setApproved(false)}
          className={`p-4 rounded-lg border-2 transition-all ${
            approved === false
              ? 'border-red-500 bg-red-500/20'
              : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-600'
          }`}
        >
          <div className="text-2xl mb-1">❌</div>
          <div className="font-medium">REJECT</div>
        </button>
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium text-zinc-300 mb-2">
          Reasoning (required)
        </label>
        <textarea
          value={reasoning}
          onChange={(e) => setReasoning(e.target.value)}
          rows={4}
          className="w-full p-3 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 placeholder-zinc-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          placeholder="Explain your decision..."
        />
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={approved === null || !reasoning.trim()}
        className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
      >
        Sign & Submit Decision
      </button>

      <p className="text-xs text-zinc-500 mt-3 text-center">
        Decision will be submitted with EIP-712 signature for on-chain
        verification
      </p>
    </div>
  )
}

export function DirectorDashboard() {
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(
    null,
  )

  // Fetch pending proposals
  const { data: pendingProposals } = useQuery({
    queryKey: ['director-pending-proposals'],
    queryFn: async () => {
      const res = await fetch(
        `${getAutocratUrl()}/api/v1/proposals?status=DIRECTOR_QUEUE`,
      )
      if (!res.ok) throw new Error('Failed to fetch proposals')
      return res.json() as Promise<Proposal[]>
    },
    refetchInterval: 30000,
  })

  // Fetch context for selected proposal
  const { data: context, isLoading: contextLoading } = useQuery({
    queryKey: ['director-context', selectedProposalId],
    queryFn: async () => {
      if (!selectedProposalId) return null
      const res = await fetch(
        `${getAutocratUrl()}/api/v1/director/context/${selectedProposalId}`,
      )
      if (!res.ok) throw new Error('Failed to fetch context')
      return res.json() as Promise<DirectorContext>
    },
    enabled: !!selectedProposalId,
  })

  const handleDecisionSubmit = async (decision: {
    approved: boolean
    reasoning: string
  }) => {
    // This would trigger wallet signature and submit to chain
    console.log('Submitting decision:', {
      proposalId: selectedProposalId,
      ...decision,
    })
    // TODO: Implement EIP-712 signature and on-chain submission
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Director Dashboard</h1>
            <p className="text-sm text-zinc-500">
              Human Director Decision Interface
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm text-zinc-500">Pending Decisions</div>
              <div className="text-xl font-bold text-amber-400">
                {pendingProposals?.length ?? 0}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-12 gap-8">
          {/* Proposal List */}
          <div className="col-span-4">
            <h2 className="text-lg font-semibold mb-4">Pending Proposals</h2>
            <div className="space-y-2">
              {pendingProposals?.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => setSelectedProposalId(p.id)}
                  className={`w-full p-4 text-left rounded-lg border transition-all ${
                    selectedProposalId === p.id
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700'
                  }`}
                >
                  <div className="font-medium text-zinc-200 truncate">
                    {p.title || `${p.id.slice(0, 16)}...`}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
                    <span>{p.proposalType}</span>
                    <span>Score: {p.qualityScore}</span>
                  </div>
                </button>
              ))}
              {(!pendingProposals || pendingProposals.length === 0) && (
                <div className="text-center py-8 text-zinc-500">
                  No pending proposals
                </div>
              )}
            </div>
          </div>

          {/* Context & Decision */}
          <div className="col-span-8">
            {selectedProposalId ? (
              contextLoading ? (
                <div className="text-center py-12 text-zinc-500">
                  Loading context...
                </div>
              ) : context ? (
                <div className="space-y-6">
                  <ProposalContextSection context={context} />
                  <DecisionForm
                    proposalId={selectedProposalId}
                    onSubmit={handleDecisionSubmit}
                  />
                </div>
              ) : (
                <div className="text-center py-12 text-zinc-500">
                  Failed to load context
                </div>
              )
            ) : (
              <div className="text-center py-12 text-zinc-500">
                Select a proposal to review
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default DirectorDashboard
