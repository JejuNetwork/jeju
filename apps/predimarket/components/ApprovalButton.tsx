'use client';

import { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useReadContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, maxUint256 } from 'viem';

interface ApprovalButtonProps {
  tokenAddress: `0x${string}`;
  spenderAddress: `0x${string}`;
  amount: string;
  onApproved: () => void;
  tokenSymbol?: string;
}

const ERC20_ABI = [
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' }
    ],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  }
] as const;

export function ApprovalButton({ 
  tokenAddress, 
  spenderAddress, 
  amount,
  onApproved,
  tokenSymbol = 'elizaOS'
}: ApprovalButtonProps) {
  const { address } = useAccount();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // Check current allowance
  const { data: allowance, refetch } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, spenderAddress] : undefined,
    query: {
      enabled: !!address,
    },
  });

  const [needsApproval, setNeedsApproval] = useState(false);

  useEffect(() => {
    if (allowance !== undefined && amount) {
      try {
        const amountWei = parseEther(amount);
        setNeedsApproval(allowance < amountWei);
      } catch {
        setNeedsApproval(false);
      }
    }
  }, [allowance, amount]);

  useEffect(() => {
    if (isSuccess) {
      // Approval successful, refetch allowance
      refetch();
      onApproved();
    }
  }, [isSuccess, refetch, onApproved]);

  const handleApprove = () => {
    writeContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spenderAddress, maxUint256], // Approve unlimited
    });
  };

  if (!needsApproval) {
    return null;
  }

  return (
    <button
      onClick={handleApprove}
      disabled={isPending || isConfirming}
      className="w-full px-6 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white font-bold rounded-lg transition mb-4"
      data-testid="approve-button"
    >
      {isPending || isConfirming ? 'Approving...' : `Approve ${tokenSymbol}`}
    </button>
  );
}

