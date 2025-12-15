/**
 * Solana DEX Aggregator
 * 
 * Unified interface for:
 * - Jupiter (aggregated routing)
 * - Raydium (CPMM + CLMM)
 * - Meteora (DLMM)
 * - Orca (Whirlpools)
 * - PumpSwap (Bonding Curves)
 * 
 * Automatically finds the best route across all DEXs.
 */

import { Connection, PublicKey, Keypair, VersionedTransaction } from '@solana/web3.js';
import type {
  SwapParams,
  SwapQuote,
  SwapTransaction,
  PoolInfo,
  LPPosition,
  DexType,
  DexAdapter,
  BondingCurveState,
  BondingCurveParams,
} from '../types';
import { JupiterAdapter, createJupiterAdapter } from '../jupiter';
import { RaydiumAdapter, createRaydiumAdapter } from '../raydium';
import { MeteoraAdapter, createMeteoraAdapter } from '../meteora';
import { OrcaAdapter, createOrcaAdapter } from '../orca';
import { PumpSwapAdapter, createPumpSwapAdapter } from '../pumpswap';

export interface AggregatorConfig {
  /** Solana RPC connection */
  connection: Connection;
  /** DEXs to include (defaults to all) */
  enabledDexes?: DexType[];
  /** Use Jupiter for routing by default */
  preferJupiter?: boolean;
  /** Maximum price impact allowed (percentage) */
  maxPriceImpact?: number;
}

export interface AggregatedQuote extends SwapQuote {
  /** Alternative quotes from other DEXs */
  alternativeQuotes: SwapQuote[];
  /** Best quote source */
  bestSource: DexType;
}

export interface SwapResult {
  signature: string;
  inputAmount: bigint;
  outputAmount: bigint;
  dex: DexType;
}

export class SolanaDexAggregator {
  private connection: Connection;
  private jupiter: JupiterAdapter;
  private raydium: RaydiumAdapter;
  private meteora: MeteoraAdapter;
  private orca: OrcaAdapter;
  private pumpswap: PumpSwapAdapter;
  private enabledDexes: Set<DexType>;
  private preferJupiter: boolean;
  private maxPriceImpact: number;

  constructor(config: AggregatorConfig) {
    this.connection = config.connection;
    this.preferJupiter = config.preferJupiter ?? true;
    this.maxPriceImpact = config.maxPriceImpact ?? 5;

    // Initialize all adapters
    this.jupiter = createJupiterAdapter(config.connection);
    this.raydium = createRaydiumAdapter(config.connection);
    this.meteora = createMeteoraAdapter(config.connection);
    this.orca = createOrcaAdapter(config.connection);
    this.pumpswap = createPumpSwapAdapter(config.connection);

    // Set enabled DEXs
    this.enabledDexes = new Set(
      config.enabledDexes ?? ['jupiter', 'raydium', 'meteora', 'orca', 'pumpswap']
    );
  }

  // ============================================================================
  // Swap Operations
  // ============================================================================

  /**
   * Get the best quote across all DEXs
   */
  async getBestQuote(params: SwapParams): Promise<AggregatedQuote> {
    const quotes: SwapQuote[] = [];
    const errors: { dex: DexType; error: string }[] = [];

    // Check if this is a bonding curve token (PumpSwap)
    const isBondingCurveToken = await this.isBondingCurveToken(params.outputMint) ||
                                  await this.isBondingCurveToken(params.inputMint);

    // Get quotes from enabled DEXs
    const quotePromises: Promise<SwapQuote | null>[] = [];

    if (this.preferJupiter && this.enabledDexes.has('jupiter') && !isBondingCurveToken) {
      quotePromises.push(
        this.jupiter.getQuote(params).catch(e => {
          errors.push({ dex: 'jupiter', error: e.message });
          return null;
        })
      );
    }

    if (this.enabledDexes.has('raydium') && !isBondingCurveToken) {
      quotePromises.push(
        this.raydium.getQuote(params).catch(e => {
          errors.push({ dex: 'raydium', error: e.message });
          return null;
        })
      );
    }

    if (this.enabledDexes.has('meteora') && !isBondingCurveToken) {
      quotePromises.push(
        this.meteora.getQuote(params).catch(e => {
          errors.push({ dex: 'meteora', error: e.message });
          return null;
        })
      );
    }

    if (this.enabledDexes.has('orca') && !isBondingCurveToken) {
      quotePromises.push(
        this.orca.getQuote(params).catch(e => {
          errors.push({ dex: 'orca', error: e.message });
          return null;
        })
      );
    }

    if (this.enabledDexes.has('pumpswap') && isBondingCurveToken) {
      quotePromises.push(
        this.pumpswap.getQuote(params).catch(e => {
          errors.push({ dex: 'pumpswap', error: e.message });
          return null;
        })
      );
    }

    const results = await Promise.all(quotePromises);
    
    for (const quote of results) {
      if (quote && quote.priceImpactPct <= this.maxPriceImpact) {
        quotes.push(quote);
      }
    }

    if (quotes.length === 0) {
      const errorMessages = errors.map(e => `${e.dex}: ${e.error}`).join('; ');
      throw new Error(`No valid quotes found. Errors: ${errorMessages}`);
    }

    // Sort by output amount (best first)
    quotes.sort((a, b) => Number(b.outputAmount - a.outputAmount));

    const bestQuote = quotes[0];
    
    return {
      ...bestQuote,
      alternativeQuotes: quotes.slice(1),
      bestSource: bestQuote.dex,
    };
  }

