/**
 * Raydium DEX Integration
 * 
 * Supports:
 * - CPMM (Constant Product Market Maker) - Standard AMM pools
 * - CLMM (Concentrated Liquidity Market Maker) - Uniswap V3-style
 */

import {
  Connection,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  VersionedTransaction,
  TransactionMessage,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
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
  TokenInfo,
} from '../types';

// Raydium Program IDs
const RAYDIUM_CPMM_PROGRAM = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
const RAYDIUM_CLMM_PROGRAM = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');
const RAYDIUM_AMM_V4 = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

// Raydium API endpoints
const RAYDIUM_API_BASE = 'https://api-v3.raydium.io';

// Pool state layouts
interface RaydiumPoolState {
  ammId: PublicKey;
  ammAuthority: PublicKey;
  ammOpenOrders: PublicKey;
  lpMint: PublicKey;
  coinMint: PublicKey;
  pcMint: PublicKey;
  coinVault: PublicKey;
  pcVault: PublicKey;
  coinDecimals: number;
  pcDecimals: number;
  lpDecimals: number;
  status: number;
  nonce: number;
}

interface RaydiumApiPool {
  id: string;
  mintA: { address: string; symbol: string; decimals: number };
  mintB: { address: string; symbol: string; decimals: number };
  mintAmountA: number;
  mintAmountB: number;
  tvl: number;
  feeRate: number;
  apr: { fee: number; reward: number };
  lpMint: { address: string };
  type: 'Standard' | 'Concentrated';
}

export class RaydiumAdapter implements DexAdapter {
  readonly name = 'raydium' as const;
  private connection: Connection;
  private poolCache: Map<string, PoolInfo> = new Map();

  constructor(connection: Connection) {
    this.connection = connection;
  }

  // ============================================================================
  // Swap Operations
  // ============================================================================

