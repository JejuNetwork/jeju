import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { toast } from 'sonner';
import { useEffect } from 'react';
import { CONTRACTS } from '@/config';

const PREDIMARKET_ADDRESS = CONTRACTS.predimarket;

const PREDIMARKET_ABI = [
  {
    name: 'claim',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'sessionId', type: 'bytes32' }],
    outputs: [{ name: 'payout', type: 'uint256' }]
  }
] as const;

export function useClaim(sessionId: string) {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) {
      toast.success('Winnings claimed successfully!');
    }
  }, [isSuccess]);

  useEffect(() => {
    if (error) {
      toast.error('Failed to claim winnings', {
        description: error.message,
      });
    }
  }, [error]);

  const claim = () => {
    if (PREDIMARKET_ADDRESS === '0x0') {
      toast.error('Predimarket contract not deployed');
      return;
    }

    writeContract({
      address: PREDIMARKET_ADDRESS,
      abi: PREDIMARKET_ABI,
      functionName: 'claim',
      args: [sessionId as `0x${string}`],
    });
  };

  return {
    claim,
    isPending: isPending || isConfirming,
    isSuccess,
    error,
  };
}



