import {
  AlertCircle,
  BarChart3,
  BookOpen,
  Bug,
  Building2,
  CheckCircle2,
  Clock,
  Compass,
  Copy,
  Crown,
  Filter,
  Gift,
  GraduationCap,
  ListChecks,
  MessageSquare,
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
  ThumbsDown,
  ThumbsUp,
  Users,
  Vote,
  Wallet,
  XCircle,
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

type SettingsTab = 'my-daos' | 'wallet' | 'airdrop' | 'help' | 'notifications'

function SettingsPopup({ onClose }: { onClose: () => void }) {
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('my-daos')

  const tabs: { id: SettingsTab; label: string; icon: typeof ListChecks }[] = [
    { id: 'my-daos', label: 'My DAOs', icon: ListChecks },
    { id: 'wallet', label: 'Wallet', icon: BarChart3 },
    { id: 'airdrop', label: 'Airdrop', icon: Gift },
    { id: 'help', label: 'Help', icon: BookOpen },
    { id: 'notifications', label: 'Settings', icon: Settings },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-3xl h-[500px] rounded-2xl overflow-hidden flex"
        style={{
          backgroundColor: '#1e1d32',
          border: '1px solid rgb(121, 125, 245)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* Left Side Tabs */}
        <div
          className="w-48 shrink-0 p-3 flex flex-col"
          style={{ backgroundColor: 'rgba(30, 29, 50, 0.8)', borderRight: '1px solid rgba(121, 125, 245, 0.3)' }}
        >
          <div className="flex items-center justify-between mb-4 px-2">
            <h2 className="text-lg font-bold text-white">Settings</h2>
          </div>
          <nav className="space-y-1 flex-1">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveSettingsTab(id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left"
                style={{
                  backgroundColor: activeSettingsTab === id ? 'rgba(139, 92, 246, 0.3)' : 'transparent',
                  color: activeSettingsTab === id ? '#fff' : '#a1a1aa',
                }}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </nav>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left hover:bg-white/5"
            style={{ color: '#a1a1aa' }}
          >
            <XCircle className="w-4 h-4" />
            Close
          </button>
        </div>

        {/* Right Content Area */}
        <div className="flex-1 p-6 overflow-y-auto">
          {activeSettingsTab === 'my-daos' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-white font-semibold text-lg">My DAOs</h3>
                <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: 'rgba(139, 92, 246, 0.3)', color: '#a78bfa' }}>
                  3 DAOs
                </span>
              </div>
              <p className="text-sm" style={{ color: '#a1a1aa' }}>
                Manage your DAO memberships and view your roles across different organizations.
              </p>
              <div className="space-y-3 mt-4">
                {[
                  { name: 'Autocrat DAO', role: 'Member', proposals: 3, members: 128, icon: '🏛️' },
                  { name: 'DeFi Builders', role: 'Admin', proposals: 12, members: 456, icon: '🔧' },
                  { name: 'NFT Collectors', role: 'Member', proposals: 0, members: 89, icon: '🎨' },
                ].map((dao) => (
                  <div
                    key={dao.name}
                    className="p-4 rounded-xl cursor-pointer transition-all hover:brightness-110"
                    style={{ backgroundColor: 'rgba(50, 58, 96, 0.5)', border: '1px solid rgba(139, 92, 246, 0.2)' }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style={{ backgroundColor: 'rgba(139, 92, 246, 0.3)' }}>
                        {dao.icon}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <h4 className="text-white font-semibold">{dao.name}</h4>
                          <span
                            className="text-xs px-2 py-0.5 rounded"
                            style={{
                              backgroundColor: dao.role === 'Admin' ? 'rgba(234, 179, 8, 0.2)' : 'rgba(139, 92, 246, 0.2)',
                              color: dao.role === 'Admin' ? '#eab308' : '#a78bfa',
                            }}
                          >
                            {dao.role}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-xs" style={{ color: '#a1a1aa' }}>
                          <span>{dao.members} members</span>
                          <span>•</span>
                          <span>{dao.proposals} active proposals</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSettingsTab === 'wallet' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-white font-semibold text-lg">Wallet Activity</h3>
                <button
                  type="button"
                  className="text-xs px-3 py-1.5 rounded-lg transition-all hover:brightness-110"
                  style={{ backgroundColor: 'rgba(139, 92, 246, 0.3)', color: '#a78bfa' }}
                >
                  View All
                </button>
              </div>
              <p className="text-sm" style={{ color: '#a1a1aa' }}>
                Your recent governance activity and transactions.
              </p>

              {/* Balance Card */}
              <div
                className="p-4 rounded-xl"
                style={{ background: 'linear-gradient(135deg, rgba(107, 33, 168, 0.4) 0%, rgba(139, 92, 246, 0.2) 100%)', border: '1px solid rgba(139, 92, 246, 0.3)' }}
              >
                <p className="text-xs mb-1" style={{ color: '#a1a1aa' }}>Total Balance</p>
                <p className="text-2xl font-bold text-white">1,250 AUTOCRAT</p>
                <p className="text-sm" style={{ color: '#4ade80' }}>≈ $2,500.00 USD</p>
              </div>

              {/* Activity List */}
              <div className="space-y-2 mt-4">
                {[
                  { action: 'Voted on Proposal #42', time: '2 hours ago', type: 'vote', amount: null },
                  { action: 'Staked tokens', time: '1 day ago', type: 'stake', amount: '+100 AUTOCRAT' },
                  { action: 'Claimed Airdrop', time: '3 days ago', type: 'claim', amount: '+250 AUTOCRAT' },
                  { action: 'Delegated voting power', time: '1 week ago', type: 'delegate', amount: null },
                  { action: 'Received from treasury', time: '2 weeks ago', type: 'receive', amount: '+500 AUTOCRAT' },
                ].map((activity, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: 'rgba(50, 58, 96, 0.5)' }}>
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: 'rgba(139, 92, 246, 0.3)' }}
                      >
                        {activity.type === 'vote' && <Vote className="w-4 h-4" style={{ color: '#a78bfa' }} />}
                        {activity.type === 'stake' && <Zap className="w-4 h-4" style={{ color: '#a78bfa' }} />}
                        {activity.type === 'claim' && <Gift className="w-4 h-4" style={{ color: '#a78bfa' }} />}
                        {activity.type === 'delegate' && <Users className="w-4 h-4" style={{ color: '#a78bfa' }} />}
                        {activity.type === 'receive' && <Wallet className="w-4 h-4" style={{ color: '#a78bfa' }} />}
                      </div>
                      <div>
                        <p className="text-white text-sm">{activity.action}</p>
                        <p className="text-xs" style={{ color: '#a1a1aa' }}>{activity.time}</p>
                      </div>
                    </div>
                    {activity.amount && (
                      <span className="text-sm font-medium" style={{ color: '#4ade80' }}>{activity.amount}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSettingsTab === 'airdrop' && (
            <div className="space-y-4">
              <h3 className="text-white font-semibold text-lg">Airdrop</h3>
              <p className="text-sm" style={{ color: '#a1a1aa' }}>
                Claim your governance tokens and view airdrop history.
              </p>

              {/* Claim Card */}
              <div
                className="p-6 rounded-xl text-center"
                style={{ background: 'linear-gradient(135deg, rgba(107, 33, 168, 0.4) 0%, rgba(139, 92, 246, 0.2) 100%)', border: '1px solid rgba(139, 92, 246, 0.3)' }}
              >
                <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6b21a8, #7c3aed)' }}>
                  <Gift className="w-8 h-8 text-white" />
                </div>
                <p className="text-3xl font-bold text-white mb-1">250 AUTOCRAT</p>
                <p className="text-sm mb-4" style={{ color: '#a1a1aa' }}>Available to claim</p>
                <button
                  type="button"
                  className="px-8 py-3 rounded-lg text-white font-semibold transition-all hover:brightness-110"
                  style={{ background: 'linear-gradient(135deg, #6b21a8, #7c3aed)' }}
                >
                  Claim Airdrop
                </button>
              </div>

              {/* Airdrop History */}
              <div className="mt-6">
                <h4 className="text-white font-medium text-sm mb-3">Claim History</h4>
                <div className="space-y-2">
                  {[
                    { date: 'Jan 15, 2024', amount: '500 AUTOCRAT', status: 'Claimed' },
                    { date: 'Dec 1, 2023', amount: '250 AUTOCRAT', status: 'Claimed' },
                    { date: 'Nov 1, 2023', amount: '100 AUTOCRAT', status: 'Claimed' },
                  ].map((claim, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: 'rgba(50, 58, 96, 0.5)' }}>
                      <div>
                        <p className="text-white text-sm">{claim.amount}</p>
                        <p className="text-xs" style={{ color: '#a1a1aa' }}>{claim.date}</p>
                      </div>
                      <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: 'rgba(34, 197, 94, 0.2)', color: '#4ade80' }}>
                        {claim.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeSettingsTab === 'help' && (
            <div className="space-y-4">
              <h3 className="text-white font-semibold text-lg">Help & Resources</h3>
              <p className="text-sm" style={{ color: '#a1a1aa' }}>
                Learn how to use the platform and get help when you need it.
              </p>

              {/* Quick Links */}
              <div className="grid grid-cols-2 gap-3 mt-4">
                {[
                  { title: 'Getting Started', desc: 'New to DAOs? Start here', icon: Rocket },
                  { title: 'Voting Guide', desc: 'How to vote on proposals', icon: Vote },
                  { title: 'Create Proposals', desc: 'Submit your ideas', icon: Plus },
                  { title: 'Staking & Rewards', desc: 'Earn with your tokens', icon: Gift },
                ].map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    className="p-4 rounded-xl text-left transition-all hover:brightness-110"
                    style={{ backgroundColor: 'rgba(50, 58, 96, 0.5)', border: '1px solid rgba(139, 92, 246, 0.2)' }}
                  >
                    <item.icon className="w-6 h-6 mb-2" style={{ color: '#a78bfa' }} />
                    <p className="text-white font-medium text-sm">{item.title}</p>
                    <p className="text-xs mt-1" style={{ color: '#a1a1aa' }}>{item.desc}</p>
                  </button>
                ))}
              </div>

              {/* FAQ */}
              <div className="mt-6">
                <h4 className="text-white font-medium text-sm mb-3">Frequently Asked Questions</h4>
                <div className="space-y-2">
                  {[
                    'What is a DAO?',
                    'How do governance tokens work?',
                    'Can I delegate my voting power?',
                    'How are proposals executed?',
                  ].map((q) => (
                    <button
                      key={q}
                      type="button"
                      className="w-full flex items-center justify-between p-3 rounded-lg text-left transition-all hover:brightness-110"
                      style={{ backgroundColor: 'rgba(50, 58, 96, 0.5)' }}
                    >
                      <span className="text-white text-sm">{q}</span>
                      <span style={{ color: '#a78bfa' }}>→</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeSettingsTab === 'notifications' && (
            <div className="space-y-4">
              <h3 className="text-white font-semibold text-lg">Notification Settings</h3>
              <p className="text-sm" style={{ color: '#a1a1aa' }}>
                Control how and when you receive notifications.
              </p>

              {/* Email Notifications */}
              <div className="mt-4">
                <h4 className="text-white font-medium text-sm mb-3">Email Notifications</h4>
                <div className="space-y-2">
                  {[
                    { label: 'New proposals', desc: 'When new proposals are created', enabled: true },
                    { label: 'Vote reminders', desc: 'Reminders before voting ends', enabled: true },
                    { label: 'Results announcements', desc: 'When proposals pass or fail', enabled: true },
                    { label: 'Weekly digest', desc: 'Summary of DAO activity', enabled: false },
                  ].map((setting) => (
                    <div key={setting.label} className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: 'rgba(50, 58, 96, 0.5)' }}>
                      <div>
                        <p className="text-white text-sm">{setting.label}</p>
                        <p className="text-xs" style={{ color: '#a1a1aa' }}>{setting.desc}</p>
                      </div>
                      <div
                        className="w-10 h-6 rounded-full relative cursor-pointer transition-colors"
                        style={{ backgroundColor: setting.enabled ? '#22c55e' : 'rgba(255,255,255,0.2)' }}
                      >
                        <div
                          className="absolute top-1 w-4 h-4 rounded-full bg-white transition-all"
                          style={{ left: setting.enabled ? '22px' : '4px' }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Push Notifications */}
              <div className="mt-6">
                <h4 className="text-white font-medium text-sm mb-3">Push Notifications</h4>
                <div className="space-y-2">
                  {[
                    { label: 'Browser notifications', desc: 'Show desktop notifications', enabled: false },
                    { label: 'Mobile push', desc: 'Notifications on your phone', enabled: false },
                  ].map((setting) => (
                    <div key={setting.label} className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: 'rgba(50, 58, 96, 0.5)' }}>
                      <div>
                        <p className="text-white text-sm">{setting.label}</p>
                        <p className="text-xs" style={{ color: '#a1a1aa' }}>{setting.desc}</p>
                      </div>
                      <div
                        className="w-10 h-6 rounded-full relative cursor-pointer transition-colors"
                        style={{ backgroundColor: setting.enabled ? '#22c55e' : 'rgba(255,255,255,0.2)' }}
                      >
                        <div
                          className="absolute top-1 w-4 h-4 rounded-full bg-white transition-all"
                          style={{ left: setting.enabled ? '22px' : '4px' }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function DAOListPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<DAOStatus | 'all'>('all')
  const [showNetworkOnly, setShowNetworkOnly] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'proposals' | 'discussions'>('overview')
  const [activeSidebarPanel, setActiveSidebarPanel] = useState<string | null>(null)

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

        {/* Bottom button */}
        <div className="absolute left-8 sm:left-28 bottom-[76px]">
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
          <img src="/autoline.png" alt="" className="w-full h-[12px] object-cover" />

          {/* Your DAOs Section */}
          <div>
            <h3 className="text-white font-semibold mb-3">Your DAOs</h3>
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
            <div className="px-7 pb-5 flex justify-between">
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
          </div>

          {/* Navigation Links */}
          <nav className="flex gap-2" aria-label="Sidebar navigation">
            <button
              type="button"
              onClick={() => setActiveSidebarPanel(activeSidebarPanel === 'settings' ? null : 'settings')}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-white font-medium transition-all hover:brightness-110"
              style={{
                backgroundColor: activeSidebarPanel === 'settings' ? 'rgba(107, 33, 168, 0.6)' : 'rgba(50, 58, 96, 0.8)',
                border: activeSidebarPanel === 'settings' ? '2px solid rgb(139, 92, 246)' : '2px solid rgb(84, 100, 183)',
                boxShadow: 'inset 0 -4px 0 rgb(71, 79, 81)',
              }}
            >
              <Settings className="w-5 h-5" aria-hidden="true" />
              Settings
            </button>
            <button
              type="button"
              onClick={() => setActiveSidebarPanel(activeSidebarPanel === 'report-bug' ? null : 'report-bug')}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-white font-medium transition-all hover:brightness-110"
              style={{
                backgroundColor: activeSidebarPanel === 'report-bug' ? 'rgba(107, 33, 168, 0.6)' : 'rgba(50, 58, 96, 0.8)',
                border: activeSidebarPanel === 'report-bug' ? '2px solid rgb(139, 92, 246)' : '2px solid rgb(84, 100, 183)',
                boxShadow: 'inset 0 -4px 0 rgb(71, 79, 81)',
              }}
            >
              <Bug className="w-5 h-5" aria-hidden="true" />
              Report Bug
            </button>
          </nav>

          {/* Settings Popup */}
          {activeSidebarPanel === 'settings' && (
            <SettingsPopup onClose={() => setActiveSidebarPanel(null)} />
          )}

          {/* Report Bug Popup */}
          {activeSidebarPanel === 'report-bug' && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}>
              <div
                className="w-full max-w-md rounded-2xl p-6"
                style={{
                  backgroundColor: '#1e1d32',
                  border: '1px solid rgb(121, 125, 245)',
                  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                }}
              >
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-white">Report A Bug</h2>
                  <button
                    type="button"
                    onClick={() => setActiveSidebarPanel(null)}
                    className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                  >
                    <XCircle className="w-5 h-5 text-white" />
                  </button>
                </div>
                <div className="space-y-4">
                  <input
                    type="text"
                    placeholder="Bug title..."
                    className="w-full px-4 py-3 rounded-lg text-white text-sm placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-purple-500"
                    style={{ backgroundColor: 'rgba(50, 58, 96, 0.5)', border: '1px solid rgba(139, 92, 246, 0.3)' }}
                  />
                  <textarea
                    placeholder="Describe the bug..."
                    rows={4}
                    className="w-full px-4 py-3 rounded-lg text-white text-sm placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                    style={{ backgroundColor: 'rgba(50, 58, 96, 0.5)', border: '1px solid rgba(139, 92, 246, 0.3)' }}
                  />
                  <button
                    type="button"
                    className="w-full px-4 py-3 rounded-lg text-white font-semibold transition-all hover:brightness-110"
                    style={{ background: 'linear-gradient(135deg, #dc2626, #ef4444)' }}
                  >
                    Submit Report
                  </button>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* Main Content */}
        <section className="flex-1 min-w-0 space-y-6">
          {activeTab === 'overview' && (
            <>
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
          <div className="flex gap-5 flex-wrap">
            {/* Explore DAOs Card */}
            <div
              className="rounded-[13px] p-6 relative overflow-hidden shrink-0"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.2)',
                backdropFilter: 'blur(8px)',
                height: '305px',
                width: '380px',
              }}
            >
              {/* Poptart mascot on left */}
              <div className="absolute left-7 top-10">
                <img src="/poptart.png" alt="" className="w-[120px] h-[124px] object-contain" />
              </div>
              {/* Content on right */}
              <div className="absolute left-[160px] top-10 right-6">
                <h3 className="text-white text-lg font-semibold mb-3">Explore DAOs</h3>
                <p
                  className="text-sm leading-relaxed max-w-[280px]"
                  style={{
                    background: 'linear-gradient(to bottom, #eeeeee 0%, #b4b2ae 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  DAOs are like chat groups, except you're able to crowdfund, vote, build, and interact with each other in a decentralized environment.
                </p>
              </div>
              {/* Bottom CTA button */}
              <Link
                to="/explore"
                className="absolute bottom-6 left-6 right-6 flex items-center justify-center px-5 py-3 rounded-lg text-white font-semibold transition-all hover:brightness-110"
                style={{
                  backgroundColor: '#7b61ff',
                  border: '2px solid black',
                  boxShadow: '0 4px 0 black',
                }}
              >
                Explore DAOs
              </Link>
            </div>

            {/* Right column with two stacked cards */}
            <div className="flex flex-col gap-5 flex-1 min-w-[200px]">
              {/* Create Your DAO Card */}
              <div
                className="rounded-xl p-5 flex flex-col flex-1"
                style={{
                  backgroundColor: 'rgba(131, 138, 168, 0.25)',
                  border: '1px solid rgb(121, 125, 245)',
                  boxShadow: '0 4px 0 black',
                  backdropFilter: 'blur(24px)',
                }}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: 'rgba(180, 130, 20, 0.3)', border: '1px solid rgba(234, 179, 8, 0.4)' }}
                  >
                    <Sparkles className="w-5 h-5" style={{ color: '#eab308' }} aria-hidden="true" />
                  </div>
                  <h3 className="text-white font-semibold">Create Your DAO</h3>
                </div>
                <p className="text-xs leading-relaxed mb-3 flex-1" style={{ color: '#cdcdcd' }}>
                  Launch your own decentralized organization with AI-powered governance.
                </p>
                <Link
                  to="/create"
                  className="inline-flex items-center justify-center gap-2 w-full px-4 py-2 rounded-lg text-white text-sm font-semibold transition-all hover:brightness-110"
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
                className="rounded-xl p-5 flex flex-col flex-1"
                style={{
                  backgroundColor: 'rgba(131, 138, 168, 0.25)',
                  border: '1px solid rgb(121, 125, 245)',
                  boxShadow: '0 4px 0 black',
                  backdropFilter: 'blur(24px)',
                }}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: 'rgba(22, 163, 74, 0.3)', border: '1px solid rgba(74, 222, 128, 0.4)' }}
                  >
                    <GraduationCap className="w-5 h-5" style={{ color: '#4ade80' }} aria-hidden="true" />
                  </div>
                  <h3 className="text-white font-semibold">Education</h3>
                </div>
                <p className="text-xs leading-relaxed mb-3 flex-1" style={{ color: '#cdcdcd' }}>
                  Learn about DAOs, governance, and decentralized coordination.
                </p>
                <Link
                  to="/education"
                  className="inline-flex items-center justify-center gap-2 w-full px-4 py-2 rounded-lg text-white text-sm font-semibold transition-all hover:brightness-110"
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
          </div>

          {/* Top Agents This Week */}
          <div
            className="rounded-[10px] p-4"
            style={{ backgroundColor: 'transparent' }}
          >
            <h2 className="text-white font-semibold mb-5 px-1">Top Agents This Week</h2>
            <div className="flex gap-0 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
              {[
                { rank: 1, name: 'Eliza', pnl: '200+ (243% PNL)', color: '#8b5cf6', image: '/agents/eliza.png' },
                { rank: 2, name: 'Sponge', pnl: '400+ (133% PNL)', color: '#6366f1', image: '/agents/sponge.png' },
                { rank: 3, name: 'Jubi', pnl: '800+ (533% PNL)', color: '#818cf8', image: '/agents/jubi.png' },
                { rank: 4, name: 'Big Boy', pnl: '800+ (533% PNL)', color: '#7c3aed', image: '/agents/bigboy.png' },
                { rank: 5, name: 'Zhibti', pnl: '800+ (533% PNL)', color: '#a78bfa', image: '/agents/zhibti.png' },
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
                    {/* Agent image */}
                    <img
                      src={agent.image}
                      alt={agent.name}
                      className="absolute inset-0 w-full h-full object-cover object-top"
                    />
                    {/* Gradient overlay for text readability */}
                    <div
                      className="absolute inset-0"
                      style={{
                        background: 'linear-gradient(to bottom, transparent 50%, #726fe8 100%)',
                      }}
                    />
                    {/* Text overlay at bottom */}
                    <div className="absolute bottom-0 left-0 right-0 px-3 pb-4 pt-8">
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
            </>
          )}

          {activeTab === 'proposals' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-white text-lg font-semibold">Active Proposals</h2>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-semibold transition-all hover:brightness-110"
                  style={{
                    backgroundColor: 'rgba(50, 58, 96, 0.8)',
                    border: '2px solid rgb(84, 100, 183)',
                    boxShadow: 'inset 0 -4px 0 rgb(71, 79, 81)',
                  }}
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  New Proposal
                </button>
              </div>

              {/* Dummy Proposals */}
              {[
                {
                  id: 1,
                  title: 'Implement Cross-Chain Bridge for Token Transfers',
                  description: 'Proposal to integrate a cross-chain bridge enabling seamless token transfers between Ethereum, Polygon, and Arbitrum networks.',
                  status: 'active',
                  votesFor: 1243,
                  votesAgainst: 456,
                  endTime: '2 days left',
                  author: 'vitalik.eth',
                },
                {
                  id: 2,
                  title: 'Treasury Diversification into Stablecoins',
                  description: 'Allocate 30% of treasury funds into a mix of USDC, DAI, and FRAX to reduce volatility exposure during market downturns.',
                  status: 'active',
                  votesFor: 892,
                  votesAgainst: 234,
                  endTime: '5 days left',
                  author: 'treasury.dao',
                },
                {
                  id: 3,
                  title: 'Governance Token Staking Rewards Program',
                  description: 'Launch a staking program offering 12% APY for governance token holders who lock tokens for a minimum of 6 months.',
                  status: 'passed',
                  votesFor: 2341,
                  votesAgainst: 123,
                  endTime: 'Ended',
                  author: 'defi.wizard',
                },
                {
                  id: 4,
                  title: 'On-Chain Voting Gas Subsidies',
                  description: 'Implement meta-transactions to subsidize gas fees for on-chain voting, increasing participation from smaller token holders.',
                  status: 'active',
                  votesFor: 567,
                  votesAgainst: 789,
                  endTime: '1 day left',
                  author: 'gas.optimizer',
                },
                {
                  id: 5,
                  title: 'Decentralized Oracle Integration for Price Feeds',
                  description: 'Integrate Chainlink oracles for reliable price feeds to power automated treasury rebalancing and proposal execution.',
                  status: 'rejected',
                  votesFor: 234,
                  votesAgainst: 1567,
                  endTime: 'Ended',
                  author: 'oracle.node',
                },
              ].map((proposal) => (
                <div
                  key={proposal.id}
                  className="rounded-xl p-5 cursor-pointer transition-all hover:brightness-110"
                  style={{
                    backgroundColor: 'rgba(131, 138, 168, 0.25)',
                    border: '1px solid rgb(121, 125, 245)',
                    boxShadow: '0 4px 0 black',
                    backdropFilter: 'blur(24px)',
                  }}
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <h3 className="text-white font-semibold">{proposal.title}</h3>
                    <span
                      className="shrink-0 px-3 py-1 text-xs font-semibold rounded-full flex items-center gap-1"
                      style={{
                        backgroundColor:
                          proposal.status === 'active'
                            ? 'rgba(34, 197, 94, 0.2)'
                            : proposal.status === 'passed'
                            ? 'rgba(59, 130, 246, 0.2)'
                            : 'rgba(239, 68, 68, 0.2)',
                        color:
                          proposal.status === 'active'
                            ? '#4ade80'
                            : proposal.status === 'passed'
                            ? '#60a5fa'
                            : '#f87171',
                      }}
                    >
                      {proposal.status === 'active' && <Clock className="w-3 h-3" />}
                      {proposal.status === 'passed' && <CheckCircle2 className="w-3 h-3" />}
                      {proposal.status === 'rejected' && <XCircle className="w-3 h-3" />}
                      {proposal.status.charAt(0).toUpperCase() + proposal.status.slice(1)}
                    </span>
                  </div>
                  <p className="text-sm mb-4" style={{ color: '#cdcdcd' }}>
                    {proposal.description}
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5 text-sm" style={{ color: '#4ade80' }}>
                        <ThumbsUp className="w-4 h-4" />
                        <span>{proposal.votesFor.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-sm" style={{ color: '#f87171' }}>
                        <ThumbsDown className="w-4 h-4" />
                        <span>{proposal.votesAgainst.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs" style={{ color: '#a1a1aa' }}>
                      <span>by {proposal.author}</span>
                      <span>·</span>
                      <span>{proposal.endTime}</span>
                    </div>
                  </div>
                  {/* Vote progress bar */}
                  <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(proposal.votesFor / (proposal.votesFor + proposal.votesAgainst)) * 100}%`,
                        background: 'linear-gradient(90deg, #4ade80 0%, #22c55e 100%)',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'discussions' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-white text-lg font-semibold">DAO Discussions</h2>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-semibold transition-all hover:brightness-110"
                  style={{
                    backgroundColor: 'rgba(50, 58, 96, 0.8)',
                    border: '2px solid rgb(84, 100, 183)',
                    boxShadow: 'inset 0 -4px 0 rgb(71, 79, 81)',
                  }}
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  Start Discussion
                </button>
              </div>

              {/* DAO Selector */}
              <div
                className="rounded-xl p-4"
                style={{
                  backgroundColor: 'rgba(71, 77, 120, 0.5)',
                  border: '1px solid rgba(171, 171, 233, 0.4)',
                  backdropFilter: 'blur(24px)',
                }}
              >
                <p className="text-sm mb-2" style={{ color: '#cdcdcd' }}>Selected DAO</p>
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ background: 'linear-gradient(135deg, #6b21a8, #7c3aed)' }}
                  >
                    <Building2 className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-white font-semibold">Autocrat DAO</p>
                    <p className="text-xs" style={{ color: '#a1a1aa' }}>128 members · 23 active discussions</p>
                  </div>
                </div>
              </div>

              {/* Discussion threads */}
              {[
                {
                  id: 1,
                  title: 'Best practices for proposal drafting',
                  preview: 'I think we should establish a template for all future proposals to ensure consistency and clarity...',
                  author: 'governance.lead',
                  replies: 24,
                  lastActive: '2 hours ago',
                  pinned: true,
                },
                {
                  id: 2,
                  title: 'Weekly Community Call - Agenda Items',
                  preview: 'Please add your agenda items for this week\'s community call. We\'ll be discussing the treasury report and...',
                  author: 'community.mod',
                  replies: 18,
                  lastActive: '4 hours ago',
                  pinned: true,
                },
                {
                  id: 3,
                  title: 'Thoughts on the new staking proposal?',
                  preview: 'I\'ve been reviewing the staking rewards program and have some concerns about the tokenomics...',
                  author: 'token.analyst',
                  replies: 42,
                  lastActive: '1 day ago',
                  pinned: false,
                },
                {
                  id: 4,
                  title: 'Introducing myself - New member',
                  preview: 'Hey everyone! I just joined the DAO and wanted to introduce myself. I\'m a developer with 5 years of...',
                  author: 'newbie.dev',
                  replies: 12,
                  lastActive: '2 days ago',
                  pinned: false,
                },
                {
                  id: 5,
                  title: 'Feedback on the governance dashboard',
                  preview: 'The new dashboard looks great! A few suggestions for improvement: 1) Add filtering by proposal status...',
                  author: 'ux.designer',
                  replies: 8,
                  lastActive: '3 days ago',
                  pinned: false,
                },
              ].map((thread) => (
                <div
                  key={thread.id}
                  className="rounded-xl p-5 cursor-pointer transition-all hover:brightness-110"
                  style={{
                    backgroundColor: 'rgba(131, 138, 168, 0.25)',
                    border: thread.pinned ? '1px solid rgba(234, 179, 8, 0.5)' : '1px solid rgb(121, 125, 245)',
                    boxShadow: '0 4px 0 black',
                    backdropFilter: 'blur(24px)',
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold text-white"
                      style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                    >
                      {thread.author.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {thread.pinned && (
                          <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'rgba(234, 179, 8, 0.2)', color: '#eab308' }}>
                            Pinned
                          </span>
                        )}
                        <h3 className="text-white font-semibold truncate">{thread.title}</h3>
                      </div>
                      <p className="text-sm mb-3 line-clamp-2" style={{ color: '#cdcdcd' }}>
                        {thread.preview}
                      </p>
                      <div className="flex items-center gap-4 text-xs" style={{ color: '#a1a1aa' }}>
                        <span>@{thread.author}</span>
                        <div className="flex items-center gap-1">
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>{thread.replies} replies</span>
                        </div>
                        <span>{thread.lastActive}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
