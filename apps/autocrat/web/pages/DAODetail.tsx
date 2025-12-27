/**
 * DAO Detail Page
 *
 * Comprehensive view of a single DAO with tabs for Agents, Governance, Treasury, and Settings.
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
import { useCallback, useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AgentsTab } from '../components/dao/AgentsTab'
import { GovernanceTab } from '../components/dao/GovernanceTab'
import { SettingsTab } from '../components/dao/SettingsTab'
import { TreasuryTab } from '../components/dao/TreasuryTab'
import { useDAO } from '../hooks/useDAO'

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

interface StatCardProps {
  label: string
  value: string | number
  subtext?: string
  color?: string
}

function StatCard({ label, value, subtext, color }: StatCardProps) {
  return (
    <div
      className="rounded-xl p-4 sm:p-5"
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      <p
        className="text-xs font-medium uppercase tracking-wider mb-1"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {label}
      </p>
      <p
        className="text-xl sm:text-2xl font-bold"
        style={{ color: color ?? 'var(--text-primary)' }}
      >
        {value}
      </p>
      {subtext && (
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
          {subtext}
        </p>
      )}
    </div>
  )
}

function LoadingState() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div className="text-center">
        <Loader2
          className="w-10 h-10 animate-spin mx-auto mb-4"
          style={{ color: 'var(--color-primary)' }}
        />
        <p style={{ color: 'var(--text-secondary)' }}>
          Loading organization...
        </p>
      </div>
    </div>
  )
}

interface ErrorStateProps {
  error: Error
  onRetry: () => void
}

function ErrorState({ error, onRetry }: ErrorStateProps) {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div className="text-center max-w-md">
        <div
          className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
          }}
        >
          <AlertCircle
            className="w-10 h-10"
            style={{ color: 'var(--color-error)' }}
          />
        </div>
        <h2
          className="text-xl font-semibold mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Failed to load organization
        </h2>
        <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
          {error.message}
        </p>
        <div className="flex gap-3 justify-center">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-colors"
            style={{
              backgroundColor: 'var(--surface)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
            }}
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Try Again
          </button>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-white"
            style={{ background: 'var(--gradient-primary)' }}
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Back to DAOs
          </Link>
        </div>
      </div>
    </div>
  )
}

function NotFoundState() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div className="text-center max-w-md">
        <div
          className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
          }}
        >
          <AlertCircle
            className="w-10 h-10"
            style={{ color: 'var(--text-tertiary)' }}
          />
        </div>
        <h2
          className="text-xl font-semibold mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Organization not found
        </h2>
        <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
          This organization doesn&apos;t exist or may have been archived.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-white"
          style={{ background: 'var(--gradient-primary)' }}
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Back to DAOs
        </Link>
      </div>
    </div>
  )
}

export default function DAODetailPage() {
  const { daoId } = useParams<{ daoId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()

  const { data: dao, isLoading, error, refetch } = useDAO(daoId)

  const activeTab = (searchParams.get('tab') as TabId) ?? 'agents'

  const setActiveTab = useCallback(
    (tab: TabId) => {
      setSearchParams({ tab })
    },
    [setSearchParams],
  )

  const handleRetry = useCallback(() => {
    refetch()
  }, [refetch])

  // Memoize external links to avoid recalculation
  const externalLinks = useMemo(() => {
    if (!dao) return []
    const links = []
    if (dao.farcasterChannel) {
      links.push({
        href: `https://warpcast.com/~/channel${dao.farcasterChannel}`,
        label: 'Farcaster',
      })
    }
    if (dao.websiteUrl) {
      links.push({ href: dao.websiteUrl, label: 'Website' })
    }
    if (dao.githubOrg) {
      links.push({
        href: `https://github.com/${dao.githubOrg}`,
        label: 'GitHub',
      })
    }
    return links
  }, [dao])

  if (isLoading) {
    return <LoadingState />
  }

  if (error) {
    return <ErrorState error={error as Error} onRetry={handleRetry} />
  }

  if (!dao) {
    return <NotFoundState />
  }

  return (
    <div style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Hero Section */}
      <section
        className="border-b"
        style={{
          background: 'var(--gradient-hero)',
          borderColor: 'rgba(255, 255, 255, 0.1)',
        }}
      >
        <div className="container mx-auto py-8">
          {/* Back Button */}
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-white mb-6 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            All DAOs
          </Link>

          <div className="flex flex-col md:flex-row md:items-start gap-6">
            {/* DAO Avatar */}
            <div className="relative shrink-0">
              <div
                className="w-20 h-20 md:w-24 md:h-24 rounded-2xl flex items-center justify-center text-3xl md:text-4xl font-bold text-white shadow-xl"
                style={{ background: 'var(--gradient-secondary)' }}
              >
                {dao.displayName.charAt(0).toUpperCase()}
              </div>
              {dao.networkPermissions.isNetworkDAO && (
                <div
                  className="absolute -top-2 -right-2 w-8 h-8 rounded-full flex items-center justify-center shadow-lg"
                  style={{ backgroundColor: 'var(--color-warning)' }}
                  title="Network DAO"
                >
                  <Shield className="w-4 h-4 text-white" aria-hidden="true" />
                </div>
              )}
            </div>

            {/* DAO Info */}
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h1 className="text-2xl md:text-3xl font-bold text-white">
                  {dao.displayName}
                </h1>
                <span
                  className="px-2.5 py-1 text-xs font-semibold rounded-full"
                  style={{
                    backgroundColor: 'rgba(16, 185, 129, 0.2)',
                    color: '#34D399',
                  }}
                >
                  {dao.status}
                </span>
                {dao.networkPermissions.isNetworkDAO && (
                  <span
                    className="px-2.5 py-1 text-xs font-semibold rounded-full"
                    style={{
                      backgroundColor: 'rgba(245, 158, 11, 0.2)',
                      color: '#FBBF24',
                    }}
                  >
                    Network DAO
                  </span>
                )}
              </div>

              <p className="text-white/80 mb-4 max-w-2xl">{dao.description}</p>

              {/* CEO and Board Summary */}
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ background: 'var(--gradient-accent)' }}
                  >
                    <Crown className="w-4 h-4 text-white" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-white font-medium">
                      {dao.ceo.persona.name}
                    </p>
                    <p className="text-xs text-white/60">CEO</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: 'rgba(255, 255, 255, 0.2)' }}
                  >
                    <Users className="w-4 h-4 text-white" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-white font-medium">
                      {dao.board.length} Members
                    </p>
                    <p className="text-xs text-white/60">Board</p>
                  </div>
                </div>
              </div>

              {/* External Links */}
              {externalLinks.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-4">
                  {externalLinks.map((link) => (
                    <a
                      key={link.label}
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
                    >
                      {link.label}
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </a>
                  ))}
                </div>
              )}
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
              color="var(--color-success)"
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
      </section>

      {/* Tabs Navigation */}
      <nav
        className="sticky top-16 z-40 backdrop-blur-xl border-b"
        style={{
          backgroundColor: 'rgba(var(--bg-primary-rgb, 250, 251, 255), 0.95)',
          borderColor: 'var(--border)',
        }}
        aria-label="DAO sections"
      >
        <div className="container mx-auto">
          <div className="flex gap-1 -mb-px overflow-x-auto">
            {TABS.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className="flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap"
                  style={{
                    borderColor: isActive
                      ? 'var(--color-primary)'
                      : 'transparent',
                    color: isActive
                      ? 'var(--color-primary)'
                      : 'var(--text-secondary)',
                  }}
                  aria-selected={isActive}
                  role="tab"
                >
                  <Icon className="w-4 h-4" aria-hidden="true" />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>
      </nav>

      {/* Tab Content */}
      <div className="container mx-auto py-8" role="tabpanel">
        {activeTab === 'agents' && <AgentsTab dao={dao} />}
        {activeTab === 'governance' && <GovernanceTab dao={dao} />}
        {activeTab === 'treasury' && <TreasuryTab dao={dao} />}
        {activeTab === 'settings' && <SettingsTab dao={dao} />}
      </div>
    </div>
  )
}
