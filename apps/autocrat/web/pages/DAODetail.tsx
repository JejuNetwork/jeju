/**
 * DAO Detail Page
 *
 * Main view for a single DAO with tabs for Agents, Governance, Treasury, and Settings.
 */

import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Coins,
  Crown,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  Settings,
  Shield,
  Users,
} from 'lucide-react'
import { useCallback } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useDAO } from '../hooks/useDAO'
import type { DAODetail as DAODetailType } from '../types/dao'

// Tab components
import { AgentsTab } from '../components/dao/AgentsTab'
import { GovernanceTab } from '../components/dao/GovernanceTab'
import { SettingsTab } from '../components/dao/SettingsTab'
import { TreasuryTab } from '../components/dao/TreasuryTab'

type TabId = 'agents' | 'governance' | 'treasury' | 'settings'

interface TabConfig {
  id: TabId
  label: string
  icon: typeof Bot
}

const TABS: TabConfig[] = [
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'governance', label: 'Governance', icon: FileText },
  { id: 'treasury', label: 'Treasury', icon: Coins },
  { id: 'settings', label: 'Settings', icon: Settings },
]

function StatCard({
  label,
  value,
  subtext,
}: { label: string; value: string | number; subtext?: string }) {
  return (
    <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4">
      <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className="text-xl font-semibold text-slate-100">{value}</p>
      {subtext && <p className="text-xs text-slate-500 mt-0.5">{subtext}</p>}
    </div>
  )
}

export default function DAODetailPage() {
  const { daoId } = useParams<{ daoId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()

  // Use the real API hook
  const {
    data: dao,
    isLoading: loading,
    error,
    refetch,
  } = useDAO(daoId)

  const activeTab = (searchParams.get('tab') as TabId) || 'agents'

  const setActiveTab = useCallback(
    (tab: TabId) => {
      setSearchParams({ tab })
    },
    [setSearchParams],
  )

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
            Failed to load DAO
          </h2>
          <p className="text-slate-500 mb-4">
            {error instanceof Error ? error.message : 'An unknown error occurred'}
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
              to="/"
              className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to DAOs
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!dao) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-slate-200 mb-2">
            DAO Not Found
          </h2>
          <p className="text-slate-500 mb-4">
            The DAO you&apos;re looking for doesn&apos;t exist.
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to DAOs
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Hero Section */}
      <div className="border-b border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950">
        <div className="container mx-auto px-4 py-8">
          {/* Back Button */}
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-6 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            All DAOs
          </Link>

          <div className="flex flex-col md:flex-row md:items-start gap-6">
            {/* DAO Avatar */}
            <div className="relative shrink-0">
              <div className="w-20 h-20 md:w-24 md:h-24 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center text-4xl font-bold text-white shadow-xl shadow-violet-500/20">
                {dao.displayName.charAt(0).toUpperCase()}
              </div>
              {dao.networkPermissions.isNetworkDAO && (
                <div className="absolute -top-2 -right-2 w-8 h-8 bg-amber-500 rounded-full flex items-center justify-center shadow-lg">
                  <Shield className="w-4 h-4 text-amber-950" />
                </div>
              )}
            </div>

            {/* DAO Info */}
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h1 className="text-2xl md:text-3xl font-bold text-white">
                  {dao.displayName}
                </h1>
                <span className="px-2.5 py-1 text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full">
                  {dao.status}
                </span>
                {dao.networkPermissions.isNetworkDAO && (
                  <span className="px-2.5 py-1 text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full">
                    Network DAO
                  </span>
                )}
              </div>

              <p className="text-slate-400 mb-4 max-w-2xl">{dao.description}</p>

              {/* CEO and Board Summary */}
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center">
                    <Crown className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <p className="text-slate-200 font-medium">
                      {dao.ceo.persona.name}
                    </p>
                    <p className="text-xs text-slate-500">CEO</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                    <Users className="w-4 h-4 text-slate-300" />
                  </div>
                  <div>
                    <p className="text-slate-200 font-medium">
                      {dao.board.length} Members
                    </p>
                    <p className="text-xs text-slate-500">Board</p>
                  </div>
                </div>
              </div>

              {/* External Links */}
              <div className="flex flex-wrap gap-2 mt-4">
                {dao.farcasterChannel && (
                  <a
                    href={`https://warpcast.com/~/channel${dao.farcasterChannel}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
                  >
                    Farcaster
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {dao.websiteUrl && (
                  <a
                    href={dao.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
                  >
                    Website
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {dao.githubOrg && (
                  <a
                    href={`https://github.com/${dao.githubOrg}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
                  >
                    GitHub
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
            <StatCard
              label="Proposals"
              value={dao.stats.totalProposals}
              subtext={`${dao.stats.activeProposals} active`}
            />
            <StatCard
              label="Approval Rate"
              value={`${dao.stats.ceoApprovalRate}%`}
              subtext="CEO decisions"
            />
            <StatCard
              label="Total Funded"
              value={`$${dao.stats.totalFunded}`}
              subtext="All time"
            />
            <StatCard
              label="Members"
              value={dao.stats.uniqueProposers}
              subtext="Unique proposers"
            />
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="sticky top-14 z-40 bg-slate-950/95 backdrop-blur-xl border-b border-slate-800">
        <div className="container mx-auto px-4">
          <nav className="flex gap-1 -mb-px">
            {TABS.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    isActive
                      ? 'border-violet-500 text-violet-400'
                      : 'border-transparent text-slate-500 hover:text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              )
            })}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      <div className="container mx-auto px-4 py-8">
        {activeTab === 'agents' && <AgentsTab dao={dao} />}
        {activeTab === 'governance' && <GovernanceTab dao={dao} />}
        {activeTab === 'treasury' && <TreasuryTab dao={dao} />}
        {activeTab === 'settings' && <SettingsTab dao={dao} />}
      </div>
    </div>
  )
}
