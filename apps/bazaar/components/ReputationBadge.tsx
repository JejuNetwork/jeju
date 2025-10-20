/**
 * Reputation Badge Component
 * Shows compact reputation indicators for traders
 */

'use client';

import { useReadContract } from 'wagmi';
import { Shield, AlertTriangle, Award, Zap } from 'lucide-react';
import { Address } from 'viem';

interface ReputationBadgeProps {
  address: Address;
  agentId?: bigint;
  size?: 'sm' | 'md' | 'lg';
}

const LABEL_MANAGER_ABI = [
  {
    name: 'getLabels',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint8[]' }],
  },
  {
    name: 'hasLabel',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'label', type: 'uint8' },
    ],
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
  {
    name: 'addressToAgentId',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'entity', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
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

const LABEL_MANAGER_ADDRESS = process.env.NEXT_PUBLIC_LABEL_MANAGER_ADDRESS as `0x${string}`;
const IDENTITY_REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS as `0x${string}`;
const BAN_MANAGER_ADDRESS = process.env.NEXT_PUBLIC_BAN_MANAGER_ADDRESS as `0x${string}`;

export default function ReputationBadge({ address, agentId: providedAgentId, size = 'md' }: ReputationBadgeProps) {
  // Get agent ID from address if not provided
  const { data: fetchedAgentId } = useReadContract({
    address: IDENTITY_REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'addressToAgentId',
    args: [address],
    query: { enabled: !providedAgentId },
  });

  const agentId = providedAgentId || (fetchedAgentId as bigint);

  // Query agent data
  const { data: agentData } = useReadContract({
    address: IDENTITY_REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getAgent',
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

  // Query labels
  const { data: labels } = useReadContract({
    address: LABEL_MANAGER_ADDRESS,
    abi: LABEL_MANAGER_ABI,
    functionName: 'getLabels',
    args: [agentId],
    query: { enabled: !!agentId && agentId > 0n },
  });

  if (!agentId || agentId === 0n) {
    return (
      <div className={`inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-600 rounded text-${size}`}>
        <Shield size={size === 'sm' ? 12 : size === 'lg' ? 20 : 16} />
        <span>Not Registered</span>
      </div>
    );
  }

  // Show ban warning (highest priority)
  if (isBanned) {
    return (
      <div className={`inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded text-${size} border border-red-300`}>
        <AlertTriangle size={size === 'sm' ? 12 : size === 'lg' ? 20 : 16} />
        <span className="font-semibold">BANNED</span>
      </div>
    );
  }

  // Check for HACKER label (second priority)
  if (labels && labels.includes(1)) {
    return (
      <div className={`inline-flex items-center gap-1 px-2 py-1 bg-red-600 text-white rounded text-${size}`}>
        <Zap size={size === 'sm' ? 12 : size === 'lg' ? 20 : 16} />
        <span className="font-semibold">HACKER</span>
      </div>
    );
  }

  // Check for SCAMMER label
  if (labels && labels.includes(2)) {
    return (
      <div className={`inline-flex items-center gap-1 px-2 py-1 bg-orange-600 text-white rounded text-${size}`}>
        <AlertTriangle size={size === 'sm' ? 12 : size === 'lg' ? 20 : 16} />
        <span className="font-semibold">SCAMMER</span>
      </div>
    );
  }

  // Check for TRUSTED label (positive)
  if (labels && labels.includes(4)) {
    return (
      <div className={`inline-flex items-center gap-1 px-2 py-1 bg-green-600 text-white rounded text-${size}`}>
        <Award size={size === 'sm' ? 12 : size === 'lg' ? 20 : 16} />
        <span className="font-semibold">TRUSTED</span>
      </div>
    );
  }

  // Show stake tier (default)
  if (agentData) {
    const tierNames = ['None', 'Small', 'Medium', 'High'];
    const tierColors = ['gray', 'blue', 'purple', 'yellow'];
    const tier = agentData.tier;
    const color = tierColors[tier] || 'gray';

    return (
      <div className={`inline-flex items-center gap-1 px-2 py-1 bg-${color}-100 text-${color}-700 rounded text-${size}`}>
        <Shield size={size === 'sm' ? 12 : size === 'lg' ? 20 : 16} />
        <span>{tierNames[tier]}</span>
      </div>
    );
  }

  return null;
}
