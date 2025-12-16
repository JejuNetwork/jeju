/**
 * Raydium DEX Integration
 */

import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
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
} from '../types';

const RAYDIUM_API_BASE = 'https://api-v3.raydium.io';

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

  async getQuote(params: SwapParams): Promise<SwapQuote> {
    const pools = await this.getPools(params.inputMint, params.outputMint);
    if (pools.length === 0) {
      throw new Error(`No Raydium pool found for ${params.inputMint.toBase58()} -> ${params.outputMint.toBase58()}`);
    }

    const pool = pools.sort((a, b) => Number(b.tvl - a.tvl))[0];

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

  async buildSwapTransaction(_quote: SwapQuote): Promise<SwapTransaction> {
    throw new Error('Use Jupiter adapter for swap execution - it routes through Raydium automatically');
  }

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
        tvl: BigInt(Math.floor(pool.tvl * 1e6)),
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

  async getAddLiquidityQuote(params: AddLiquidityParams): Promise<AddLiquidityQuote> {
    const pool = await this.getPoolInfo(params.pool);

    const ratioA = (params.tokenAAmount * 10000n) / pool.reserveA;
    const ratioB = (params.tokenBAmount * 10000n) / pool.reserveB;
    const minRatio = ratioA < ratioB ? ratioA : ratioB;

    const adjustedA = (pool.reserveA * minRatio) / 10000n;
    const adjustedB = (pool.reserveB * minRatio) / 10000n;

    const lpTokenAmount = minRatio;

    return {
      pool: params.pool,
      tokenAAmount: adjustedA,
      tokenBAmount: adjustedB,
      lpTokenAmount,
      shareOfPool: Number(minRatio) / 10000,
    };
  }

  async buildAddLiquidityTransaction(
    _quote: AddLiquidityQuote,
    params: AddLiquidityParams
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

  async getRemoveLiquidityQuote(params: RemoveLiquidityParams): Promise<RemoveLiquidityQuote> {
    const pool = await this.getPoolInfo(params.pool);
    const shareRatio = Number(params.lpAmount) / 1e9;

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
    _quote: RemoveLiquidityQuote,
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

  async createCLMMPosition(params: ConcentratedLiquidityParams): Promise<SwapTransaction> {
    const pool = await this.getPoolInfo(params.pool);

    if (pool.poolType !== 'clmm') {
      throw new Error('Pool is not a CLMM pool');
    }

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

  async getCLMMPositions(userPublicKey: PublicKey): Promise<CLPosition[]> {
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

  private priceToTick(price: number, decimalsA: number, decimalsB: number): number {
    const adjustedPrice = price * Math.pow(10, decimalsB - decimalsA);
    return Math.floor(Math.log(adjustedPrice) / Math.log(1.0001));
  }

  private tickToPrice(tick: number, decimalsA: number, decimalsB: number): number {
    const rawPrice = Math.pow(1.0001, tick);
    return rawPrice * Math.pow(10, decimalsA - decimalsB);
  }
}

export function createRaydiumAdapter(connection: Connection): RaydiumAdapter {
  return new RaydiumAdapter(connection);
}

