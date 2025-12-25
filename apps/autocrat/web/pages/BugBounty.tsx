import {
  AlertTriangle,
  ArrowRight,
  Award,
  Bug,
  CheckCircle,
  Code,
  DollarSign,
  Eye,
  Lock,
  Server,
  Shield,
  TrendingUp,
  Users,
  Wallet,
  XCircle,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { formatEther, parseEther } from 'viem'
import {
  type BountyStats,
  type BountySubmission,
  fetchBugBountyStats,
  fetchBugBountySubmissions,
} from '../config/api'

// Severity config
const SEVERITY_CONFIG = [
  {
    label: 'Low',
    color: 'bg-blue-500',
    textColor: 'text-blue-500',
    range: '$500 - $2,500',
  },
  {
    label: 'Medium',
    color: 'bg-yellow-500',
    textColor: 'text-yellow-500',
    range: '$2,500 - $10,000',
  },
  {
    label: 'High',
    color: 'bg-orange-500',
    textColor: 'text-orange-500',
    range: '$10,000 - $25,000',
  },
  {
    label: 'Critical',
    color: 'bg-red-500',
    textColor: 'text-red-500',
    range: '$25,000 - $50,000',
  },
] as const

const STATUS_CONFIG = [
  { label: 'Pending', color: 'bg-gray-500' },
  { label: 'Validating', color: 'bg-blue-500' },
  { label: 'Guardian Review', color: 'bg-purple-500' },
  { label: 'CEO Review', color: 'bg-indigo-500' },
  { label: 'Approved', color: 'bg-green-500' },
  { label: 'Paid', color: 'bg-emerald-500' },
  { label: 'Rejected', color: 'bg-red-500' },
  { label: 'Duplicate', color: 'bg-orange-500' },
  { label: 'Disputed', color: 'bg-yellow-500' },
  { label: 'Withdrawn', color: 'bg-gray-400' },
] as const

function getSeverityConfig(severity: number) {
  if (severity < 0 || severity >= SEVERITY_CONFIG.length) {
    throw new Error(`Invalid severity index: ${severity}`)
  }
  return SEVERITY_CONFIG[severity]
}

function getStatusConfig(status: number) {
  if (status < 0 || status >= STATUS_CONFIG.length) {
    throw new Error(`Invalid status index: ${status}`)
  }
  return STATUS_CONFIG[status]
}

const VULN_TYPES = [
  {
    icon: Wallet,
    label: 'Funds at Risk',
    description: 'Direct loss of user funds',
  },
  {
    icon: Lock,
    label: 'Wallet Drain',
    description: 'Unauthorized wallet access',
  },
  {
    icon: Code,
    label: 'Remote Code Execution',
    description: 'RCE on infrastructure',
  },
  { icon: Shield, label: 'TEE Bypass', description: 'Enclave manipulation' },
  {
    icon: Server,
    label: 'Consensus Attack',
    description: '51% or consensus issues',
  },
  {
    icon: Lock,
    label: 'MPC Key Exposure',
    description: 'Key material leakage',
  },
]

export default function BugBountyPage() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<BountyStats | null>(null)
  const [submissions, setSubmissions] = useState<BountySubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<
    'overview' | 'submissions' | 'leaderboard'
  >('overview')

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      const [statsData, submissionsData] = await Promise.all([
        fetchBugBountyStats().catch(() => null),
        fetchBugBountySubmissions(10).catch(() => ({
          submissions: [],
          total: 0,
        })),
      ])

      if (statsData) {
        setStats(statsData)
      }
      setSubmissions(submissionsData.submissions ?? [])
      setLoading(false)
    }

    fetchData()
  }, [])

  const formatPoolValue = (value: string) => {
    const parsed = parseEther(value)
    return `${formatEther(parsed)} ETH`
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-red-500/10 via-orange-500/10 to-yellow-500/10" />
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-20" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
          <div className="text-center">
            <div className="flex justify-center mb-6">
              <div className="p-4 bg-red-500/20 rounded-2xl">
                <Bug className="w-12 h-12 text-red-400" />
              </div>
            </div>

            <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
              Security Bug Bounty
            </h1>

            <p className="text-xl text-gray-300 max-w-2xl mx-auto mb-8">
              Help secure Jeju Network. Report vulnerabilities and earn rewards
              up to $50,000.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/create?type=bug-bounty"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl transition-all transform hover:scale-105"
              >
                <AlertTriangle className="w-5 h-5" />
                Report Vulnerability
                <ArrowRight className="w-5 h-5" />
              </Link>

              <a
                href="#scope"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-xl transition-all"
              >
                <Eye className="w-5 h-5" />
                View Scope
              </a>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-16">
            <StatCard
              icon={DollarSign}
              label="Bounty Pool"
              value={stats ? formatPoolValue(stats.totalPool) : '---'}
              loading={loading}
            />
            <StatCard
              icon={Award}
              label="Total Paid"
              value={stats ? formatPoolValue(stats.totalPaidOut) : '---'}
              loading={loading}
            />
            <StatCard
              icon={Bug}
              label="Active Reports"
              value={stats ? String(stats.activeSubmissions) : '---'}
              loading={loading}
            />
            <StatCard
              icon={Users}
              label="Guardians"
              value={stats ? String(stats.guardianCount) : '---'}
              loading={loading}
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex gap-4 border-b border-gray-700 mb-8">
          {(['overview', 'submissions', 'leaderboard'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 font-medium capitalize transition-colors ${
                activeTab === tab
                  ? 'text-red-400 border-b-2 border-red-400'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div className="space-y-12 pb-16">
            {/* Reward Tiers */}
            <section id="rewards">
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                <DollarSign className="w-6 h-6 text-green-400" />
                Reward Tiers
              </h2>

              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {SEVERITY_CONFIG.map((severity, i) => (
                  <div
                    key={severity.label}
                    className="p-6 rounded-xl bg-gray-800/50 border border-gray-700 hover:border-gray-600 transition-colors"
                  >
                    <div
                      className={`inline-block px-3 py-1 rounded-full text-sm font-medium text-white mb-4 ${severity.color}`}
                    >
                      {severity.label}
                    </div>
                    <div className="text-2xl font-bold text-white mb-2">
                      {severity.range}
                    </div>
                    <p className="text-sm text-gray-400">
                      {i === 3 && 'Immediate fund loss, RCE, wallet drain'}
                      {i === 2 && '51% attack, MPC exposure, escalation'}
                      {i === 1 && 'DoS, info disclosure, manipulation'}
                      {i === 0 && 'Minor bugs, theoretical issues'}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {/* In Scope */}
            <section id="scope">
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                <Shield className="w-6 h-6 text-blue-400" />
                In Scope
              </h2>

              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {VULN_TYPES.map((type) => (
                  <div
                    key={type.label}
                    className="p-6 rounded-xl bg-gray-800/50 border border-gray-700 flex items-start gap-4"
                  >
                    <div className="p-3 bg-gray-700 rounded-lg">
                      <type.icon className="w-6 h-6 text-gray-300" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white mb-1">
                        {type.label}
                      </h3>
                      <p className="text-sm text-gray-400">
                        {type.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 p-4 bg-gray-800/50 rounded-xl border border-gray-700">
                <h3 className="font-semibold text-white mb-2">
                  Also In Scope:
                </h3>
                <ul className="grid sm:grid-cols-2 gap-2 text-sm text-gray-300">
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-400" /> Smart
                    contracts (Solidity)
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-400" /> Backend
                    services (TypeScript)
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-400" /> DWS
                    compute infrastructure
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-400" /> MPC key
                    management
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-400" />{' '}
                    TEE/enclave security
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-400" /> Bridge
                    protocols
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-400" /> Oracle
                    integrations
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-400" />{' '}
                    Governance mechanisms
                  </li>
                </ul>
              </div>

              <div className="mt-4 p-4 bg-red-900/20 rounded-xl border border-red-800/50">
                <h3 className="font-semibold text-red-400 mb-2">
                  Out of Scope:
                </h3>
                <ul className="grid sm:grid-cols-2 gap-2 text-sm text-gray-300">
                  <li className="flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-red-400" /> Third-party
                    dependencies
                  </li>
                  <li className="flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-red-400" /> Social
                    engineering
                  </li>
                  <li className="flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-red-400" /> Physical
                    security
                  </li>
                  <li className="flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-red-400" /> DoS via gas
                    limits
                  </li>
                </ul>
              </div>
            </section>

            {/* Process */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                <Zap className="w-6 h-6 text-yellow-400" />
                Submission Process
              </h2>

              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  {
                    step: 1,
                    title: 'Submit',
                    desc: 'File encrypted vulnerability report with PoC',
                  },
                  {
                    step: 2,
                    title: 'Validation',
                    desc: 'AI agent runs PoC in secure sandbox',
                  },
                  {
                    step: 3,
                    title: 'Review',
                    desc: 'Guardians vote on validity and reward',
                  },
                  {
                    step: 4,
                    title: 'Payout',
                    desc: 'CEO approves, reward paid on-chain',
                  },
                ].map((item) => (
                  <div
                    key={item.step}
                    className="relative p-6 rounded-xl bg-gray-800/50 border border-gray-700"
                  >
                    <div className="absolute -top-3 left-4 px-3 py-1 bg-red-500 text-white text-sm font-bold rounded-full">
                      {item.step}
                    </div>
                    <h3 className="font-semibold text-white mt-2 mb-2">
                      {item.title}
                    </h3>
                    <p className="text-sm text-gray-400">{item.desc}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Rules */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                <AlertTriangle className="w-6 h-6 text-orange-400" />
                Rules & Guidelines
              </h2>

              <div className="p-6 rounded-xl bg-gray-800/50 border border-gray-700 space-y-4">
                <div className="grid sm:grid-cols-2 gap-6">
                  <div>
                    <h3 className="font-semibold text-green-400 mb-3">DO:</h3>
                    <ul className="space-y-2 text-sm text-gray-300">
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />{' '}
                        Provide detailed reproduction steps
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />{' '}
                        Include working proof of concept
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />{' '}
                        Suggest a fix when possible
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />{' '}
                        Wait for fix before disclosure
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />{' '}
                        Stake to prioritize your submission
                      </li>
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-semibold text-red-400 mb-3">DO NOT:</h3>
                    <ul className="space-y-2 text-sm text-gray-300">
                      <li className="flex items-start gap-2">
                        <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />{' '}
                        Access user data or funds
                      </li>
                      <li className="flex items-start gap-2">
                        <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />{' '}
                        Execute exploits on mainnet
                      </li>
                      <li className="flex items-start gap-2">
                        <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />{' '}
                        Disclose before fix is deployed
                      </li>
                      <li className="flex items-start gap-2">
                        <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />{' '}
                        Submit duplicates knowingly
                      </li>
                      <li className="flex items-start gap-2">
                        <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />{' '}
                        Use automated scanners only
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'submissions' && (
          <div className="pb-16">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-white">
                Recent Submissions
              </h2>
              <Link
                to="/create?type=bug-bounty"
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg transition-colors"
              >
                New Report
              </Link>
            </div>

            {loading ? (
              <div className="text-center py-12 text-gray-400">Loading...</div>
            ) : submissions.length === 0 ? (
              <div className="text-center py-12">
                <Bug className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400">
                  No submissions yet. Be the first to report a vulnerability.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {submissions.map((sub) => (
                  <button
                    type="button"
                    key={sub.submissionId}
                    className="p-4 rounded-xl bg-gray-800/50 border border-gray-700 hover:border-gray-600 transition-colors cursor-pointer w-full text-left"
                    onClick={() => navigate(`/bug-bounty/${sub.submissionId}`)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div
                          className={`px-2 py-1 rounded text-xs font-medium text-white ${getSeverityConfig(sub.severity).color}`}
                        >
                          {getSeverityConfig(sub.severity).label}
                        </div>
                        <h3 className="font-medium text-white">{sub.title}</h3>
                      </div>
                      <div className="flex items-center gap-4">
                        <div
                          className={`px-2 py-1 rounded text-xs ${getStatusConfig(sub.status).color} text-white`}
                        >
                          {getStatusConfig(sub.status).label}
                        </div>
                        {BigInt(sub.rewardAmount) > 0n && (
                          <span className="text-green-400 font-medium">
                            {formatEther(BigInt(sub.rewardAmount))} ETH
                          </span>
                        )}
                        <span className="text-sm text-gray-400">
                          {new Date(
                            sub.submittedAt * 1000,
                          ).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'leaderboard' && (
          <div className="pb-16">
            <h2 className="text-2xl font-bold text-white mb-6">
              Top Researchers
            </h2>
            <div className="p-12 text-center">
              <TrendingUp className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400">Leaderboard coming soon...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  loading: boolean
}) {
  return (
    <div className="p-4 sm:p-6 rounded-xl bg-gray-800/50 border border-gray-700">
      <div className="flex items-center gap-3 mb-2">
        <Icon className="w-5 h-5 text-gray-400" />
        <span className="text-sm text-gray-400">{label}</span>
      </div>
      <div
        className={`text-xl sm:text-2xl font-bold text-white ${loading ? 'animate-pulse' : ''}`}
      >
        {value}
      </div>
    </div>
  )
}
