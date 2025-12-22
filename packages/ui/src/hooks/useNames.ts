import { useCallback } from "react";
import type { Address, Hex } from "viem";
import { useNetworkContext } from "../context";
import { useAsyncState, requireClient, type AsyncState } from "./utils";
import type {
  NameInfo,
  RegisterNameParams,
  NameRecords,
} from "@jejunetwork/sdk";

export interface UseNamesResult extends AsyncState {
  resolve: (name: string) => Promise<Address | null>;
  reverseResolve: (address: Address) => Promise<string | null>;
  register: (params: RegisterNameParams) => Promise<Hex>;
  listMyNames: () => Promise<NameInfo[]>;
  isAvailable: (name: string) => Promise<boolean>;
  getPrice: (name: string, years: number) => Promise<bigint>;
  setRecords: (name: string, records: NameRecords) => Promise<Hex>;
}

export function useNames(): UseNamesResult {
  const { client } = useNetworkContext();
  const { isLoading, error, execute } = useAsyncState();

  const resolve = useCallback(
    async (name: string): Promise<Address | null> => {
      const c = requireClient(client);
      return c.names.resolve(name);
    },
    [client],
  );

  const reverseResolve = useCallback(
    async (address: Address): Promise<string | null> => {
      const c = requireClient(client);
      return c.names.reverseResolve(address);
    },
    [client],
  );

  const register = useCallback(
    async (params: RegisterNameParams): Promise<Hex> => {
      const c = requireClient(client);
      return execute(() => c.names.register(params));
    },
    [client, execute],
  );

  const listMyNames = useCallback(async (): Promise<NameInfo[]> => {
    const c = requireClient(client);
    return c.names.listMyNames();
  }, [client]);

  const isAvailable = useCallback(
    async (name: string): Promise<boolean> => {
      const c = requireClient(client);
      return c.names.isAvailable(name);
    },
    [client],
  );

  const getPrice = useCallback(
    async (name: string, years: number): Promise<bigint> => {
      const c = requireClient(client);
      return c.names.getRegistrationPrice(name, years);
    },
    [client],
  );

  const setRecords = useCallback(
    async (name: string, records: NameRecords): Promise<Hex> => {
      const c = requireClient(client);
      return c.names.setRecords(name, records);
    },
    [client],
  );

  return {
    isLoading,
    error,
    resolve,
    reverseResolve,
    register,
    listMyNames,
    isAvailable,
    getPrice,
    setRecords,
  };
}
