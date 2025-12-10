'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatEther, parseEther, Address } from 'viem';
import { CONTRACTS } from '@/config';
import { 
  Shield, 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown,
  Users, 
  Clock, 
  DollarSign,
  ThumbsUp,
  ThumbsDown,
  Gavel,
  Flame,
  Trophy
} from 'lucide-react';

// ============ Types ============

enum BanStatus {
  NONE = 0,
  ON_NOTICE = 1,
  CHALLENGED = 2,
  BANNED = 3,
  CLEARED = 4,
  APPEALING = 5
}

enum VotePosition {
  YES = 0,
  NO = 1
}

interface BanCase {
  caseId: `0x${string}`;
  reporter: Address;
  target: Address;
  reporterStake: bigint;
  targetStake: bigint;
  reason: string;
  evidenceHash: `0x${string}`;
  status: number;
  createdAt: bigint;
  marketOpenUntil: bigint;
  yesVotes: bigint;
  noVotes: bigint;
  totalPot: bigint;
  resolved: boolean;
  outcome: number;
  appealCount: bigint;
}

interface StakeInfo {
  amount: bigint;
  stakedAt: bigint;
  stakedBlock: bigint;
  lastActivityBlock: bigint;
  isStaked: boolean;
}

// ============ Constants ============

const MODERATION_MARKETPLACE_ADDRESS = CONTRACTS.moderationMarketplace || undefined;

const MODERATION_MARKETPLACE_ABI = [
  {
    name: 'stake',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: []
  },
  {
    name: 'unstake',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: []
  },
  {
    name: 'openCase',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'reason', type: 'string' },
      { name: 'evidenceHash', type: 'bytes32' }
    ],
    outputs: [{ name: 'caseId', type: 'bytes32' }]
  },
  {
    name: 'challengeCase',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'caseId', type: 'bytes32' }],
    outputs: []
  },
  {
    name: 'vote',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'caseId', type: 'bytes32' },
      { name: 'position', type: 'uint8' }
    ],
    outputs: []
  },
  {
    name: 'resolveCase',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'caseId', type: 'bytes32' }],
    outputs: []
  },
  {
    name: 'getCase',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'caseId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'caseId', type: 'bytes32' },
          { name: 'reporter', type: 'address' },
          { name: 'target', type: 'address' },
          { name: 'reporterStake', type: 'uint256' },
          { name: 'targetStake', type: 'uint256' },
          { name: 'reason', type: 'string' },
          { name: 'evidenceHash', type: 'bytes32' },
          { name: 'status', type: 'uint8' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'marketOpenUntil', type: 'uint256' },
          { name: 'yesVotes', type: 'uint256' },
          { name: 'noVotes', type: 'uint256' },
          { name: 'totalPot', type: 'uint256' },
          { name: 'resolved', type: 'bool' },
          { name: 'outcome', type: 'uint8' },
          { name: 'appealCount', type: 'uint256' }
        ]
      }
    ]
  },
  {
    name: 'getStake',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'amount', type: 'uint256' },
          { name: 'stakedAt', type: 'uint256' },
          { name: 'stakedBlock', type: 'uint256' },
          { name: 'lastActivityBlock', type: 'uint256' },
          { name: 'isStaked', type: 'bool' }
        ]
      }
    ]
  },
  {
    name: 'canReport',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'getAllCaseIds',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32[]' }]
  },
  {
    name: 'minReporterStake',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  }
] as const;

// ============ Components ============

function StatusBadge({ status }: { status: number }) {
  const statusConfig: Record<number, { label: string; className: string }> = {
    [BanStatus.NONE]: { label: 'None', className: 'bg-gray-100 text-gray-800' },
    [BanStatus.ON_NOTICE]: { label: 'On Notice', className: 'bg-yellow-100 text-yellow-800 animate-pulse' },
    [BanStatus.CHALLENGED]: { label: 'Challenged', className: 'bg-orange-100 text-orange-800' },
    [BanStatus.BANNED]: { label: 'Banned', className: 'bg-red-100 text-red-800' },
    [BanStatus.CLEARED]: { label: 'Cleared', className: 'bg-green-100 text-green-800' },
    [BanStatus.APPEALING]: { label: 'Appealing', className: 'bg-purple-100 text-purple-800' },
  };

  const config = statusConfig[status] || statusConfig[BanStatus.NONE];

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}