  /**
   * Get quotes from all enabled DEXs
   */
  async getAllQuotes(params: SwapParams): Promise<SwapQuote[]> {
    const quote = await this.getBestQuote(params);
    return [quote, ...quote.alternativeQuotes];
  }

  /**
   * Execute a swap
   */
  async executeSwap(
    params: SwapParams,
    signer: Keypair
  ): Promise<SwapResult> {
    // Get best quote
    const quote = await this.getBestQuote(params);
    
    // Build transaction from appropriate DEX
    const swapTx = await this.buildSwapTransaction(quote, params.userPublicKey);
    
    // Sign transaction
    swapTx.transaction.sign([signer]);
    
    // Send transaction
    const signature = await this.connection.sendTransaction(swapTx.transaction, {
      maxRetries: 3,
      skipPreflight: false,
    });
    
    // Confirm
    await this.connection.confirmTransaction({
      signature,
      blockhash: (await this.connection.getLatestBlockhash()).blockhash,
      lastValidBlockHeight: swapTx.lastValidBlockHeight,
    });

    return {
      signature,
      inputAmount: quote.inputAmount,
      outputAmount: quote.outputAmount,
      dex: quote.dex,
    };
  }

  /**
   * Build swap transaction from quote
   */
  async buildSwapTransaction(
    quote: SwapQuote,
    userPublicKey: PublicKey
  ): Promise<SwapTransaction> {
    // Use Jupiter for most swaps as it handles routing
    if (quote.dex === 'jupiter' || (this.preferJupiter && quote.dex !== 'pumpswap')) {
      return this.jupiter.buildSwapTransactionForUser(quote, userPublicKey);
    }

    // For PumpSwap, use direct adapter
    if (quote.dex === 'pumpswap') {
      return this.pumpswap.buildSwapTransaction(quote);
    }

    // Fallback to Jupiter routing
    return this.jupiter.buildSwapTransactionForUser(quote, userPublicKey);
  }

  // ============================================================================
  // Pool Discovery
  // ============================================================================

  /**
   * Find all pools for a token pair
   */
  async findPools(tokenA: PublicKey, tokenB: PublicKey): Promise<PoolInfo[]> {
    const pools: PoolInfo[] = [];

    const poolPromises = [
      this.raydium.getPools(tokenA, tokenB).catch(() => []),
      this.meteora.getPools(tokenA, tokenB).catch(() => []),
      this.orca.getPools(tokenA, tokenB).catch(() => []),
    ];

    const results = await Promise.all(poolPromises);
    for (const result of results) {
      pools.push(...result);
    }

    // Sort by TVL
    return pools.sort((a, b) => Number(b.tvl - a.tvl));
  }

  /**
   * Get best pool for a token pair
   */
  async getBestPool(tokenA: PublicKey, tokenB: PublicKey): Promise<PoolInfo | null> {
    const pools = await this.findPools(tokenA, tokenB);
    return pools[0] ?? null;
  }

  // ============================================================================
  // Liquidity Operations
  // ============================================================================

  /**
   * Get all LP positions for a user across all DEXs
   */
  async getAllLPPositions(userPublicKey: PublicKey): Promise<{
    dex: DexType;
    positions: LPPosition[];
  }[]> {
    const results: { dex: DexType; positions: LPPosition[] }[] = [];

    const positionPromises = [
      { dex: 'raydium' as DexType, promise: this.raydium.getLPPositions(userPublicKey) },
      { dex: 'meteora' as DexType, promise: this.meteora.getLPPositions(userPublicKey) },
      { dex: 'orca' as DexType, promise: this.orca.getLPPositions(userPublicKey) },
    ];

    for (const { dex, promise } of positionPromises) {
      try {
        const positions = await promise;
        if (positions.length > 0) {
          results.push({ dex, positions });
        }
      } catch {
        // Skip failed queries
      }
    }

    return results;
  }

