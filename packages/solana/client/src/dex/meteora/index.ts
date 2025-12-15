/**
 * Meteora DEX Integration
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
} from '../types';

const METEORA_API_BASE = 'https://dlmm-api.meteora.ag';

interface MeteoraPoolInfo {
  address: string;
  name: string;
  mint_x: string;
  mint_y: string;
  reserve_x: string;
  reserve_y: string;
  reserve_x_amount: number;
  reserve_y_amount: number;
  bin_step: number;
  base_fee_percentage: string;
  liquidity: string;
  current_price: number;
  apy: number;
  hide: boolean;
}

interface MeteoraPositionInfo {
  address: string;
  pair_address: string;
  total_x_amount: string;
  total_y_amount: string;
  position_bin_data: Array<{
    bin_id: number;
    position_liquidity: string;
  }>;
  fee_x: string;
  fee_y: string;
}

export class MeteoraAdapter implements DexAdapter {
  readonly name = 'meteora' as const;
  private connection: Connection;
  private poolCache: Map<string, PoolInfo> = new Map();

  constructor(connection: Connection) {
    this.connection = connection;
  }

  async getQuote(params: SwapParams): Promise<SwapQuote> {
    const pools = await this.getPools(params.inputMint, params.outputMint);
    if (pools.length === 0) {
      throw new Error(`No Meteora pool found for ${params.inputMint.toBase58()} -> ${params.outputMint.toBase58()}`);
    }

    const pool = pools.sort((a, b) => Number(b.tvl - a.tvl))[0];

    const isInputX = pool.tokenA.mint.equals(params.inputMint);
    const inputReserve = isInputX ? pool.reserveA : pool.reserveB;
    const outputReserve = isInputX ? pool.reserveB : pool.reserveA;

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
        dex: 'meteora',
        poolAddress: pool.address,
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        inputAmount: params.amount,
        outputAmount,
      }],
      dex: 'meteora',
    };
  }

  async buildSwapTransaction(_quote: SwapQuote): Promise<SwapTransaction> {
    throw new Error('Use Jupiter adapter for swap execution - it routes through Meteora automatically');
  }

  async getPools(tokenA?: PublicKey, tokenB?: PublicKey): Promise<PoolInfo[]> {
    const url = `${METEORA_API_BASE}/pair/all`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Meteora API error: ${response.statusText}`);
    }

    const data = await response.json() as MeteoraPoolInfo[];
    const pools: PoolInfo[] = [];

    for (const pool of data) {
      if (pool.hide) continue;

      const mintX = new PublicKey(pool.mint_x);
      const mintY = new PublicKey(pool.mint_y);

      if (tokenA && tokenB) {
        const hasA = mintX.equals(tokenA) || mintY.equals(tokenA);
        const hasB = mintX.equals(tokenB) || mintY.equals(tokenB);
        if (!hasA || !hasB) continue;
      } else if (tokenA) {
        if (!mintX.equals(tokenA) && !mintY.equals(tokenA)) continue;
      }

      const [symbolX, symbolY] = pool.name.split('-');

      const poolInfo: PoolInfo = {
        address: new PublicKey(pool.address),
        dex: 'meteora',
        poolType: 'dlmm',
        tokenA: {
          mint: mintX,
          decimals: this.inferDecimals(pool.reserve_x_amount, pool.reserve_x),
          symbol: symbolX || mintX.toBase58().slice(0, 4),
        },
        tokenB: {
          mint: mintY,
          decimals: this.inferDecimals(pool.reserve_y_amount, pool.reserve_y),
          symbol: symbolY || mintY.toBase58().slice(0, 4),
        },
        reserveA: BigInt(pool.reserve_x),
        reserveB: BigInt(pool.reserve_y),
        fee: parseFloat(pool.base_fee_percentage) / 100,
        tvl: BigInt(Math.floor(parseFloat(pool.liquidity))),
        apy: pool.apy,
      };

      pools.push(poolInfo);
      this.poolCache.set(pool.address, poolInfo);
    }

    return pools;
  }

  async getPoolInfo(pool: PublicKey): Promise<PoolInfo> {
    const cached = this.poolCache.get(pool.toBase58());
    if (cached) return cached;

    const url = `${METEORA_API_BASE}/pair/${pool.toBase58()}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch pool: ${pool.toBase58()}`);
    }

    const data = await response.json() as MeteoraPoolInfo;
    const [symbolX, symbolY] = data.name.split('-');

    const poolInfo: PoolInfo = {
      address: pool,
      dex: 'meteora',
      poolType: 'dlmm',
      tokenA: {
        mint: new PublicKey(data.mint_x),
        decimals: this.inferDecimals(data.reserve_x_amount, data.reserve_x),
        symbol: symbolX || '',
      },
      tokenB: {
        mint: new PublicKey(data.mint_y),
        decimals: this.inferDecimals(data.reserve_y_amount, data.reserve_y),
        symbol: symbolY || '',
      },
      reserveA: BigInt(data.reserve_x),
      reserveB: BigInt(data.reserve_y),
      fee: parseFloat(data.base_fee_percentage) / 100,
      tvl: BigInt(Math.floor(parseFloat(data.liquidity))),
      apy: data.apy,
    };

    this.poolCache.set(pool.toBase58(), poolInfo);
    return poolInfo;
  }

  async getAddLiquidityQuote(params: AddLiquidityParams): Promise<AddLiquidityQuote> {
    const pool = await this.getPoolInfo(params.pool);

    const shareA = (params.tokenAAmount * 10000n) / pool.reserveA;
    const shareB = (params.tokenBAmount * 10000n) / pool.reserveB;
    const minShare = shareA < shareB ? shareA : shareB;

    return {
      pool: params.pool,
      tokenAAmount: (pool.reserveA * minShare) / 10000n,
      tokenBAmount: (pool.reserveB * minShare) / 10000n,
      lpTokenAmount: minShare,
      shareOfPool: Number(minShare) / 10000,
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
    const shareRatio = Number(params.lpAmount) / 10000;

    return {
      pool: params.pool,
      lpAmount: params.lpAmount,
      tokenAAmount: BigInt(Math.floor(Number(pool.reserveA) * shareRatio)),
      tokenBAmount: BigInt(Math.floor(Number(pool.reserveB) * shareRatio)),
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
    const url = `${METEORA_API_BASE}/position/${userPublicKey.toBase58()}`;

    try {
      const response = await fetch(url);
      if (!response.ok) return [];

      const data = await response.json() as MeteoraPositionInfo[];

      return data.map(pos => ({
        pool: new PublicKey(pos.pair_address),
        lpMint: new PublicKey(pos.address),
        lpBalance: BigInt(pos.position_bin_data.reduce(
          (sum, bin) => sum + BigInt(bin.position_liquidity),
          0n
        )),
        tokenAValue: BigInt(pos.total_x_amount),
        tokenBValue: BigInt(pos.total_y_amount),
        unclaimedFees: {
          tokenA: BigInt(pos.fee_x),
          tokenB: BigInt(pos.fee_y),
        },
      }));
    } catch {
      return [];
    }
  }

  async getActiveBin(pool: PublicKey): Promise<{ binId: number; price: number }> {
    const poolInfo = await this.getPoolInfoDetailed(pool);
    return {
      binId: poolInfo.activeBinId,
      price: poolInfo.currentPrice,
    };
  }

  async getPoolInfoDetailed(pool: PublicKey): Promise<{
    address: PublicKey;
    activeBinId: number;
    binStep: number;
    currentPrice: number;
    liquidity: bigint;
  }> {
    const url = `${METEORA_API_BASE}/pair/${pool.toBase58()}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch pool: ${pool.toBase58()}`);
    }

    const data = await response.json() as MeteoraPoolInfo;

    return {
      address: pool,
      activeBinId: Math.floor(Math.log(data.current_price) / Math.log(1 + data.bin_step / 10000)),
      binStep: data.bin_step,
      currentPrice: data.current_price,
      liquidity: BigInt(Math.floor(parseFloat(data.liquidity))),
    };
  }

  async createDLMMPosition(params: ConcentratedLiquidityParams): Promise<SwapTransaction> {
    const poolInfo = await this.getPoolInfoDetailed(params.pool);

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

  private inferDecimals(amount: number, rawAmount: string): number {
    if (amount === 0) return 9;
    const ratio = parseFloat(rawAmount) / amount;
    return Math.round(Math.log10(ratio));
  }

  private priceToBinId(price: number, binStep: number): number {
    return Math.floor(Math.log(price) / Math.log(1 + binStep / 10000));
  }

  private binIdToPrice(binId: number, binStep: number): number {
    return Math.pow(1 + binStep / 10000, binId);
  }
}

export function createMeteoraAdapter(connection: Connection): MeteoraAdapter {
  return new MeteoraAdapter(connection);
}

