import { useEffect, useState, useCallback } from "react";
import { formatEther } from "viem";
import { useNetworkContext } from "../context";

export interface UseBalanceResult {
  balance: bigint | null;
  balanceFormatted: string | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useBalance(): UseBalanceResult {
  const { client } = useNetworkContext();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async (): Promise<void> => {
    if (!client) return;

    setIsLoading(true);
    setError(null);

    const bal = await client.getBalance();
    setBalance(bal);
    setIsLoading(false);
  }, [client]);

  useEffect(() => {
    if (client) {
      refetch().catch((e: unknown) =>
        setError(e instanceof Error ? e : new Error(String(e))),
      );
    }
  }, [client, refetch]);

  return {
    balance,
    balanceFormatted: balance !== null ? formatEther(balance) : null,
    isLoading,
    error,
    refetch,
  };
}
