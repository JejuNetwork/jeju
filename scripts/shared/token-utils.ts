/**
 * Token utility functions for formatting and calculations
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { BaseTokensManifest } from '../../types/base-tokens';

let tokenManifest: BaseTokensManifest | null = null;

/**
 * Load token configuration
 */
export function loadTokenConfig(): BaseTokensManifest {
  if (!tokenManifest) {
    const configPath = join(process.cwd(), 'config', 'base-tokens.json');
    tokenManifest = JSON.parse(readFileSync(configPath, 'utf-8'));
  }
  return tokenManifest!;
}

/**
 * Get decimals for a token
 */
export function getTokenDecimals(symbolOrAddress: string): number {
  const config = loadTokenConfig();
  
  // Try by symbol first
  for (const [symbol, tokenConfig] of Object.entries(config.tokens)) {
    if (symbol.toLowerCase() === symbolOrAddress.toLowerCase()) {
      return tokenConfig.decimals;
    }
  }
  
  // Try by address
  for (const tokenConfig of Object.values(config.tokens)) {
    if (tokenConfig.address.toLowerCase() === symbolOrAddress.toLowerCase()) {
      return tokenConfig.decimals;
    }
  }
  
  // Default to 18
  return 18;
}

/**
 * Format token amount with correct decimals
 */
export function formatTokenAmount(
  amount: bigint | string | number,
  symbolOrAddress: string,
  displayDecimals: number = 4
): string {
  const decimals = getTokenDecimals(symbolOrAddress);
  const amountBigInt = typeof amount === 'bigint' ? amount : BigInt(amount);
  
  const divisor = 10n ** BigInt(decimals);
  const whole = amountBigInt / divisor;
  const remainder = amountBigInt % divisor;
  
  if (remainder === 0n) {
    return whole.toString();
  }
  
  const fractional = remainder.toString().padStart(decimals, '0');
  const trimmed = fractional.slice(0, displayDecimals).replace(/0+$/, '');
  
  if (trimmed.length === 0) {
    return whole.toString();
  }
  
  return `${whole}.${trimmed}`;
}

/**
 * Parse token amount string to bigint (with decimals)
 */
export function parseTokenAmount(
  amount: string,
  symbolOrAddress: string
): bigint {
  const decimals = getTokenDecimals(symbolOrAddress);
  
  const [whole, fractional = ''] = amount.split('.');
  const paddedFractional = fractional.padEnd(decimals, '0').slice(0, decimals);
  
  const wholeBigInt = BigInt(whole || '0');
  const fractionalBigInt = BigInt(paddedFractional);
  
  return wholeBigInt * (10n ** BigInt(decimals)) + fractionalBigInt;
}

/**
 * Get token symbol from address
 */
export function getTokenSymbol(address: string): string {
  const config = loadTokenConfig();
  
  for (const [symbol, tokenConfig] of Object.entries(config.tokens)) {
    if (tokenConfig.address.toLowerCase() === address.toLowerCase()) {
      return symbol;
    }
  }
  
  return 'UNKNOWN';
}

/**
 * Get token name from address
 */
export function getTokenName(address: string): string {
  const config = loadTokenConfig();
  
  for (const tokenConfig of Object.values(config.tokens)) {
    if (tokenConfig.address.toLowerCase() === address.toLowerCase()) {
      return tokenConfig.name;
    }
  }
  
  return 'Unknown Token';
}

/**
 * Get token price in USD
 */
export function getTokenPriceUSD(symbolOrAddress: string): number {
  const config = loadTokenConfig();
  
  // Try by symbol
  for (const [symbol, tokenConfig] of Object.entries(config.tokens)) {
    if (symbol.toLowerCase() === symbolOrAddress.toLowerCase()) {
      return tokenConfig.marketData.priceUSD;
    }
  }
  
  // Try by address
  for (const tokenConfig of Object.values(config.tokens)) {
    if (tokenConfig.address.toLowerCase() === symbolOrAddress.toLowerCase()) {
      return tokenConfig.marketData.priceUSD;
    }
  }
  
  return 0;
}

/**
 * Calculate USD value from token amount
 */
export function calculateUSDValue(
  amount: bigint | string | number,
  symbolOrAddress: string
): number {
  const priceUSD = getTokenPriceUSD(symbolOrAddress);
  const decimals = getTokenDecimals(symbolOrAddress);
  
  const amountBigInt = typeof amount === 'bigint' ? amount : BigInt(amount);
  const amountNumber = Number(amountBigInt) / (10 ** decimals);
  
  return amountNumber * priceUSD;
}

/**
 * Format USD value
 */
export function formatUSD(value: number, decimals: number = 2): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Get all supported tokens
 */
export function getAllSupportedTokens(): Array<{
  symbol: string;
  address: string;
  name: string;
  decimals: number;
  priceUSD: number;
}> {
  const config = loadTokenConfig();
  
  return Object.entries(config.tokens).map(([symbol, tokenConfig]) => ({
    symbol,
    address: tokenConfig.address,
    name: tokenConfig.name,
    decimals: tokenConfig.decimals,
    priceUSD: tokenConfig.marketData.priceUSD,
  }));
}

/**
 * Calculate sqrtPriceX96 for Uniswap V4 pool initialization
 */
export function calculateSqrtPriceX96(priceToken1PerToken0: number): bigint {
  const sqrtPrice = Math.sqrt(priceToken1PerToken0);
  const Q96 = 2n ** 96n;
  return BigInt(Math.floor(sqrtPrice * Number(Q96)));
}

/**
 * Calculate price from sqrtPriceX96
 */
export function priceFromSqrtPriceX96(sqrtPriceX96: bigint): number {
  const Q96 = 2n ** 96n;
  const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
  return sqrtPrice ** 2;
}

/**
 * Get token configuration
 */
export function getTokenConfig(symbolOrAddress: string) {
  const config = loadTokenConfig();
  
  // Try by symbol
  for (const [symbol, tokenConfig] of Object.entries(config.tokens)) {
    if (symbol.toLowerCase() === symbolOrAddress.toLowerCase()) {
      return { symbol, ...tokenConfig };
    }
  }
  
  // Try by address
  for (const [symbol, tokenConfig] of Object.entries(config.tokens)) {
    if (tokenConfig.address.toLowerCase() === symbolOrAddress.toLowerCase()) {
      return { symbol, ...tokenConfig };
    }
  }
  
  return null;
}

