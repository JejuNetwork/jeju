/**
 * PumpSwap / Pump.fun Style Bonding Curve Integration
 */

import {
  Connection,
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
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
  BondingCurveState,
  BondingCurveParams,
  BondingCurveBuyParams,
  BondingCurveSellParams,
} from '../types';
import { buildPlaceholderTransaction } from '../utils';

const PUMP_BONDING_CURVE_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const DEFAULT_GRADUATION_THRESHOLD = 85n * BigInt(LAMPORTS_PER_SOL);
const SOL_MINT = 'So11111111111111111111111111111111111111112';

export class PumpSwapAdapter implements DexAdapter {
  readonly name = 'pumpswap' as const;
  private connection: Connection;
  private curveCache: Map<string, BondingCurveState> = new Map();

  constructor(connection: Connection) {
    this.connection = connection;
  }

  async getQuote(params: SwapParams): Promise<SwapQuote> {
    const isSOL = params.inputMint.toBase58() === SOL_MINT;
    return isSOL ? this.getBuyQuote(params) : this.getSellQuote(params);
  }

  private async getBuyQuote(params: SwapParams): Promise<SwapQuote> {
    const curveAddress = this.deriveBondingCurveAddress(params.outputMint);
    const curve = await this.getBondingCurve(curveAddress);

    if (curve.graduated) {
      throw new Error('Token has graduated - use Raydium for trading');
    }

    const k = curve.virtualSolReserves * curve.virtualTokenReserves;
    const newVirtualSol = curve.virtualSolReserves + params.amount;
    const newVirtualToken = k / newVirtualSol;
    const tokensOut = curve.virtualTokenReserves - newVirtualToken;

    const fee = params.amount / 100n;
    const tokensOutAfterFee = tokensOut * 99n / 100n;
    const minTokensOut = tokensOutAfterFee * (10000n - BigInt(params.slippageBps)) / 10000n;

    const spotPrice = Number(curve.virtualTokenReserves) / Number(curve.virtualSolReserves);
    const execPrice = Number(tokensOutAfterFee) / Number(params.amount);
    const priceImpact = Math.abs(1 - execPrice / spotPrice) * 100;

    return {
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      inputAmount: params.amount,
      outputAmount: tokensOutAfterFee,
      minOutputAmount: minTokensOut,
      priceImpactPct: priceImpact,
      fee,
      route: [{
        dex: 'pumpswap',
        poolAddress: curveAddress,
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        inputAmount: params.amount,
        outputAmount: tokensOutAfterFee,
      }],
      dex: 'pumpswap',
    };
  }

  private async getSellQuote(params: SwapParams): Promise<SwapQuote> {
    const curveAddress = this.deriveBondingCurveAddress(params.inputMint);
    const curve = await this.getBondingCurve(curveAddress);

    if (curve.graduated) {
      throw new Error('Token has graduated - use Raydium for trading');
    }

    const k = curve.virtualSolReserves * curve.virtualTokenReserves;
    const newVirtualToken = curve.virtualTokenReserves + params.amount;
    const newVirtualSol = k / newVirtualToken;
    const solOut = curve.virtualSolReserves - newVirtualSol;

    const fee = solOut / 100n;
    const solOutAfterFee = solOut * 99n / 100n;
    const minSolOut = solOutAfterFee * (10000n - BigInt(params.slippageBps)) / 10000n;

    const spotPrice = Number(curve.virtualSolReserves) / Number(curve.virtualTokenReserves);
    const execPrice = Number(solOutAfterFee) / Number(params.amount);
    const priceImpact = Math.abs(1 - execPrice / spotPrice) * 100;

    return {
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      inputAmount: params.amount,
      outputAmount: solOutAfterFee,
      minOutputAmount: minSolOut,
      priceImpactPct: priceImpact,
      fee,
      route: [{
        dex: 'pumpswap',
        poolAddress: curveAddress,
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        inputAmount: params.amount,
        outputAmount: solOutAfterFee,
      }],
      dex: 'pumpswap',
    };
  }

  async buildSwapTransaction(quote: SwapQuote): Promise<SwapTransaction> {
    const isSOL = quote.inputMint.toBase58() === SOL_MINT;
    return isSOL
      ? buildPlaceholderTransaction(this.connection, PublicKey.default)
      : buildPlaceholderTransaction(this.connection, PublicKey.default);
  }

  async getBondingCurve(curveAddress: PublicKey): Promise<BondingCurveState> {
    const cached = this.curveCache.get(curveAddress.toBase58());
    if (cached) return cached;

    const accountInfo = await this.connection.getAccountInfo(curveAddress);
    if (!accountInfo) {
      throw new Error(`Bonding curve not found: ${curveAddress.toBase58()}`);
    }

    const data = accountInfo.data;

    const virtualTokenReserves = data.readBigUInt64LE(8);
    const virtualSolReserves = data.readBigUInt64LE(16);
    const realTokenReserves = data.readBigUInt64LE(24);
    const realSolReserves = data.readBigUInt64LE(32);
    const tokenTotalSupply = data.readBigUInt64LE(40);
    const complete = data.readUInt8(48) === 1;

    const currentPrice = Number(virtualTokenReserves) / Number(virtualSolReserves);
    const pricePerToken = Number(virtualSolReserves) / Number(virtualTokenReserves);
    const marketCap = BigInt(Math.floor(pricePerToken * Number(tokenTotalSupply)));
    const progress = (Number(realSolReserves) / Number(DEFAULT_GRADUATION_THRESHOLD)) * 100;

    const [tokenMint] = PublicKey.findProgramAddressSync(
      [Buffer.from('mint'), curveAddress.toBuffer()],
      PUMP_BONDING_CURVE_PROGRAM
    );

    const state: BondingCurveState = {
      address: curveAddress,
      tokenMint,
      virtualSolReserves,
      virtualTokenReserves,
      realSolReserves,
      realTokenReserves,
      tokensSold: tokenTotalSupply - realTokenReserves,
      graduated: complete,
      graduationThreshold: DEFAULT_GRADUATION_THRESHOLD,
      currentPrice,
      marketCap,
      progress: Math.min(progress, 100),
    };

    this.curveCache.set(curveAddress.toBase58(), state);
    return state;
  }

