/**
 * Cross-chain hook
 */

import { useCallback, useState } from 'react';
import type { Hex } from 'viem';
import { useNetworkContext } from '../context';
import type { TransferParams, CrossChainQuote, IntentStatus, SupportedChain } from '@jejunetwork/sdk';

export function useCrossChain() {
  const { client } = useNetworkContext();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const getQuote = useCallback(
    async (params: TransferParams): Promise<CrossChainQuote> => {
      if (!client) throw new Error('Not connected');
      return client.crosschain.getQuote(params);
    },
    [client]
  );

  const getQuotes = useCallback(
    async (params: TransferParams): Promise<CrossChainQuote[]> => {
      if (!client) throw new Error('Not connected');
      return client.crosschain.getQuotes(params);
    },
    [client]
  );

  const transfer = useCallback(
    async (quote: CrossChainQuote): Promise<Hex> => {
      if (!client) throw new Error('Not connected');
      setIsLoading(true);
      setError(null);

      const txHash = await client.crosschain.transfer(quote);
      setIsLoading(false);
      return txHash;
    },
    [client]
  );

  const listMyIntents = useCallback(async (): Promise<IntentStatus[]> => {
    if (!client) throw new Error('Not connected');
    return client.crosschain.listMyIntents();
  }, [client]);

  const getSupportedChains = useCallback((): SupportedChain[] => {
    if (!client) throw new Error('Not connected');
    return client.crosschain.getSupportedChains();
  }, [client]);

  return {
    isLoading,
    error,
    getQuote,
    getQuotes,
    transfer,
    listMyIntents,
    getSupportedChains,
  };
}

