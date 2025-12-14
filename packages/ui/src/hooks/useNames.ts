/**
 * Names hook
 */

import { useCallback, useState } from 'react';
import type { Address, Hex } from 'viem';
import { useNetworkContext } from '../context';
import type { NameInfo, RegisterNameParams, NameRecords } from '@jejunetwork/sdk';

export function useNames() {
  const { client } = useNetworkContext();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const resolve = useCallback(
    async (name: string): Promise<Address | null> => {
      if (!client) throw new Error('Not connected');
      return client.names.resolve(name);
    },
    [client]
  );

  const reverseResolve = useCallback(
    async (address: Address): Promise<string | null> => {
      if (!client) throw new Error('Not connected');
      return client.names.reverseResolve(address);
    },
    [client]
  );

  const register = useCallback(
    async (params: RegisterNameParams): Promise<Hex> => {
      if (!client) throw new Error('Not connected');
      setIsLoading(true);
      setError(null);

      const txHash = await client.names.register(params);
      setIsLoading(false);
      return txHash;
    },
    [client]
  );

  const listMyNames = useCallback(async (): Promise<NameInfo[]> => {
    if (!client) throw new Error('Not connected');
    return client.names.listMyNames();
  }, [client]);

  const isAvailable = useCallback(
    async (name: string): Promise<boolean> => {
      if (!client) throw new Error('Not connected');
      return client.names.isAvailable(name);
    },
    [client]
  );

  const getPrice = useCallback(
    async (name: string, years: number): Promise<bigint> => {
      if (!client) throw new Error('Not connected');
      return client.names.getRegistrationPrice(name, years);
    },
    [client]
  );

  const setRecords = useCallback(
    async (name: string, records: NameRecords): Promise<Hex> => {
      if (!client) throw new Error('Not connected');
      return client.names.setRecords(name, records);
    },
    [client]
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

