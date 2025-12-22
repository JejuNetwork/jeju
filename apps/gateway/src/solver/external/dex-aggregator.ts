/**
 * DEX Aggregator
 * 
 * Permissionless routing through major DEXes:
 * - Uniswap V2 & V3
 * - Balancer V2
 * 
 * All operations are on-chain reads (quoter) or swaps.
 */

import { type PublicClient, type Address } from 'viem';

// Uniswap V3 Quoter V2
export const UNISWAP_V3_QUOTER: Record<number, Address> = {
  1: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',      // Ethereum
  42161: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',  // Arbitrum
  10: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',     // Optimism
  8453: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',   // Base
  137: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',    // Polygon
};

// Uniswap V2 Router
export const UNISWAP_V2_ROUTER: Record<number, Address> = {
  1: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
  42161: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
  8453: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
};

// Balancer V2 Vault
export const BALANCER_VAULT: Record<number, Address> = {
  1: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  42161: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  10: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  8453: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  137: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
};

// Common fee tiers for Uniswap V3
const FEE_TIERS = [100, 500, 3000, 10000];

// Quoter V2 ABI
const QUOTER_V2_ABI = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    inputs: [{
      name: 'params',
      type: 'tuple',
      components: [
        { name: 'tokenIn', type: 'address' },
        { name: 'tokenOut', type: 'address' },
        { name: 'amountIn', type: 'uint256' },
        { name: 'fee', type: 'uint24' },
        { name: 'sqrtPriceLimitX96', type: 'uint160' },
      ],
    }],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
] as const;

// Uniswap V2 Router ABI
const V2_ROUTER_ABI = [
  {
    type: 'function',
    name: 'getAmountsOut',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'view',
  },
] as const;

export interface DexQuote {
  dex: 'uniswap_v2' | 'uniswap_v3' | 'balancer';
  amountOut: bigint;
  path: Address[];
  fee?: number;
  gasEstimate: bigint;
  priceImpactBps: number;
}

export interface AggregatedQuote {
  best: DexQuote;
  all: DexQuote[];
  timestamp: number;
}

export class DexAggregator {
  private clients: Map<number, PublicClient>;

  constructor(clients: Map<number, PublicClient>) {
    this.clients = clients;
  }

  /**
   * Get the best quote across all DEXes
   */
  async getBestQuote(
    chainId: number,
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint
  ): Promise<AggregatedQuote | null> {
    const client = this.clients.get(chainId);
    if (!client) return null;

    const quotes: DexQuote[] = [];

    // Get quotes from all DEXes in parallel
    const [v3Quotes, v2Quote] = await Promise.all([
      this.getUniswapV3Quotes(client, chainId, tokenIn, tokenOut, amountIn),
      this.getUniswapV2Quote(client, chainId, tokenIn, tokenOut, amountIn),
    ]);

    quotes.push(...v3Quotes);
    if (v2Quote) quotes.push(v2Quote);

    if (quotes.length === 0) return null;

    // Sort by output amount (descending)
    quotes.sort((a, b) => Number(b.amountOut - a.amountOut));

    return {
      best: quotes[0],
      all: quotes,
      timestamp: Date.now(),
    };
  }

  /**
   * Get quotes from Uniswap V3 across all fee tiers
   */
  private async getUniswapV3Quotes(
    client: PublicClient,
    chainId: number,
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint
  ): Promise<DexQuote[]> {
    const quoter = UNISWAP_V3_QUOTER[chainId];
    if (!quoter) return [];

    const quotes: DexQuote[] = [];

    const quotePromises = FEE_TIERS.map(async (fee) => {
      const result = await client.simulateContract({
        address: quoter,
        abi: QUOTER_V2_ABI,
        functionName: 'quoteExactInputSingle',
        args: [{
          tokenIn,
          tokenOut,
          amountIn,
          fee,
          sqrtPriceLimitX96: BigInt(0),
        }],
      });

      const [amountOut, , , gasEstimate] = result.result;

      return {
        dex: 'uniswap_v3' as const,
        amountOut,
        path: [tokenIn, tokenOut],
        fee,
        gasEstimate,
        priceImpactBps: 0,
      };
    });

    const results = await Promise.allSettled(quotePromises);
    for (const result of results) {
      if (result.status === 'fulfilled') quotes.push(result.value);
    }

    return quotes;
  }

  /**
   * Get quote from Uniswap V2
   */
  private async getUniswapV2Quote(
    client: PublicClient,
    chainId: number,
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint
  ): Promise<DexQuote | null> {
    const router = UNISWAP_V2_ROUTER[chainId];
    if (!router) return null;

    const result = await client.readContract({
      address: router,
      abi: V2_ROUTER_ABI,
      functionName: 'getAmountsOut',
      args: [amountIn, [tokenIn, tokenOut]],
    });

    const amountOut = result[result.length - 1];

    return {
      dex: 'uniswap_v2',
      amountOut,
      path: [tokenIn, tokenOut],
      gasEstimate: BigInt(150000),
      priceImpactBps: 0,
    };
  }

  /**
   * Compare our internal quote vs external DEX quotes
   */
  async compareWithInternal(
    chainId: number,
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
    internalAmountOut: bigint
  ): Promise<{
    shouldUseExternal: boolean;
    externalQuote: DexQuote | null;
    improvementBps: number;
  }> {
    const externalQuotes = await this.getBestQuote(chainId, tokenIn, tokenOut, amountIn);
    
    if (!externalQuotes) {
      return {
        shouldUseExternal: false,
        externalQuote: null,
        improvementBps: 0,
      };
    }

    const best = externalQuotes.best;
    
    // Ensure both values are BigInt before math
    const externalOut = BigInt(best.amountOut);
    const internalOut = BigInt(internalAmountOut);
    
    if (internalOut === 0n) {
      return {
        shouldUseExternal: externalOut > 0n,
        externalQuote: best,
        improvementBps: externalOut > 0n ? 10000 : 0,
      };
    }
    
    const improvementBps = Number(
      ((externalOut - internalOut) * 10000n) / internalOut
    );

    return {
      shouldUseExternal: improvementBps >= 10,
      externalQuote: best,
      improvementBps,
    };
  }
}

/**
 * Common intermediate tokens for multi-hop routing
 */
export const INTERMEDIATE_TOKENS: Record<number, Address[]> = {
  1: [
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
  ],
  42161: [
    '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
  ],
  8453: [
    '0x4200000000000000000000000000000000000006', // WETH
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
  ],
};



