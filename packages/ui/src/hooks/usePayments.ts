/**
 * Payments hook
 */

import { useCallback, useState } from "react";
import type { Address, Hex } from "viem";
import { useNetworkContext } from "../context";
import type { PaymasterInfo, CreditBalance } from "@jejunetwork/sdk";

export function usePayments() {
  const { client } = useNetworkContext();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const getBalance = useCallback(async (): Promise<bigint> => {
    if (!client) throw new Error("Not connected");
    return client.payments.getBalance();
  }, [client]);

  const getTokenBalance = useCallback(
    async (token: Address): Promise<bigint> => {
      if (!client) throw new Error("Not connected");
      return client.payments.getTokenBalance(token);
    },
    [client],
  );

  const listPaymasters = useCallback(async (): Promise<PaymasterInfo[]> => {
    if (!client) throw new Error("Not connected");
    return client.payments.listPaymasters();
  }, [client]);

  const getCredits = useCallback(
    async (
      service: "compute" | "storage" | "inference",
    ): Promise<CreditBalance> => {
      if (!client) throw new Error("Not connected");
      return client.payments.getCredits(service);
    },
    [client],
  );

  const depositCredits = useCallback(
    async (
      service: "compute" | "storage" | "inference",
      amount: bigint,
    ): Promise<Hex> => {
      if (!client) throw new Error("Not connected");
      setIsLoading(true);
      setError(null);

      const txHash = await client.payments.depositCredits(service, amount);
      setIsLoading(false);
      return txHash;
    },
    [client],
  );

  const provideLiquidity = useCallback(
    async (paymaster: Address, amount: bigint): Promise<Hex> => {
      if (!client) throw new Error("Not connected");
      setIsLoading(true);
      setError(null);

      const txHash = await client.payments.provideLiquidity(paymaster, amount);
      setIsLoading(false);
      return txHash;
    },
    [client],
  );

  return {
    isLoading,
    error,
    getBalance,
    getTokenBalance,
    listPaymasters,
    getCredits,
    depositCredits,
    provideLiquidity,
  };
}
