/**
 * @fileoverview Intent-based transaction hooks using OIF
 */

import { useCallback, useState, useMemo, useEffect } from 'react';
import type { Hex } from 'viem';
import { usePublicClient, useWalletClient, useChainId, useAccount } from 'wagmi';
import { OIFClient } from '../sdk/oif';
import type { Intent, IntentParams, IntentQuote, IntentStatus } from '../sdk/types';
import { chains } from '../sdk/chains';

// ============================================================================
// Hook: useIntents
// ============================================================================

export function useIntents() {
  const chainId = useChainId();
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [activeIntents, setActiveIntents] = useState<Intent[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const oifClient = useMemo(() => {
    if (!publicClient) return null;
    return new OIFClient({
      chainId,
      publicClient,
      walletClient: walletClient ?? undefined,
    });
  }, [chainId, publicClient, walletClient]);

  // Get quote for intent
  const getQuote = useCallback(
    async (params: IntentParams): Promise<IntentQuote | null> => {
      if (!oifClient) return null;

      try {
        return await oifClient.getQuote(params);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to get quote');
        return null;
      }
    },
    [oifClient]
  );

  // Create intent
  const createIntent = useCallback(
    async (params: IntentParams) => {
      if (!oifClient || !walletClient || !address) {
        throw new Error('Wallet not connected');
      }

      setIsCreating(true);
      setError(null);

      try {
        const result = await oifClient.createIntent(params);

        // Add to active intents
        const newIntent: Intent = {
          id: result.intentId,
          user: address,
          inputToken: params.inputToken,
          inputAmount: params.inputAmount,
          outputToken: params.outputToken,
          outputAmount: params.minOutputAmount,
          sourceChainId: chainId,
          destinationChainId: params.destinationChainId,
          recipient: params.recipient ?? address,
          maxFee: params.maxFee ?? 0n,
          openDeadline: 0, // Would come from contract
          fillDeadline: 0,
          status: 'created',
          txHash: result.txHash,
          createdAt: Date.now(),
        };

        setActiveIntents((prev) => [newIntent, ...prev]);

        // Watch for status changes
        oifClient.watchIntent(result.intentId, (status) => {
          setActiveIntents((prev) =>
            prev.map((intent) =>
              intent.id === result.intentId ? { ...intent, status } : intent
            )
          );
        });

        return result;
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to create intent';
        setError(message);
        throw new Error(message);
      } finally {
        setIsCreating(false);
      }
    },
    [oifClient, walletClient, address, chainId]
  );

  // Refund intent
  const refundIntent = useCallback(
    async (intentId: Hex) => {
      if (!oifClient || !walletClient) {
        throw new Error('Wallet not connected');
      }

      try {
        const hash = await oifClient.refundIntent(intentId);

        // Update status
        setActiveIntents((prev) =>
          prev.map((intent) =>
            intent.id === intentId ? { ...intent, status: 'refunded' as IntentStatus } : intent
          )
        );

        return hash;
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to refund intent';
        setError(message);
        throw new Error(message);
      }
    },
    [oifClient, walletClient]
  );

  // Check if intent can be refunded
  const canRefund = useCallback(
    async (intentId: Hex): Promise<boolean> => {
      if (!oifClient) return false;
      return oifClient.canRefund(intentId);
    },
    [oifClient]
  );

  // Get supported destination chains
  const destinationChains = useMemo(() => {
    return Object.values(chains)
      .filter((c) => c.id !== chainId && c.oifSupported)
      .map((c) => ({
        id: c.id,
        name: c.name,
        testnet: c.testnet ?? false,
      }));
  }, [chainId]);

  return {
    activeIntents,
    isCreating,
    error,
    getQuote,
    createIntent,
    refundIntent,
    canRefund,
    destinationChains,
    isReady: !!oifClient && !!walletClient,
  };
}

// ============================================================================
// Hook: useIntentQuote
// ============================================================================

export function useIntentQuote(params: IntentParams | null) {
  const chainId = useChainId();
  const publicClient = usePublicClient();

  const [quote, setQuote] = useState<IntentQuote | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const oifClient = useMemo(() => {
    if (!publicClient) return null;
    return new OIFClient({
      chainId,
      publicClient,
    });
  }, [chainId, publicClient]);

  useEffect(() => {
    if (!oifClient || !params || params.inputAmount === 0n) {
      setQuote(null);
      return;
    }

    let cancelled = false;

    const fetchQuote = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await oifClient.getQuote(params);
        if (!cancelled) {
          setQuote(result);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to get quote');
          setQuote(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchQuote();

    return () => {
      cancelled = true;
    };
  }, [oifClient, params?.inputToken, params?.outputToken, params?.inputAmount, params?.destinationChainId]);

  return { quote, isLoading, error };
}

// ============================================================================
// Hook: useIntentHistory
// ============================================================================

export function useIntentHistory() {
  const { address } = useAccount();
  const [intents, setIntents] = useState<Intent[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch intent history from indexer/API
  const fetchHistory = useCallback(async () => {
    if (!address) return;

    setIsLoading(true);

    try {
      // In production, call the indexer API
      const response = await fetch(
        `https://api.jejunetwork.org/oif/intents?user=${address}`
      );

      if (response.ok) {
        const data = await response.json();
        setIntents(data.intents ?? []);
      }
    } catch {
      // Silently fail - history is optional
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return {
    intents,
    isLoading,
    refetch: fetchHistory,
  };
}

