/**
 * User/Organization Profile Page
 * Shows contributions, bounties, repos from real data
 */

'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useAccount } from 'wagmi';
import {
  User,
  Building2,
  GitBranch,
  DollarSign,
  Star,
  Trophy,
  Calendar,
  MapPin,
  Link as LinkIcon,
  Twitter,
  MessageSquare,
  Shield,
  CheckCircle,
  Clock,
  Users,
  Edit2,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { useProfile, type ProfileData, type ProfileBounty, type ProfileRepo } from '../../../hooks/useProfile';
import type { Address } from 'viem';

type ProfileTab = 'overview' | 'bounties' | 'repositories' | 'contributions' | 'teams';

const tierColors = {
  bronze: 'text-amber-600 bg-amber-600/20',
  silver: 'text-gray-400 bg-gray-400/20',
  gold: 'text-amber-400 bg-amber-400/20',
  diamond: 'text-cyan-400 bg-cyan-400/20',
};

const languageColors: Record<string, string> = {
  Solidity: 'bg-purple-400',
  TypeScript: 'bg-blue-400',
  Python: 'bg-yellow-400',
  JavaScript: 'bg-yellow-300',
  Rust: 'bg-orange-400',
};

export default function ProfilePage() {
  const params = useParams();
  const address = params.address as string;
  const { address: connectedAddress, isConnected } = useAccount();
  const [tab, setTab] = useState<ProfileTab>('overview');
  
  // Fetch real data
  const { profile, bounties, repos, isLoading } = useProfile(address as Address);
  
  const isOwnProfile = isConnected && connectedAddress?.toLowerCase() === address.toLowerCase();

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

  const formatNumber = (num: number) => {
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toString();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent-400" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <User className="w-16 h-16 mx-auto mb-4 text-factory-600" />
          <h2 className="text-xl font-semibold text-factory-300 mb-2">Profile not found</h2>
          <p className="text-factory-500">This address hasn&apos;t registered as a contributor yet.</p>
          {isOwnProfile && (
            <Link href="/contributors" className="btn btn-primary mt-4">
              Register as Contributor
            </Link>
          )}
        </div>
      </div>
    );
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
                    <h1 className="text-2xl font-bold text-factory-100">{profile.name}</h1>
                    {profile.isGuardian && (
                      <span className="badge bg-purple-500/20 text-purple-400 border border-purple-500/30">
                        <Shield className="w-3 h-3 mr-1" />
                        Guardian
                      </span>
                    )}
                    {profile.isContributor && (
                      <span className="badge bg-green-500/20 text-green-400 border border-green-500/30">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Contributor
                      </span>
                    )}
                  </div>
                  <p className="text-factory-500 font-mono text-sm mt-1">{profile.address}</p>
                </div>
                
                {isOwnProfile ? (
                  <Link href="/settings/profile" className="btn btn-secondary text-sm">
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

              {profile.bio && (
                <p className="text-factory-300 mt-3 max-w-2xl">{profile.bio}</p>
              )}

              {/* Meta */}
              <div className="flex flex-wrap items-center gap-4 mt-4 text-sm text-factory-500">
                {profile.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-4 h-4" />
                    {profile.location}
                  </span>
                )}
                {profile.website && (
                  <a href={profile.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-accent-400">
                    <LinkIcon className="w-4 h-4" />
                    {profile.website.replace('https://', '')}
                  </a>
                )}
                {profile.twitter && (
                  <a href={`https://twitter.com/${profile.twitter}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-accent-400">
                    <Twitter className="w-4 h-4" />
                    @{profile.twitter}
                  </a>
                )}
                {profile.github && (
                  <a href={`https://github.com/${profile.github}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-accent-400">
                    <GitBranch className="w-4 h-4" />
                    {profile.github}
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
            {([
              { id: 'overview' as const, label: 'Overview', icon: User, count: undefined },
              { id: 'bounties' as const, label: 'Bounties', icon: DollarSign, count: profile.stats.bounties },
              { id: 'repositories' as const, label: 'Repositories', icon: GitBranch, count: profile.stats.repositories },
              { id: 'contributions' as const, label: 'Contributions', icon: Trophy, count: undefined },
              { id: 'teams' as const, label: 'Teams', icon: Users, count: undefined },
            ]).map(({ id, label, icon: Icon, count }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  tab === id
                    ? 'border-accent-500 text-accent-400'
                    : 'border-transparent text-factory-400 hover:text-factory-100 hover:border-factory-600'
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
                {count !== undefined && count > 0 && (
                  <span className="px-1.5 py-0.5 text-xs rounded-full bg-factory-800">{count}</span>
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
                <div className={clsx(
                  'px-3 py-1 rounded-full font-semibold capitalize',
                  tierColors[profile.reputation.tier]
                )}>
                  {profile.reputation.tier}
                </div>
                <span className="text-2xl font-bold text-factory-100">
                  {profile.reputation.score.toLocaleString()}
                </span>
              </div>
              {profile.reputation.badges.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {profile.reputation.badges.map((badge) => (
                    <span key={badge} className="badge badge-info">
                      {badge}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Skills */}
            {profile.skills.length > 0 && (
              <div className="card p-6">
                <h3 className="font-semibold text-factory-100 mb-4">Skills</h3>
                <div className="flex flex-wrap gap-2">
                  {profile.skills.map((skill) => (
                    <span key={skill} className="badge bg-factory-800 text-factory-300 border border-factory-700">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Organizations */}
            <div className="card p-6">
              <h3 className="font-semibold text-factory-100 mb-4 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-factory-400" />
                Organizations
              </h3>
              <p className="text-factory-500 text-sm">No organizations yet</p>
            </div>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {tab === 'overview' && (
              <>
                {/* Pinned Repos */}
                {repos.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-factory-100 mb-4">Pinned Repositories</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {repos.slice(0, 4).map((repo) => (
                        <RepoCard key={repo.fullName} repo={repo} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent Activity */}
                {bounties.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-factory-100 mb-4">Recent Bounties</h3>
                    <div className="card divide-y divide-factory-800">
                      {bounties.slice(0, 5).map((bounty) => (
                        <BountyItem key={bounty.id} bounty={bounty} />
                      ))}
                    </div>
                  </div>
                )}

                {repos.length === 0 && bounties.length === 0 && (
                  <div className="card p-8 text-center">
                    <User className="w-12 h-12 mx-auto mb-4 text-factory-600" />
                    <h3 className="text-lg font-medium text-factory-300 mb-2">No activity yet</h3>
                    <p className="text-factory-500">This contributor hasn&apos;t completed any bounties or claimed any repositories yet.</p>
                  </div>
                )}
              </>
            )}

            {tab === 'bounties' && (
              bounties.length > 0 ? (
                <div className="card divide-y divide-factory-800">
                  {bounties.map((bounty) => (
                    <BountyItem key={bounty.id} bounty={bounty} />
                  ))}
                </div>
              ) : (
                <EmptyState icon={DollarSign} title="No bounties" description="No bounties completed yet" />
              )
            )}

            {tab === 'repositories' && (
              repos.length > 0 ? (
                <div className="space-y-4">
                  {repos.map((repo) => (
                    <RepoCard key={repo.fullName} repo={repo} large />
                  ))}
                </div>
              ) : (
                <EmptyState icon={GitBranch} title="No repositories" description="No repositories claimed yet" />
              )
            )}

            {tab === 'contributions' && (
              <div className="card p-6">
                <h3 className="font-semibold text-factory-100 mb-4">Contribution Graph</h3>
                <p className="text-factory-500 text-sm">
                  {profile.stats.contributions} contributions tracked
                </p>
              </div>
            )}

            {tab === 'teams' && (
              <EmptyState icon={Users} title="No teams" description="Not a member of any teams yet" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ Sub-components ============

function BountyItem({ bounty }: { bounty: ProfileBounty }) {
  return (
    <Link
      href={`/bounties/${bounty.id}`}
      className="flex items-center gap-4 p-4 hover:bg-factory-800/50 transition-colors"
    >
      {bounty.status === 'completed' ? (
        <CheckCircle className="w-5 h-5 text-green-400" />
      ) : (
        <Clock className="w-5 h-5 text-amber-400" />
      )}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-factory-100 truncate">{bounty.title}</p>
        <p className="text-factory-500 text-sm">{bounty.reward}</p>
      </div>
      <span className={clsx(
        'badge',
        bounty.status === 'completed' && 'badge-success',
        bounty.status === 'in_progress' && 'badge-warning'
      )}>
        {bounty.status.replace('_', ' ')}
      </span>
    </Link>
  );
}

function RepoCard({ repo, large }: { repo: ProfileRepo; large?: boolean }) {
  return (
    <Link
      href={`/git/${repo.fullName}`}
      className={clsx('card card-hover', large ? 'p-6' : 'p-4')}
    >
      <div className="flex items-start gap-2 mb-2">
        <GitBranch className="w-4 h-4 text-factory-400 mt-0.5" />
        <span className="font-medium text-accent-400 hover:underline">{repo.name}</span>
      </div>
      {repo.description && (
        <p className="text-factory-400 text-sm mb-3 line-clamp-2">{repo.description}</p>
      )}
      <div className="flex items-center gap-3 text-xs text-factory-500">
        <span className="flex items-center gap-1">
          <span className={clsx('w-3 h-3 rounded-full', languageColors[repo.language] || 'bg-gray-400')} />
          {repo.language}
        </span>
        <span className="flex items-center gap-1">
          <Star className="w-3 h-3" />
          {repo.stars}
        </span>
      </div>
    </Link>
  );
}

function EmptyState({ icon: Icon, title, description }: { icon: React.ComponentType<{ className?: string }>; title: string; description: string }) {
  return (
    <div className="card p-8 text-center">
      <Icon className="w-12 h-12 mx-auto mb-4 text-factory-600" />
      <h3 className="text-lg font-medium text-factory-300 mb-2">{title}</h3>
      <p className="text-factory-500">{description}</p>
    </div>
  );
}
