/**
 * Reputation Column for Leaderboard
 * Shows reputation badges in rankings table
 */

'use client';

import { useReadContract } from 'wagmi';
import { Shield, AlertTriangle, Award, Ban } from 'lucide-react';

interface ReputationColumnProps {
  agentId: bigint;
  compact?: boolean;
}

const LABEL_MANAGER_ABI = [
  {
    name: 'getLabels',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint8[]' }],
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
] as const;

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

const LABEL_MANAGER_ADDRESS = process.env.NEXT_PUBLIC_LABEL_MANAGER_ADDRESS as `0x${string}`;
const BAN_MANAGER_ADDRESS = process.env.NEXT_PUBLIC_BAN_MANAGER_ADDRESS as `0x${string}`;
const IDENTITY_REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS as `0x${string}`;

export default function ReputationColumn({ agentId, compact = false }: ReputationColumnProps) {
  // Query labels
  const { data: labels } = useReadContract({
    address: LABEL_MANAGER_ADDRESS,
    abi: LABEL_MANAGER_ABI,
    functionName: 'getLabels',
    args: [agentId],
    query: { enabled: !!agentId && agentId > 0n },
  });

  // Query ban status
  const { data: isBanned } = useReadContract({
    address: BAN_MANAGER_ADDRESS,
    abi: BAN_MANAGER_ABI,
    functionName: 'isNetworkBanned',
    args: [agentId],
    query: { enabled: !!agentId && agentId > 0n },
  });

  // Query stake tier
  const { data: agent } = useReadContract({
    address: IDENTITY_REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getAgent',
    args: [agentId],
    query: { enabled: !!agentId && agentId > 0n },
  });

  if (!agentId || agentId === 0n) {
    return <span className="text-gray-400 text-sm">No Agent</span>;
  }

  // Priority: Ban > HACKER > SCAMMER > TRUSTED > Tier
  if (isBanned) {
    return (
      <div className="flex items-center gap-1.5">
        <Ban size={compact ? 14 : 16} className="text-red-500" />
        <span className={`text-red-600 font-semibold ${compact ? 'text-xs' : 'text-sm'}`}>BANNED</span>
      </div>
    );
  }

  if (labels && labels.includes(1)) {
    // HACKER
    return (
      <div className="flex items-center gap-1.5">
        <AlertTriangle size={compact ? 14 : 16} className="text-red-600" />
        <span className={`text-red-600 font-semibold ${compact ? 'text-xs' : 'text-sm'}`}>HACKER</span>
      </div>
    );
  }

  if (labels && labels.includes(2)) {
    // SCAMMER
    return (
      <div className="flex items-center gap-1.5">
        <AlertTriangle size={compact ? 14 : 16} className="text-orange-500" />
        <span className={`text-orange-600 font-semibold ${compact ? 'text-xs' : 'text-sm'}`}>SCAMMER</span>
      </div>
    );
  }

  if (labels && labels.includes(4)) {
    // TRUSTED
    return (
      <div className="flex items-center gap-1.5">
        <Award size={compact ? 14 : 16} className="text-green-500" />
        <span className={`text-green-600 font-semibold ${compact ? 'text-xs' : 'text-sm'}`}>TRUSTED</span>
      </div>
    );
  }

  // Show stake tier
  if (agent) {
    const tierNames = ['None', 'Small', 'Med', 'High'];
    const tierColors = ['text-gray-500', 'text-blue-500', 'text-purple-500', 'text-yellow-500'];
    const tier = agent.tier;

    return (
      <div className="flex items-center gap-1.5">
        <Shield size={compact ? 14 : 16} className={tierColors[tier]} />
        <span className={`${tierColors[tier]} ${compact ? 'text-xs' : 'text-sm'}`}>
          {compact ? `T${tier}` : tierNames[tier]}
        </span>
      </div>
    );
  }

  return null;
}

