import { useCallback, useEffect, useRef, useState } from "react";
import { formatEther } from "viem";
import { useNetworkContext } from "../context";
import { type AsyncState, useAsyncState } from "./utils";

export interface UseBalanceResult extends AsyncState {
  balance: bigint | null;
  balanceFormatted: string | null;
  refetch: () => Promise<void>;
}

export function useBalance(): UseBalanceResult {
  const { client } = useNetworkContext();
  const { isLoading, error, execute } = useAsyncState();
  const [balance, setBalance] = useState<bigint | null>(null);
  const isMountedRef = useRef(true);

  const refetch = useCallback(async (): Promise<void> => {
    if (!client) return;
    const bal = await execute<bigint>(() => client.getBalance());
    if (isMountedRef.current) {
      setBalance(bal);
    }
  }, [client, execute]);

  useEffect(() => {
    isMountedRef.current = true;

    if (client) {
      refetch().catch(() => {});
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [client, refetch]);

  return {
    balance,
    balanceFormatted: balance !== null ? formatEther(balance) : null,
    isLoading,
    error,
    refetch,
  };
}