  /**
   * Get recommended pools for adding liquidity
   */
  async getRecommendedPools(
    tokenA: PublicKey,
    tokenB: PublicKey,
    options?: {
      preferredDex?: DexType;
      minTvl?: bigint;
      maxFee?: number;
    }
  ): Promise<PoolInfo[]> {
    const pools = await this.findPools(tokenA, tokenB);
    
    return pools.filter(pool => {
      if (options?.preferredDex && pool.dex !== options.preferredDex) {
        return false;
      }
      if (options?.minTvl && pool.tvl < options.minTvl) {
        return false;
      }
      if (options?.maxFee && pool.fee > options.maxFee) {
        return false;
      }
      return true;
    });
  }

  // ============================================================================
  // Bonding Curve Operations
  // ============================================================================

  /**
   * Get bonding curve state for a token
   */
  async getBondingCurve(tokenMint: PublicKey): Promise<BondingCurveState | null> {
    try {
      const curveAddress = this.pumpswap.deriveBondingCurveAddress(tokenMint);
      return await this.pumpswap.getBondingCurve(curveAddress);
    } catch {
      return null;
    }
  }

  /**
   * Check if a token is on a bonding curve
   */
  async isBondingCurveToken(tokenMint: PublicKey): Promise<boolean> {
    const curve = await this.getBondingCurve(tokenMint);
    return curve !== null && !curve.graduated;
  }

  /**
   * Create a new token with bonding curve
   */
  async createBondingCurveToken(
    params: BondingCurveParams,
    creator: PublicKey
  ): Promise<{
    transaction: SwapTransaction;
    tokenMint: PublicKey;
    curveAddress: PublicKey;
  }> {
    return this.pumpswap.createBondingCurve(params, creator);
  }

  // ============================================================================
  // Price & Analytics
  // ============================================================================

  /**
   * Get token price in terms of another token
   */
  async getPrice(
    inputMint: PublicKey,
    outputMint: PublicKey,
    amount?: bigint
  ): Promise<number> {
    return this.jupiter.getPrice(inputMint, outputMint, amount);
  }

  /**
   * Get token price in USD (via USDC)
   */
  async getPriceUSD(tokenMint: PublicKey): Promise<number> {
    const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    
    if (tokenMint.equals(USDC)) {
      return 1;
    }

    try {
      // Get price relative to USDC
      return await this.jupiter.getPrice(tokenMint, USDC, 1_000_000n); // 1 token
    } catch {
      return 0;
    }
  }

  /**
   * Get market data for a token
   */
  async getTokenMarketData(tokenMint: PublicKey): Promise<{
    priceUSD: number;
    liquidityUSD: number;
    volume24h: number;
    topPools: PoolInfo[];
  }> {
    const [priceUSD, pools] = await Promise.all([
      this.getPriceUSD(tokenMint),
      this.findPools(tokenMint, new PublicKey('So11111111111111111111111111111111111111112')),
    ]);

    const topPools = pools.slice(0, 5);
    const totalTvl = pools.reduce((sum, p) => sum + p.tvl, 0n);

    return {
      priceUSD,
      liquidityUSD: Number(totalTvl) / 1e6,
      volume24h: 0, // Would need to aggregate from APIs
      topPools,
    };
  }

  // ============================================================================
  // Adapter Access
  // ============================================================================

  /**
   * Get specific DEX adapter
   */
  getAdapter(dex: DexType): DexAdapter {
    switch (dex) {
      case 'jupiter': return this.jupiter;
      case 'raydium': return this.raydium;
      case 'meteora': return this.meteora;
      case 'orca': return this.orca;
      case 'pumpswap': return this.pumpswap;
      default: throw new Error(`Unknown DEX: ${dex}`);
    }
  }

  /**
   * Get connection
   */
  getConnection(): Connection {
    return this.connection;
  }
}

/**
 * Create a Solana DEX aggregator instance
 */
export function createSolanaDexAggregator(config: AggregatorConfig): SolanaDexAggregator {
  return new SolanaDexAggregator(config);
}

// Re-export types
export type {
  SwapParams,
  SwapQuote,
  SwapTransaction,
  PoolInfo,
  LPPosition,
  DexType,
  BondingCurveState,
};