  async createBondingCurve(
    _params: BondingCurveParams,
    creator: PublicKey
  ): Promise<{
    transaction: SwapTransaction;
    tokenMint: PublicKey;
    curveAddress: PublicKey;
  }> {
    const mintKeypair = Keypair.generate();

    const [curveAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), mintKeypair.publicKey.toBuffer()],
      PUMP_BONDING_CURVE_PROGRAM
    );

    const transaction = await buildPlaceholderTransaction(this.connection, creator);

    return {
      transaction,
      tokenMint: mintKeypair.publicKey,
      curveAddress,
    };
  }

  async buy(params: BondingCurveBuyParams): Promise<SwapTransaction> {
    const curve = await this.getBondingCurve(params.curve);

    const quote = await this.getQuote({
      inputMint: new PublicKey(SOL_MINT),
      outputMint: curve.tokenMint,
      amount: params.solAmount,
      slippageBps: 100,
      userPublicKey: params.userPublicKey,
    });

    return this.buildSwapTransaction(quote);
  }

  async sell(params: BondingCurveSellParams): Promise<SwapTransaction> {
    const curve = await this.getBondingCurve(params.curve);

    const quote = await this.getQuote({
      inputMint: curve.tokenMint,
      outputMint: new PublicKey(SOL_MINT),
      amount: params.tokenAmount,
      slippageBps: 100,
      userPublicKey: params.userPublicKey,
    });

    return this.buildSwapTransaction(quote);
  }

  async getPools(_tokenA?: PublicKey, _tokenB?: PublicKey): Promise<PoolInfo[]> {
    return [];
  }

  async getPoolInfo(pool: PublicKey): Promise<PoolInfo> {
    const curve = await this.getBondingCurve(pool);

    return {
      address: pool,
      dex: 'pumpswap',
      poolType: 'bonding',
      tokenA: {
        mint: new PublicKey(SOL_MINT),
        decimals: 9,
        symbol: 'SOL',
      },
      tokenB: {
        mint: curve.tokenMint,
        decimals: 6,
        symbol: 'TOKEN',
      },
      reserveA: curve.virtualSolReserves,
      reserveB: curve.virtualTokenReserves,
      fee: 0.01,
      tvl: curve.realSolReserves,
      apy: 0,
    };
  }

  async getAddLiquidityQuote(_params: AddLiquidityParams): Promise<AddLiquidityQuote> {
    throw new Error('Bonding curves do not support direct liquidity provision');
  }

  async buildAddLiquidityTransaction(
    _quote: AddLiquidityQuote,
    _params: AddLiquidityParams
  ): Promise<SwapTransaction> {
    throw new Error('Bonding curves do not support direct liquidity provision');
  }

  async getRemoveLiquidityQuote(_params: RemoveLiquidityParams): Promise<RemoveLiquidityQuote> {
    throw new Error('Bonding curves do not support liquidity removal');
  }

  async buildRemoveLiquidityTransaction(
    _quote: RemoveLiquidityQuote,
    _params: RemoveLiquidityParams
  ): Promise<SwapTransaction> {
    throw new Error('Bonding curves do not support liquidity removal');
  }

  async getLPPositions(_userPublicKey: PublicKey): Promise<LPPosition[]> {
    return [];
  }

  deriveBondingCurveAddress(tokenMint: PublicKey): PublicKey {
    const [curveAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), tokenMint.toBuffer()],
      PUMP_BONDING_CURVE_PROGRAM
    );
    return curveAddress;
  }

  calculateBuyAmount(curve: BondingCurveState, solAmount: bigint): bigint {
    const k = curve.virtualSolReserves * curve.virtualTokenReserves;
    const newVirtualSol = curve.virtualSolReserves + solAmount;
    const newVirtualToken = k / newVirtualSol;
    return curve.virtualTokenReserves - newVirtualToken;
  }

  calculateSellAmount(curve: BondingCurveState, tokenAmount: bigint): bigint {
    const k = curve.virtualSolReserves * curve.virtualTokenReserves;
    const newVirtualToken = curve.virtualTokenReserves + tokenAmount;
    const newVirtualSol = k / newVirtualToken;
    return curve.virtualSolReserves - newVirtualSol;
  }

  getPrice(curve: BondingCurveState): number {
    return Number(curve.virtualSolReserves) / Number(curve.virtualTokenReserves);
  }

  canGraduate(curve: BondingCurveState): boolean {
    return curve.realSolReserves >= curve.graduationThreshold && !curve.graduated;
  }
}

export function createPumpSwapAdapter(connection: Connection): PumpSwapAdapter {
  return new PumpSwapAdapter(connection);
}
