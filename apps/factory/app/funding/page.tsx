'use client';

import { useState } from 'react';
import { formatEther } from 'viem';

// ============ Types ============

interface FundingEpoch {
  epochId: number;
  startTime: number;
  endTime: number;
  contributorPool: bigint;
  dependencyPool: bigint;
  reservePool: bigint;
  totalDistributed: bigint;
  finalized: boolean;
}

interface ContributorAllocation {
  contributorId: string;
  wallet: string;
  weight: number;
  pendingRewards: bigint;
  contributions: {
    bounties: number;
    paymentRequests: number;
    repos: number;
  };
}

interface DependencyAllocation {
  packageName: string;
  registryType: string;
  weight: number;
  depth: number;
  usageCount: number;
  isRegistered: boolean;
  pendingRewards: bigint;
}

interface WeightVote {
  voter: string;
  targetId: string;
  targetName: string;
  adjustment: number;
  reason: string;
  reputation: number;
  votedAt: number;
}

// ============ Mock Data ============

const MOCK_EPOCH: FundingEpoch = {
  epochId: 3,
  startTime: Date.now() - 15 * 24 * 60 * 60 * 1000,
  endTime: Date.now() + 15 * 24 * 60 * 60 * 1000,
  contributorPool: 50000000000000000000n,
  dependencyPool: 30000000000000000000n,
  reservePool: 5000000000000000000n,
  totalDistributed: 0n,
  finalized: false,
};

const MOCK_CONTRIBUTORS: ContributorAllocation[] = [
  { contributorId: '0x1', wallet: '0xf39F...2266', weight: 2500, pendingRewards: 12500000000000000000n, contributions: { bounties: 12, paymentRequests: 3, repos: 2 } },
  { contributorId: '0x2', wallet: '0x7099...79C8', weight: 1800, pendingRewards: 9000000000000000000n, contributions: { bounties: 8, paymentRequests: 5, repos: 1 } },
  { contributorId: '0x3', wallet: '0x3C44...93BC', weight: 1200, pendingRewards: 6000000000000000000n, contributions: { bounties: 5, paymentRequests: 2, repos: 3 } },
  { contributorId: '0x4', wallet: '0x90F7...b906', weight: 900, pendingRewards: 4500000000000000000n, contributions: { bounties: 4, paymentRequests: 4, repos: 0 } },
];

const MOCK_DEPENDENCIES: DependencyAllocation[] = [
  { packageName: 'viem', registryType: 'npm', weight: 1500, depth: 0, usageCount: 45, isRegistered: true, pendingRewards: 4500000000000000000n },
  { packageName: 'ethers', registryType: 'npm', weight: 1200, depth: 0, usageCount: 38, isRegistered: true, pendingRewards: 3600000000000000000n },
  { packageName: 'wagmi', registryType: 'npm', weight: 800, depth: 0, usageCount: 25, isRegistered: false, pendingRewards: 0n },
  { packageName: 'abitype', registryType: 'npm', weight: 400, depth: 1, usageCount: 45, isRegistered: true, pendingRewards: 1200000000000000000n },
  { packageName: 'noble-curves', registryType: 'npm', weight: 300, depth: 2, usageCount: 45, isRegistered: false, pendingRewards: 0n },
];

const MOCK_VOTES: WeightVote[] = [
  { voter: '0xf39F...2266', targetId: '0x1', targetName: 'viem', adjustment: 200, reason: 'Critical infrastructure, widely used', reputation: 85, votedAt: Date.now() - 2 * 24 * 60 * 60 * 1000 },
  { voter: '0x7099...79C8', targetId: '0x2', targetName: 'wagmi', adjustment: 150, reason: 'Great DX, good docs', reputation: 72, votedAt: Date.now() - 1 * 24 * 60 * 60 * 1000 },
  { voter: '0x3C44...93BC', targetId: '0x3', targetName: 'contributor-1', adjustment: -100, reason: 'Inactive recently', reputation: 45, votedAt: Date.now() - 3 * 24 * 60 * 60 * 1000 },
];

const FEE_CONFIG = {
  treasuryBps: 3000,
  contributorPoolBps: 4000,
  dependencyPoolBps: 2000,
  jejuBps: 500,
  burnBps: 0,
  reserveBps: 500,
};

// ============ Components ============

