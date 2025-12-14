/**
 * Compute hook
 */

import { useCallback, useState } from 'react';
import type { Address, Hex } from 'viem';
import { useNetworkContext } from '../context';
import type {
  ProviderInfo,
  RentalInfo,
  CreateRentalParams,
  InferenceParams,
  InferenceResult,
  ListProvidersOptions,
} from '@jejunetwork/sdk';

export function useCompute() {
  const { client } = useNetworkContext();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const listProviders = useCallback(
    async (options?: ListProvidersOptions): Promise<ProviderInfo[]> => {
      if (!client) throw new Error('Not connected');
      setIsLoading(true);
      setError(null);

      const providers = await client.compute.listProviders(options);
      setIsLoading(false);
      return providers;
    },
    [client]
  );

  const getQuote = useCallback(
    async (
      provider: Address,
      durationHours: number
    ): Promise<{ cost: bigint; costFormatted: string }> => {
      if (!client) throw new Error('Not connected');
      return client.compute.getQuote(provider, durationHours);
    },
    [client]
  );

  const createRental = useCallback(
    async (params: CreateRentalParams): Promise<Hex> => {
      if (!client) throw new Error('Not connected');
      setIsLoading(true);
      setError(null);

      const txHash = await client.compute.createRental(params);
      setIsLoading(false);
      return txHash;
    },
    [client]
  );

  const listMyRentals = useCallback(async (): Promise<RentalInfo[]> => {
    if (!client) throw new Error('Not connected');
    return client.compute.listMyRentals();
  }, [client]);

  const cancelRental = useCallback(
    async (rentalId: Hex): Promise<Hex> => {
      if (!client) throw new Error('Not connected');
      return client.compute.cancelRental(rentalId);
    },
    [client]
  );

  const inference = useCallback(
    async (params: InferenceParams): Promise<InferenceResult> => {
      if (!client) throw new Error('Not connected');
      setIsLoading(true);
      setError(null);

      const result = await client.compute.inference(params);
      setIsLoading(false);
      return result;
    },
    [client]
  );

  return {
    isLoading,
    error,
    listProviders,
    getQuote,
    createRental,
    listMyRentals,
    cancelRental,
    inference,
  };
}

