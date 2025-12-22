import { useCallback } from "react";
import type { Address, Hex } from "viem";
import { useNetworkContext } from "../context";
import { useAsyncState, requireClient, type AsyncState } from "./utils";
import type {
  ProviderInfo,
  RentalInfo,
  CreateRentalParams,
  InferenceParams,
  InferenceResult,
  ListProvidersOptions,
} from "@jejunetwork/sdk";

export interface UseComputeResult extends AsyncState {
  listProviders: (options?: ListProvidersOptions) => Promise<ProviderInfo[]>;
  getQuote: (
    provider: Address,
    durationHours: number,
  ) => Promise<{ cost: bigint; costFormatted: string }>;
  createRental: (params: CreateRentalParams) => Promise<Hex>;
  listMyRentals: () => Promise<RentalInfo[]>;
  cancelRental: (rentalId: Hex) => Promise<Hex>;
  inference: (params: InferenceParams) => Promise<InferenceResult>;
}

export function useCompute(): UseComputeResult {
  const { client } = useNetworkContext();
  const { isLoading, error, execute } = useAsyncState();

  const listProviders = useCallback(
    async (options?: ListProvidersOptions): Promise<ProviderInfo[]> => {
      const c = requireClient(client);
      return execute(() => c.compute.listProviders(options));
    },
    [client, execute],
  );

  const getQuote = useCallback(
    async (
      provider: Address,
      durationHours: number,
    ): Promise<{ cost: bigint; costFormatted: string }> => {
      const c = requireClient(client);
      return c.compute.getQuote(provider, durationHours);
    },
    [client],
  );

  const createRental = useCallback(
    async (params: CreateRentalParams): Promise<Hex> => {
      const c = requireClient(client);
      return execute(() => c.compute.createRental(params));
    },
    [client, execute],
  );

  const listMyRentals = useCallback(async (): Promise<RentalInfo[]> => {
    const c = requireClient(client);
    return c.compute.listMyRentals();
  }, [client]);

  const cancelRental = useCallback(
    async (rentalId: Hex): Promise<Hex> => {
      const c = requireClient(client);
      return c.compute.cancelRental(rentalId);
    },
    [client],
  );

  const inference = useCallback(
    async (params: InferenceParams): Promise<InferenceResult> => {
      const c = requireClient(client);
      return execute(() => c.compute.inference(params));
    },
    [client, execute],
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
