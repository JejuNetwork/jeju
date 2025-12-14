/**
 * @fileoverview Cross-chain transfer hooks using EIL
 */

import { useCallback, useState, useMemo } from 'react';
import type { Address, Hex } from 'viem';
import { usePublicClient, useWalletClient, useChainId } from 'wagmi';
import { EILClient } from '../sdk/eil';
import type { CrossChainTransferParams } from '../sdk/eil';
import { getChainContracts, chains } from '../sdk/chains';

// ============================================================================
// Types
// ============================================================================

export type TransferStatus =
  | 'idle'
  | 'approving'
  | 'creating'
  | 'waiting'
  | 'claimed'
  | 'complete'
  | 'failed';

export interface CrossChainTransferState {
  status: TransferStatus;
  requestId?: Hex;
  txHash?: Hex;
  error?: string;
  currentFee?: bigint;
}

// ============================================================================
// Hook: useCrossChainTransfer
// ============================================================================

export function useCrossChainTransfer() {
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [state, setState] = useState<CrossChainTransferState>({
    status: 'idle',
  });

  // Create EIL client
  const eilClient = useMemo(() => {
    if (!publicClient) return null;

    const contracts = getChainContracts(chainId);
    return new EILClient({
      chainId,
      publicClient,
      walletClient: walletClient ?? undefined,
      paymasterAddress: contracts.crossChainPaymaster,
    });
  }, [chainId, publicClient, walletClient]);

  // Execute cross-chain transfer
  const transfer = useCallback(
    async (params: CrossChainTransferParams) => {
      if (!eilClient || !walletClient) {
        setState({ status: 'failed', error: 'Wallet not connected' });
        return;
      }

      setState({ status: 'creating' });

      try {
        const result = await eilClient.createCrossChainTransfer(params);

        setState({
          status: 'waiting',
          requestId: result.requestId,
          txHash: result.txHash,
        });

        // Poll for status updates
        const pollInterval = setInterval(async () => {
          try {
            const request = await eilClient.getRequest(result.requestId);
            if (!request) {
              clearInterval(pollInterval);
              return;
            }

            const fee = await eilClient.getCurrentFee(result.requestId);
            setState((prev) => ({ ...prev, currentFee: fee }));

            if (request.status === 'issued') {
              setState((prev) => ({ ...prev, status: 'claimed' }));
            } else if (request.status === 'fulfilled') {
              clearInterval(pollInterval);
              setState((prev) => ({ ...prev, status: 'complete' }));
            } else if (request.status === 'expired') {
              clearInterval(pollInterval);
              setState((prev) => ({
                ...prev,
                status: 'failed',
                error: 'Transfer expired',
              }));
            }
          } catch {
            // Continue polling
          }
        }, 5000);

        // Cleanup after 10 minutes
        setTimeout(() => clearInterval(pollInterval), 600000);
      } catch (e) {
        setState({
          status: 'failed',
          error: e instanceof Error ? e.message : 'Transfer failed',
        });
      }
    },
    [eilClient, walletClient]
  );

  // Refund expired request
  const refund = useCallback(
    async (requestId: Hex) => {
      if (!eilClient || !walletClient) {
        throw new Error('Wallet not connected');
      }

      const hash = await eilClient.refundExpiredRequest(requestId);
      return hash;
    },
    [eilClient, walletClient]
  );

  // Get request details
  const getRequest = useCallback(
    async (requestId: Hex) => {
      if (!eilClient) return null;
      return eilClient.getRequest(requestId);
    },
    [eilClient]
  );

  // Reset state
  const reset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  // Get destination chains
  const destinationChains = useMemo(() => {
    return Object.values(chains)
      .filter((c) => c.id !== chainId && c.eilSupported)
      .map((c) => ({
        id: c.id,
        name: c.name,
        testnet: c.testnet ?? false,
      }));
  }, [chainId]);

  return {
    state,
    transfer,
    refund,
    getRequest,
    reset,
    destinationChains,
    isReady: !!eilClient && !!walletClient,
  };
}

// ============================================================================
// Hook: useSwap (EIL AMM)
// ============================================================================

export function useSwap() {
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eilClient = useMemo(() => {
    if (!publicClient) return null;
    return new EILClient({
      chainId,
      publicClient,
      walletClient: walletClient ?? undefined,
    });
  }, [chainId, publicClient, walletClient]);

  // Get swap quote
  const getQuote = useCallback(
    async (tokenIn: Address, tokenOut: Address, amountIn: bigint) => {
      if (!eilClient) return null;

      try {
        return await eilClient.getSwapQuote(tokenIn, tokenOut, amountIn);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to get quote');
        return null;
      }
    },
    [eilClient]
  );

  // Execute swap
  const swap = useCallback(
    async (params: {
      tokenIn: Address;
      tokenOut: Address;
      amountIn: bigint;
      minAmountOut: bigint;
    }) => {
      if (!eilClient || !walletClient) {
        throw new Error('Wallet not connected');
      }

      setIsLoading(true);
      setError(null);

      try {
        const hash = await eilClient.swap(params);
        return hash;
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Swap failed';
        setError(message);
        throw new Error(message);
      } finally {
        setIsLoading(false);
      }
    },
    [eilClient, walletClient]
  );

  return {
    getQuote,
    swap,
    isLoading,
    error,
    isReady: !!eilClient && !!walletClient,
  };
}

