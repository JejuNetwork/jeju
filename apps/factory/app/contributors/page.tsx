'use client';

import { useState } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { formatEther } from 'viem';

// ============ Types ============

type ContributorType = 'INDIVIDUAL' | 'ORGANIZATION' | 'PROJECT';
type VerificationStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REVOKED';

interface Contributor {
  contributorId: string;
  wallet: string;
  agentId: string;
  contributorType: ContributorType;
  profileUri: string;
  totalEarned: bigint;
  registeredAt: number;
  lastActiveAt: number;
  active: boolean;
}

interface SocialLink {
  platform: string;
  handle: string;
  status: VerificationStatus;
  verifiedAt: number;
}

interface RepoClaim {
  claimId: string;
  owner: string;
  repo: string;
  status: VerificationStatus;
  claimedAt: number;
}

interface DepClaim {
  claimId: string;
  packageName: string;
  registryType: string;
  status: VerificationStatus;
  claimedAt: number;
}

// ============ Mock Data ============

const MOCK_CONTRIBUTORS: Contributor[] = [
  {
    contributorId: '0x1234...abcd',
    wallet: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    agentId: '42',
    contributorType: 'INDIVIDUAL',
    profileUri: 'ipfs://QmProfile1',
    totalEarned: 15000000000000000000n,
    registeredAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    lastActiveAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
    active: true,
  },
  {
    contributorId: '0x5678...efgh',
    wallet: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    agentId: '0',
    contributorType: 'ORGANIZATION',
    profileUri: 'ipfs://QmProfile2',
    totalEarned: 45000000000000000000n,
    registeredAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
    lastActiveAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
    active: true,
  },
];

const MOCK_SOCIAL_LINKS: SocialLink[] = [
  { platform: 'github', handle: 'satoshi', status: 'VERIFIED', verifiedAt: Date.now() - 7 * 24 * 60 * 60 * 1000 },
  { platform: 'discord', handle: 'satoshi#1234', status: 'PENDING', verifiedAt: 0 },
  { platform: 'twitter', handle: '@satoshi', status: 'VERIFIED', verifiedAt: Date.now() - 14 * 24 * 60 * 60 * 1000 },
];

const MOCK_REPO_CLAIMS: RepoClaim[] = [
  { claimId: '0xrepo1', owner: 'satoshi', repo: 'bitcoin', status: 'VERIFIED', claimedAt: Date.now() - 5 * 24 * 60 * 60 * 1000 },
  { claimId: '0xrepo2', owner: 'jeju-network', repo: 'jeju', status: 'PENDING', claimedAt: Date.now() - 1 * 24 * 60 * 60 * 1000 },
];

const MOCK_DEP_CLAIMS: DepClaim[] = [
  { claimId: '0xdep1', packageName: 'viem', registryType: 'npm', status: 'VERIFIED', claimedAt: Date.now() - 10 * 24 * 60 * 60 * 1000 },
  { claimId: '0xdep2', packageName: 'ethers', registryType: 'npm', status: 'PENDING', claimedAt: Date.now() - 2 * 24 * 60 * 60 * 1000 },
];

// ============ Components ============

function StatusBadge({ status }: { status: VerificationStatus }) {
  const styles: Record<VerificationStatus, string> = {
    VERIFIED: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    PENDING: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
    UNVERIFIED: 'bg-slate-500/20 text-slate-400 border border-slate-500/30',
    REVOKED: 'bg-rose-500/20 text-rose-400 border border-rose-500/30',
  };

  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${styles[status]}`}>
      {status}
    </span>
  );
}

function ContributorTypeBadge({ type }: { type: ContributorType }) {
  const styles: Record<ContributorType, string> = {
    INDIVIDUAL: 'bg-blue-500/20 text-blue-400',
    ORGANIZATION: 'bg-purple-500/20 text-purple-400',
    PROJECT: 'bg-cyan-500/20 text-cyan-400',
  };

  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded ${styles[type]}`}>
      {type}
    </span>
  );
}

function ContributorCard({ contributor, onSelect }: { contributor: Contributor; onSelect: () => void }) {
  return (
    <div
      onClick={onSelect}
      className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 cursor-pointer hover:border-indigo-500/50 transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/5"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold">
            {contributor.wallet.slice(2, 4).toUpperCase()}
          </div>
          <div>
            <p className="font-mono text-sm text-white">{contributor.wallet.slice(0, 8)}...{contributor.wallet.slice(-6)}</p>
            <ContributorTypeBadge type={contributor.contributorType} />
          </div>
        </div>
        <div className={`w-2 h-2 rounded-full ${contributor.active ? 'bg-emerald-500' : 'bg-slate-500'}`} />
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-slate-400">Total Earned</p>
          <p className="text-white font-medium">{parseFloat(formatEther(contributor.totalEarned)).toFixed(2)} ETH</p>
        </div>
        <div>
          <p className="text-slate-400">Agent ID</p>
          <p className="text-white font-medium">{contributor.agentId === '0' ? 'None' : `#${contributor.agentId}`}</p>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-700/50 text-xs text-slate-500">
        Registered {new Date(contributor.registeredAt).toLocaleDateString()}
      </div>
    </div>
  );
}

