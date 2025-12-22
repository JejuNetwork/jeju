'use client';

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { formatEther } from 'viem';
import type { ContributorProfile, SocialLink, RepositoryClaim, DependencyClaim, ContributorType, SocialPlatform } from '../../types/funding';
import { CONTRIBUTOR_TYPES, SOCIAL_PLATFORMS } from '../../types/funding';
import { 
  useContributorByWallet, 
  useSocialLinks, 
  useRepositoryClaims, 
  useDependencyClaims,
  useContributorCount,
  useRegisterContributor,
  useAddSocialLink,
  useClaimRepository,
  useClaimDependency,
} from '../../hooks/useContributor';
import { 
  VerificationStatusBadge, 
  ContributorTypeBadge, 
  ActiveBadge 
} from '../../components/shared/StatusBadge';

// ============ Components ============

function ContributorCard({ 
  profile, 
  onSelect 
}: { 
  profile: ContributorProfile; 
  onSelect: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 cursor-pointer hover:border-indigo-500/50 transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/5"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold">
            {profile.wallet.slice(2, 4).toUpperCase()}
          </div>
          <div>
            <p className="font-mono text-sm text-white">{profile.wallet.slice(0, 8)}...{profile.wallet.slice(-6)}</p>
            <ContributorTypeBadge type={profile.contributorType} />
          </div>
        </div>
        <ActiveBadge active={profile.active} />
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-slate-400">Total Earned</p>
          <p className="text-white font-medium">{parseFloat(formatEther(profile.totalEarned)).toFixed(2)} ETH</p>
        </div>
        <div>
          <p className="text-slate-400">Agent ID</p>
          <p className="text-white font-medium">{profile.agentId === 0n ? 'None' : `#${profile.agentId}`}</p>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-700/50 text-xs text-slate-500">
        Registered {new Date(profile.registeredAt * 1000).toLocaleDateString()}
      </div>
    </div>
  );
}

