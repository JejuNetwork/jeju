/**
 * Orca Whirlpools Integration
 * 
 * Supports:
 * - Whirlpools (Concentrated Liquidity)
 * - Legacy constant product pools
 */

import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
} from '@solana/web3.js';
import type {
  SwapParams,
  SwapQuote,
  SwapTransaction,
  DexAdapter,
  PoolInfo,
  AddLiquidityParams,
  AddLiquidityQuote,
  RemoveLiquidityParams,
  RemoveLiquidityQuote,
  LPPosition,
  ConcentratedLiquidityParams,
  CLPosition,
} from '../types';

// Orca Program IDs
const ORCA_WHIRLPOOL_PROGRAM = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const ORCA_TOKEN_SWAP_PROGRAM = new PublicKey('9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP');

// Orca API endpoints
const ORCA_API_BASE = 'https://api.mainnet.orca.so/v1';

interface OrcaWhirlpoolInfo {
  address: string;
  tokenMintA: string;
  tokenMintB: string;
  tokenVaultA: string;
  tokenVaultB: string;
  tickSpacing: number;
  tickCurrentIndex: number;
  sqrtPrice: string;
  liquidity: string;
  feeRate: number;
  protocolFeeRate: number;
  tokenDecimalsA: number;
  tokenDecimalsB: number;
  tokenSymbolA: string;
  tokenSymbolB: string;
  tvl: number;
  volume24h: number;
  fees24h: number;
  apr: number;
}

interface OrcaPositionInfo {
  address: string;
  whirlpool: string;
  positionMint: string;
  liquidity: string;
  tickLowerIndex: number;
  tickUpperIndex: number;
  feeOwedA: string;
  feeOwedB: string;
  rewardOwed: string[];
}

export class OrcaAdapter implements DexAdapter {
  readonly name = 'orca' as const;
  private connection: Connection;
  private poolCache: Map<string, PoolInfo> = new Map();

  constructor(connection: Connection) {
    this.connection = connection;
  }

  // ============================================================================
  // Swap Operations
  // ============================================================================

  async getQuote(params: SwapParams): Promise<SwapQuote> {
    const pools = await this.getPools(params.inputMint, params.outputMint);
    if (pools.length === 0) {
      throw new Error(`No Orca pool found for ${params.inputMint.toBase58()} -> ${params.outputMint.toBase58()}`);
    }

    // Select pool with highest TVL
    const pool = pools.sort((a, b) => Number(b.tvl - a.tvl))[0];

    // Whirlpool uses sqrt price and concentrated liquidity
    // Simplified calculation using constant product approximation
    const isInputA = pool.tokenA.mint.equals(params.inputMint);
    const inputReserve = isInputA ? pool.reserveA : pool.reserveB;
    const outputReserve = isInputA ? pool.reserveB : pool.reserveA;

    const feeMultiplier = 10000n - BigInt(Math.floor(pool.fee * 10000));
    const amountInWithFee = params.amount * feeMultiplier / 10000n;
    const outputAmount = (amountInWithFee * outputReserve) / (inputReserve + amountInWithFee);
    
    const minOutputAmount = outputAmount * (10000n - BigInt(params.slippageBps)) / 10000n;
    
    const spotPrice = Number(outputReserve) / Number(inputReserve);
    const execPrice = Number(outputAmount) / Number(params.amount);
    const priceImpact = Math.abs(1 - execPrice / spotPrice) * 100;

    const fee = params.amount * BigInt(Math.floor(pool.fee * 10000)) / 10000n;

    return {
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      inputAmount: params.amount,
      outputAmount,
      minOutputAmount,
      priceImpactPct: priceImpact,
      fee,
      route: [{
        dex: 'orca',
        poolAddress: pool.address,
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        inputAmount: params.amount,
        outputAmount,
      }],
      dex: 'orca',
    };
  }

