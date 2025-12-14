/**
 * Balance hook
 */

import { useEffect, useState, useCallback } from 'react';
import { formatEther } from 'viem';
import { useNetworkContext } from '../context';

export function useBalance() {
  const { client } = useNetworkContext();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    if (!client) return;

    setIsLoading(true);
    setError(null);

    const bal = await client.getBalance();
    setBalance(bal);
    setIsLoading(false);
  }, [client]);

  useEffect(() => {
    if (client) {
      refetch().catch((e) => setError(e instanceof Error ? e : new Error(String(e))));
    }
  }, [client, refetch]);

  return {
    balance,
    balanceFormatted: balance ? formatEther(balance) : null,
    isLoading,
    error,
    refetch,
  };
}