function ProgressBar({ segments }: { segments: Array<{ value: number; color: string; label: string }> }) {
  return (
    <div className="space-y-2">
      <div className="flex h-4 rounded-full overflow-hidden bg-slate-800">
        {segments.map((seg, i) => (
          <div
            key={i}
            className={`${seg.color}`}
            style={{ width: `${seg.value / 100}%` }}
            title={`${seg.label}: ${(seg.value / 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-xs">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded ${seg.color}`} />
            <span className="text-slate-400">{seg.label}</span>
            <span className="text-white font-medium">{(seg.value / 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EpochCard({ epoch }: { epoch: FundingEpoch }) {
  const now = Date.now();
  const total = epoch.endTime - epoch.startTime;
  const elapsed = now - epoch.startTime;
  const progress = Math.min(100, (elapsed / total) * 100);
  const daysRemaining = Math.max(0, Math.ceil((epoch.endTime - now) / (24 * 60 * 60 * 1000)));

  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white">Epoch #{epoch.epochId}</h3>
          <p className="text-slate-400 text-sm">
            {new Date(epoch.startTime).toLocaleDateString()} – {new Date(epoch.endTime).toLocaleDateString()}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-white">{daysRemaining}</p>
          <p className="text-slate-400 text-sm">days remaining</p>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-slate-400">Progress</span>
          <span className="text-white">{progress.toFixed(0)}%</span>
        </div>
        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-800/50 rounded-lg p-3">
          <p className="text-slate-400 text-xs">Contributor Pool</p>
          <p className="text-white font-semibold">{parseFloat(formatEther(epoch.contributorPool)).toFixed(2)} ETH</p>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3">
          <p className="text-slate-400 text-xs">Dependency Pool</p>
          <p className="text-white font-semibold">{parseFloat(formatEther(epoch.dependencyPool)).toFixed(2)} ETH</p>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3">
          <p className="text-slate-400 text-xs">Reserve Pool</p>
          <p className="text-white font-semibold">{parseFloat(formatEther(epoch.reservePool)).toFixed(2)} ETH</p>
        </div>
      </div>
    </div>
  );
}

function ContributorRow({ contributor, rank }: { contributor: ContributorAllocation; rank: number }) {
  return (
    <div className="flex items-center gap-4 bg-slate-800/30 rounded-lg p-4 hover:bg-slate-800/50 transition-colors">
      <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-white font-bold text-sm">
        {rank}
      </div>
      <div className="flex-1">
        <p className="text-white font-mono text-sm">{contributor.wallet}</p>
        <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
          <span>🏆 {contributor.contributions.bounties} bounties</span>
          <span>💰 {contributor.contributions.paymentRequests} payments</span>
          <span>📦 {contributor.contributions.repos} repos</span>
        </div>
      </div>
      <div className="text-right">
        <p className="text-white font-medium">{(contributor.weight / 100).toFixed(1)}%</p>
        <p className="text-emerald-400 text-sm">{parseFloat(formatEther(contributor.pendingRewards)).toFixed(2)} ETH</p>
      </div>
    </div>
  );
}

function DependencyRow({ dep, rank }: { dep: DependencyAllocation; rank: number }) {
  return (
    <div className="flex items-center gap-4 bg-slate-800/30 rounded-lg p-4 hover:bg-slate-800/50 transition-colors">
      <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-white font-bold text-sm">
        {rank}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="text-white font-medium">{dep.packageName}</p>
          <span className="text-xs text-slate-500 bg-slate-700/50 px-1.5 py-0.5 rounded">{dep.registryType}</span>
          {dep.isRegistered ? (
            <span className="text-xs text-emerald-400 bg-emerald-500/20 px-1.5 py-0.5 rounded">Registered</span>
          ) : (
            <span className="text-xs text-amber-400 bg-amber-500/20 px-1.5 py-0.5 rounded">Unregistered</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
          <span>Depth: {dep.depth}</span>
          <span>Used by: {dep.usageCount} packages</span>
        </div>
      </div>
      <div className="text-right">
        <p className="text-white font-medium">{(dep.weight / 100).toFixed(1)}%</p>
        {dep.isRegistered && (
          <p className="text-emerald-400 text-sm">{parseFloat(formatEther(dep.pendingRewards)).toFixed(2)} ETH</p>
        )}
      </div>
    </div>
  );
}

function VoteCard({ vote }: { vote: WeightVote }) {
  const isPositive = vote.adjustment > 0;

  return (
    <div className="bg-slate-800/30 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-white font-mono text-sm">{vote.voter}</span>
          <span className="text-slate-500">→</span>
          <span className="text-indigo-400">{vote.targetName}</span>
        </div>
        <span className={`font-bold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
          {isPositive ? '+' : ''}{vote.adjustment}
        </span>
      </div>
      <p className="text-slate-300 text-sm">{vote.reason}</p>
      <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
        <span>Reputation: {vote.reputation}</span>
        <span>{new Date(vote.votedAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

function VoteForm({ onSubmit }: { onSubmit: (targetId: string, adjustment: number, reason: string) => void }) {
  const [targetId, setTargetId] = useState('');
  const [adjustment, setAdjustment] = useState(0);
  const [reason, setReason] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(targetId, adjustment, reason);
    setTargetId('');
    setAdjustment(0);
    setReason('');
  };

  return (
    <form onSubmit={handleSubmit} className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-5 space-y-4">
      <h4 className="text-white font-medium">Submit Weight Vote</h4>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-slate-400 block mb-1">Target (Contributor/Dependency)</label>
          <input
            type="text"
            value={targetId}
            onChange={e => setTargetId(e.target.value)}
            placeholder="viem, ethers, or contributor ID"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Weight Adjustment</label>
          <input
            type="number"
            value={adjustment}
            onChange={e => setAdjustment(parseInt(e.target.value) || 0)}
            placeholder="e.g., +100 or -50"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label className="text-sm text-slate-400 block mb-1">Reason</label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Explain your reasoning for this weight adjustment..."
          rows={2}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-indigo-500 focus:outline-none resize-none"
        />
      </div>

      <button
        type="submit"
        className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-500 transition-colors"
      >
        Submit Vote
      </button>
    </form>
  );
}

// ============ Main Page ============

export default function FundingPage() {
  const [activeTab, setActiveTab] = useState<'contributors' | 'dependencies' | 'deliberation'>('contributors');

  const handleVoteSubmit = (targetId: string, adjustment: number, reason: string) => {
    console.log('Vote submitted:', { targetId, adjustment, reason });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950">
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Deep Funding</h1>
          <p className="text-slate-400">Network fee distribution to contributors and dependencies</p>
        </div>

        {/* Fee Distribution Config */}
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-6 mb-8">
          <h3 className="text-lg font-semibold text-white mb-4">Fee Distribution</h3>
          <ProgressBar
            segments={[
              { value: FEE_CONFIG.treasuryBps, color: 'bg-indigo-500', label: 'Treasury' },
              { value: FEE_CONFIG.contributorPoolBps, color: 'bg-emerald-500', label: 'Contributors' },
              { value: FEE_CONFIG.dependencyPoolBps, color: 'bg-purple-500', label: 'Dependencies' },
              { value: FEE_CONFIG.jejuBps, color: 'bg-amber-500', label: 'Jeju Network' },
              { value: FEE_CONFIG.reserveBps, color: 'bg-slate-500', label: 'Reserve' },
            ]}
          />
        </div>

        {/* Current Epoch */}
        <div className="mb-8">
          <EpochCard epoch={MOCK_EPOCH} />
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-700 mb-6">
          {[
            { id: 'contributors', label: 'Contributors', count: MOCK_CONTRIBUTORS.length },
            { id: 'dependencies', label: 'Dependencies', count: MOCK_DEPENDENCIES.length },
            { id: 'deliberation', label: 'Deliberation', count: MOCK_VOTES.length },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as 'contributors' | 'dependencies' | 'deliberation')}
              className={`px-6 py-3 text-sm font-medium transition-colors flex items-center gap-2 ${
                activeTab === tab.id
                  ? 'text-indigo-400 border-b-2 border-indigo-500'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab.label}
              <span className="bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full text-xs">{tab.count}</span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'contributors' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Contributor Allocations</h3>
              <p className="text-slate-400 text-sm">Based on activity and deliberation votes</p>
            </div>
            {MOCK_CONTRIBUTORS.map((contributor, i) => (
              <ContributorRow key={contributor.contributorId} contributor={contributor} rank={i + 1} />
            ))}
          </div>
        )}

        {activeTab === 'dependencies' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Dependency Allocations</h3>
              <p className="text-slate-400 text-sm">Depth decay: 20% per level</p>
            </div>
            {MOCK_DEPENDENCIES.map((dep, i) => (
              <DependencyRow key={dep.packageName} dep={dep} rank={i + 1} />
            ))}
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mt-6">
              <p className="text-amber-400 font-medium">Unregistered Dependencies</p>
              <p className="text-amber-300/80 text-sm mt-1">
                {MOCK_DEPENDENCIES.filter(d => !d.isRegistered).length} dependencies have not been claimed.
                Their allocation is held in the reserve pool until a maintainer registers.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'deliberation' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h3 className="text-lg font-semibold text-white mb-4">Recent Votes</h3>
              <div className="space-y-3">
                {MOCK_VOTES.map((vote, i) => (
                  <VoteCard key={i} vote={vote} />
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white mb-4">Cast Your Vote</h3>
              <VoteForm onSubmit={handleVoteSubmit} />
              <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-4 mt-4">
                <p className="text-slate-300 text-sm font-medium mb-2">Deliberation Rules</p>
                <ul className="text-slate-400 text-sm space-y-1">
                  <li>• Votes are weighted by voter reputation (0-100)</li>
                  <li>• Maximum adjustment influence: 10% of base weight</li>
                  <li>• Votes must include reasoning for transparency</li>
                  <li>• Aggregated adjustments applied at epoch end</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

