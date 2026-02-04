import {
  AlertCircle,
  BarChart3,
  BookOpen,
  Bug,
  Building2,
  Compass,
  Copy,
  Crown,
  Filter,
  Gift,
  GraduationCap,
  ListChecks,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Server,
  Settings,
  Share2,
  Shield,
  Sparkles,
  Users,
  Wallet,
  Zap,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { getDAOStatusStyle } from '../constants/ui'
import { useDAOs } from '../hooks/useDAO'
import type { DAOListItem, DAOStatus } from '../types/dao'

interface DAOCardProps {
  dao: DAOListItem
}

function DAOCard({ dao }: DAOCardProps) {
  const statusStyle = getDAOStatusStyle(dao.status)

  return (
    <Link
      to={`/dao/${dao.daoId}`}
      className="group block rounded-2xl p-5 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      style={
        {
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-card)',
          '--tw-ring-color': 'var(--color-primary)',
        } as React.CSSProperties
      }
    >
      <div className="flex items-start gap-4">
        {/* DAO Avatar */}
        <div className="relative shrink-0">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl font-bold text-white shadow-lg transition-transform duration-300 group-hover:scale-105"
            style={{ background: 'var(--gradient-secondary)' }}
          >
            {dao.displayName.charAt(0).toUpperCase()}
          </div>
          {dao.isNetworkDAO && (
            <div
              className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center"
              style={{ backgroundColor: 'var(--color-warning)' }}
              title="Network DAO"
            >
              <Shield className="w-3 h-3 text-white" aria-hidden="true" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3
                className="font-semibold truncate transition-colors group-hover:text-[var(--color-primary)]"
                style={{ color: 'var(--text-primary)' }}
              >
                {dao.displayName}
              </h3>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                @{dao.name}
              </p>
            </div>
            <span
              className="shrink-0 px-2.5 py-1 text-xs font-semibold rounded-full"
              style={{
                backgroundColor: statusStyle.bg,
                color: statusStyle.text,
              }}
            >
              {statusStyle.label}
            </span>
          </div>

          <p
            className="mt-2 text-sm line-clamp-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            {dao.description}
          </p>

          {/* Director Info */}
          <div className="mt-3 flex items-center gap-2 text-sm">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center"
              style={{ background: 'var(--gradient-accent)' }}
            >
              <Crown className="w-3 h-3 text-white" aria-hidden="true" />
            </div>
            <span style={{ color: 'var(--text-primary)' }}>
              {dao.directorName}
            </span>
            <span style={{ color: 'var(--text-tertiary)' }}>·</span>
            <span style={{ color: 'var(--text-tertiary)' }}>
              {dao.boardMemberCount} board members
            </span>
          </div>

          {/* Stats */}
          <div className="mt-4 flex items-center gap-4 text-xs">
            <div
              className="flex items-center gap-1.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{dao.proposalCount} proposals</span>
            </div>
            <div
              className="flex items-center gap-1.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Users className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{(dao.memberCount ?? 0).toLocaleString()} members</span>
            </div>
            {dao.activeProposalCount > 0 && (
              <div
                className="flex items-center gap-1.5"
                style={{ color: 'var(--color-success)' }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ backgroundColor: 'var(--color-success)' }}
                  aria-hidden="true"
                />
                <span>{dao.activeProposalCount} active</span>
              </div>
            )}
          </div>

          {/* Tags */}
          {dao.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {dao.tags.slice(0, 4).map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 text-xs rounded-md"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  {tag}
                </span>
              ))}
              {dao.tags.length > 4 && (
                <span
                  className="px-2 py-0.5 text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  +{dao.tags.length - 4}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}

function EmptyState() {
  return (
    <div className="text-center py-16 animate-in">
      <div
        className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
        }}
      >
        <Rocket
          className="w-10 h-10"
          style={{ color: 'var(--text-tertiary)' }}
        />
      </div>
      <h3
        className="text-lg font-semibold mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        No results
      </h3>
      <p
        className="mb-6 max-w-md mx-auto"
        style={{ color: 'var(--text-secondary)' }}
      >
        No DAOs match your current filters. Adjust your search or start a new
        organization.
      </p>
      <Link
        to="/create"
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-white transition-all hover:shadow-lg"
        style={{ background: 'var(--gradient-primary)' }}
      >
        <Plus className="w-4 h-4" aria-hidden="true" />
        Create DAO
      </Link>
    </div>
  )
}

function DAOCardSkeleton() {
  return (
    <div
      className="rounded-2xl p-5"
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="flex items-start gap-4">
        {/* Avatar skeleton */}
        <div
          className="skeleton w-14 h-14 rounded-xl shrink-0"
          style={{ backgroundColor: 'var(--bg-tertiary)' }}
        />
        <div className="flex-1 min-w-0 space-y-3">
          {/* Title skeleton */}
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2 flex-1">
              <div
                className="skeleton h-5 rounded-lg"
                style={{
                  width: '60%',
                  backgroundColor: 'var(--bg-tertiary)',
                }}
              />
              <div
                className="skeleton h-4 rounded-lg"
                style={{
                  width: '30%',
                  backgroundColor: 'var(--bg-tertiary)',
                }}
              />
            </div>
            <div
              className="skeleton h-6 w-16 rounded-full shrink-0"
              style={{ backgroundColor: 'var(--bg-tertiary)' }}
            />
          </div>
          {/* Description skeleton */}
          <div
            className="skeleton h-10 rounded-lg"
            style={{ backgroundColor: 'var(--bg-tertiary)' }}
          />
          {/* Director skeleton */}
          <div className="flex items-center gap-2">
            <div
              className="skeleton w-6 h-6 rounded-full"
              style={{ backgroundColor: 'var(--bg-tertiary)' }}
            />
            <div
              className="skeleton h-4 w-24 rounded-lg"
              style={{ backgroundColor: 'var(--bg-tertiary)' }}
            />
          </div>
          {/* Stats skeleton */}
          <div className="flex items-center gap-4">
            <div
              className="skeleton h-4 w-20 rounded-lg"
              style={{ backgroundColor: 'var(--bg-tertiary)' }}
            />
            <div
              className="skeleton h-4 w-20 rounded-lg"
              style={{ backgroundColor: 'var(--bg-tertiary)' }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// Pre-generate stable keys for skeleton loading
const SKELETON_IDS = ['sk-a', 'sk-b', 'sk-c', 'sk-d', 'sk-e', 'sk-f']

function LoadingState() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {SKELETON_IDS.map((id) => (
        <DAOCardSkeleton key={id} />
      ))}
    </div>
  )
}

interface ErrorStateProps {
  error: Error
  onRetry: () => void
}

function ErrorState({ error, onRetry }: ErrorStateProps) {
  return (
    <div className="text-center py-16">
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
      <h3
        className="text-lg font-semibold mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        Something went wrong
      </h3>
      <p
        className="mb-6 max-w-md mx-auto"
        style={{ color: 'var(--text-secondary)' }}
      >
        {error.message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold transition-colors"
        style={{
          backgroundColor: 'var(--surface)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
        }}
      >
        <RefreshCw className="w-4 h-4" aria-hidden="true" />
        Try Again
      </button>
    </div>
  )
}

export default function DAOListPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<DAOStatus | 'all'>('all')
  const [showNetworkOnly, setShowNetworkOnly] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'proposals' | 'discussions'>('overview')

  const {
    data: daos = [],
    isLoading,
    error,
    refetch,
  } = useDAOs({
    status: statusFilter,
    search,
    networkOnly: showNetworkOnly,
  })

  const handleRetry = useCallback(() => {
    refetch()
  }, [refetch])

  return (
    <div style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Hero Section */}
      <section
        className="relative overflow-hidden"
        style={{
          height: '336px',
          background:
            'radial-gradient(ellipse at 70% 50%, rgba(91, 21, 178, 0.7) 0%, rgba(36, 6, 71, 0.7) 4.5%, rgba(36, 106, 122, 0.66) 57.5%, rgba(22, 49, 186, 0.66) 100%), linear-gradient(135deg, #1a0a2e 0%, #0d1b3e 50%, #162060 100%)',
        }}
      >
        {/* Create A DAO button - top right */}
        <Link
          to="/create"
          className="absolute top-3 right-4 sm:right-8 z-10 inline-flex items-center gap-2.5 px-6 py-3.5 rounded-lg text-white font-semibold transition-all hover:brightness-110"
          style={{
            backgroundColor: 'rgba(50, 58, 96, 0.8)',
            border: '2px solid rgb(84, 100, 183)',
            boxShadow: 'inset 0 -4px 0 rgb(71, 79, 81)',
          }}
        >
          <BarChart3 className="w-6 h-6" aria-hidden="true" />
          Create A DAO
        </Link>

        {/* Title section - left aligned */}
        <div className="absolute left-8 sm:left-28 top-[75px]">
          <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight">
            DAOs With AI Leadership
          </h1>
          <p className="text-2xl sm:text-3xl text-white mt-2">
            Community Center
          </p>
        </div>

        {/* Play button - center */}
        <button
          type="button"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-[60px] h-[54px] rounded-full transition-all hover:scale-110 hover:opacity-80"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
          aria-label="Play video"
        >
          <Play className="w-5 h-5 text-white fill-white" aria-hidden="true" />
        </button>

        {/* Bottom buttons */}
        <div className="absolute left-8 sm:left-28 bottom-[76px] flex gap-8">
          <Link
            to="/guide"
            className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-lg text-white font-semibold transition-all hover:brightness-110"
            style={{
              backgroundColor: 'rgba(50, 58, 96, 0.8)',
              border: '2px solid rgb(84, 100, 183)',
              boxShadow: 'inset 0 -4px 0 rgb(71, 79, 81)',
            }}
          >
            <BookOpen className="w-6 h-6" aria-hidden="true" />
            Help Guide
          </Link>
          <Link
            to="/my-daos"
            className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-lg text-white font-semibold transition-all hover:brightness-110"
            style={{
              backgroundColor: 'rgba(50, 58, 96, 0.8)',
              border: '2px solid rgb(84, 100, 183)',
              boxShadow: 'inset 0 -4px 0 rgb(71, 79, 81)',
            }}
          >
            <ListChecks className="w-6 h-6" aria-hidden="true" />
            My DAOs
          </Link>
        </div>
      </section>

      {/* Category Tabs */}
      <nav
        className="sticky top-16 z-40"
        style={{
          borderBottom: '1px solid rgb(168, 169, 178)',
          backgroundColor: 'var(--bg-primary)',
        }}
        role="tablist"
        aria-label="DAO categories"
      >
        <div className="flex">
          {(['overview', 'proposals', 'discussions'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className="flex-1 h-[55px] flex items-center justify-center text-base font-medium transition-colors relative"
              style={{
                color: activeTab === tab ? 'white' : 'rgba(255, 255, 255, 0.6)',
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {activeTab === tab && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-[2px]"
                  style={{
                    background:
                      'linear-gradient(90deg, #ababe9 0%, #bbf9ab 33%, #ababe9 70%, #ff26dc 100%)',
                  }}
                />
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* Main Content with Sidebar */}
      <div className="flex gap-6 px-5 py-6">
        {/* Left Sidebar Navigation */}
        <aside className="hidden lg:block w-[400px] shrink-0 space-y-5">
          {/* Deposit Funds Card */}
          <div
            className="rounded-xl px-6 py-6 flex items-center justify-between"
            style={{
              backgroundColor: 'rgba(71, 77, 120, 0.5)',
              border: '1px solid rgba(171, 171, 233, 0.4)',
              backdropFilter: 'blur(24px)',
            }}
          >
            <div className="flex items-center gap-4">
              <Zap className="w-10 h-10 shrink-0" style={{ color: '#44dee9' }} aria-hidden="true" />
              <div>
                <p className="text-white font-medium">Deposit Funds</p>
                <p className="text-sm" style={{ color: '#cdcdcd' }}>0xc12c...484F2</p>
              </div>
            </div>
            <button
              type="button"
              className="text-sm font-medium px-2.5 py-2.5 transition-colors hover:opacity-80"
              style={{ color: '#ababe9' }}
            >
              Copy Address
            </button>
          </div>

          {/* Account Balance Card */}
          <div
            className="rounded-xl px-6 py-6 flex items-center justify-between"
            style={{
              backgroundColor: 'rgba(71, 77, 120, 0.5)',
              border: '1px solid rgba(171, 171, 233, 0.4)',
              backdropFilter: 'blur(24px)',
            }}
          >
            <div className="flex items-center gap-4">
              <Wallet className="w-10 h-10 shrink-0" style={{ color: '#f575c2' }} aria-hidden="true" />
              <div>
                <p className="text-white font-medium">Account Balance</p>
                <p className="text-sm" style={{ color: '#cdcdcd' }}>0.023 ETH ($23.99)</p>
              </div>
            </div>
            <button
              type="button"
              className="text-sm font-medium px-2.5 py-2.5 transition-colors hover:opacity-80"
              style={{ color: '#ababe9' }}
            >
              View Wallet
            </button>
          </div>

          {/* Gradient Divider */}
          <div
            className="h-[3px] rounded-full"
            style={{
              background: 'linear-gradient(90deg, #ababe9 0%, #bbf9ab 33%, #ababe9 70%, #ff26dc 100%)',
            }}
          />

          {/* App Card */}
          <div
            className="rounded-lg overflow-hidden"
            style={{
              backgroundColor: '#2f2e40',
              border: '1px solid rgba(171, 171, 233, 0.4)',
              boxShadow: '0 4px 0 black',
            }}
          >
            <div className="px-7 pt-6 pb-4">
              <div className="flex gap-4">
                <div
                  className="w-[70px] h-[70px] rounded-2xl shrink-0 flex items-center justify-center"
                  style={{
                    backgroundColor: '#3a3960',
                    border: '1px solid rgba(255, 255, 255, 0.5)',
                  }}
                >
                  <Building2 className="w-8 h-8 text-white" aria-hidden="true" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-white font-semibold">Autocrat DAO</h3>
                  <p className="text-sm text-white/80 leading-relaxed">
                    AI-powered governance with transparent on-chain management
                  </p>
                  <p className="text-sm text-white/60">v1.0.0</p>
                </div>
              </div>
              <div className="h-px bg-white/20 mt-4" />
            </div>
            <div className="px-7 pb-5 flex gap-4">
              <div className="text-center">
                <p className="text-white text-sm font-medium">Blockchain</p>
                <div className="flex items-center gap-1 mt-1 justify-center">
                  <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>
                  <span className="text-white text-sm">Ethereum</span>
                </div>
              </div>
              <div className="text-center">
                <p className="text-white text-sm font-medium">Structure</p>
                <div className="flex items-center gap-1 mt-1 justify-center">
                  <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22V2L2 12l10 10z" /><path d="M12 22l10-10L12 2" /></svg>
                  <span className="text-white text-sm">NFT-Based</span>
                </div>
              </div>
              <div className="text-center">
                <p className="text-white text-sm font-medium">Members</p>
                <p className="text-white text-sm mt-1">128</p>
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-4" aria-label="Sidebar navigation">
            {[
              { icon: ListChecks, label: 'My DAOs', to: '/my-daos' },
              { icon: BarChart3, label: 'Wallet Activity', to: '/activity' },
              { icon: Gift, label: 'Airdrop', to: '/airdrop' },
              { icon: BookOpen, label: 'Help Guide', to: '/guide' },
              { icon: Settings, label: 'Settings', to: '/settings' },
              { icon: Bug, label: 'Report A Bug', to: '/report' },
            ].map(({ icon: Icon, label, to }) => (
              <Link
                key={label}
                to={to}
                className="flex items-center gap-2.5 px-6 py-4 rounded-lg text-white font-medium transition-all hover:brightness-110"
                style={{
                  backgroundColor: 'rgba(50, 58, 96, 0.8)',
                  border: '2px solid rgb(84, 100, 183)',
                  boxShadow: 'inset 0 -4px 0 rgb(71, 79, 81)',
                }}
              >
                <Icon className="w-6 h-6" aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <section className="flex-1 min-w-0 space-y-6">
          {/* Referral Banner */}
          <div
            className="relative rounded-[10px] px-6 py-4 overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(47, 46, 64, 0.9) 0%, rgba(30, 29, 50, 0.95) 100%)',
              border: '1px solid transparent',
              backgroundClip: 'padding-box',
            }}
          >
            <div
              className="absolute inset-0 rounded-[10px] -z-10"
              style={{
                padding: '1px',
                background: 'linear-gradient(90deg, #ababe9 0%, #bbf9ab 33%, #ababe9 70%, #ff26dc 100%)',
                WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                WebkitMaskComposite: 'xor',
                maskComposite: 'exclude',
              }}
            />
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <Share2 className="w-5 h-5 shrink-0" style={{ color: '#bbf9ab' }} aria-hidden="true" />
                <p className="text-white text-sm font-medium">
                  Invite Friends, Earn Rewards Up To 200 <span style={{ color: '#bbf9ab' }}>$AUTOCRATS</span> Per Referral
                </p>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-white text-sm font-semibold transition-all hover:brightness-110 shrink-0"
                style={{
                  backgroundColor: 'rgba(50, 58, 96, 0.8)',
                  border: '2px solid rgb(84, 100, 183)',
                  boxShadow: 'inset 0 -4px 0 rgb(71, 79, 81)',
                }}
              >
                Invite Now
              </button>
            </div>
          </div>

          {/* Feature Cards Row */}
          <div className="grid gap-5 md:grid-cols-3">
            {/* Explore DAOs Card */}
            <div
              className="rounded-xl p-6 flex flex-col"
              style={{
                backgroundColor: 'rgba(131, 138, 168, 0.25)',
                border: '1px solid rgb(121, 125, 245)',
                boxShadow: '0 4px 0 black',
                backdropFilter: 'blur(24px)',
              }}
            >
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center mb-4"
                style={{ backgroundColor: 'rgba(91, 21, 178, 0.4)', border: '1px solid rgba(171, 171, 233, 0.4)' }}
              >
                <Compass className="w-7 h-7" style={{ color: '#ababe9' }} aria-hidden="true" />
              </div>
              <h3 className="text-white text-lg font-semibold mb-2">Explore DAOs</h3>
              <p className="text-sm leading-relaxed mb-6 flex-1" style={{ color: '#cdcdcd' }}>
                DAOs are like chat groups, but with a shared wallet and democratic rules. Find a community that matches your interests.
              </p>
              <Link
                to="/explore"
                className="inline-flex items-center justify-center gap-2 w-full px-5 py-3 rounded-lg text-white font-semibold transition-all hover:brightness-110"
                style={{
                  background: 'linear-gradient(135deg, #6b21a8 0%, #7c3aed 100%)',
                  boxShadow: '0 2px 8px rgba(107, 33, 168, 0.4)',
                }}
              >
                <Compass className="w-4 h-4" aria-hidden="true" />
                Explore
              </Link>
            </div>

            {/* Create Your DAO Card */}
            <div
              className="rounded-xl p-6 flex flex-col"
              style={{
                backgroundColor: 'rgba(131, 138, 168, 0.25)',
                border: '1px solid rgb(121, 125, 245)',
                boxShadow: '0 4px 0 black',
                backdropFilter: 'blur(24px)',
              }}
            >
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center mb-4"
                style={{ backgroundColor: 'rgba(180, 130, 20, 0.3)', border: '1px solid rgba(234, 179, 8, 0.4)' }}
              >
                <Sparkles className="w-7 h-7" style={{ color: '#eab308' }} aria-hidden="true" />
              </div>
              <h3 className="text-white text-lg font-semibold mb-2">Create Your DAO</h3>
              <p className="text-sm leading-relaxed mb-6 flex-1" style={{ color: '#cdcdcd' }}>
                Launch your own decentralized organization with AI-powered governance. Set up proposals, treasury, and voting in minutes.
              </p>
              <Link
                to="/create"
                className="inline-flex items-center justify-center gap-2 w-full px-5 py-3 rounded-lg text-white font-semibold transition-all hover:brightness-110"
                style={{
                  background: 'linear-gradient(135deg, #b45309 0%, #eab308 100%)',
                  boxShadow: '0 2px 8px rgba(234, 179, 8, 0.3)',
                }}
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                Create
              </Link>
            </div>

            {/* Education Card */}
            <div
              className="rounded-xl p-6 flex flex-col"
              style={{
                backgroundColor: 'rgba(131, 138, 168, 0.25)',
                border: '1px solid rgb(121, 125, 245)',
                boxShadow: '0 4px 0 black',
                backdropFilter: 'blur(24px)',
              }}
            >
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center mb-4"
                style={{ backgroundColor: 'rgba(22, 163, 74, 0.3)', border: '1px solid rgba(74, 222, 128, 0.4)' }}
              >
                <GraduationCap className="w-7 h-7" style={{ color: '#4ade80' }} aria-hidden="true" />
              </div>
              <h3 className="text-white text-lg font-semibold mb-2">Education</h3>
              <p className="text-sm leading-relaxed mb-6 flex-1" style={{ color: '#cdcdcd' }}>
                Learn about DAOs, governance, and decentralized coordination. Tutorials, guides, and resources for every level.
              </p>
              <Link
                to="/education"
                className="inline-flex items-center justify-center gap-2 w-full px-5 py-3 rounded-lg text-white font-semibold transition-all hover:brightness-110"
                style={{
                  background: 'linear-gradient(135deg, #15803d 0%, #22c55e 100%)',
                  boxShadow: '0 2px 8px rgba(34, 197, 94, 0.3)',
                }}
              >
                <GraduationCap className="w-4 h-4" aria-hidden="true" />
                Learn More
              </Link>
            </div>
          </div>

          {/* Top Agents This Week */}
          <div
            className="rounded-[10px] p-4"
            style={{ backgroundColor: 'transparent' }}
          >
            <h2 className="text-white font-semibold mb-5 px-1">Top Agents This Week</h2>
            <div className="flex gap-0 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
              {[
                { rank: 1, name: 'Eliza', pnl: '200+ (243% PNL)', color: '#8b5cf6' },
                { rank: 2, name: 'Sponge', pnl: '400+ (133% PNL)', color: '#6366f1' },
                { rank: 3, name: 'Jubi', pnl: '800+ (533% PNL)', color: '#818cf8' },
                { rank: 4, name: 'Big Boy', pnl: '800+ (533% PNL)', color: '#7c3aed' },
                { rank: 5, name: 'Zhibti', pnl: '800+ (533% PNL)', color: '#a78bfa' },
              ].map((agent) => (
                <div key={agent.rank} className="flex items-end shrink-0" style={{ width: '176px' }}>
                  {/* Rank number */}
                  <span
                    className="text-sm font-bold self-center mb-4"
                    style={{
                      color: 'transparent',
                      WebkitTextStroke: '1px white',
                      width: '26px',
                      textAlign: 'center',
                    }}
                  >
                    {agent.rank}
                  </span>
                  {/* Agent card */}
                  <div
                    className="relative overflow-hidden cursor-pointer transition-transform hover:scale-105"
                    style={{
                      width: '150px',
                      height: '217px',
                      borderRadius: '13.5px',
                      backgroundColor: '#726fe8',
                    }}
                  >
                    {/* Avatar placeholder with gradient fade */}
                    <div
                      className="absolute inset-0"
                      style={{
                        background: `linear-gradient(to bottom, rgba(114, 111, 232, 0.3) 0%, rgba(114, 111, 232, 0) 30%, rgba(114, 111, 232, 0) 61.5%, #726fe8 100%)`,
                      }}
                    />
                    {/* Agent avatar silhouette */}
                    <div
                      className="absolute inset-x-0 top-3 bottom-0 flex items-center justify-center"
                      style={{ opacity: 0.4 }}
                    >
                      <div
                        className="w-20 h-20 rounded-full"
                        style={{
                          background: `radial-gradient(circle, ${agent.color} 0%, transparent 70%)`,
                        }}
                      />
                    </div>
                    {/* Text overlay at bottom */}
                    <div className="absolute bottom-0 left-0 right-0 px-3 pb-4 pt-8" style={{ background: 'linear-gradient(to top, #726fe8 40%, transparent 100%)' }}>
                      <p className="text-white text-sm font-semibold text-center">{agent.name}</p>
                      <p className="text-white/80 text-xs text-center mt-1">{agent.pnl}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* DAO Showcase Cards */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-white text-lg font-semibold">Featured DAOs</h2>
              <button
                type="button"
                onClick={() => refetch()}
                className="p-2 rounded-lg transition-colors"
                style={{ color: 'var(--text-tertiary)' }}
                aria-label="Refresh list"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {isLoading ? (
              <LoadingState />
            ) : error ? (
              <ErrorState error={error as Error} onRetry={handleRetry} />
            ) : daos.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="grid gap-5 md:grid-cols-2">
                {/* Humanitarian ECO DAO Showcase */}
                <div
                  className="rounded-xl overflow-hidden"
                  style={{
                    backgroundColor: 'rgba(131, 138, 168, 0.25)',
                    border: '1px solid rgb(121, 125, 245)',
                    boxShadow: '0 4px 0 black',
                    backdropFilter: 'blur(24px)',
                  }}
                >
                  {/* Green gradient header */}
                  <div
                    className="h-[100px] relative"
                    style={{
                      background: 'linear-gradient(135deg, #065f46 0%, #059669 40%, #34d399 100%)',
                    }}
                  >
                    <span
                      className="absolute top-3 left-4 px-3 py-1 text-xs font-semibold rounded-full"
                      style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)', color: '#bbf9ab' }}
                    >
                      Public Goods
                    </span>
                  </div>
                  <div className="px-5 pb-5 pt-4">
                    <h3 className="text-white text-base font-bold mb-1">Humanitarian ECO DAO</h3>
                    <p className="text-sm mb-4" style={{ color: '#cdcdcd' }}>
                      Building sustainable solutions for communities worldwide through decentralized coordination.
                    </p>
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                        style={{ background: 'linear-gradient(135deg, #6b21a8, #7c3aed)' }}
                      >
                        B
                      </div>
                      <span className="text-white text-sm font-medium">Brain Bay</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs" style={{ color: '#a1a1aa' }}>
                      <Users className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>234 Members</span>
                      <span>·</span>
                      <span>23 Proposals</span>
                    </div>
                  </div>
                </div>

                {/* EMBERQUILL STUDIOS Showcase */}
                <div
                  className="rounded-xl overflow-hidden"
                  style={{
                    backgroundColor: 'rgba(131, 138, 168, 0.25)',
                    border: '1px solid rgb(121, 125, 245)',
                    boxShadow: '0 4px 0 black',
                    backdropFilter: 'blur(24px)',
                  }}
                >
                  {/* Orange/red gradient header */}
                  <div
                    className="h-[100px] relative"
                    style={{
                      background: 'linear-gradient(135deg, #9a3412 0%, #ea580c 40%, #fb923c 100%)',
                    }}
                  >
                    <span
                      className="absolute top-3 left-4 px-3 py-1 text-xs font-semibold rounded-full"
                      style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)', color: '#fdba74' }}
                    >
                      Creatives
                    </span>
                  </div>
                  <div className="px-5 pb-5 pt-4">
                    <h3 className="text-white text-base font-bold mb-1">EMBERQUILL STUDIOS</h3>
                    <p className="text-sm mb-4" style={{ color: '#cdcdcd' }}>
                      Over 50 tight-knit art buddies collaborating on digital art, NFTs, and creative projects.
                    </p>
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                        style={{ background: 'linear-gradient(135deg, #b45309, #ea580c)' }}
                      >
                        C
                      </div>
                      <span className="text-white text-sm font-medium">Cedric Dower</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs" style={{ color: '#a1a1aa' }}>
                      <Users className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>52 Members</span>
                      <span>·</span>
                      <span>14 Proposals</span>
                    </div>
                  </div>
                </div>

                {/* Dynamic DAO Cards from data */}
                {daos.slice(0, 4).map((dao) => (
                  <DAOCard key={dao.daoId} dao={dao} />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
