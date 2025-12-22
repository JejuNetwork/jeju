'use client'

import { useEffect, useState } from 'react'
import { formatEther, parseEther } from 'viem'
import { useAccount } from 'wagmi'
import {
  PaymentStatusBadge,
  RetroactiveBadge,
} from '../../components/shared/StatusBadge'
import { useContributorByWallet } from '../../hooks/useContributor'
import {
  useCEODecision,
  useCouncilVote,
  useCouncilVotes,
  usePaymentRequest,
  usePendingRequests,
  useSubmitPaymentRequest,
} from '../../hooks/usePaymentRequest'
import type {
  PaymentCategory,
  PaymentRequest,
  PaymentRequestStatus,
  VoteType,
} from '../../types/funding'
import {
  PAYMENT_CATEGORIES,
  PAYMENT_CATEGORY_DISPLAY,
  PAYMENT_STATUS_DISPLAY,
} from '../../types/funding'

// Hardcoded DAO ID for demo
const DEFAULT_DAO_ID = `0x${'0'.repeat(63)}1`

// ============ Components ============

function CategoryBadge({ category }: { category: PaymentCategory }) {
  const style = PAYMENT_CATEGORY_DISPLAY[category]
  return (
    <span
      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium ${style.color} bg-slate-800 rounded-full`}
    >
      <span>{style.icon}</span>
      {style.label}
    </span>
  )
}

function RequestCard({
  request,
  onSelect,
}: {
  request: PaymentRequest
  onSelect: () => void
}) {
  return (
    <div
      onClick={onSelect}
      className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 cursor-pointer hover:border-indigo-500/50 transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/5"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <CategoryBadge category={request.category} />
            {request.isRetroactive && <RetroactiveBadge />}
          </div>
          <h3 className="text-white font-semibold text-lg">{request.title}</h3>
        </div>
        <PaymentStatusBadge status={request.status} />
      </div>

      <p className="text-slate-400 text-sm line-clamp-2 mb-4">
        {request.description}
      </p>

      <div className="flex items-center justify-between pt-4 border-t border-slate-700/50">
        <div>
          <p className="text-slate-500 text-xs">Requested</p>
          <p className="text-white font-semibold">
            {formatEther(request.requestedAmount)} ETH
          </p>
        </div>
        <div className="text-right">
          <p className="text-slate-500 text-xs">Submitted</p>
          <p className="text-slate-400 text-sm">
            {new Date(request.submittedAt * 1000).toLocaleDateString()}
          </p>
        </div>
      </div>
    </div>
  )
}

function SubmitRequestForm({
  contributorId,
  onClose,
  onSuccess,
}: {
  contributorId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [category, setCategory] = useState<PaymentCategory>('MARKETING')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [evidenceUri, setEvidenceUri] = useState('')
  const [amount, setAmount] = useState('')
  const [isRetroactive, setIsRetroactive] = useState(false)
  const [workStartDate, setWorkStartDate] = useState('')
  const [workEndDate, setWorkEndDate] = useState('')

  const { submit, isPending, isConfirming, isSuccess, error } =
    useSubmitPaymentRequest()

  useEffect(() => {
    if (isSuccess) {
      onSuccess()
      onClose()
    }
  }, [isSuccess, onSuccess, onClose])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    submit({
      daoId: DEFAULT_DAO_ID,
      contributorId,
      category,
      title,
      description,
      evidenceUri,
      requestedAmount: parseEther(amount || '0'),
      isRetroactive,
      workStartDate: workStartDate
        ? Math.floor(new Date(workStartDate).getTime() / 1000)
        : 0,
      workEndDate: workEndDate
        ? Math.floor(new Date(workEndDate).getTime() / 1000)
        : 0,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-2xl w-full mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h3 className="text-xl font-semibold text-white mb-6">
          Submit Payment Request
        </h3>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Category
            </label>
            <div className="grid grid-cols-4 gap-2">
              {PAYMENT_CATEGORIES.slice(0, 8).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    category === cat
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {PAYMENT_CATEGORY_DISPLAY[cat].icon}{' '}
                  {PAYMENT_CATEGORY_DISPLAY[cat].label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief description of the work"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed explanation of the work completed or proposed..."
              rows={4}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none resize-none"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Amount (ETH)
              </label>
              <input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Evidence URI
              </label>
              <input
                type="text"
                value={evidenceUri}
                onChange={(e) => setEvidenceUri(e.target.value)}
                placeholder="ipfs://..."
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="retroactive"
              checked={isRetroactive}
              onChange={(e) => setIsRetroactive(e.target.checked)}
              className="w-4 h-4 bg-slate-800 border-slate-600 rounded"
            />
            <label htmlFor="retroactive" className="text-sm text-slate-300">
              This is for work already completed (retroactive funding)
            </label>
          </div>

          {isRetroactive && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Work Start Date
                </label>
                <input
                  type="date"
                  value={workStartDate}
                  onChange={(e) => setWorkStartDate(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Work End Date
                </label>
                <input
                  type="date"
                  value={workEndDate}
                  onChange={(e) => setWorkEndDate(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {error && <p className="text-rose-400 text-sm">{error.message}</p>}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending || isConfirming}
              className="flex-1 px-4 py-2.5 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || isConfirming || !title || !amount}
              className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors disabled:opacity-50"
            >
              {isPending
                ? 'Signing...'
                : isConfirming
                  ? 'Confirming...'
                  : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function RequestDetails({
  requestId,
  onClose,
}: {
  requestId: string
  onClose: () => void
}) {
  const { request } = usePaymentRequest(requestId)
  const { votes } = useCouncilVotes(requestId)
  const { decision } = useCEODecision(requestId)
  const {
    vote,
    isPending: voting,
    isConfirming: confirmingVote,
  } = useCouncilVote()
  const [voteReason, setVoteReason] = useState('')

  if (!request) {
    return null
  }

  const handleVote = (voteType: VoteType) => {
    vote(requestId, voteType, voteReason)
    setVoteReason('')
  }

  const approveCount = votes.filter((v) => v.vote === 'APPROVE').length
  const rejectCount = votes.filter((v) => v.vote === 'REJECT').length
  const abstainCount = votes.filter((v) => v.vote === 'ABSTAIN').length

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full mx-4 shadow-2xl max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-slate-700">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <CategoryBadge category={request.category} />
                {request.isRetroactive && <RetroactiveBadge />}
                <PaymentStatusBadge status={request.status} />
              </div>
              <h2 className="text-2xl font-bold text-white">{request.title}</h2>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white text-2xl"
            >
              ×
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">
          <div className="space-y-6">
            {/* Description */}
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-2">
                Description
              </h3>
              <p className="text-white">{request.description}</p>
            </div>

            {/* Amounts */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-slate-800/50 rounded-lg p-4">
                <p className="text-slate-400 text-sm">Requested</p>
                <p className="text-white text-xl font-bold">
                  {formatEther(request.requestedAmount)} ETH
                </p>
              </div>
              {request.approvedAmount > 0n && (
                <div className="bg-emerald-500/10 rounded-lg p-4">
                  <p className="text-emerald-400 text-sm">Approved</p>
                  <p className="text-emerald-300 text-xl font-bold">
                    {formatEther(request.approvedAmount)} ETH
                  </p>
                </div>
              )}
              <div className="bg-slate-800/50 rounded-lg p-4">
                <p className="text-slate-400 text-sm">Submitted</p>
                <p className="text-white">
                  {new Date(request.submittedAt * 1000).toLocaleDateString()}
                </p>
              </div>
            </div>

            {/* Council Votes */}
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-3">
                Council Votes
              </h3>
              <div className="flex gap-4 mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-emerald-500" />
                  <span className="text-slate-300">
                    Approve: {approveCount}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-rose-500" />
                  <span className="text-slate-300">Reject: {rejectCount}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-slate-500" />
                  <span className="text-slate-300">
                    Abstain: {abstainCount}
                  </span>
                </div>
              </div>

              {votes.length > 0 && (
                <div className="space-y-2">
                  {votes.map((v, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between bg-slate-800/50 rounded-lg p-3"
                    >
                      <span className="text-slate-400 font-mono text-sm">
                        {v.voter.slice(0, 6)}...{v.voter.slice(-4)}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          v.vote === 'APPROVE'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : v.vote === 'REJECT'
                              ? 'bg-rose-500/20 text-rose-400'
                              : 'bg-slate-500/20 text-slate-400'
                        }`}
                      >
                        {v.vote}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* CEO Decision */}
            {decision && (
              <div>
                <h3 className="text-sm font-medium text-slate-400 mb-3">
                  CEO Decision
                </h3>
                <div
                  className={`rounded-lg p-4 ${decision.approved ? 'bg-emerald-500/10' : 'bg-rose-500/10'}`}
                >
                  <p
                    className={`font-medium ${decision.approved ? 'text-emerald-400' : 'text-rose-400'}`}
                  >
                    {decision.approved ? 'Approved' : 'Rejected'}
                  </p>
                  {decision.reason && (
                    <p className="text-slate-300 mt-1">{decision.reason}</p>
                  )}
                  {decision.modifiedAmount > 0n && (
                    <p className="text-slate-400 mt-2">
                      Modified Amount: {formatEther(decision.modifiedAmount)}{' '}
                      ETH
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Vote Form (for pending requests) */}
            {(request.status === 'SUBMITTED' ||
              request.status === 'COUNCIL_REVIEW') && (
              <div className="border-t border-slate-700 pt-6">
                <h3 className="text-sm font-medium text-slate-400 mb-3">
                  Cast Your Vote
                </h3>
                <div className="space-y-3">
                  <input
                    type="text"
                    value={voteReason}
                    onChange={(e) => setVoteReason(e.target.value)}
                    placeholder="Reason for your vote (optional)"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleVote('APPROVE')}
                      disabled={voting || confirmingVote}
                      className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50"
                    >
                      {voting || confirmingVote ? '...' : 'Approve'}
                    </button>
                    <button
                      onClick={() => handleVote('REJECT')}
                      disabled={voting || confirmingVote}
                      className="flex-1 px-4 py-2.5 bg-rose-600 text-white rounded-lg hover:bg-rose-500 transition-colors disabled:opacity-50"
                    >
                      {voting || confirmingVote ? '...' : 'Reject'}
                    </button>
                    <button
                      onClick={() => handleVote('ABSTAIN')}
                      disabled={voting || confirmingVote}
                      className="flex-1 px-4 py-2.5 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors disabled:opacity-50"
                    >
                      {voting || confirmingVote ? '...' : 'Abstain'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============ Main Page ============

export default function PaymentRequestsPage() {
  const { address, isConnected } = useAccount()
  const [showSubmit, setShowSubmit] = useState(false)
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
    null,
  )
  const [statusFilter, setStatusFilter] = useState<
    PaymentRequestStatus | 'ALL'
  >('ALL')

  const { profile: myProfile } = useContributorByWallet(address)
  const { requests, refetch } = usePendingRequests(DEFAULT_DAO_ID)

  const filteredRequests =
    statusFilter === 'ALL'
      ? requests
      : requests.filter((r) => r.status === statusFilter)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950">
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">
              Payment Requests
            </h1>
            <p className="text-slate-400">
              Submit and track payment requests for non-bounty contributions
            </p>
          </div>
          {isConnected && myProfile && (
            <button
              onClick={() => setShowSubmit(true)}
              className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-500 transition-colors flex items-center gap-2"
            >
              <span>+</span> Submit Request
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-5">
            <p className="text-slate-400 text-sm">Total Requests</p>
            <p className="text-2xl font-bold text-white mt-1">
              {requests.length}
            </p>
          </div>
          <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-5">
            <p className="text-slate-400 text-sm">Pending Review</p>
            <p className="text-2xl font-bold text-amber-400 mt-1">
              {
                requests.filter(
                  (r) =>
                    r.status === 'COUNCIL_REVIEW' || r.status === 'CEO_REVIEW',
                ).length
              }
            </p>
          </div>
          <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-5">
            <p className="text-slate-400 text-sm">Approved</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">
              {
                requests.filter(
                  (r) => r.status === 'APPROVED' || r.status === 'PAID',
                ).length
              }
            </p>
          </div>
          <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-5">
            <p className="text-slate-400 text-sm">Total Value</p>
            <p className="text-2xl font-bold text-white mt-1">
              {formatEther(
                requests.reduce((sum, r) => sum + r.requestedAmount, 0n),
              )}{' '}
              ETH
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-6">
          {(
            [
              'ALL',
              'SUBMITTED',
              'COUNCIL_REVIEW',
              'CEO_REVIEW',
              'APPROVED',
              'REJECTED',
              'PAID',
            ] as const
          ).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                statusFilter === status
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {status === 'ALL'
                ? 'All'
                : PAYMENT_STATUS_DISPLAY[status]?.label || status}
            </button>
          ))}
        </div>

        {/* Requests Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRequests.map((request) => (
            <RequestCard
              key={request.requestId}
              request={request}
              onSelect={() => setSelectedRequestId(request.requestId)}
            />
          ))}
        </div>

        {filteredRequests.length === 0 && (
          <div className="text-center py-12 bg-slate-800/30 rounded-xl border border-slate-700">
            <p className="text-slate-400 text-lg">No payment requests found</p>
            {isConnected && myProfile && (
              <button
                onClick={() => setShowSubmit(true)}
                className="mt-4 px-6 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-500 transition-colors"
              >
                Submit Your First Request
              </button>
            )}
          </div>
        )}

        {/* Not registered notice */}
        {isConnected && !myProfile && (
          <div className="mt-8 p-6 bg-amber-500/10 border border-amber-500/30 rounded-xl">
            <p className="text-amber-400 font-medium">
              You need to register as a contributor to submit payment requests
            </p>
            <p className="text-slate-400 text-sm mt-1">
              Go to the Contributors page to register first.
            </p>
          </div>
        )}
      </div>

      {/* Modals */}
      {showSubmit && myProfile && (
        <SubmitRequestForm
          contributorId={myProfile.contributorId}
          onClose={() => setShowSubmit(false)}
          onSuccess={() => refetch()}
        />
      )}
      {selectedRequestId && (
        <RequestDetails
          requestId={selectedRequestId}
          onClose={() => setSelectedRequestId(null)}
        />
      )}
    </div>
  )
}
