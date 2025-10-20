/**
 * Report Button Component
 * Quick report action for traders
 */

'use client';

import { useState } from 'react';
import { Flag } from 'lucide-react';
import { Address } from 'viem';
import { useAccount, useReadContract } from 'wagmi';
import { MODERATION_CONTRACTS } from '../lib/moderation-contracts';

interface ReportButtonProps {
  targetAddress: Address;
  context?: string; // e.g., "Suspicious trade behavior"
  variant?: 'icon' | 'button' | 'text';
}

const IDENTITY_REGISTRY_ABI = [
  {
    name: 'addressToAgentId',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'entity', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export default function ReportButton({ targetAddress, context, variant = 'icon' }: ReportButtonProps) {
  const [showModal, setShowModal] = useState(false);
  const { address: userAddress } = useAccount();

  // Get target agent ID
  const { data: targetAgentId } = useReadContract({
    address: MODERATION_CONTRACTS.IdentityRegistry as `0x${string}`,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'addressToAgentId',
    args: [targetAddress],
  });

  const handleReport = () => {
    if (!userAddress) {
      alert('Please connect your wallet to report users');
      return;
    }

    if (!targetAgentId || targetAgentId === 0n) {
      alert('Target user is not registered in the Identity Registry');
      return;
    }

    // Redirect to Gateway moderation page with pre-filled data
    const params = new URLSearchParams({
      targetAgentId: targetAgentId.toString(),
      sourceApp: 'bazaar',
      context: context || 'Reported from Bazaar',
    });

    window.open(`https://gateway.jeju.network/moderation/report?${params.toString()}`, '_blank');
  };

  if (variant === 'icon') {
    return (
      <button
        onClick={handleReport}
        className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
        title="Report this user"
      >
        <Flag size={18} />
      </button>
    );
  }

  if (variant === 'text') {
    return (
      <button
        onClick={handleReport}
        className="text-sm text-gray-600 hover:text-red-600 transition-colors flex items-center gap-1"
      >
        <Flag size={14} />
        Report
      </button>
    );
  }

  return (
    <button
      onClick={handleReport}
      className="px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium"
    >
      <Flag size={16} />
      Report User
    </button>
  );
}

