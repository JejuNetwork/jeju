/**
 * Hook to load protocol tokens configuration
 * 
 * Loads from protocol-tokens.json and provides typed access
 */

import { useMemo } from 'react';
import { getProtocolTokens } from '../lib/tokens';

export interface ProtocolToken {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  priceUSD: number;
  hasPaymaster: boolean;
  bridged: boolean;
  originChain: string;
  baseAddress?: string;
  vaultAddress?: string;
  distributorAddress?: string;
  paymasterAddress?: string;
  logoUrl?: string;
}

export function useProtocolTokens() {
  const tokens = useMemo(() => getProtocolTokens(), []);

  const tokensBySymbol = useMemo(() => {
    const map = new Map<string, ProtocolToken>();
    tokens.forEach(token => map.set(token.symbol, token));
    return map;
  }, [tokens]);

  const tokensByAddress = useMemo(() => {
    const map = new Map<string, ProtocolToken>();
    tokens.forEach(token => map.set(token.address.toLowerCase(), token));
    return map;
  }, [tokens]);

  const bridgeableTokens = useMemo(
    () => tokens.filter(t => t.bridged),
    [tokens]
  );

  const nativeTokens = useMemo(
    () => tokens.filter(t => !t.bridged),
    [tokens]
  );

  const getToken = (symbolOrAddress: string): ProtocolToken | undefined => {
    return tokensBySymbol.get(symbolOrAddress) || 
           tokensByAddress.get(symbolOrAddress.toLowerCase());
  };

  return {
    tokens,
    bridgeableTokens,
    nativeTokens,
    getToken,
    tokensBySymbol,
    tokensByAddress,
  };
}

