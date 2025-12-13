'use client';

import { useState, useEffect } from 'react';
import { useReadContract } from 'wagmi';
import { Shield, AlertTriangle } from 'lucide-react';
import { MODERATION_CONTRACTS } from '../../config/moderation';
import { ZERO_BYTES32 } from '../../lib/contracts';

interface ReputationViewerProps {
  agentId: bigint;
}

interface ReputationData {
  stakeTier: number;
  stakeAmount: bigint;
  networkBanned: boolean;
  appBans: string[];
  labels: string[];
  banReason?: string;
}

const IDENTITY_REGISTRY_ABI = [
  {
    name: 'getAgent',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'agentId', type: 'uint256' },
          { name: 'owner', type: 'address' },
          { name: 'tier', type: 'uint8' },
          { name: 'stakedToken', type: 'address' },
          { name: 'stakedAmount', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'lastActivityAt', type: 'uint256' },
          { name: 'isBanned', type: 'bool' },
          { name: 'isSlashed', type: 'bool' },
        ],
      },
    ],
  },
] as const;

const BAN_MANAGER_ABI = [
  {
    name: 'isNetworkBanned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getAppBans',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  {
    name: 'getBanReason',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'appId', type: 'bytes32' },
    ],
    outputs: [{ name: 'reason', type: 'string' }],
  },
] as const;

const LABEL_MANAGER_ABI = [
  {
    name: 'getLabels',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint8[]' }],
  },
] as const;

export default function ReputationViewer({ agentId }: ReputationViewerProps) {
  const [reputation, setReputation] = useState<ReputationData | null>(null);
  
  // Query agent data from IdentityRegistry
  const { data: agentData, isLoading: loadingAgent } = useReadContract({
    address: MODERATION_CONTRACTS.IdentityRegistry as `0x${string}`,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getAgent',
    args: [agentId],
  });
  
  // Query ban status
  const { data: isNetworkBanned, isLoading: loadingBan } = useReadContract({
    address: MODERATION_CONTRACTS.BanManager as `0x${string}`,
    abi: BAN_MANAGER_ABI,
    functionName: 'isNetworkBanned',
    args: [agentId],
  });
  
  // Query app bans
  const { data: appBans, isLoading: loadingAppBans } = useReadContract({
    address: MODERATION_CONTRACTS.BanManager as `0x${string}`,
    abi: BAN_MANAGER_ABI,
    functionName: 'getAppBans',
    args: [agentId],
  });
  
  // Query labels
  const { data: labelIds, isLoading: loadingLabels } = useReadContract({
    address: MODERATION_CONTRACTS.ReputationLabelManager as `0x${string}`,
    abi: LABEL_MANAGER_ABI,
    functionName: 'getLabels',
    args: [agentId],
  });
  
  // Query ban reason if banned
  const { data: banReason } = useReadContract({
    address: MODERATION_CONTRACTS.BanManager as `0x${string}`,
    abi: BAN_MANAGER_ABI,
    functionName: 'getBanReason',
    args: [agentId, ZERO_BYTES32],
    query: { enabled: !!isNetworkBanned },
  });
  
  // Build reputation data
  useEffect(() => {
    if (agentData && typeof isNetworkBanned === 'boolean') {
      const labels = (labelIds || []).map(id => getLabelName(Number(id)));
      const appBanNames = (appBans || []).map(bytes32ToAppName);
      
      setReputation({
        stakeTier: agentData.tier,
        stakeAmount: agentData.stakedAmount,
        networkBanned: isNetworkBanned,
        appBans: appBanNames,
        labels,
        banReason: banReason as string | undefined,
      });
    }
  }, [agentData, isNetworkBanned, appBans, labelIds, banReason]);
  
  const loading = loadingAgent || loadingBan || loadingAppBans || loadingLabels;
  
  if (loading) {
    return <div className="animate-pulse">Loading reputation...</div>;
  }
  
  if (!reputation) {
    return <div>No reputation data</div>;
  }
  
  return (
    <div className="space-y-4">
      {/* Stake Tier */}
      <div className="card">
        <div className="flex items-center gap-2 mb-2">
          <Shield size={20} />
          <h3 className="font-semibold">Reputation Stake</h3>
        </div>
        <div className="text-2xl font-bold">
          Tier {reputation.stakeTier}: {getTierName(reputation.stakeTier)}
        </div>
        <div className="text-sm text-gray-600">
          {Number(reputation.stakeAmount) / 1e18} ETH staked
        </div>
      </div>
      
      {/* Network Ban */}
      {reputation.networkBanned && (
        <div className="card bg-red-50 border-red-300">
          <div className="flex items-center gap-2 text-red-700">
            <AlertTriangle size={20} />
            <h3 className="font-semibold">NETWORK BAN</h3>
          </div>
          <p className="text-sm text-red-600 mt-2">
            {reputation.banReason || 'Banned from entire Jeju network'}
          </p>
        </div>
      )}
      
      {/* App Bans */}
      {reputation.appBans.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-2">App Bans ({reputation.appBans.length})</h3>
          <div className="flex flex-wrap gap-2">
            {reputation.appBans.map(app => (
              <span key={app} className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-sm">
                {app}
              </span>
            ))}
          </div>
        </div>
      )}
      
      {/* Labels */}
      {reputation.labels.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-2">Labels</h3>
          <div className="flex flex-wrap gap-2">
            {reputation.labels.map(label => (
              <span key={label} className={`px-2 py-1 rounded text-sm ${getLabelColor(label)}`}>
                {label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function getTierName(tier: number): string {
  return ['None', 'Small', 'Medium', 'High'][tier] || 'Unknown';
}

function getLabelColor(label: string): string {
  if (label === 'HACKER') return 'bg-red-600 text-white';
  if (label === 'SCAMMER') return 'bg-orange-600 text-white';
  if (label === 'TRUSTED') return 'bg-green-600 text-white';
  if (label === 'SPAM_BOT') return 'bg-yellow-600 text-white';
  return 'bg-gray-600 text-white';
}

function getLabelName(labelId: number): string {
  const labels = ['NONE', 'HACKER', 'SCAMMER', 'SPAM_BOT', 'TRUSTED'];
  return labels[labelId] || 'UNKNOWN';
}

function bytes32ToAppName(bytes32: string): string {
  // Convert bytes32 back to app name
  // Simplified - in production would have mapping
  if (bytes32.includes('hyperscape')) return 'Hyperscape';
  if (bytes32.includes('bazaar')) return 'Bazaar';
  if (bytes32.includes('gateway')) return 'Gateway';
  return bytes32.substring(0, 10) + '...';
}


