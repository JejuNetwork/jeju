import type { TokenOption } from '../components/TokenSelector';
import { getTokenConfigs, type TokenConfig } from '../config/contracts.js';
import { ZERO_ADDRESS } from './contracts';

export interface ProtocolToken extends TokenOption {
  hasPaymaster: boolean;
  bridged: boolean;
  originChain: string;
  l1Address?: string;
  vaultAddress?: string;
  distributorAddress?: string;
  paymasterAddress?: string;
  isPreferred?: boolean;
  hasBanEnforcement?: boolean;
}

export function getAllTokens(): TokenOption[] {
  return getProtocolTokens().map(t => ({
    symbol: t.symbol,
    name: t.name,
    address: t.address,
    decimals: t.decimals,
    priceUSD: t.priceUSD,
    logoUrl: t.logoUrl,
  }));
}

export function getProtocolTokens(): ProtocolToken[] {
  const configs = getTokenConfigs();
  const tokens: ProtocolToken[] = configs.map((t: TokenConfig) => ({
    symbol: t.symbol,
    name: t.name,
    address: t.address,
    decimals: t.decimals,
    priceUSD: t.priceUSD,
    logoUrl: t.logoUrl,
    hasPaymaster: t.hasPaymaster,
    bridged: t.bridged,
    originChain: t.originChain,
    l1Address: t.l1Address,
    isPreferred: t.isPreferred,
    hasBanEnforcement: t.hasBanEnforcement,
  }));

  const isTest = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
  if (isTest) return tokens;

  return tokens.filter(t => t.address !== ZERO_ADDRESS);
}

export function getTokenBySymbol(symbol: string): TokenOption | undefined {
  return getAllTokens().find(t => t.symbol.toLowerCase() === symbol.toLowerCase());
}

export function getTokenByAddress(address: string): TokenOption | undefined {
  return getAllTokens().find(t => t.address.toLowerCase() === address.toLowerCase());
}

export function getPreferredToken(): ProtocolToken | undefined {
  return getProtocolTokens().find(t => t.isPreferred);
}

export function getPaymasterTokens(): ProtocolToken[] {
  return getProtocolTokens()
    .filter(t => t.hasPaymaster)
    .sort((a, b) => {
      if (a.isPreferred && !b.isPreferred) return -1;
      if (!a.isPreferred && b.isPreferred) return 1;
      return 0;
    });
}

export function hasBanEnforcement(symbol: string): boolean {
  const token = getProtocolTokens().find(t => t.symbol.toLowerCase() === symbol.toLowerCase());
  return token?.hasBanEnforcement ?? false;
}