function VotingBar({ yesVotes, noVotes }: { yesVotes: bigint; noVotes: bigint }) {
  const total = yesVotes + noVotes;
  const yesPercent = total > 0n ? Number((yesVotes * 100n) / total) : 50;
  const noPercent = 100 - yesPercent;

  return (
    <div className="w-full">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-red-600 font-medium">BAN {yesPercent}%</span>
        <span className="text-green-600 font-medium">{noPercent}% CLEAR</span>
      </div>
      <div className="h-3 rounded-full overflow-hidden flex bg-gray-200">
        <div 
          className="bg-gradient-to-r from-red-500 to-red-400 transition-all duration-500"
          style={{ width: `${yesPercent}%` }}
        />
        <div 
          className="bg-gradient-to-r from-green-400 to-green-500 transition-all duration-500"
          style={{ width: `${noPercent}%` }}
        />
      </div>
      <div className="flex justify-between text-xs mt-1 text-gray-500">
        <span>{formatEther(yesVotes)} ETH</span>
        <span>{formatEther(noVotes)} ETH</span>
      </div>
    </div>
  );
}

function TimeRemaining({ endTime }: { endTime: bigint }) {
  const [remaining, setRemaining] = useState({ hours: 0, minutes: 0, expired: false });

  useEffect(() => {
    const update = () => {
      const now = BigInt(Math.floor(Date.now() / 1000));
      const diff = endTime - now;
      
      if (diff <= 0n) {
        setRemaining({ hours: 0, minutes: 0, expired: true });
      } else {
        const hours = Number(diff / 3600n);
        const minutes = Number((diff % 3600n) / 60n);
        setRemaining({ hours, minutes, expired: false });
      }
    };

    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [endTime]);

  if (remaining.expired) {
    return <span className="text-red-500 font-medium">Voting Ended</span>;
  }

  return (
    <span className="text-gray-600">
      {remaining.hours}h {remaining.minutes}m remaining
    </span>
  );
}

function CaseCard({ 
  banCase, 
  onVote, 
  onResolve,
  canVote,
  isVoting 
}: { 
  banCase: BanCase; 
  onVote: (caseId: `0x${string}`, position: VotePosition) => void;
  onResolve: (caseId: `0x${string}`) => void;
  canVote: boolean;
  isVoting: boolean;
}) {
  const potentialEarnings = banCase.totalPot * 9n / 10n; // 90% of pot
  const isExpired = BigInt(Math.floor(Date.now() / 1000)) > banCase.marketOpenUntil;

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden hover:shadow-xl transition-shadow">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-3 text-white">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Gavel size={18} />
            <span className="font-semibold">Case #{banCase.caseId.slice(0, 10)}...</span>
          </div>
          <StatusBadge status={banCase.status} />
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Target & Reporter */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-gray-500 mb-1">Target</div>
            <div className="font-mono text-sm truncate">{banCase.target}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Reporter</div>
            <div className="font-mono text-sm truncate">{banCase.reporter}</div>
          </div>
        </div>

        {/* Reason */}
        <div>
          <div className="text-xs text-gray-500 mb-1">Reason</div>
          <p className="text-sm text-gray-700 bg-gray-50 rounded p-2">
            {banCase.reason || 'No reason provided'}
          </p>
        </div>

        {/* Pot Size */}
        <div className="flex items-center justify-between bg-gradient-to-r from-amber-50 to-yellow-50 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <DollarSign className="text-amber-500" size={20} />
            <div>
              <div className="text-xs text-amber-600">Total Pot</div>
              <div className="font-bold text-amber-700">{formatEther(banCase.totalPot)} ETH</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-green-600">Potential Win</div>
            <div className="font-bold text-green-600">{formatEther(potentialEarnings)} ETH</div>
          </div>
        </div>

        {/* Voting Progress */}
        <VotingBar yesVotes={banCase.yesVotes} noVotes={banCase.noVotes} />

        {/* Time Remaining */}
        <div className="flex items-center gap-2 text-sm">
          <Clock size={16} className="text-gray-400" />
          <TimeRemaining endTime={banCase.marketOpenUntil} />
        </div>

        {/* Actions */}
        {!banCase.resolved && (
          <div className="flex gap-2 pt-2">
            {!isExpired && canVote && (
              <>
                <button
                  onClick={() => onVote(banCase.caseId, VotePosition.YES)}
                  disabled={isVoting}
                  className="flex-1 flex items-center justify-center gap-2 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  <ThumbsDown size={16} />
                  Vote BAN
                </button>
                <button
                  onClick={() => onVote(banCase.caseId, VotePosition.NO)}
                  disabled={isVoting}
                  className="flex-1 flex items-center justify-center gap-2 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  <ThumbsUp size={16} />
                  Vote CLEAR
                </button>
              </>
            )}
            {isExpired && (
              <button
                onClick={() => onResolve(banCase.caseId)}
                disabled={isVoting}
                className="w-full flex items-center justify-center gap-2 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                <Gavel size={16} />
                Resolve Case
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============ Main Component ============

export default function ModerationMarketplace() {
  const { address, isConnected } = useAccount();
  const [stakeAmount, setStakeAmount] = useState('0.01');
  const [activeCases, setActiveCases] = useState<BanCase[]>([]);
  const [selectedTab, setSelectedTab] = useState<'cases' | 'stake' | 'report' | 'leaderboard'>('cases');

  // Read stake info
  const { data: stakeInfo, refetch: refetchStake } = useReadContract({
    address: MODERATION_MARKETPLACE_ADDRESS,
    abi: MODERATION_MARKETPLACE_ABI,
    functionName: 'getStake',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!MODERATION_MARKETPLACE_ADDRESS }
  });

  // Read can report
  const { data: canReport } = useReadContract({
    address: MODERATION_MARKETPLACE_ADDRESS,
    abi: MODERATION_MARKETPLACE_ABI,
    functionName: 'canReport',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!MODERATION_MARKETPLACE_ADDRESS }
  });

  // Read moderator reputation
  const { data: moderatorRep, refetch: refetchRep } = useReadContract({
    address: MODERATION_MARKETPLACE_ADDRESS,
    abi: [
      {
        name: 'getModeratorReputation',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'moderator', type: 'address' }],
        outputs: [
          {
            type: 'tuple',
            components: [
              { name: 'successfulBans', type: 'uint256' },
              { name: 'unsuccessfulBans', type: 'uint256' },
              { name: 'totalSlashedFrom', type: 'uint256' },
              { name: 'totalSlashedOthers', type: 'uint256' },
              { name: 'reputationScore', type: 'uint256' },
              { name: 'lastReportTimestamp', type: 'uint256' },
              { name: 'reportCooldownUntil', type: 'uint256' },
            ],
          },
        ],
      },
    ] as const,
    functionName: 'getModeratorReputation',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!MODERATION_MARKETPLACE_ADDRESS }
  });

  // Read moderator P&L
  const { data: moderatorPnL } = useReadContract({
    address: MODERATION_MARKETPLACE_ADDRESS,
    abi: [
      {
        name: 'getModeratorPnL',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'moderator', type: 'address' }],
        outputs: [{ name: '', type: 'int256' }],
      },
    ] as const,
    functionName: 'getModeratorPnL',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!MODERATION_MARKETPLACE_ADDRESS }
  });

  // Read reputation tier
  const { data: repTier } = useReadContract({
    address: MODERATION_MARKETPLACE_ADDRESS,
    abi: [
      {
        name: 'getReputationTier',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'user', type: 'address' }],
        outputs: [{ name: '', type: 'uint8' }],
      },
    ] as const,
    functionName: 'getReputationTier',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!MODERATION_MARKETPLACE_ADDRESS }
  });

  // Read min stake
  const { data: minStake } = useReadContract({
    address: MODERATION_MARKETPLACE_ADDRESS,
    abi: MODERATION_MARKETPLACE_ABI,
    functionName: 'minReporterStake',
    query: { enabled: !!MODERATION_MARKETPLACE_ADDRESS }
  });

  // Read all case IDs
  const { data: caseIds, refetch: refetchCases } = useReadContract({
    address: MODERATION_MARKETPLACE_ADDRESS,
    abi: MODERATION_MARKETPLACE_ABI,
    functionName: 'getAllCaseIds',
    query: { enabled: !!MODERATION_MARKETPLACE_ADDRESS }
  });

  // Write functions
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  // Handle stake
  const handleStake = useCallback(() => {
    if (!MODERATION_MARKETPLACE_ADDRESS) return;
    writeContract({
      address: MODERATION_MARKETPLACE_ADDRESS,
      abi: MODERATION_MARKETPLACE_ABI,
      functionName: 'stake',
      value: parseEther(stakeAmount),
    });
  }, [writeContract, stakeAmount]);

  // Handle vote
  const handleVote = useCallback((caseId: `0x${string}`, position: VotePosition) => {
    if (!MODERATION_MARKETPLACE_ADDRESS) return;
    writeContract({
      address: MODERATION_MARKETPLACE_ADDRESS,
      abi: MODERATION_MARKETPLACE_ABI,
      functionName: 'vote',
      args: [caseId, position],
    });
  }, [writeContract]);

  // Handle resolve
  const handleResolve = useCallback((caseId: `0x${string}`) => {
    if (!MODERATION_MARKETPLACE_ADDRESS) return;
    writeContract({
      address: MODERATION_MARKETPLACE_ADDRESS,
      abi: MODERATION_MARKETPLACE_ABI,
      functionName: 'resolveCase',
      args: [caseId],
    });
  }, [writeContract]);

  // Refetch on success
  useEffect(() => {
    if (isSuccess) {
      refetchStake();
      refetchCases();
      refetchRep();
    }
  }, [isSuccess, refetchStake, refetchCases, refetchRep]);

  const stake = stakeInfo as StakeInfo | undefined;
  const isStaked = stake?.isStaked ?? false;
  const isLoading = isPending || isConfirming;

  if (!MODERATION_MARKETPLACE_ADDRESS) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
        <AlertTriangle className="mx-auto text-yellow-500 mb-2" size={32} />
        <p className="text-yellow-700">Moderation Marketplace not configured</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 rounded-2xl p-6 text-white">
        <div className="flex items-center gap-3 mb-2">
          <Flame size={28} />
          <h2 className="text-2xl font-bold">Moderation Marketplace</h2>
        </div>
        <p className="text-purple-100 mb-4">
          Bet on ban outcomes, earn rewards, and keep the network safe
        </p>
        
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white/10 rounded-lg p-3">
            <div className="text-sm text-purple-200">Your Stake</div>
            <div className="text-xl font-bold">
              {stake ? formatEther(stake.amount) : '0'} ETH
            </div>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <div className="text-sm text-purple-200">Active Cases</div>
            <div className="text-xl font-bold">{caseIds?.length || 0}</div>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <div className="text-sm text-purple-200">Win Rate</div>
            <div className="text-xl font-bold">
              {moderatorRep ? (
                <>
                  {Number(moderatorRep.successfulBans) + Number(moderatorRep.unsuccessfulBans) > 0
                    ? Math.round((Number(moderatorRep.successfulBans) / (Number(moderatorRep.successfulBans) + Number(moderatorRep.unsuccessfulBans))) * 100)
                    : 50}%
                </>
              ) : '50%'}
            </div>
            {moderatorRep && (
              <div className="text-xs text-purple-200">
                {moderatorRep.successfulBans.toString()}W / {moderatorRep.unsuccessfulBans.toString()}L
              </div>
            )}
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <div className="text-sm text-purple-200">Mod P&L</div>
            <div className={`text-xl font-bold ${moderatorPnL && moderatorPnL >= 0n ? 'text-green-300' : 'text-red-300'}`}>
              {moderatorPnL ? (
                <>
                  {Number(moderatorPnL) >= 0 ? '+' : ''}{formatEther(moderatorPnL)}
                </>
              ) : '0'} ETH
            </div>
          </div>
        </div>

        {/* Reputation Tier Badge */}
        {repTier !== undefined && (
          <div className="mt-4 flex items-center gap-2">
            <span className="text-purple-200 text-sm">Reputation Tier:</span>
            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
              repTier === 4 ? 'bg-green-400 text-green-900' :
              repTier === 3 ? 'bg-blue-400 text-blue-900' :
              repTier === 2 ? 'bg-yellow-400 text-yellow-900' :
              repTier === 1 ? 'bg-orange-400 text-orange-900' :
              'bg-red-400 text-red-900'
            }`}>
              {['Untrusted', 'Low', 'Medium', 'High', 'Trusted'][repTier] || 'Unknown'}
            </span>
            {repTier <= 1 && (
              <span className="text-xs text-purple-200">(Need higher rep or multiple reporters)</span>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200 overflow-x-auto">
        {(['cases', 'stake', 'report', 'leaderboard'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setSelectedTab(tab)}
            className={`px-4 py-2 font-medium transition-colors whitespace-nowrap ${
              selectedTab === tab
                ? 'text-purple-600 border-b-2 border-purple-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'cases' && <span className="flex items-center gap-2"><Gavel size={16} /> Cases</span>}
            {tab === 'stake' && <span className="flex items-center gap-2"><Shield size={16} /> Stake</span>}
            {tab === 'report' && <span className="flex items-center gap-2"><AlertTriangle size={16} /> Report</span>}
            {tab === 'leaderboard' && <span className="flex items-center gap-2"><Trophy size={16} /> Leaderboard</span>}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {selectedTab === 'cases' && (
        <div className="grid md:grid-cols-2 gap-4">
          {!caseIds || caseIds.length === 0 ? (
            <div className="col-span-2 text-center py-12 text-gray-500">
              <Users size={48} className="mx-auto mb-4 text-gray-300" />
              <p>No active cases. The network is peaceful.</p>
            </div>
          ) : (
            caseIds.slice().reverse().map((caseId) => (
              <CaseCardWrapper
                key={caseId}
                caseId={caseId}
                onVote={handleVote}
                onResolve={handleResolve}
                canVote={isStaked}
                isVoting={isLoading}
              />
            ))
          )}
        </div>
      )}

      {selectedTab === 'stake' && (
        <div className="max-w-md mx-auto space-y-6">
          {/* Current Stake */}
          <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl p-6">
            <h3 className="font-semibold text-purple-900 mb-4 flex items-center gap-2">
              <Shield size={20} />
              Your Moderation Power
            </h3>
            <div className="text-3xl font-bold text-purple-700 mb-2">
              {stake ? formatEther(stake.amount) : '0'} ETH
            </div>
            {stake?.isStaked && (
              <div className="text-sm text-purple-600">
                Staked since block {stake.stakedBlock.toString()}
              </div>
            )}
          </div>

          {/* Stake Input */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold mb-4">Add Stake</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Amount (ETH)</label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={stakeAmount}
                  onChange={(e) => setStakeAmount(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
                {minStake && (
                  <p className="text-xs text-gray-500 mt-1">
                    Minimum to report: {formatEther(minStake)} ETH
                  </p>
                )}
              </div>
              <button
                onClick={handleStake}
                disabled={isLoading || !isConnected}
                className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Staking...' : 'Stake ETH'}
              </button>
            </div>
          </div>

          {/* Benefits */}
          <div className="bg-gray-50 rounded-xl p-6">
            <h4 className="font-semibold mb-3">Staking Benefits</h4>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-center gap-2">
                <TrendingUp size={16} className="text-green-500" />
                Earn 90% of loser stake when you vote correctly
              </li>
              <li className="flex items-center gap-2">
                <Shield size={16} className="text-purple-500" />
                Report bad actors and protect the network
              </li>
              <li className="flex items-center gap-2">
                <Users size={16} className="text-blue-500" />
                Vote on moderation cases
              </li>
              <li className="flex items-center gap-2">
                <Clock size={16} className="text-orange-500" />
                24h stake age required before voting power activates
              </li>
            </ul>
          </div>
        </div>
      )}

      {selectedTab === 'report' && (
        <div className="max-w-md mx-auto">
          <ReportForm canReport={canReport ?? false} isLoading={isLoading} />
        </div>
      )}

      {selectedTab === 'leaderboard' && (
        <div className="space-y-6">
          {/* Your Stats */}
          {moderatorRep && (
            <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl p-6">
              <h3 className="font-semibold text-purple-900 mb-4 flex items-center gap-2">
                <Trophy size={20} className="text-yellow-500" />
                Your Moderation Stats
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white rounded-lg p-4 shadow-sm">
                  <div className="text-sm text-gray-500">Successful Bans</div>
                  <div className="text-2xl font-bold text-green-600">
                    {moderatorRep.successfulBans.toString()}
                  </div>
                </div>
                <div className="bg-white rounded-lg p-4 shadow-sm">
                  <div className="text-sm text-gray-500">Failed Reports</div>
                  <div className="text-2xl font-bold text-red-600">
                    {moderatorRep.unsuccessfulBans.toString()}
                  </div>
                </div>
                <div className="bg-white rounded-lg p-4 shadow-sm">
                  <div className="text-sm text-gray-500">Total Earned</div>
                  <div className="text-2xl font-bold text-green-600 flex items-center gap-1">
                    <TrendingUp size={18} />
                    {formatEther(moderatorRep.totalSlashedOthers)}
                  </div>
                </div>
                <div className="bg-white rounded-lg p-4 shadow-sm">
                  <div className="text-sm text-gray-500">Total Lost</div>
                  <div className="text-2xl font-bold text-red-600 flex items-center gap-1">
                    <TrendingDown size={18} />
                    {formatEther(moderatorRep.totalSlashedFrom)}
                  </div>
                </div>
              </div>
              
              {/* Reputation Score Bar */}
              <div className="mt-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Reputation Score</span>
                  <span className="font-semibold">{moderatorRep.reputationScore.toString()} / 10000</span>
                </div>
                <div className="h-3 rounded-full overflow-hidden bg-gray-200">
                  <div 
                    className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 transition-all duration-500"
                    style={{ width: `${Number(moderatorRep.reputationScore) / 100}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs mt-1 text-gray-400">
                  <span>Untrusted</span>
                  <span>Low</span>
                  <span>Medium</span>
                  <span>High</span>
                  <span>Trusted</span>
                </div>
              </div>

              {/* Net P&L */}
              <div className="mt-4 p-4 bg-white rounded-lg shadow-sm">
                <div className="text-sm text-gray-500 mb-1">Net Profit/Loss</div>
                <div className={`text-3xl font-bold flex items-center gap-2 ${
                  moderatorPnL && moderatorPnL >= 0n ? 'text-green-600' : 'text-red-600'
                }`}>
                  {moderatorPnL && moderatorPnL >= 0n ? (
                    <TrendingUp size={24} />
                  ) : (
                    <TrendingDown size={24} />
                  )}
                  {moderatorPnL ? (
                    <>
                      {Number(moderatorPnL) >= 0 ? '+' : ''}{formatEther(moderatorPnL)} ETH
                    </>
                  ) : '0 ETH'}
                </div>
              </div>
            </div>
          )}

          {/* Info Card */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
            <h4 className="font-semibold text-blue-800 mb-2 flex items-center gap-2">
              <Shield size={18} />
              How Reputation Works
            </h4>
            <ul className="space-y-2 text-sm text-blue-700">
              <li>• <strong>Win:</strong> +200 reputation, earn 90% of opponent's stake</li>
              <li>• <strong>Lose:</strong> -600 reputation (3x the gain)</li>
              <li>• <strong>Get Slashed:</strong> -1800 reputation (3x loss penalty)</li>
              <li>• <strong>High Rep (6000+):</strong> Can report alone, lower stake required</li>
              <li>• <strong>Trusted (8000+):</strong> 50% stake discount, instant reports</li>
              <li>• <strong>Low Rep (0-3000):</strong> Need 2-3 reporters for quorum</li>
            </ul>
          </div>

          {/* Top Moderators - Coming Soon */}
          <div className="bg-gray-50 rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2 text-gray-500">
              <Trophy size={20} />
              Top Moderators
            </h3>
            <p className="text-gray-400 text-sm text-center py-4">
              Global leaderboard coming soon.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// Wrapper to fetch individual case data
function CaseCardWrapper({ 
  caseId, 
  onVote, 
  onResolve,
  canVote,
  isVoting 
}: { 
  caseId: `0x${string}`; 
  onVote: (caseId: `0x${string}`, position: VotePosition) => void;
  onResolve: (caseId: `0x${string}`) => void;
  canVote: boolean;
  isVoting: boolean;
}) {
  const { data: banCase } = useReadContract({
    address: MODERATION_MARKETPLACE_ADDRESS,
    abi: MODERATION_MARKETPLACE_ABI,
    functionName: 'getCase',
    args: [caseId],
    query: { enabled: !!MODERATION_MARKETPLACE_ADDRESS }
  });

  if (!banCase) return null;

  return (
    <CaseCard
      banCase={banCase as BanCase}
      onVote={onVote}
      onResolve={onResolve}
      canVote={canVote}
      isVoting={isVoting}
    />
  );
}

// Report form component with evidence upload
function ReportForm({ canReport, isLoading }: { canReport: boolean; isLoading: boolean }) {
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState('SCAMMING');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceHash, setEvidenceHash] = useState<`0x${string}` | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { writeContract } = useWriteContract();

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setEvidenceFile(file);
    setUploading(true);
    setUploadError(null);
    
    // Import dynamically to avoid SSR issues
    const { uploadToIPFS, cidToBytes32 } = await import('../lib/ipfs');
    const cid = await uploadToIPFS(file);
    setEvidenceHash(cidToBytes32(cid));
    setUploading(false);
  };

  const handleSubmit = () => {
    if (!MODERATION_MARKETPLACE_ADDRESS || !target || !reason) return;
    if (!evidenceHash) {
      setUploadError('Please upload evidence before submitting');
      return;
    }
    
    writeContract({
      address: MODERATION_MARKETPLACE_ADDRESS,
      abi: MODERATION_MARKETPLACE_ABI,
      functionName: 'openCase',
      args: [target as Address, reason, evidenceHash],
    });
  };

  if (!canReport) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-center">
        <AlertTriangle className="mx-auto text-yellow-500 mb-2" size={32} />
        <h3 className="font-semibold text-yellow-800 mb-2">Cannot Report</h3>
        <p className="text-sm text-yellow-700">
          You need to stake at least the minimum amount and wait 24 hours before you can report.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <h3 className="font-semibold flex items-center gap-2">
        <AlertTriangle size={20} className="text-red-500" />
        Report a Bad Actor
      </h3>
      
      <div>
        <label className="block text-sm text-gray-600 mb-1">Target Address *</label>
        <input
          type="text"
          placeholder="0x..."
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
        />
      </div>

      <div>
        <label className="block text-sm text-gray-600 mb-1">Category *</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
        >
          <option value="SCAMMING">Scamming</option>
          <option value="HACKING">Hacking</option>
          <option value="CSAM">CSAM (Illegal Content)</option>
          <option value="SPAM">Spam/Bot Activity</option>
          <option value="OTHER">Other</option>
        </select>
      </div>

      <div>
        <label className="block text-sm text-gray-600 mb-1">Evidence * (Upload to IPFS)</label>
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center">
          {!evidenceFile ? (
            <>
              <p className="text-sm text-gray-500 mb-2">Upload screenshots, videos, or documents</p>
              <input
                type="file"
                onChange={handleFileUpload}
                accept="image/*,video/*,.pdf,.txt"
                className="hidden"
                id="evidence-upload"
              />
              <label
                htmlFor="evidence-upload"
                className="inline-block px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg cursor-pointer text-sm"
              >
                Choose File
              </label>
            </>
          ) : (
            <div className="text-left">
              <div className="font-medium text-sm">{evidenceFile.name}</div>
              <div className="text-xs text-gray-500 mt-1">
                {uploading ? 'Uploading to IPFS...' : evidenceHash ? `Hash: ${evidenceHash.slice(0, 18)}...` : 'Ready'}
              </div>
            </div>
          )}
        </div>
        {uploadError && <p className="text-xs text-red-500 mt-1">{uploadError}</p>}
      </div>

      <div>
        <label className="block text-sm text-gray-600 mb-1">Reason *</label>
        <textarea
          placeholder="Describe the violation in detail..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
        />
      </div>

      <div className="bg-red-50 rounded-lg p-3">
        <p className="text-sm text-red-700">
          <strong>Warning:</strong> Your stake is at risk. If the community votes to clear the target, you will lose your stake.
        </p>
      </div>

      <button
        onClick={handleSubmit}
        disabled={isLoading || uploading || !target || !reason || !evidenceHash}
        className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
      >
        {uploading ? 'Uploading Evidence...' : isLoading ? 'Submitting...' : 'Submit Report'}
      </button>
    </div>
  );
}

