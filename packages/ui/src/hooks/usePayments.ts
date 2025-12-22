import { useCallback } from "react";
import type { Address, Hex } from "viem";
import { useNetworkContext } from "../context";
import { useAsyncState, requireClient, type AsyncState } from "./utils";
import type {
  PaymasterInfo,
  CreditBalance,
  ServiceType,
} from "@jejunetwork/sdk";

export interface UsePaymentsResult extends AsyncState {
  getBalance: () => Promise<bigint>;
  getTokenBalance: (token: Address) => Promise<bigint>;
  listPaymasters: () => Promise<PaymasterInfo[]>;
  getCredits: (service: ServiceType) => Promise<CreditBalance>;
  depositCredits: (service: ServiceType, amount: bigint) => Promise<Hex>;
  provideLiquidity: (paymaster: Address, amount: bigint) => Promise<Hex>;
}

export function usePayments(): UsePaymentsResult {
  const { client } = useNetworkContext();
  const { isLoading, error, execute } = useAsyncState();

  const getBalance = useCallback(async (): Promise<bigint> => {
    const c = requireClient(client);
    return c.payments.getBalance();
  }, [client]);

  const getTokenBalance = useCallback(
    async (token: Address): Promise<bigint> => {
      const c = requireClient(client);
      return c.payments.getTokenBalance(token);
    },
    [client],
  );

  const listPaymasters = useCallback(async (): Promise<PaymasterInfo[]> => {
    const c = requireClient(client);
    return c.payments.listPaymasters();
  }, [client]);

  const getCredits = useCallback(
    async (service: ServiceType): Promise<CreditBalance> => {
      const c = requireClient(client);
      return c.payments.getCredits(service);
    },
    [client],
  );

  const depositCredits = useCallback(
    async (service: ServiceType, amount: bigint): Promise<Hex> => {
      const c = requireClient(client);
      return execute(() => c.payments.depositCredits(service, amount));
    },
    [client, execute],
  );

  const provideLiquidity = useCallback(
    async (paymaster: Address, amount: bigint): Promise<Hex> => {
      const c = requireClient(client);
      return execute(() => c.payments.provideLiquidity(paymaster, amount));
    },
    [client, execute],
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
