/**
 * @fileoverview Cross-chain swap integration via OIF
 * Enables Bazaar users to swap tokens across chains using intents
 */

import type { Address } from 'viem';

// ============ Types ============

export interface CrossChainQuote {
  quoteId: string;
  sourceChainId: number;
  destinationChainId: number;
  sourceToken: Address;
  destinationToken: Address;
  inputAmount: string;
  outputAmount: string;
  fee: string;
  feePercent: number; // basis points
  estimatedTimeSeconds: number;
  solver: Address;
  solverReputation: number;
  validUntil: number;
}

export interface CrossChainRoute {
  routeId: string;
  sourceChainId: number;
  destinationChainId: number;
  oracle: 'hyperlane' | 'superchain' | 'optimism-native';
  isActive: boolean;
  avgFeePercent: number;
  avgTimeSeconds: number;
  successRate: number;
  totalVolume: string;
}

export interface CreateIntentParams {
  sourceChainId: number;
  destinationChainId: number;
  sourceToken: Address;
  destinationToken: Address;
  amount: string;
  recipient?: Address;
  maxFee?: string;
  slippageBps?: number;
}

export interface IntentResult {
  intentId: string;
  status: 'open' | 'pending' | 'filled' | 'expired' | 'cancelled';
  inputAmount: string;
  outputAmount: string;
  fee: string;
  solver?: Address;
  sourceTxHash?: string;
  destinationTxHash?: string;
}

import { OIF_AGGREGATOR_URL } from '../config';

// ============ Constants ============

const AGGREGATOR_URL = OIF_AGGREGATOR_URL;

export const SUPPORTED_CHAINS = [
  { chainId: 1, name: 'Ethereum' },
  { chainId: 42161, name: 'Arbitrum' },
  { chainId: 10, name: 'Optimism' },
  { chainId: 420691, name: 'Jeju' },
] as const;

// Common tokens across chains
export const CROSS_CHAIN_TOKENS: Record<number, Record<string, Address>> = {
  1: {
    ETH: '0x0000000000000000000000000000000000000000',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  },
  42161: {
    ETH: '0x0000000000000000000000000000000000000000',
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  },
  10: {
    ETH: '0x0000000000000000000000000000000000000000',
    USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    WETH: '0x4200000000000000000000000000000000000006',
  },
  420691: {
    ETH: '0x0000000000000000000000000000000000000000',
  },
};

// ============ API Functions ============

/**
 * Get quotes from OIF aggregator for a cross-chain swap
 */
export async function getCrossChainQuotes(params: CreateIntentParams): Promise<CrossChainQuote[]> {
  const response = await fetch(`${AGGREGATOR_URL}/api/intents/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceChain: params.sourceChainId,
      destinationChain: params.destinationChainId,
      sourceToken: params.sourceToken,
      destinationToken: params.destinationToken,
      amount: params.amount,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch quotes');
  }

  return response.json();
}

/**
 * Get best quote for a cross-chain swap
 */
export async function getBestQuote(params: CreateIntentParams): Promise<CrossChainQuote | null> {
  const quotes = await getCrossChainQuotes(params);
  
  if (quotes.length === 0) return null;

  // Sort by output amount (highest first), then by time (fastest first)
  quotes.sort((a, b) => {
    const outputDiff = BigInt(b.outputAmount) - BigInt(a.outputAmount);
    if (outputDiff !== 0n) return Number(outputDiff);
    return a.estimatedTimeSeconds - b.estimatedTimeSeconds;
  });

  return quotes[0];
}

/**
 * Get available routes between chains
 */
export async function getRoutes(sourceChainId?: number, destChainId?: number): Promise<CrossChainRoute[]> {
  const params = new URLSearchParams();
  if (sourceChainId) params.set('sourceChain', sourceChainId.toString());
  if (destChainId) params.set('destinationChain', destChainId.toString());
  params.set('active', 'true');

  const response = await fetch(`${AGGREGATOR_URL}/api/routes?${params}`);
  
  if (!response.ok) {
    throw new Error('Failed to fetch routes');
  }

  return response.json();
}

/**
 * Check if a route exists between two chains
 */
export async function hasRoute(sourceChainId: number, destChainId: number): Promise<boolean> {
  const routes = await getRoutes(sourceChainId, destChainId);
  return routes.length > 0;
}

/**
 * Get intent status
 */
export async function getIntentStatus(intentId: string): Promise<IntentResult> {
  const response = await fetch(`${AGGREGATOR_URL}/api/intents/${intentId}`);
  
  if (!response.ok) {
    throw new Error('Failed to fetch intent status');
  }

  return response.json();
}

/**
 * Create a cross-chain swap intent via A2A
 */
export async function createIntent(params: CreateIntentParams): Promise<{ intentId: string }> {
  const response = await fetch(`${AGGREGATOR_URL}/api/intents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceChain: params.sourceChainId,
      destinationChain: params.destinationChainId,
      sourceToken: params.sourceToken,
      destinationToken: params.destinationToken,
      amount: params.amount,
      recipient: params.recipient,
      maxFee: params.maxFee,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to create intent');
  }

  return response.json();
}

// ============ Utility Functions ============

/**
 * Get chain info by ID
 */
export function getChainInfo(chainId: number) {
  return SUPPORTED_CHAINS.find(c => c.chainId === chainId);
}

/**
 * Get token address on a specific chain
 */
export function getTokenAddress(chainId: number, symbol: string): Address | undefined {
  return CROSS_CHAIN_TOKENS[chainId]?.[symbol];
}

/**
 * Check if token is supported on chain
 */
export function isTokenSupported(chainId: number, tokenAddress: Address): boolean {
  const tokens = CROSS_CHAIN_TOKENS[chainId];
  if (!tokens) return false;
  return Object.values(tokens).includes(tokenAddress);
}

/**
 * Format amount for display
 */
export function formatCrossChainAmount(amount: string, decimals: number = 18): string {
  const value = parseFloat(amount) / Math.pow(10, decimals);
  if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(2)}K`;
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

/**
 * Calculate minimum output with slippage
 */
export function calculateMinOutput(outputAmount: string, slippageBps: number): string {
  const output = BigInt(outputAmount);
  const slippageMultiplier = 10000n - BigInt(slippageBps);
  return ((output * slippageMultiplier) / 10000n).toString();
}

/**
 * Estimate gas for cross-chain intent on source chain
 */
export function estimateIntentGas(): bigint {
  // Approximate gas for InputSettler.open()
  return 150000n;
}
