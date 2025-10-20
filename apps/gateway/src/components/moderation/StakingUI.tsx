/**
 * Staking UI Component
 * Upgrade reputation tier by staking ETH
 */

'use client';

import { useState, useEffect } from 'react';
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { Shield, TrendingUp, Award, AlertCircle } from 'lucide-react';
import { MODERATION_CONTRACTS } from '../../config/moderation';

const TIER_INFO = [
  { name: 'None', stake: '0', benefits: 'Basic access only' },
  { name: 'Small', stake: '0.001', benefits: 'Trading enabled, slight trust boost' },
  { name: 'Medium', stake: '0.01', benefits: 'PvP enabled, moderate trust, 1.5x vote weight' },
  { name: 'High', stake: '0.1', benefits: 'Guild creation, high trust, 2x vote weight, Guardian eligible' },
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
    name: 'increaseStake',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'newTier', type: 'uint8' },
    ],
    outputs: [],
  },
  {
    name: 'addressToAgentId',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'entity', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

interface StakingUIProps {
  agentId?: bigint;
}

export default function StakingUI({ agentId: providedAgentId }: StakingUIProps) {
  const [selectedTier, setSelectedTier] = useState<number | null>(null);
  const { address } = useAccount();

  // Get agent ID from address if not provided
  const { data: fetchedAgentId } = useReadContract({
    address: MODERATION_CONTRACTS.IdentityRegistry as `0x${string}`,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'addressToAgentId',
    args: [address!],
    query: { enabled: !!address && !providedAgentId },
  });

  const agentId = providedAgentId || (fetchedAgentId as bigint);

  // Get current agent data
  const { data: agent, refetch } = useReadContract({
    address: MODERATION_CONTRACTS.IdentityRegistry as `0x${string}`,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getAgent',
    args: [agentId],
    query: { enabled: !!agentId && agentId > 0n },
  });

  // Increase stake
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  // Handle success
  useEffect(() => {
    if (isSuccess) {
      refetch(); // Refresh agent data
      setSelectedTier(null);
    }
  }, [isSuccess, refetch]);

  const handleUpgrade = () => {
    if (selectedTier === null || !agentId) return;

    const stakeAmount = parseEther(TIER_INFO[selectedTier].stake);

    writeContract({
      address: MODERATION_CONTRACTS.IdentityRegistry as `0x${string}`,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'increaseStake',
      args: [agentId, selectedTier],
      value: stakeAmount,
    });
  };

  if (!address) {
    return (
      <div className="text-center py-8 text-gray-600">
        Please connect your wallet to manage staking
      </div>
    );
  }

  if (!agentId || agentId === 0n) {
    return (
      <div className="text-center py-8">
        <AlertCircle className="mx-auto text-yellow-500 mb-2" size={32} />
        <div className="text-gray-700 font-semibold mb-2">Not Registered</div>
        <div className="text-sm text-gray-600">You must register in the Identity Registry first</div>
      </div>
    );
  }

  const currentTier = agent ? agent.tier : 0;

  return (
    <div className="space-y-6">
      {/* Current Tier */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <div className="flex items-center gap-3 mb-2">
          <Shield className="text-blue-500" size={24} />
          <h3 className="text-lg font-semibold text-blue-900">Current Reputation Tier</h3>
        </div>
        <div className="text-3xl font-bold text-blue-900 mb-1">
          Tier {currentTier}: {TIER_INFO[currentTier].name}
        </div>
        <div className="text-sm text-blue-700">
          Staked: {agent ? formatEther(agent.stakedAmount) : '0'} ETH
        </div>
      </div>

      {/* Tier Selection */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Upgrade to Higher Tier</h3>
        <div className="grid gap-3">
          {TIER_INFO.map((tier, index) => {
            const isCurrentTier = index === currentTier;
            const isLowerTier = index < currentTier;
            const canUpgrade = index > currentTier;

            return (
              <button
                key={index}
                onClick={() => canUpgrade && setSelectedTier(index)}
                disabled={isCurrentTier || isLowerTier || isPending || isConfirming}
                className={`p-4 border-2 rounded-lg text-left transition-all ${
                  isCurrentTier
                    ? 'border-blue-500 bg-blue-50'
                    : selectedTier === index
                    ? 'border-green-500 bg-green-50'
                    : canUpgrade
                    ? 'border-gray-200 hover:border-gray-300 cursor-pointer'
                    : 'border-gray-100 bg-gray-50 cursor-not-allowed opacity-60'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Shield size={20} className={isCurrentTier ? 'text-blue-500' : 'text-gray-400'} />
                    <span className="font-semibold">Tier {index}: {tier.name}</span>
                  </div>
                  {isCurrentTier && (
                    <span className="px-2 py-1 bg-blue-500 text-white text-xs rounded">Current</span>
                  )}
                  {selectedTier === index && (
                    <span className="px-2 py-1 bg-green-500 text-white text-xs rounded">Selected</span>
                  )}
                </div>
                <div className="text-sm text-gray-600 mb-1">{tier.benefits}</div>
                <div className="text-lg font-bold text-gray-900">{tier.stake} ETH</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Upgrade Button */}
      {selectedTier !== null && selectedTier > currentTier && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="text-green-600" size={24} />
            <h3 className="text-lg font-semibold text-green-900">Ready to Upgrade</h3>
          </div>
          <div className="mb-4">
            <div className="text-sm text-green-700">
              You will stake <span className="font-bold">{TIER_INFO[selectedTier].stake} ETH</span> to upgrade to{' '}
              <span className="font-bold">Tier {selectedTier}</span>
            </div>
            <div className="text-sm text-green-600 mt-1">
              This stake is refundable if you de-register later
            </div>
          </div>
          <button
            onClick={handleUpgrade}
            disabled={isPending || isConfirming}
            className="w-full py-3 bg-green-500 text-white rounded-lg font-semibold hover:bg-green-600 disabled:bg-gray-300"
          >
            {isPending ? 'Preparing...' : isConfirming ? 'Confirming...' : isSuccess ? '✓ Upgraded!' : 'Upgrade Now'}
          </button>
        </div>
      )}

      {/* Benefits Info */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h4 className="font-semibold mb-2 flex items-center gap-2">
          <Award size={18} className="text-yellow-500" />
          Reputation Benefits
        </h4>
        <ul className="text-sm text-gray-700 space-y-1">
          <li>• Higher tiers increase trust across all Jeju apps</li>
          <li>• Voting power increases with tier (Medium: 1.5x, High: 2x)</li>
          <li>• High Tier required to become Guardian</li>
          <li>• Stake is fully refundable if you de-register</li>
          <li>• Can be slashed if you violate network rules</li>
        </ul>
      </div>
    </div>
  );
}

