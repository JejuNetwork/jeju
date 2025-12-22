/**
 * Shared DEX utilities
 * Common calculations and helpers used across DEX adapters
 */

import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
} from '@solana/web3.js';
import type {
  SwapQuote,
  SwapTransaction,
  PoolInfo,
  DexType,
} from './types';

// ============================================================================
// AMM Swap Calculation
// ============================================================================

export interface AMMSwapParams {
  inputAmount: bigint;
  inputReserve: bigint;
  outputReserve: bigint;
  feeBps: number;
  slippageBps: number;
}

export interface AMMSwapResult {
  outputAmount: bigint;
  minOutputAmount: bigint;
  fee: bigint;
  priceImpactPct: number;
}

/**
 * Calculate constant-product AMM swap output
 * Used by Raydium CPMM, Meteora standard pools, Orca standard pools
 */
export function calculateAMMSwap(params: AMMSwapParams): AMMSwapResult {
  const { inputAmount, inputReserve, outputReserve, feeBps, slippageBps } = params;

  const feeMultiplier = 10000n - BigInt(Math.floor(feeBps));
  const amountInWithFee = inputAmount * feeMultiplier / 10000n;
  const outputAmount = (amountInWithFee * outputReserve) / (inputReserve + amountInWithFee);

  const minOutputAmount = outputAmount * (10000n - BigInt(slippageBps)) / 10000n;

  const spotPrice = Number(outputReserve) / Number(inputReserve);
  const execPrice = Number(outputAmount) / Number(inputAmount);
  const priceImpactPct = Math.abs(1 - execPrice / spotPrice) * 100;

  const fee = inputAmount * BigInt(Math.floor(feeBps)) / 10000n;

  return {
    outputAmount,
    minOutputAmount,
    fee,
    priceImpactPct,
  };
}

/**
 * Build a swap quote from pool info and AMM calculation result
 */
export function buildSwapQuote(params: {
  inputMint: PublicKey;
  outputMint: PublicKey;
  inputAmount: bigint;
  pool: PoolInfo;
  ammResult: AMMSwapResult;
  dex: DexType;
}): SwapQuote {
  const { inputMint, outputMint, inputAmount, pool, ammResult, dex } = params;

  return {
    inputMint,
    outputMint,
    inputAmount,
    outputAmount: ammResult.outputAmount,
    minOutputAmount: ammResult.minOutputAmount,
    priceImpactPct: ammResult.priceImpactPct,
    fee: ammResult.fee,
    route: [{
      dex,
      poolAddress: pool.address,
      inputMint,
      outputMint,
      inputAmount,
      outputAmount: ammResult.outputAmount,
    }],
    dex,
  };
}

// ============================================================================
// Transaction Building
// ============================================================================

/**
 * Build an empty placeholder transaction
 * Used when actual transaction building requires SDK integration
 */
export async function buildPlaceholderTransaction(
  connection: Connection,
  payer: PublicKey
): Promise<SwapTransaction> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

  const messageV0 = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [],
  }).compileToV0Message();

  return {
    transaction: new VersionedTransaction(messageV0),
    lastValidBlockHeight,
  };
}

// ============================================================================
// Pool Filtering
// ============================================================================

export interface PoolFilterParams {
  tokenA?: PublicKey;
  tokenB?: PublicKey;
}

/**
 * Check if a pool matches the given token filter criteria
 */
export function poolMatchesFilter(
  mintX: PublicKey,
  mintY: PublicKey,
  filter: PoolFilterParams
): boolean {
  const { tokenA, tokenB } = filter;

  if (tokenA && tokenB) {
    const hasA = mintX.equals(tokenA) || mintY.equals(tokenA);
    const hasB = mintX.equals(tokenB) || mintY.equals(tokenB);
    return hasA && hasB;
  }

  if (tokenA) {
    return mintX.equals(tokenA) || mintY.equals(tokenA);
  }

  return true;
}

/**
 * Determine input/output reserves based on which token is input
 */
export function getSwapReserves(
  pool: PoolInfo,
  inputMint: PublicKey
): { inputReserve: bigint; outputReserve: bigint; isInputA: boolean } {
  const isInputA = pool.tokenA.mint.equals(inputMint);
  return {
    inputReserve: isInputA ? pool.reserveA : pool.reserveB,
    outputReserve: isInputA ? pool.reserveB : pool.reserveA,
    isInputA,
  };
}

