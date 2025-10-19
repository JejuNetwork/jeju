import { useAccount, useReadContracts } from 'wagmi';
import { useMemo } from 'react';
import { getAllTokens } from '../lib/tokens';

const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view'
  }
] as const;

export function useTokenBalances() {
  const { address: userAddress } = useAccount();
  const tokens = getAllTokens();

  const contracts = useMemo(() => {
    if (!userAddress) return [];
    
    return tokens.map(token => ({
      address: token.address as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf' as const,
      args: [userAddress],
    }));
  }, [userAddress, tokens]);

  const { data, isLoading, refetch } = useReadContracts({
    contracts,
  });

  const balances = useMemo(() => {
    if (!data) return {};
    
    const result: Record<string, bigint> = {};
    
    tokens.forEach((token, index) => {
      const balance = data[index];
      if (balance?.status === 'success' && balance.result !== undefined) {
        result[token.symbol] = balance.result;
      }
    });
    
    return result;
  }, [data, tokens]);

  return {
    balances,
    isLoading,
    refetch,
  };
}

