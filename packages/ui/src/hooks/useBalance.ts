import { useEffect, useState, useCallback } from "react";
import { formatEther } from "viem";
import { useNetworkContext } from "../context";
import { useAsyncState, type AsyncState } from "./utils";

export interface UseBalanceResult extends AsyncState {
  balance: bigint | null;
  balanceFormatted: string | null;
  refetch: () => Promise<void>;
}

export function useBalance(): UseBalanceResult {
  const { client } = useNetworkContext();
  const { isLoading, error, execute } = useAsyncState();
  const [balance, setBalance] = useState<bigint | null>(null);

  const refetch = useCallback(async (): Promise<void> => {
    if (!client) return;
    const bal = await execute<bigint>(() => client.getBalance());
    setBalance(bal);
  }, [client, execute]);

  useEffect(() => {
    if (client) {
      refetch().catch(() => {});
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