function RegistrationForm({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [type, setType] = useState<ContributorType>('INDIVIDUAL');
  const [profileUri, setProfileUri] = useState('');
  const { register, isPending, isConfirming, isSuccess, error } = useRegisterContributor();

  useEffect(() => {
    if (isSuccess) {
      onSuccess();
      onClose();
    }
  }, [isSuccess, onSuccess, onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    register(type, profileUri);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
        <h3 className="text-xl font-semibold text-white mb-4">Register as Contributor</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Contributor Type</label>
            <div className="flex gap-2">
              {CONTRIBUTOR_TYPES.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    type === t
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Profile URI (IPFS)</label>
            <input
              type="text"
              value={profileUri}
              onChange={e => setProfileUri(e.target.value)}
              placeholder="ipfs://Qm..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {error && (
            <p className="text-rose-400 text-sm">{error.message}</p>
          )}

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
              disabled={isPending || isConfirming}
              className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors disabled:opacity-50"
            >
              {isPending ? 'Signing...' : isConfirming ? 'Confirming...' : 'Register'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ContributorDetails({ 
  contributorId,
  profile,
  onClose 
}: { 
  contributorId: string;
  profile: ContributorProfile;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'social' | 'repos' | 'deps'>('social');
  const { links } = useSocialLinks(contributorId);
  const { claims: repoClaims } = useRepositoryClaims(contributorId);
  const { claims: depClaims } = useDependencyClaims(contributorId);

  const [newPlatform, setNewPlatform] = useState<SocialPlatform>('github');
  const [newHandle, setNewHandle] = useState('');
  const [newRepoOwner, setNewRepoOwner] = useState('');
  const [newRepoName, setNewRepoName] = useState('');
  const [newDepName, setNewDepName] = useState('');
  const [newDepRegistry, setNewDepRegistry] = useState('npm');

  const { addSocialLink, isPending: addingLink } = useAddSocialLink();
  const { claimRepository, isPending: claimingRepo } = useClaimRepository();
  const { claimDependency, isPending: claimingDep } = useClaimDependency();

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full mx-4 shadow-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-slate-700">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold">
                {profile.wallet.slice(2, 4).toUpperCase()}
              </div>
              <div>
                <p className="font-mono text-lg text-white">{profile.wallet.slice(0, 10)}...{profile.wallet.slice(-8)}</p>
                <div className="flex items-center gap-2 mt-1">
                  <ContributorTypeBadge type={profile.contributorType} />
                  <ActiveBadge active={profile.active} />
                </div>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl">×</button>
          </div>

          <div className="grid grid-cols-3 gap-4 mt-6">
            <div className="bg-slate-800/50 rounded-lg p-3">
              <p className="text-slate-400 text-xs">Total Earned</p>
              <p className="text-white text-lg font-semibold">{parseFloat(formatEther(profile.totalEarned)).toFixed(2)} ETH</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <p className="text-slate-400 text-xs">Agent ID</p>
              <p className="text-white text-lg font-semibold">{profile.agentId === 0n ? 'Not Linked' : `#${profile.agentId}`}</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <p className="text-slate-400 text-xs">Last Active</p>
              <p className="text-white text-lg font-semibold">{new Date(profile.lastActiveAt * 1000).toLocaleDateString()}</p>
            </div>
          </div>
        </div>

        <div className="flex border-b border-slate-700">
          {[
            { id: 'social', label: 'Social Links' },
            { id: 'repos', label: 'Repositories' },
            { id: 'deps', label: 'Dependencies' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as 'social' | 'repos' | 'deps')}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'text-indigo-400 border-b-2 border-indigo-500'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {activeTab === 'social' && (
            <div className="space-y-3">
              {links.map((link, i) => (
                <div key={i} className="flex items-center justify-between bg-slate-800/50 rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-slate-700 flex items-center justify-center">
                      {link.platform === 'github' && '📦'}
                      {link.platform === 'discord' && '💬'}
                      {link.platform === 'twitter' && '🐦'}
                      {link.platform === 'farcaster' && '💜'}
                    </div>
                    <div>
                      <p className="text-white font-medium capitalize">{link.platform}</p>
                      <p className="text-slate-400 text-sm">{link.handle}</p>
                    </div>
                  </div>
                  <VerificationStatusBadge status={link.status} />
                </div>
              ))}
              
              {/* Add new social link */}
              <div className="border border-dashed border-slate-600 rounded-lg p-4">
                <p className="text-sm text-slate-400 mb-3">Add Social Link</p>
                <div className="flex gap-2">
                  <select 
                    value={newPlatform} 
                    onChange={e => setNewPlatform(e.target.value as SocialPlatform)}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                  >
                    {SOCIAL_PLATFORMS.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={newHandle}
                    onChange={e => setNewHandle(e.target.value)}
                    placeholder="Handle"
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500"
                  />
                  <button
                    onClick={() => {
                      addSocialLink(contributorId, newPlatform, newHandle);
                      setNewHandle('');
                    }}
                    disabled={addingLink || !newHandle}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50"
                  >
                    {addingLink ? '...' : 'Add'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'repos' && (
            <div className="space-y-3">
              {repoClaims.map((claim, i) => (
                <div key={i} className="flex items-center justify-between bg-slate-800/50 rounded-lg p-4">
                  <div>
                    <p className="text-white font-medium">{claim.owner}/{claim.repo}</p>
                    <p className="text-slate-400 text-sm">Claimed {new Date(claim.claimedAt * 1000).toLocaleDateString()}</p>
                  </div>
                  <VerificationStatusBadge status={claim.status} />
                </div>
              ))}
              
              {/* Claim new repo */}
              <div className="border border-dashed border-slate-600 rounded-lg p-4">
                <p className="text-sm text-slate-400 mb-3">Claim Repository</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newRepoOwner}
                    onChange={e => setNewRepoOwner(e.target.value)}
                    placeholder="Owner"
                    className="w-32 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500"
                  />
                  <input
                    type="text"
                    value={newRepoName}
                    onChange={e => setNewRepoName(e.target.value)}
                    placeholder="Repository"
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500"
                  />
                  <button
                    onClick={() => {
                      claimRepository(contributorId, newRepoOwner, newRepoName);
                      setNewRepoOwner('');
                      setNewRepoName('');
                    }}
                    disabled={claimingRepo || !newRepoOwner || !newRepoName}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50"
                  >
                    {claimingRepo ? '...' : 'Claim'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'deps' && (
            <div className="space-y-3">
              {depClaims.map((claim, i) => (
                <div key={i} className="flex items-center justify-between bg-slate-800/50 rounded-lg p-4">
                  <div>
                    <p className="text-white font-medium">{claim.packageName}</p>
                    <p className="text-slate-400 text-sm">{claim.registryType} • Claimed {new Date(claim.claimedAt * 1000).toLocaleDateString()}</p>
                  </div>
                  <VerificationStatusBadge status={claim.status} />
                </div>
              ))}
              
              {/* Claim new dependency */}
              <div className="border border-dashed border-slate-600 rounded-lg p-4">
                <p className="text-sm text-slate-400 mb-3">Claim Dependency</p>
                <div className="flex gap-2">
                  <select 
                    value={newDepRegistry}
                    onChange={e => setNewDepRegistry(e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                  >
                    <option value="npm">npm</option>
                    <option value="pypi">pypi</option>
                    <option value="cargo">cargo</option>
                    <option value="go">go</option>
                  </select>
                  <input
                    type="text"
                    value={newDepName}
                    onChange={e => setNewDepName(e.target.value)}
                    placeholder="Package name"
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500"
                  />
                  <button
                    onClick={() => {
                      claimDependency(contributorId, newDepName, newDepRegistry);
                      setNewDepName('');
                    }}
                    disabled={claimingDep || !newDepName}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50"
                  >
                    {claimingDep ? '...' : 'Claim'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Main Page ============

export default function ContributorsPage() {
  const { address, isConnected } = useAccount();
  const [showRegister, setShowRegister] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<ContributorProfile | null>(null);

  const { profile: myProfile, refetch: refetchProfile } = useContributorByWallet(address);
  const { count } = useContributorCount();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950">
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Contributors</h1>
            <p className="text-slate-400">Register, verify identities, and claim repositories and dependencies</p>
          </div>
          {isConnected && !myProfile && (
            <button
              onClick={() => setShowRegister(true)}
              className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-500 transition-colors flex items-center gap-2"
            >
              <span>+</span> Register
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Contributors', value: count.toString() },
            { label: 'Status', value: myProfile ? 'Registered' : 'Not Registered' },
            { label: 'Wallet', value: address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not Connected' },
            { label: 'Connected', value: isConnected ? 'Yes' : 'No' },
          ].map((stat, i) => (
            <div key={i} className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-5">
              <p className="text-slate-400 text-sm">{stat.label}</p>
              <p className="text-2xl font-bold text-white mt-1">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* My Profile */}
        {myProfile && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-4">My Profile</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <ContributorCard
                profile={myProfile}
                onSelect={() => setSelectedProfile(myProfile)}
              />
            </div>
          </div>
        )}

        {/* Not Connected / Not Registered State */}
        {!isConnected && (
          <div className="text-center py-12 bg-slate-800/30 rounded-xl border border-slate-700">
            <p className="text-slate-400 text-lg">Connect your wallet to view and manage your contributor profile</p>
          </div>
        )}

        {isConnected && !myProfile && (
          <div className="text-center py-12 bg-slate-800/30 rounded-xl border border-slate-700">
            <p className="text-slate-400 text-lg mb-4">You are not registered as a contributor yet</p>
            <button
              onClick={() => setShowRegister(true)}
              className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-500 transition-colors"
            >
              Register Now
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      {showRegister && (
        <RegistrationForm 
          onClose={() => setShowRegister(false)} 
          onSuccess={() => refetchProfile()}
        />
      )}
      {selectedProfile && (
        <ContributorDetails
          contributorId={selectedProfile.contributorId}
          profile={selectedProfile}
          onClose={() => setSelectedProfile(null)}
        />
      )}
    </div>
  );
}
