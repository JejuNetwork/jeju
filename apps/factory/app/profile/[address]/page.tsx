/**
 * User/Organization Profile Page
 * Dework-like profile with contributions, bounties, repos
 */

'use client'

import { clsx } from 'clsx'
import {
  Building2,
  Calendar,
  CheckCircle,
  Clock,
  DollarSign,
  Edit2,
  GitBranch,
  Link as LinkIcon,
  MapPin,
  MessageSquare,
  Shield,
  Star,
  Trophy,
  Twitter,
  User,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { useAccount } from 'wagmi'

type ProfileTab =
  | 'overview'
  | 'bounties'
  | 'repositories'
  | 'contributions'
  | 'teams'

interface ProfileData {
  address: string
  name: string
  type: 'user' | 'org'
  avatar: string
  bio: string
  location?: string
  website?: string
  twitter?: string
  farcaster?: string
  joinedAt: number
  stats: {
    repositories: number
    bounties: number
    contributions: number
    stars: number
    followers: number
    following: number
  }
  reputation: {
    score: number
    tier: 'bronze' | 'silver' | 'gold' | 'diamond'
    badges: string[]
  }
  skills: string[]
  isGuardian: boolean
}

const mockProfile: ProfileData = {
  address: '0x1234...5678',
  name: 'alice.eth',
  type: 'user',
  avatar: 'https://avatars.githubusercontent.com/u/1?v=4',
  bio: 'Full-stack developer passionate about Web3 and decentralized systems. Building the future of developer coordination.',
  location: 'San Francisco, CA',
  website: 'https://alice.dev',
  twitter: 'alice_dev',
  farcaster: 'alice',
  joinedAt: Date.now() - 365 * 24 * 60 * 60 * 1000,
  stats: {
    repositories: 23,
    bounties: 15,
    contributions: 342,
    stars: 567,
    followers: 234,
    following: 89,
  },
  reputation: {
    score: 4250,
    tier: 'gold',
    badges: ['Early Adopter', 'Bug Hunter', 'Top Contributor', 'Guardian'],
  },
  skills: [
    'Solidity',
    'TypeScript',
    'React',
    'Node.js',
    'Rust',
    'Smart Contracts',
  ],
  isGuardian: true,
}

const mockBounties = [
  {
    id: '1',
    title: 'Implement multi-token rewards for BountyRegistry',
    status: 'completed',
    reward: '2.5 ETH',
    completedAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
  },
  {
    id: '2',
    title: 'Security audit for GuardianRegistry contract',
    status: 'in_progress',
    reward: '5 ETH',
  },
  {
    id: '3',
    title: 'Add IPFS integration to model hub',
    status: 'completed',
    reward: '1.5 ETH',
    completedAt: Date.now() - 14 * 24 * 60 * 60 * 1000,
  },
]

const mockRepos = [
  {
    name: 'jeju-contracts',
    fullName: 'alice/jeju-contracts',
    description: 'Smart contract implementations for Jeju protocol',
    language: 'Solidity',
    stars: 89,
    forks: 12,
    updatedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
  },
  {
    name: 'ml-models',
    fullName: 'alice/ml-models',
    description: 'Machine learning models for code analysis',
    language: 'Python',
    stars: 156,
    forks: 34,
    updatedAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
  },
]

const tierColors = {
  bronze: 'text-amber-600 bg-amber-600/20',
  silver: 'text-gray-400 bg-gray-400/20',
  gold: 'text-amber-400 bg-amber-400/20',
  diamond: 'text-cyan-400 bg-cyan-400/20',
}

const languageColors: Record<string, string> = {
  Solidity: 'bg-purple-400',
  TypeScript: 'bg-blue-400',
  Python: 'bg-yellow-400',
  JavaScript: 'bg-yellow-300',
  Rust: 'bg-orange-400',
}

export default function ProfilePage() {
  const params = useParams()
  const address = params.address as string
  const { address: connectedAddress, isConnected } = useAccount()
  const [tab, setTab] = useState<ProfileTab>('overview')

  const profile = mockProfile
  const isOwnProfile =
    isConnected && connectedAddress?.toLowerCase() === address.toLowerCase()

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
    })
  }

  const formatNumber = (num: number) => {
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`
    return num.toString()
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-factory-800 bg-factory-900/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
          <div className="flex flex-col sm:flex-row gap-6">
            {/* Avatar */}
            <div className="flex-shrink-0">
              <img
                src={profile.avatar}
                alt={profile.name}
                className="w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 border-factory-800"
              />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold text-factory-100">
                      {profile.name}
                    </h1>
                    {profile.isGuardian && (
                      <span className="badge bg-purple-500/20 text-purple-400 border border-purple-500/30">
                        <Shield className="w-3 h-3 mr-1" />
                        Guardian
                      </span>
                    )}
                  </div>
                  <p className="text-factory-500 font-mono text-sm mt-1">
                    {profile.address}
                  </p>
                </div>

                {isOwnProfile ? (
                  <Link
                    href="/settings/profile"
                    className="btn btn-secondary text-sm"
                  >
                    <Edit2 className="w-4 h-4" />
                    Edit Profile
                  </Link>
                ) : (
                  <div className="flex gap-2">
                    <button className="btn btn-primary text-sm">Follow</button>
                    <button className="btn btn-secondary text-sm">
                      <MessageSquare className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              <p className="text-factory-300 mt-3 max-w-2xl">{profile.bio}</p>

              {/* Meta */}
              <div className="flex flex-wrap items-center gap-4 mt-4 text-sm text-factory-500">
                {profile.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-4 h-4" />
                    {profile.location}
                  </span>
                )}
                {profile.website && (
                  <a
                    href={profile.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 hover:text-accent-400"
                  >
                    <LinkIcon className="w-4 h-4" />
                    {profile.website.replace('https://', '')}
                  </a>
                )}
                {profile.twitter && (
                  <a
                    href={`https://twitter.com/${profile.twitter}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 hover:text-accent-400"
                  >
                    <Twitter className="w-4 h-4" />@{profile.twitter}
                  </a>
                )}
                <span className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  Joined {formatDate(profile.joinedAt)}
                </span>
              </div>

              {/* Stats */}
              <div className="flex flex-wrap items-center gap-4 mt-4 text-sm">
                <span className="text-factory-300">
                  <strong>{formatNumber(profile.stats.followers)}</strong>
                  <span className="text-factory-500 ml-1">followers</span>
                </span>
                <span className="text-factory-300">
                  <strong>{formatNumber(profile.stats.following)}</strong>
                  <span className="text-factory-500 ml-1">following</span>
                </span>
                <span className="text-factory-300">
                  <strong>{formatNumber(profile.stats.stars)}</strong>
                  <span className="text-factory-500 ml-1">stars earned</span>
                </span>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-6 overflow-x-auto -mb-px">
            {[
              {
                id: 'overview' as const,
                label: 'Overview',
                icon: User,
                count: undefined,
              },
              {
                id: 'bounties' as const,
                label: 'Bounties',
                icon: DollarSign,
                count: profile.stats.bounties,
              },
              {
                id: 'repositories' as const,
                label: 'Repositories',
                icon: GitBranch,
                count: profile.stats.repositories,
              },
              {
                id: 'contributions' as const,
                label: 'Contributions',
                icon: Trophy,
                count: undefined,
              },
              {
                id: 'teams' as const,
                label: 'Teams',
                icon: Users,
                count: undefined,
              },
            ].map(({ id, label, icon: Icon, count }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  tab === id
                    ? 'border-accent-500 text-accent-400'
                    : 'border-transparent text-factory-400 hover:text-factory-100 hover:border-factory-600',
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
                {count !== undefined && (
                  <span className="px-1.5 py-0.5 text-xs rounded-full bg-factory-800">
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-6">
            {/* Reputation */}
            <div className="card p-6">
              <h3 className="font-semibold text-factory-100 mb-4 flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-400" />
                Reputation
              </h3>
              <div className="flex items-center gap-3 mb-4">
                <div
                  className={clsx(
                    'px-3 py-1 rounded-full font-semibold capitalize',
                    tierColors[profile.reputation.tier],
                  )}
                >
                  {profile.reputation.tier}
                </div>
                <span className="text-2xl font-bold text-factory-100">
                  {profile.reputation.score.toLocaleString()}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {profile.reputation.badges.map((badge) => (
                  <span key={badge} className="badge badge-info">
                    {badge}
                  </span>
                ))}
              </div>
            </div>

            {/* Skills */}
            <div className="card p-6">
              <h3 className="font-semibold text-factory-100 mb-4">Skills</h3>
              <div className="flex flex-wrap gap-2">
                {profile.skills.map((skill) => (
                  <span
                    key={skill}
                    className="badge bg-factory-800 text-factory-300 border border-factory-700"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>

            {/* Organizations */}
            <div className="card p-6">
              <h3 className="font-semibold text-factory-100 mb-4 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-factory-400" />
                Organizations
              </h3>
              <div className="flex flex-wrap gap-2">
                {['Jeju Network', 'DeFi Alliance', 'Security DAO'].map(
                  (org) => (
                    <Link
                      key={org}
                      href={`/org/${org.toLowerCase().replace(' ', '-')}`}
                      className="flex items-center gap-2 p-2 rounded-lg hover:bg-factory-800 transition-colors"
                    >
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-500 to-purple-500 flex items-center justify-center text-white font-bold">
                        {org[0]}
                      </div>
                      <span className="text-sm text-factory-300">{org}</span>
                    </Link>
                  ),
                )}
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {tab === 'overview' && (
              <>
                {/* Pinned Repos */}
                <div>
                  <h3 className="font-semibold text-factory-100 mb-4">
                    Pinned Repositories
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {mockRepos.map((repo) => (
                      <Link
                        key={repo.fullName}
                        href={`/git/${repo.fullName}`}
                        className="card p-4 card-hover"
                      >
                        <div className="flex items-start gap-2 mb-2">
                          <GitBranch className="w-4 h-4 text-factory-400 mt-0.5" />
                          <span className="font-medium text-accent-400 hover:underline">
                            {repo.name}
                          </span>
                        </div>
                        <p className="text-factory-400 text-sm mb-3 line-clamp-2">
                          {repo.description}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-factory-500">
                          <span className="flex items-center gap-1">
                            <span
                              className={clsx(
                                'w-3 h-3 rounded-full',
                                languageColors[repo.language] || 'bg-gray-400',
                              )}
                            />
                            {repo.language}
                          </span>
                          <span className="flex items-center gap-1">
                            <Star className="w-3 h-3" />
                            {repo.stars}
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>

                {/* Recent Activity */}
                <div>
                  <h3 className="font-semibold text-factory-100 mb-4">
                    Recent Bounties
                  </h3>
                  <div className="card divide-y divide-factory-800">
                    {mockBounties.map((bounty) => (
                      <Link
                        key={bounty.id}
                        href={`/bounties/${bounty.id}`}
                        className="flex items-center gap-4 p-4 hover:bg-factory-800/50 transition-colors"
                      >
                        {bounty.status === 'completed' ? (
                          <CheckCircle className="w-5 h-5 text-green-400" />
                        ) : (
                          <Clock className="w-5 h-5 text-amber-400" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-factory-100 truncate">
                            {bounty.title}
                          </p>
                          <p className="text-factory-500 text-sm">
                            {bounty.reward}
                          </p>
                        </div>
                        <span
                          className={clsx(
                            'badge',
                            bounty.status === 'completed' && 'badge-success',
                            bounty.status === 'in_progress' && 'badge-warning',
                          )}
                        >
                          {bounty.status.replace('_', ' ')}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              </>
            )}

            {tab === 'bounties' && (
              <div className="card divide-y divide-factory-800">
                {mockBounties.map((bounty) => (
                  <Link
                    key={bounty.id}
                    href={`/bounties/${bounty.id}`}
                    className="flex items-center gap-4 p-4 hover:bg-factory-800/50 transition-colors"
                  >
                    {bounty.status === 'completed' ? (
                      <CheckCircle className="w-5 h-5 text-green-400" />
                    ) : (
                      <Clock className="w-5 h-5 text-amber-400" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-factory-100 truncate">
                        {bounty.title}
                      </p>
                      <p className="text-factory-500 text-sm">
                        {bounty.reward}
                      </p>
                    </div>
                    <span
                      className={clsx(
                        'badge',
                        bounty.status === 'completed' && 'badge-success',
                        bounty.status === 'in_progress' && 'badge-warning',
                      )}
                    >
                      {bounty.status.replace('_', ' ')}
                    </span>
                  </Link>
                ))}
              </div>
            )}

            {tab === 'repositories' && (
              <div className="space-y-4">
                {mockRepos.map((repo) => (
                  <Link
                    key={repo.fullName}
                    href={`/git/${repo.fullName}`}
                    className="card p-6 card-hover block"
                  >
                    <div className="flex items-start gap-3 mb-2">
                      <GitBranch className="w-5 h-5 text-factory-400 mt-0.5" />
                      <div className="flex-1">
                        <span className="font-semibold text-accent-400 hover:underline">
                          {repo.name}
                        </span>
                        <p className="text-factory-400 text-sm mt-1">
                          {repo.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 mt-3 text-sm text-factory-500">
                      <span className="flex items-center gap-1">
                        <span
                          className={clsx(
                            'w-3 h-3 rounded-full',
                            languageColors[repo.language] || 'bg-gray-400',
                          )}
                        />
                        {repo.language}
                      </span>
                      <span className="flex items-center gap-1">
                        <Star className="w-4 h-4" />
                        {repo.stars}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {tab === 'contributions' && (
              <div className="card p-6">
                <h3 className="font-semibold text-factory-100 mb-4">
                  Contribution Graph
                </h3>
                <div className="grid grid-cols-52 gap-1">
                  {Array.from({ length: 365 }).map((_, i) => (
                    <div
                      key={i}
                      className={clsx(
                        'w-3 h-3 rounded-sm',
                        Math.random() > 0.7
                          ? 'bg-green-500'
                          : Math.random() > 0.5
                            ? 'bg-green-700'
                            : Math.random() > 0.3
                              ? 'bg-green-900'
                              : 'bg-factory-800',
                      )}
                    />
                  ))}
                </div>
                <p className="text-factory-500 text-sm mt-4">
                  {profile.stats.contributions} contributions in the last year
                </p>
              </div>
            )}

            {tab === 'teams' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  'Jeju Core',
                  'Security Team',
                  'Frontend',
                  'Smart Contracts',
                ].map((team) => (
                  <div key={team} className="card p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-accent-500 to-purple-500 flex items-center justify-center text-white font-bold">
                        {team[0]}
                      </div>
                      <div>
                        <p className="font-medium text-factory-100">{team}</p>
                        <p className="text-factory-500 text-sm">12 members</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
