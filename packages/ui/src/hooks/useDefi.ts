/**
 * DeFi hook
 */

import { useCallback, useState } from "react";
import type { Address, Hex } from "viem";
import { useNetworkContext } from "../context";
import type {
  SwapParams,
  SwapQuote,
  PoolInfo,
  LiquidityPosition,
  AddLiquidityParams,
} from "@jejunetwork/sdk";

export function useDefi() {
  const { client } = useNetworkContext();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const getSwapQuote = useCallback(
    async (params: SwapParams): Promise<SwapQuote> => {
      if (!client) throw new Error("Not connected");
      return client.defi.getSwapQuote(params);
    },
    [client],
  );

  const swap = useCallback(
    async (quote: SwapQuote): Promise<Hex> => {
      if (!client) throw new Error("Not connected");
      setIsLoading(true);
      setError(null);

      const txHash = await client.defi.swap(quote);
      setIsLoading(false);
      return txHash;
    },
    [client],
  );

  const listPools = useCallback(async (): Promise<PoolInfo[]> => {
    if (!client) throw new Error("Not connected");
    return client.defi.listPools();
  }, [client]);

  const addLiquidity = useCallback(
    async (params: AddLiquidityParams): Promise<Hex> => {
      if (!client) throw new Error("Not connected");
      setIsLoading(true);
      setError(null);

      const txHash = await client.defi.addLiquidity(params);
      setIsLoading(false);
      return txHash;
    },
    [client],
  );

  const listPositions = useCallback(async (): Promise<LiquidityPosition[]> => {
    if (!client) throw new Error("Not connected");
    return client.defi.listPositions();
  }, [client]);

  const collectFees = useCallback(
    async (positionId: bigint): Promise<Hex> => {
      if (!client) throw new Error("Not connected");
      return client.defi.collectFees(positionId);
    },
    [client],
  );

  const getBalance = useCallback(
    async (token: Address): Promise<bigint> => {
      if (!client) throw new Error("Not connected");
      return client.defi.getBalance(token);
    },
    [client],
  );

  return {
    isLoading,
    error,
    getSwapQuote,
    swap,
    listPools,
    addLiquidity,
    listPositions,
    collectFees,
    getBalance,
  };
}
