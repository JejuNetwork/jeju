import { useMemo } from 'react';
import { getProtocolTokens, getPreferredToken, getPaymasterTokens } from '../lib/tokens';

export interface ProtocolToken {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  priceUSD: number;
  hasPaymaster: boolean;
  bridged: boolean;
  originChain: string;
  l1Address?: string;
  vaultAddress?: string;
  distributorAddress?: string;
  paymasterAddress?: string;
  logoUrl?: string;
  isPreferred?: boolean;
  hasBanEnforcement?: boolean;
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

  const bridgeableTokens = useMemo(() => tokens.filter(t => t.bridged), [tokens]);
  const nativeTokens = useMemo(() => tokens.filter(t => !t.bridged), [tokens]);
  const preferredToken = useMemo(() => getPreferredToken(), []);
  const paymasterTokens = useMemo(() => getPaymasterTokens(), []);

  const getToken = (symbolOrAddress: string): ProtocolToken | undefined => {
    return tokensBySymbol.get(symbolOrAddress) || tokensByAddress.get(symbolOrAddress.toLowerCase());
  };

  const getBestPaymentToken = (balances: Record<string, bigint>): ProtocolToken | undefined => {
    if (preferredToken && balances[preferredToken.symbol] && balances[preferredToken.symbol] > 0n) {
      return preferredToken;
    }
    for (const token of paymasterTokens) {
      if (balances[token.symbol] && balances[token.symbol] > 0n) {
        return token;
      }
    }
    return preferredToken;
  };

  return {
    tokens,
    bridgeableTokens,
    nativeTokens,
    preferredToken,
    paymasterTokens,
    getToken,
    getBestPaymentToken,
    tokensBySymbol,
    tokensByAddress,
  };
}
