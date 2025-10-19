import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import { TOKEN_REGISTRY_ABI, getContractAddresses } from '../lib/contracts';

export function useTokenRegistry() {
  const { tokenRegistry } = getContractAddresses();

  // Read all tokens
  const { data: allTokens, refetch: refetchTokens } = useReadContract({
    address: tokenRegistry,
    abi: TOKEN_REGISTRY_ABI,
    functionName: 'getAllTokens',
  });

  // Read registration fee
  const { data: registrationFee } = useReadContract({
    address: tokenRegistry,
    abi: TOKEN_REGISTRY_ABI,
    functionName: 'registrationFee',
  });

  // Write: Register token
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const registerToken = async (
    tokenAddress: `0x${string}`,
    oracleAddress: `0x${string}`,
    minFee: number,
    maxFee: number
  ) => {
    writeContract({
      address: tokenRegistry,
      abi: TOKEN_REGISTRY_ABI,
      functionName: 'registerToken',
      args: [tokenAddress, oracleAddress, BigInt(minFee), BigInt(maxFee)],
      value: registrationFee || parseEther('0.1'),
    });
  };

  return {
    allTokens: (allTokens as `0x${string}`[]) || [],
    registrationFee,
    registerToken,
    isPending: isPending || isConfirming,
    isSuccess,
    refetchTokens,
  };
}

export function useTokenConfig(tokenAddress: `0x${string}` | undefined) {
  const { tokenRegistry } = getContractAddresses();

  const { data: config, refetch } = useReadContract({
    address: tokenRegistry,
    abi: TOKEN_REGISTRY_ABI,
    functionName: 'getTokenConfig',
    args: tokenAddress ? [tokenAddress] : undefined,
  });

  return {
    config,
    refetch,
  };
}

