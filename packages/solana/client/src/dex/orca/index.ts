/**
 * Orca Whirlpools Integration
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

const ORCA_API_BASE = 'https://api.mainnet.orca.so/v1';

interface OrcaWhirlpoolInfo {
  address: string;
  tokenMintA: string;
  tokenMintB: string;
  tickSpacing: number;
  tickCurrentIndex: number;
  sqrtPrice: string;
  liquidity: string;
  feeRate: number;
  tokenDecimalsA: number;
  tokenDecimalsB: number;
  tokenSymbolA: string;
  tokenSymbolB: string;
  tvl: number;
  apr: number;
}

interface OrcaPositionInfo {
  positionMint: string;
  whirlpool: string;
  liquidity: string;
  tickLowerIndex: number;
  tickUpperIndex: number;
  feeOwedA: string;
  feeOwedB: string;
}

export class OrcaAdapter implements DexAdapter {
  readonly name = 'orca' as const;
  private connection: Connection;
  private poolCache: Map<string, PoolInfo> = new Map();

  constructor(connection: Connection) {
    this.connection = connection;
  }

  async getQuote(params: SwapParams): Promise<SwapQuote> {
    const pools = await this.getPools(params.inputMint, params.outputMint);
    if (pools.length === 0) {
      throw new Error(`No Orca pool found for ${params.inputMint.toBase58()} -> ${params.outputMint.toBase58()}`);
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

  async buildSwapTransaction(_quote: SwapQuote): Promise<SwapTransaction> {
    throw new Error('Use Jupiter adapter for swap execution - it routes through Orca automatically');
  }

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

      if (tokenA && tokenB) {
        const hasA = mintA.equals(tokenA) || mintB.equals(tokenA);
        const hasB = mintA.equals(tokenB) || mintB.equals(tokenB);
        if (!hasA || !hasB) continue;
      } else if (tokenA) {
        if (!mintA.equals(tokenA) && !mintB.equals(tokenA)) continue;
      }

      const sqrtPrice = BigInt(pool.sqrtPrice);
      const liquidity = BigInt(pool.liquidity);

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
        fee: pool.feeRate / 1_000_000,
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

  async getAddLiquidityQuote(params: AddLiquidityParams): Promise<AddLiquidityQuote> {
    const pool = await this.getPoolInfo(params.pool);

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
    const positions = await this.getWhirlpoolPositions(userPublicKey);

    return positions.map(pos => ({
      pool: pos.pool,
      lpMint: pos.positionMint,
      lpBalance: pos.liquidity,
      tokenAValue: 0n,
      tokenBValue: 0n,
      unclaimedFees: {
        tokenA: pos.tokenAOwed,
        tokenB: pos.tokenBOwed,
      },
    }));
  }

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

  async createWhirlpoolPosition(params: ConcentratedLiquidityParams): Promise<SwapTransaction> {
    const pool = await this.getPoolInfo(params.pool);

    if (pool.poolType !== 'whirlpool') {
      throw new Error('Pool is not a Whirlpool');
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

  async collectFees(
    _positionMint: PublicKey,
    userPublicKey: PublicKey
  ): Promise<SwapTransaction> {
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

  private priceToTick(
    price: number,
    decimalsA: number,
    decimalsB: number,
    tickSpacing: number
  ): number {
    const adjustedPrice = price * Math.pow(10, decimalsB - decimalsA);
    const tick = Math.floor(Math.log(adjustedPrice) / Math.log(1.0001));
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

export function createOrcaAdapter(connection: Connection): OrcaAdapter {
  return new OrcaAdapter(connection);
}