// ============================================================================
// Price/Tick Utilities (for CLMM pools)
// ============================================================================

/**
 * Convert price to tick index (for concentrated liquidity)
 */
export function priceToTick(
  price: number,
  decimalsA: number,
  decimalsB: number,
  tickSpacing?: number
): number {
  const adjustedPrice = price * Math.pow(10, decimalsB - decimalsA);
  const tick = Math.floor(Math.log(adjustedPrice) / Math.log(1.0001));

  if (tickSpacing) {
    return Math.floor(tick / tickSpacing) * tickSpacing;
  }

  return tick;
}

/**
 * Convert tick index to price (for concentrated liquidity)
 */
export function tickToPrice(
  tick: number,
  decimalsA: number,
  decimalsB: number
): number {
  const rawPrice = Math.pow(1.0001, tick);
  return rawPrice * Math.pow(10, decimalsA - decimalsB);
}

/**
 * Convert sqrt price X64 to price (Orca format)
 */
export function sqrtPriceX64ToPrice(
  sqrtPriceX64: bigint,
  decimalsA: number,
  decimalsB: number
): number {
  const sqrtPrice = Number(sqrtPriceX64) / (2 ** 64);
  const price = sqrtPrice * sqrtPrice;
  return price * Math.pow(10, decimalsA - decimalsB);
}

/**
 * Convert price to bin ID (Meteora DLMM format)
 */
export function priceToBinId(price: number, binStep: number): number {
  return Math.floor(Math.log(price) / Math.log(1 + binStep / 10000));
}

/**
 * Convert bin ID to price (Meteora DLMM format)
 */
export function binIdToPrice(binId: number, binStep: number): number {
  return Math.pow(1 + binStep / 10000, binId);
}

// ============================================================================
// Decimal Inference
// ============================================================================

/**
 * Infer token decimals from raw and human-readable amounts
 */
export function inferDecimals(humanAmount: number, rawAmount: string): number {
  if (humanAmount === 0) return 9;
  const ratio = parseFloat(rawAmount) / humanAmount;
  return Math.round(Math.log10(ratio));
}

// ============================================================================
// Hex/Bytes Conversion
// ============================================================================

/**
 * Convert hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleaned = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]*$/.test(cleaned)) {
    throw new Error(`Invalid hex string: ${hex}`);
  }
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleaned.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert EVM address (20 bytes) to Uint8Array
 */
export function evmAddressToBytes(address: string): Uint8Array {
  const cleaned = address.startsWith('0x') ? address.slice(2) : address;
  if (cleaned.length !== 40) {
    throw new Error('Invalid EVM address length');
  }
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) {
    bytes[i] = parseInt(cleaned.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Convert bytes to EVM address string
 */
export function bytesToEvmAddress(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// Bonding Curve Calculations
// ============================================================================

export interface BondingCurveReserves {
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
}

/**
 * Calculate tokens out for a given SOL input on a bonding curve
 * Uses constant product formula: k = x * y
 */
export function calculateBondingCurveBuy(
  reserves: BondingCurveReserves,
  solAmount: bigint
): bigint {
  const k = reserves.virtualSolReserves * reserves.virtualTokenReserves;
  const newVirtualSol = reserves.virtualSolReserves + solAmount;
  const newVirtualToken = k / newVirtualSol;
  return reserves.virtualTokenReserves - newVirtualToken;
}

/**
 * Calculate SOL out for a given token input on a bonding curve
 * Uses constant product formula: k = x * y
 */
export function calculateBondingCurveSell(
  reserves: BondingCurveReserves,
  tokenAmount: bigint
): bigint {
  const k = reserves.virtualSolReserves * reserves.virtualTokenReserves;
  const newVirtualToken = reserves.virtualTokenReserves + tokenAmount;
  const newVirtualSol = k / newVirtualToken;
  return reserves.virtualSolReserves - newVirtualSol;
}

/**
 * Get current price from bonding curve reserves (SOL per token)
 */
export function getBondingCurvePrice(reserves: BondingCurveReserves): number {
  return Number(reserves.virtualSolReserves) / Number(reserves.virtualTokenReserves);
}
