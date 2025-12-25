import {
  AlertCircle,
  ArrowLeft,
  Award,
  Bug,
  CheckCircle,
  Clock,
  DollarSign,
  Loader2,
  Shield,
  ThumbsDown,
  ThumbsUp,
  User,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { formatEther } from 'viem'
import { fetchBugBountySubmission, fetchResearcherStats } from '../config/api'

interface SubmissionDetail {
  submissionId: string
  title: string
  description: string
  severity: number
  vulnType: number
  status: number
  submittedAt: number
  researcher: string
  stake: string
  rewardAmount: string
  guardianApprovals: number
  guardianRejections: number
  affectedComponents: string[]
  stepsToReproduce: string[]
  proofOfConcept?: string
  suggestedFix?: string
  impact?: string
  validationResult?: number
  validationNotes?: string
}

interface ResearcherStats {
  address: string
  totalSubmissions: number
  approvedSubmissions: number
  totalRewards: string
  reputation: number
  rank: number
}

const SEVERITY_CONFIG = [
  { label: 'Low', color: 'bg-blue-500', range: '$500 - $2,500' },
  { label: 'Medium', color: 'bg-yellow-500', range: '$2,500 - $10,000' },
  { label: 'High', color: 'bg-orange-500', range: '$10,000 - $25,000' },
  { label: 'Critical', color: 'bg-red-500', range: '$25,000 - $50,000' },
] as const

const STATUS_CONFIG = [
  { label: 'Pending', color: 'bg-gray-500', icon: Clock },
  { label: 'Validating', color: 'bg-blue-500', icon: Shield },
  { label: 'Guardian Review', color: 'bg-purple-500', icon: User },
  { label: 'CEO Review', color: 'bg-indigo-500', icon: User },
  { label: 'Approved', color: 'bg-green-500', icon: CheckCircle },
  { label: 'Paid', color: 'bg-emerald-500', icon: DollarSign },
  { label: 'Rejected', color: 'bg-red-500', icon: XCircle },
  { label: 'Duplicate', color: 'bg-orange-500', icon: Bug },
  { label: 'Disputed', color: 'bg-yellow-500', icon: Shield },
  { label: 'Withdrawn', color: 'bg-gray-400', icon: XCircle },
] as const

function getSeverityConfig(severity: number) {
  if (severity < 0 || severity >= SEVERITY_CONFIG.length) {
    return SEVERITY_CONFIG[0]
  }
  return SEVERITY_CONFIG[severity]
}

function getStatusConfig(status: number) {
  if (status < 0 || status >= STATUS_CONFIG.length) {
    return STATUS_CONFIG[0]
  }
  return STATUS_CONFIG[status]
}

export default function BugBountyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [submission, setSubmission] = useState<SubmissionDetail | null>(null)
  const [researcherStats, setResearcherStats] =
    useState<ResearcherStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!id) return

    setLoading(true)
    setError(null)

    const response = await fetchBugBountySubmission(id).catch((e: Error) => {
      setError(e.message)
      return null
    })

    if (response) {
      // API returns { submission: {...}, guardianVotes: [...] } - extract submission
      const responseObj = response as Record<string, unknown>
      const rawSubmission = responseObj.submission ?? response
      const submissionData = rawSubmission as SubmissionDetail
      setSubmission(submissionData)
      // Load researcher stats
      const stats = await fetchResearcherStats(submissionData.researcher).catch(
        () => null,
      )
      setResearcherStats(stats as ResearcherStats | null)
    }

    setLoading(false)
  }, [id])

  useEffect(() => {
    loadData()
  }, [loadData])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <Loader2 className="animate-spin text-white" size={48} />
      </div>
    )
  }

  if (error || !submission) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center text-white">
        <XCircle size={48} className="text-red-500 mb-4" />
        <h1 className="text-xl font-semibold mb-2">Submission Not Found</h1>
        <p className="text-gray-400 mb-6">
          {error ?? 'Unable to load submission'}
        </p>
        <Link to="/bug-bounty" className="text-red-400 hover:underline">
          ← Back to Bug Bounty
        </Link>
      </div>
    )
  }

  const severityConfig = getSeverityConfig(submission.severity)
  const statusConfig = getStatusConfig(submission.status)
  const StatusIcon = statusConfig.icon

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link
            to="/bug-bounty"
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-white"
          >
            <ArrowLeft size={20} />
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white">
              {submission.title}
            </h1>
            <p className="text-sm text-gray-400">
              Submitted{' '}
              {new Date(submission.submittedAt * 1000).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Status Banner */}
            <div
              className={`p-4 rounded-xl ${statusConfig.color} bg-opacity-20 border border-opacity-50`}
              style={{ borderColor: 'currentColor' }}
            >
              <div className="flex items-center gap-3">
                <StatusIcon size={24} className="text-white" />
                <div>
                  <p className="font-semibold text-white">
                    {statusConfig.label}
                  </p>
                  <p className="text-sm text-gray-300">
                    {submission.guardianApprovals} approvals,{' '}
                    {submission.guardianRejections} rejections
                  </p>
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="p-6 rounded-xl bg-gray-800/50 border border-gray-700">
              <h2 className="font-semibold text-white mb-4">Description</h2>
              <p className="text-gray-300 whitespace-pre-wrap">
                {submission.description}
              </p>
            </div>

            {/* Affected Components */}
            {submission.affectedComponents.length > 0 && (
              <div className="p-6 rounded-xl bg-gray-800/50 border border-gray-700">
                <h2 className="font-semibold text-white mb-4">
                  Affected Components
                </h2>
                <div className="flex flex-wrap gap-2">
                  {submission.affectedComponents.map((comp) => (
                    <span
                      key={comp}
                      className="px-3 py-1 bg-gray-700 rounded-full text-sm text-gray-300"
                    >
                      {comp}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Steps to Reproduce */}
            {submission.stepsToReproduce.length > 0 && (
              <div className="p-6 rounded-xl bg-gray-800/50 border border-gray-700">
                <h2 className="font-semibold text-white mb-4">
                  Steps to Reproduce
                </h2>
                <ol className="list-decimal list-inside space-y-2 text-gray-300">
                  {submission.stepsToReproduce.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            )}

            {/* Proof of Concept */}
            {submission.proofOfConcept && (
              <div className="p-6 rounded-xl bg-gray-800/50 border border-gray-700">
                <h2 className="font-semibold text-white mb-4">
                  Proof of Concept
                </h2>
                <pre className="p-4 bg-gray-900 rounded-lg overflow-x-auto text-sm text-gray-300">
                  {submission.proofOfConcept}
                </pre>
              </div>
            )}

            {/* Suggested Fix */}
            {submission.suggestedFix && (
              <div className="p-6 rounded-xl bg-gray-800/50 border border-gray-700">
                <h2 className="font-semibold text-white mb-4">Suggested Fix</h2>
                <p className="text-gray-300 whitespace-pre-wrap">
                  {submission.suggestedFix}
                </p>
              </div>
            )}

            {/* Impact */}
            {submission.impact && (
              <div className="p-6 rounded-xl bg-gray-800/50 border border-gray-700">
                <h2 className="font-semibold text-white mb-4">Impact</h2>
                <p className="text-gray-300 whitespace-pre-wrap">
                  {submission.impact}
                </p>
              </div>
            )}

            {/* Validation Results */}
            {submission.validationResult !== undefined && (
              <div className="p-6 rounded-xl bg-gray-800/50 border border-gray-700">
                <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
                  <Shield size={18} />
                  Validation Results
                </h2>
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    {submission.validationResult === 1 ||
                    submission.validationResult === 2 ? (
                      <span className="flex items-center gap-2 text-green-400">
                        <CheckCircle size={18} />
                        {submission.validationResult === 1
                          ? 'Verified'
                          : 'Likely Valid'}
                      </span>
                    ) : submission.validationResult === 4 ? (
                      <span className="flex items-center gap-2 text-red-400">
                        <XCircle size={18} />
                        Invalid
                      </span>
                    ) : submission.validationResult === 3 ? (
                      <span className="flex items-center gap-2 text-yellow-400">
                        <AlertCircle size={18} />
                        Needs More Info
                      </span>
                    ) : (
                      <span className="flex items-center gap-2 text-gray-400">
                        <Clock size={18} />
                        Pending
                      </span>
                    )}
                  </div>
                  {submission.validationNotes && (
                    <p className="text-sm text-gray-300">
                      {submission.validationNotes}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Severity & Reward */}
            <div className="p-4 rounded-xl bg-gray-800/50 border border-gray-700">
              <div className="flex items-center gap-2 mb-4">
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium text-white ${severityConfig.color}`}
                >
                  {severityConfig.label}
                </span>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-400">Reward Range</span>
                  <span className="text-white font-medium">
                    {severityConfig.range}
                  </span>
                </div>
                {BigInt(submission.rewardAmount) > 0n && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Awarded</span>
                    <span className="text-green-400 font-semibold">
                      {formatEther(BigInt(submission.rewardAmount))} ETH
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-400">Staked</span>
                  <span className="text-white">
                    {formatEther(BigInt(submission.stake))} ETH
                  </span>
                </div>
              </div>
            </div>

            {/* Guardian Votes */}
            <div className="p-4 rounded-xl bg-gray-800/50 border border-gray-700">
              <h3 className="font-semibold text-white mb-4">Guardian Votes</h3>
              <div className="flex gap-4">
                <div className="flex-1 p-3 bg-green-900/30 rounded-lg text-center">
                  <ThumbsUp className="mx-auto mb-1 text-green-400" size={20} />
                  <p className="text-2xl font-bold text-green-400">
                    {submission.guardianApprovals}
                  </p>
                  <p className="text-xs text-gray-400">Approvals</p>
                </div>
                <div className="flex-1 p-3 bg-red-900/30 rounded-lg text-center">
                  <ThumbsDown className="mx-auto mb-1 text-red-400" size={20} />
                  <p className="text-2xl font-bold text-red-400">
                    {submission.guardianRejections}
                  </p>
                  <p className="text-xs text-gray-400">Rejections</p>
                </div>
              </div>
            </div>

            {/* Researcher Info */}
            <div className="p-4 rounded-xl bg-gray-800/50 border border-gray-700">
              <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
                <User size={16} />
                Researcher
              </h3>
              <p className="font-mono text-sm text-gray-300 mb-3">
                {submission.researcher.slice(0, 10)}...
                {submission.researcher.slice(-8)}
              </p>
              {researcherStats && (
                <div className="space-y-2 pt-3 border-t border-gray-700">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Rank</span>
                    <span className="text-white flex items-center gap-1">
                      <Award size={14} className="text-yellow-400" />#{' '}
                      {researcherStats.rank}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Submissions</span>
                    <span className="text-white">
                      {researcherStats.totalSubmissions}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Approved</span>
                    <span className="text-green-400">
                      {researcherStats.approvedSubmissions}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Total Rewards</span>
                    <span className="text-white">
                      {formatEther(BigInt(researcherStats.totalRewards))} ETH
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Reputation</span>
                    <span className="text-white">
                      {researcherStats.reputation}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