  async getQuote(params: SwapParams): Promise<SwapQuote> {
    // Find best pool for the pair
    const pools = await this.getPools(params.inputMint, params.outputMint);
    if (pools.length === 0) {
      throw new Error(`No Raydium pool found for ${params.inputMint.toBase58()} -> ${params.outputMint.toBase58()}`);
    }

    // Use the pool with highest TVL
    const pool = pools.sort((a, b) => Number(b.tvl - a.tvl))[0];

    // Calculate output using constant product formula
    const isInputA = pool.tokenA.mint.equals(params.inputMint);
    const inputReserve = isInputA ? pool.reserveA : pool.reserveB;
    const outputReserve = isInputA ? pool.reserveB : pool.reserveA;

    // x * y = k, with fee
    const feeMultiplier = 10000n - BigInt(Math.floor(pool.fee * 10000));
    const amountInWithFee = params.amount * feeMultiplier / 10000n;
    const outputAmount = (amountInWithFee * outputReserve) / (inputReserve + amountInWithFee);
    
    // Apply slippage
    const minOutputAmount = outputAmount * (10000n - BigInt(params.slippageBps)) / 10000n;
    
    // Calculate price impact
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
        dex: 'raydium',
        poolAddress: pool.address,
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        inputAmount: params.amount,
        outputAmount,
      }],
      dex: 'raydium',
    };
  }

  async buildSwapTransaction(quote: SwapQuote): Promise<SwapTransaction> {
    const pool = quote.route[0];
    if (!pool) {
      throw new Error('No route in quote');
    }

    // For simplicity, use Jupiter for actual execution
    // In production, build raw Raydium instructions
    throw new Error('Use Jupiter adapter for swap execution - it routes through Raydium automatically');
  }

  // ============================================================================
  // Pool Operations
  // ============================================================================

  async getPools(tokenA?: PublicKey, tokenB?: PublicKey): Promise<PoolInfo[]> {
    const url = new URL(`${RAYDIUM_API_BASE}/pools/info/list`);
    url.searchParams.set('poolType', 'all');
    url.searchParams.set('poolSortField', 'tvl');
    url.searchParams.set('sortType', 'desc');
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('page', '1');

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Raydium API error: ${response.statusText}`);
    }

    const data = await response.json() as { data: { data: RaydiumApiPool[] } };
    const pools: PoolInfo[] = [];

    for (const pool of data.data.data) {
      const mintA = new PublicKey(pool.mintA.address);
      const mintB = new PublicKey(pool.mintB.address);

      // Filter by tokens if specified
      if (tokenA && tokenB) {
        const hasA = mintA.equals(tokenA) || mintB.equals(tokenA);
        const hasB = mintA.equals(tokenB) || mintB.equals(tokenB);
        if (!hasA || !hasB) continue;
      } else if (tokenA) {
        if (!mintA.equals(tokenA) && !mintB.equals(tokenA)) continue;
      }

      const poolInfo: PoolInfo = {
        address: new PublicKey(pool.id),
        dex: 'raydium',
        poolType: pool.type === 'Concentrated' ? 'clmm' : 'cpmm',
        tokenA: {
          mint: mintA,
          decimals: pool.mintA.decimals,
          symbol: pool.mintA.symbol,
        },
        tokenB: {
          mint: mintB,
          decimals: pool.mintB.decimals,
          symbol: pool.mintB.symbol,
        },
        reserveA: BigInt(Math.floor(pool.mintAmountA * Math.pow(10, pool.mintA.decimals))),
        reserveB: BigInt(Math.floor(pool.mintAmountB * Math.pow(10, pool.mintB.decimals))),
        fee: pool.feeRate,
        tvl: BigInt(Math.floor(pool.tvl * 1e6)), // Store as micro-USD
        apy: pool.apr.fee + pool.apr.reward,
      };

      pools.push(poolInfo);
      this.poolCache.set(pool.id, poolInfo);
    }

    return pools;
  }

  async getPoolInfo(pool: PublicKey): Promise<PoolInfo> {
    const cached = this.poolCache.get(pool.toBase58());
    if (cached) return cached;

    // Fetch single pool from API
    const url = `${RAYDIUM_API_BASE}/pools/info/ids?ids=${pool.toBase58()}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch pool: ${pool.toBase58()}`);
    }

    const data = await response.json() as { data: RaydiumApiPool[] };
    if (data.data.length === 0) {
      throw new Error(`Pool not found: ${pool.toBase58()}`);
    }

    const p = data.data[0];
    const poolInfo: PoolInfo = {
      address: pool,
      dex: 'raydium',
      poolType: p.type === 'Concentrated' ? 'clmm' : 'cpmm',
      tokenA: {
        mint: new PublicKey(p.mintA.address),
        decimals: p.mintA.decimals,
        symbol: p.mintA.symbol,
      },
      tokenB: {
        mint: new PublicKey(p.mintB.address),
        decimals: p.mintB.decimals,
        symbol: p.mintB.symbol,
      },
      reserveA: BigInt(Math.floor(p.mintAmountA * Math.pow(10, p.mintA.decimals))),
      reserveB: BigInt(Math.floor(p.mintAmountB * Math.pow(10, p.mintB.decimals))),
      fee: p.feeRate,
      tvl: BigInt(Math.floor(p.tvl * 1e6)),
      apy: p.apr.fee + p.apr.reward,
    };

    this.poolCache.set(pool.toBase58(), poolInfo);
    return poolInfo;
  }

  // ============================================================================
  // Liquidity Operations (CPMM)
  // ============================================================================

  async getAddLiquidityQuote(params: AddLiquidityParams): Promise<AddLiquidityQuote> {
    const pool = await this.getPoolInfo(params.pool);
    
    // Calculate LP tokens based on constant product
    // LP_tokens = sqrt(tokenA_deposited * tokenB_deposited) * total_LP / sqrt(reserveA * reserveB)
    
    // For simplicity, use ratio-based calculation
    const ratioA = (params.tokenAAmount * 10000n) / pool.reserveA;
    const ratioB = (params.tokenBAmount * 10000n) / pool.reserveB;
    const minRatio = ratioA < ratioB ? ratioA : ratioB;
    
    // Adjust amounts to maintain ratio
    const adjustedA = (pool.reserveA * minRatio) / 10000n;
    const adjustedB = (pool.reserveB * minRatio) / 10000n;
    
    // Estimate LP tokens (assuming we have total LP supply)
    // In reality, fetch this from chain
    const lpTokenAmount = minRatio; // Simplified

    return {
      pool: params.pool,
      tokenAAmount: adjustedA,
      tokenBAmount: adjustedB,
      lpTokenAmount,
      shareOfPool: Number(minRatio) / 10000,
    };
  }

  async buildAddLiquidityTransaction(
    quote: AddLiquidityQuote,
    params: AddLiquidityParams
  ): Promise<SwapTransaction> {
    const pool = await this.getPoolInfo(params.pool);
    
    // Build add liquidity instruction
    // This is a simplified version - production would use Raydium SDK
    const instructions: TransactionInstruction[] = [];

    // Get user token accounts
    const userTokenA = await getAssociatedTokenAddress(
      pool.tokenA.mint,
      params.userPublicKey
    );
    const userTokenB = await getAssociatedTokenAddress(
      pool.tokenB.mint,
      params.userPublicKey
    );

    // Note: In production, use Raydium SDK to build proper instructions
    // This is placeholder structure
    
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    
    const messageV0 = new TransactionMessage({
      payerKey: params.userPublicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);

    return {
      transaction,
      lastValidBlockHeight,
    };
  }

  async getRemoveLiquidityQuote(params: RemoveLiquidityParams): Promise<RemoveLiquidityQuote> {
    const pool = await this.getPoolInfo(params.pool);
    
    // Calculate tokens received for LP burned
    // Simplified - assumes LP represents proportional share
    const shareRatio = Number(params.lpAmount) / 1e9; // Assuming 1B total LP
    
    const tokenAAmount = BigInt(Math.floor(Number(pool.reserveA) * shareRatio));
    const tokenBAmount = BigInt(Math.floor(Number(pool.reserveB) * shareRatio));

    return {
      pool: params.pool,
      lpAmount: params.lpAmount,
      tokenAAmount,
      tokenBAmount,
    };
  }

  async buildRemoveLiquidityTransaction(
    quote: RemoveLiquidityQuote,
    params: RemoveLiquidityParams
  ): Promise<SwapTransaction> {
    const instructions: TransactionInstruction[] = [];
    
    // Build remove liquidity instructions
    // Production would use Raydium SDK
    
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    
    const messageV0 = new TransactionMessage({
      payerKey: params.userPublicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);

    return {
      transaction,
      lastValidBlockHeight,
    };
  }

  async getLPPositions(userPublicKey: PublicKey): Promise<LPPosition[]> {
    // Query user's LP token balances across Raydium pools
    // This would scan for LP token accounts owned by user
    
    const url = `${RAYDIUM_API_BASE}/pools/info/lp?owner=${userPublicKey.toBase58()}`;
    
    try {
      const response = await fetch(url);
      if (!response.ok) return [];
      
      const data = await response.json() as { data: Array<{
        poolId: string;
        lpMint: string;
        lpAmount: string;
        tokenAAmount: string;
        tokenBAmount: string;
      }> };

      return data.data.map(pos => ({
        pool: new PublicKey(pos.poolId),
        lpMint: new PublicKey(pos.lpMint),
        lpBalance: BigInt(pos.lpAmount),
        tokenAValue: BigInt(pos.tokenAAmount),
        tokenBValue: BigInt(pos.tokenBAmount),
        unclaimedFees: { tokenA: 0n, tokenB: 0n },
      }));
    } catch {
      return [];
    }
  }

  // ============================================================================
  // Concentrated Liquidity Operations (CLMM)
  // ============================================================================

  async createCLMMPosition(params: ConcentratedLiquidityParams): Promise<SwapTransaction> {
    // Create concentrated liquidity position within price range
    const pool = await this.getPoolInfo(params.pool);
    
    if (pool.poolType !== 'clmm') {
      throw new Error('Pool is not a CLMM pool');
    }

    // Convert prices to ticks
    const tickLower = this.priceToTick(params.priceLower, pool.tokenA.decimals, pool.tokenB.decimals);
    const tickUpper = this.priceToTick(params.priceUpper, pool.tokenA.decimals, pool.tokenB.decimals);

    const instructions: TransactionInstruction[] = [];
    
    // Build CLMM position creation instructions
    // Production would use Raydium CLMM SDK
    
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    
    const messageV0 = new TransactionMessage({
      payerKey: params.userPublicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);

    return {
      transaction,
      lastValidBlockHeight,
    };
  }

  async getCLMMPositions(userPublicKey: PublicKey): Promise<CLPosition[]> {
    // Fetch user's CLMM positions
    const url = `${RAYDIUM_API_BASE}/pools/info/clmm/positions?owner=${userPublicKey.toBase58()}`;
    
    try {
      const response = await fetch(url);
      if (!response.ok) return [];
      
      const data = await response.json() as { data: Array<{
        nftMint: string;
        poolId: string;
        tickLower: number;
        tickUpper: number;
        liquidity: string;
        tokenFeesOwedA: string;
        tokenFeesOwedB: string;
      }> };

      return data.data.map(pos => ({
        positionMint: new PublicKey(pos.nftMint),
        pool: new PublicKey(pos.poolId),
        tickLower: pos.tickLower,
        tickUpper: pos.tickUpper,
        liquidity: BigInt(pos.liquidity),
        tokenAOwed: BigInt(pos.tokenFeesOwedA),
        tokenBOwed: BigInt(pos.tokenFeesOwedB),
        feeGrowthA: 0n,
        feeGrowthB: 0n,
      }));
    } catch {
      return [];
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private priceToTick(price: number, decimalsA: number, decimalsB: number): number {
    // Convert price to tick index
    // tick = log(price) / log(1.0001)
    const adjustedPrice = price * Math.pow(10, decimalsB - decimalsA);
    return Math.floor(Math.log(adjustedPrice) / Math.log(1.0001));
  }

  private tickToPrice(tick: number, decimalsA: number, decimalsB: number): number {
    const rawPrice = Math.pow(1.0001, tick);
    return rawPrice * Math.pow(10, decimalsA - decimalsB);
  }
}

/**
 * Create a Raydium adapter instance
 */
export function createRaydiumAdapter(connection: Connection): RaydiumAdapter {
  return new RaydiumAdapter(connection);
}