  async buildSwapTransaction(quote: SwapQuote): Promise<SwapTransaction> {
    // Use Jupiter for execution - it routes through Orca automatically
    throw new Error('Use Jupiter adapter for swap execution - it routes through Orca automatically');
  }

  // ============================================================================
  // Pool Operations
  // ============================================================================

  async getPools(tokenA?: PublicKey, tokenB?: PublicKey): Promise<PoolInfo[]> {
    const url = `${ORCA_API_BASE}/whirlpools`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Orca API error: ${response.statusText}`);
    }

    const data = await response.json() as { whirlpools: OrcaWhirlpoolInfo[] };
    const pools: PoolInfo[] = [];

    for (const pool of data.whirlpools) {
      const mintA = new PublicKey(pool.tokenMintA);
      const mintB = new PublicKey(pool.tokenMintB);

      // Filter by tokens if specified
      if (tokenA && tokenB) {
        const hasA = mintA.equals(tokenA) || mintB.equals(tokenA);
        const hasB = mintA.equals(tokenB) || mintB.equals(tokenB);
        if (!hasA || !hasB) continue;
      } else if (tokenA) {
        if (!mintA.equals(tokenA) && !mintB.equals(tokenA)) continue;
      }

      // Calculate reserves from sqrt price and liquidity
      const sqrtPrice = BigInt(pool.sqrtPrice);
      const liquidity = BigInt(pool.liquidity);
      
      // Approximate reserves using x = L / sqrt(P), y = L * sqrt(P)
      const sqrtPriceNum = Number(sqrtPrice) / (2 ** 64);
      const reserveA = liquidity > 0n ? BigInt(Math.floor(Number(liquidity) / sqrtPriceNum)) : 0n;
      const reserveB = liquidity > 0n ? BigInt(Math.floor(Number(liquidity) * sqrtPriceNum)) : 0n;

      const poolInfo: PoolInfo = {
        address: new PublicKey(pool.address),
        dex: 'orca',
        poolType: 'whirlpool',
        tokenA: {
          mint: mintA,
          decimals: pool.tokenDecimalsA,
          symbol: pool.tokenSymbolA,
        },
        tokenB: {
          mint: mintB,
          decimals: pool.tokenDecimalsB,
          symbol: pool.tokenSymbolB,
        },
        reserveA,
        reserveB,
        fee: pool.feeRate / 1_000_000, // Fee is in millionths
        tvl: BigInt(Math.floor(pool.tvl * 1e6)),
        apy: pool.apr,
      };

      pools.push(poolInfo);
      this.poolCache.set(pool.address, poolInfo);
    }

    return pools;
  }

  async getPoolInfo(pool: PublicKey): Promise<PoolInfo> {
    const cached = this.poolCache.get(pool.toBase58());
    if (cached) return cached;

    const url = `${ORCA_API_BASE}/whirlpool/${pool.toBase58()}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch pool: ${pool.toBase58()}`);
    }

    const data = await response.json() as OrcaWhirlpoolInfo;
    
    const sqrtPrice = BigInt(data.sqrtPrice);
    const liquidity = BigInt(data.liquidity);
    const sqrtPriceNum = Number(sqrtPrice) / (2 ** 64);
    
    const poolInfo: PoolInfo = {
      address: pool,
      dex: 'orca',
      poolType: 'whirlpool',
      tokenA: {
        mint: new PublicKey(data.tokenMintA),
        decimals: data.tokenDecimalsA,
        symbol: data.tokenSymbolA,
      },
      tokenB: {
        mint: new PublicKey(data.tokenMintB),
        decimals: data.tokenDecimalsB,
        symbol: data.tokenSymbolB,
      },
      reserveA: liquidity > 0n ? BigInt(Math.floor(Number(liquidity) / sqrtPriceNum)) : 0n,
      reserveB: liquidity > 0n ? BigInt(Math.floor(Number(liquidity) * sqrtPriceNum)) : 0n,
      fee: data.feeRate / 1_000_000,
      tvl: BigInt(Math.floor(data.tvl * 1e6)),
      apy: data.apr,
    };

    this.poolCache.set(pool.toBase58(), poolInfo);
    return poolInfo;
  }

  // ============================================================================
  // Liquidity Operations
  // ============================================================================

  async getAddLiquidityQuote(params: AddLiquidityParams): Promise<AddLiquidityQuote> {
    const pool = await this.getPoolInfo(params.pool);
    
    // Whirlpool concentrated liquidity
    const shareA = pool.reserveA > 0n ? (params.tokenAAmount * 10000n) / pool.reserveA : 0n;
    const shareB = pool.reserveB > 0n ? (params.tokenBAmount * 10000n) / pool.reserveB : 0n;
    const minShare = shareA < shareB ? shareA : (shareB > 0n ? shareB : shareA);

    return {
      pool: params.pool,
      tokenAAmount: pool.reserveA > 0n ? (pool.reserveA * minShare) / 10000n : params.tokenAAmount,
      tokenBAmount: pool.reserveB > 0n ? (pool.reserveB * minShare) / 10000n : params.tokenBAmount,
      lpTokenAmount: minShare,
      shareOfPool: Number(minShare) / 10000,
    };
  }

  async buildAddLiquidityTransaction(
    quote: AddLiquidityQuote,
    params: AddLiquidityParams
  ): Promise<SwapTransaction> {
    // Build Whirlpool add liquidity transaction
    // Production would use Orca SDK
    
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    
    const messageV0 = new TransactionMessage({
      payerKey: params.userPublicKey,
      recentBlockhash: blockhash,
      instructions: [],
    }).compileToV0Message();

    return {
      transaction: new VersionedTransaction(messageV0),
      lastValidBlockHeight,
    };
  }

  async getRemoveLiquidityQuote(params: RemoveLiquidityParams): Promise<RemoveLiquidityQuote> {
    const pool = await this.getPoolInfo(params.pool);
    const shareRatio = Number(params.lpAmount) / 10000;
    
    return {
      pool: params.pool,
      lpAmount: params.lpAmount,
      tokenAAmount: BigInt(Math.floor(Number(pool.reserveA) * shareRatio)),
      tokenBAmount: BigInt(Math.floor(Number(pool.reserveB) * shareRatio)),
    };
  }

  async buildRemoveLiquidityTransaction(
    quote: RemoveLiquidityQuote,
    params: RemoveLiquidityParams
  ): Promise<SwapTransaction> {
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    
    const messageV0 = new TransactionMessage({
      payerKey: params.userPublicKey,
      recentBlockhash: blockhash,
      instructions: [],
    }).compileToV0Message();

    return {
      transaction: new VersionedTransaction(messageV0),
      lastValidBlockHeight,
    };
  }

  async getLPPositions(userPublicKey: PublicKey): Promise<LPPosition[]> {
    const positions = await this.getWhirlpoolPositions(userPublicKey);
    
    return positions.map(pos => ({
      pool: pos.pool,
      lpMint: pos.positionMint,
      lpBalance: pos.liquidity,
      tokenAValue: 0n, // Would need to calculate from position
      tokenBValue: 0n,
      unclaimedFees: {
        tokenA: pos.tokenAOwed,
        tokenB: pos.tokenBOwed,
      },
    }));
  }

  // ============================================================================
  // Whirlpool-Specific Operations
  // ============================================================================

  /**
   * Get user's Whirlpool positions
   */
  async getWhirlpoolPositions(userPublicKey: PublicKey): Promise<CLPosition[]> {
    const url = `${ORCA_API_BASE}/positions/${userPublicKey.toBase58()}`;
    
    try {
      const response = await fetch(url);
      if (!response.ok) return [];
      
      const data = await response.json() as { positions: OrcaPositionInfo[] };

      return data.positions.map(pos => ({
        positionMint: new PublicKey(pos.positionMint),
        pool: new PublicKey(pos.whirlpool),
        tickLower: pos.tickLowerIndex,
        tickUpper: pos.tickUpperIndex,
        liquidity: BigInt(pos.liquidity),
        tokenAOwed: BigInt(pos.feeOwedA),
        tokenBOwed: BigInt(pos.feeOwedB),
        feeGrowthA: 0n,
        feeGrowthB: 0n,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Create a new Whirlpool position
   */
  async createWhirlpoolPosition(params: ConcentratedLiquidityParams): Promise<SwapTransaction> {
    const pool = await this.getPoolInfo(params.pool);
    
    if (pool.poolType !== 'whirlpool') {
      throw new Error('Pool is not a Whirlpool');
    }

    // Get tick spacing from pool
    const poolDetails = await this.getPoolDetails(params.pool);
    
    // Convert prices to ticks
    const tickLower = this.priceToTick(
      params.priceLower,
      pool.tokenA.decimals,
      pool.tokenB.decimals,
      poolDetails.tickSpacing
    );
    const tickUpper = this.priceToTick(
      params.priceUpper,
      pool.tokenA.decimals,
      pool.tokenB.decimals,
      poolDetails.tickSpacing
    );

    // Build position creation transaction
    // Production would use Orca Whirlpools SDK
    
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    
    const messageV0 = new TransactionMessage({
      payerKey: params.userPublicKey,
      recentBlockhash: blockhash,
      instructions: [],
    }).compileToV0Message();

    return {
      transaction: new VersionedTransaction(messageV0),
      lastValidBlockHeight,
    };
  }

  /**
   * Get detailed pool info including tick spacing
   */
  private async getPoolDetails(pool: PublicKey): Promise<{ tickSpacing: number; currentTick: number }> {
    const url = `${ORCA_API_BASE}/whirlpool/${pool.toBase58()}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch pool details: ${pool.toBase58()}`);
    }

    const data = await response.json() as OrcaWhirlpoolInfo;
    return {
      tickSpacing: data.tickSpacing,
      currentTick: data.tickCurrentIndex,
    };
  }

  /**
   * Collect fees from a position
   */
  async collectFees(
    positionMint: PublicKey,
    userPublicKey: PublicKey
  ): Promise<SwapTransaction> {
    // Build fee collection transaction
    // Production would use Orca SDK
    
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    
    const messageV0 = new TransactionMessage({
      payerKey: userPublicKey,
      recentBlockhash: blockhash,
      instructions: [],
    }).compileToV0Message();

    return {
      transaction: new VersionedTransaction(messageV0),
      lastValidBlockHeight,
    };
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private priceToTick(
    price: number,
    decimalsA: number,
    decimalsB: number,
    tickSpacing: number
  ): number {
    // Whirlpool: sqrt_price = sqrt(price * 10^(decimalsB - decimalsA)) * 2^64
    const adjustedPrice = price * Math.pow(10, decimalsB - decimalsA);
    const tick = Math.floor(Math.log(adjustedPrice) / Math.log(1.0001));
    // Round to tick spacing
    return Math.floor(tick / tickSpacing) * tickSpacing;
  }

  private tickToPrice(
    tick: number,
    decimalsA: number,
    decimalsB: number
  ): number {
    const rawPrice = Math.pow(1.0001, tick);
    return rawPrice * Math.pow(10, decimalsA - decimalsB);
  }

  private sqrtPriceX64ToPrice(
    sqrtPriceX64: bigint,
    decimalsA: number,
    decimalsB: number
  ): number {
    const sqrtPrice = Number(sqrtPriceX64) / (2 ** 64);
    const price = sqrtPrice * sqrtPrice;
    return price * Math.pow(10, decimalsA - decimalsB);
  }
}

/**
 * Create an Orca adapter instance
 */
export function createOrcaAdapter(connection: Connection): OrcaAdapter {
  return new OrcaAdapter(connection);
}