function RegistrationForm({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState<ContributorType>('INDIVIDUAL');
  const [profileUri, setProfileUri] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // Simulate registration
    await new Promise(resolve => setTimeout(resolve, 1500));
    setLoading(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
        <h3 className="text-xl font-semibold text-white mb-4">Register as Contributor</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Contributor Type</label>
            <div className="flex gap-2">
              {(['INDIVIDUAL', 'ORGANIZATION', 'PROJECT'] as ContributorType[]).map(t => (
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

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors disabled:opacity-50"
            >
              {loading ? 'Registering...' : 'Register'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ContributorDetails({ contributor, onClose }: { contributor: Contributor; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'social' | 'repos' | 'deps'>('social');

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full mx-4 shadow-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-slate-700">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold">
                {contributor.wallet.slice(2, 4).toUpperCase()}
              </div>
              <div>
                <p className="font-mono text-lg text-white">{contributor.wallet.slice(0, 10)}...{contributor.wallet.slice(-8)}</p>
                <div className="flex items-center gap-2 mt-1">
                  <ContributorTypeBadge type={contributor.contributorType} />
                  <span className={`text-xs ${contributor.active ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {contributor.active ? '● Active' : '○ Inactive'}
                  </span>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl">×</button>
          </div>

          <div className="grid grid-cols-3 gap-4 mt-6">
            <div className="bg-slate-800/50 rounded-lg p-3">
              <p className="text-slate-400 text-xs">Total Earned</p>
              <p className="text-white text-lg font-semibold">{parseFloat(formatEther(contributor.totalEarned)).toFixed(2)} ETH</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <p className="text-slate-400 text-xs">Agent ID</p>
              <p className="text-white text-lg font-semibold">{contributor.agentId === '0' ? 'Not Linked' : `#${contributor.agentId}`}</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <p className="text-slate-400 text-xs">Last Active</p>
              <p className="text-white text-lg font-semibold">{new Date(contributor.lastActiveAt).toLocaleDateString()}</p>
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
              {MOCK_SOCIAL_LINKS.map((link, i) => (
                <div key={i} className="flex items-center justify-between bg-slate-800/50 rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-slate-700 flex items-center justify-center">
                      {link.platform === 'github' && '📦'}
                      {link.platform === 'discord' && '💬'}
                      {link.platform === 'twitter' && '🐦'}
                    </div>
                    <div>
                      <p className="text-white font-medium capitalize">{link.platform}</p>
                      <p className="text-slate-400 text-sm">{link.handle}</p>
                    </div>
                  </div>
                  <StatusBadge status={link.status} />
                </div>
              ))}
              <button className="w-full py-3 border border-dashed border-slate-600 rounded-lg text-slate-400 hover:border-indigo-500 hover:text-indigo-400 transition-colors">
                + Add Social Link
              </button>
            </div>
          )}

          {activeTab === 'repos' && (
            <div className="space-y-3">
              {MOCK_REPO_CLAIMS.map((claim, i) => (
                <div key={i} className="flex items-center justify-between bg-slate-800/50 rounded-lg p-4">
                  <div>
                    <p className="text-white font-medium">{claim.owner}/{claim.repo}</p>
                    <p className="text-slate-400 text-sm">Claimed {new Date(claim.claimedAt).toLocaleDateString()}</p>
                  </div>
                  <StatusBadge status={claim.status} />
                </div>
              ))}
              <button className="w-full py-3 border border-dashed border-slate-600 rounded-lg text-slate-400 hover:border-indigo-500 hover:text-indigo-400 transition-colors">
                + Claim Repository
              </button>
            </div>
          )}

          {activeTab === 'deps' && (
            <div className="space-y-3">
              {MOCK_DEP_CLAIMS.map((claim, i) => (
                <div key={i} className="flex items-center justify-between bg-slate-800/50 rounded-lg p-4">
                  <div>
                    <p className="text-white font-medium">{claim.packageName}</p>
                    <p className="text-slate-400 text-sm">{claim.registryType} • Claimed {new Date(claim.claimedAt).toLocaleDateString()}</p>
                  </div>
                  <StatusBadge status={claim.status} />
                </div>
              ))}
              <button className="w-full py-3 border border-dashed border-slate-600 rounded-lg text-slate-400 hover:border-indigo-500 hover:text-indigo-400 transition-colors">
                + Claim Dependency
              </button>
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
  const [selectedContributor, setSelectedContributor] = useState<Contributor | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredContributors = MOCK_CONTRIBUTORS.filter(c =>
    c.wallet.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.contributorType.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950">
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Contributors</h1>
            <p className="text-slate-400">Register, verify identities, and claim repositories and dependencies</p>
          </div>
          {isConnected && (
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
            { label: 'Total Contributors', value: '2,847', change: '+12%' },
            { label: 'Verified GitHub', value: '1,923', change: '+8%' },
            { label: 'Claimed Repos', value: '456', change: '+23%' },
            { label: 'Claimed Dependencies', value: '89', change: '+5%' },
          ].map((stat, i) => (
            <div key={i} className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-5">
              <p className="text-slate-400 text-sm">{stat.label}</p>
              <div className="flex items-end gap-2 mt-1">
                <p className="text-2xl font-bold text-white">{stat.value}</p>
                <span className="text-emerald-400 text-sm mb-1">{stat.change}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="mb-6">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by wallet or type..."
            className="w-full max-w-md bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        {/* Contributors Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredContributors.map(contributor => (
            <ContributorCard
              key={contributor.contributorId}
              contributor={contributor}
              onSelect={() => setSelectedContributor(contributor)}
            />
          ))}
        </div>

        {filteredContributors.length === 0 && (
          <div className="text-center py-12">
            <p className="text-slate-400">No contributors found matching your search.</p>
          </div>
        )}
      </div>

      {/* Modals */}
      {showRegister && <RegistrationForm onClose={() => setShowRegister(false)} />}
      {selectedContributor && (
        <ContributorDetails
          contributor={selectedContributor}
          onClose={() => setSelectedContributor(null)}
        />
      )}
    </div>
  );
}

