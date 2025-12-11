import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { PAYMASTER_FACTORY_ABI } from '../lib/contracts';
import { CONTRACTS } from '../config';

export function usePaymasterFactory() {
  const paymasterFactory = CONTRACTS.paymasterFactory;

  // Read all deployments
  const { data: allDeployments, refetch: refetchDeployments } = useReadContract({
    address: paymasterFactory,
    abi: PAYMASTER_FACTORY_ABI,
    functionName: 'getAllDeployments',
  });

  // Write: Deploy paymaster
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const deployPaymaster = async (
    tokenAddress: `0x${string}`,
    feeMargin: number,
    operator: `0x${string}`
  ) => {
    writeContract({
      address: paymasterFactory,
      abi: PAYMASTER_FACTORY_ABI,
      functionName: 'deployPaymaster',
      args: [tokenAddress, BigInt(feeMargin), operator],
    });
  };

  return {
    allDeployments: (allDeployments as `0x${string}`[]) || [],
    deployPaymaster,
    isPending: isPending || isConfirming,
    isSuccess,
    refetchDeployments,
  };
}

export function usePaymasterDeployment(tokenAddress: `0x${string}` | undefined) {
  const paymasterFactory = CONTRACTS.paymasterFactory;

  const { data: deployment, refetch } = useReadContract({
    address: paymasterFactory,
    abi: PAYMASTER_FACTORY_ABI,
    functionName: 'getDeployment',
    args: tokenAddress ? [tokenAddress] : undefined,
  });

  return {
    deployment,
    refetch,
  };
}

