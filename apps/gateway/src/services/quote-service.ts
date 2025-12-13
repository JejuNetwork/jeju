/**
 * Live Quote Service
 * 
 * Generates real quotes by:
 * 1. Checking registered solver liquidity on-chain
 * 2. Calculating gas costs for the route
 * 3. Applying solver profit margins
 * 4. Returning sorted quotes by best output amount
 */

import { createPublicClient, http, type PublicClient } from 'viem';
import { getChain } from '../lib/chains.js';
import { getRpcUrl, IS_TESTNET } from '../config/networks.js';
import { SOLVER_REGISTRY_ADDRESS } from '../config/contracts.js';
import { ZERO_ADDRESS } from '../lib/contracts.js';
import type { IntentQuote, SupportedChainId } from '@jejunetwork/types/oif';
import { keccak256, encodePacked } from 'viem';

const SOLVER_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getSolver',
    stateMutability: 'view',
    inputs: [{ name: 'solver', type: 'address' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'solver', type: 'address' },
        { name: 'stakedAmount', type: 'uint256' },
        { name: 'slashedAmount', type: 'uint256' },
        { name: 'totalFills', type: 'uint256' },
        { name: 'successfulFills', type: 'uint256' },
        { name: 'supportedChains', type: 'uint256[]' },
        { name: 'isActive', type: 'bool' },
        { name: 'registeredAt', type: 'uint256' },
      ],
    }],
  },
  {
    type: 'function',
    name: 'getStats',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: '_totalStaked', type: 'uint256' },
      { name: '_totalSlashed', type: 'uint256' },
      { name: '_activeSolvers', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'isSolverActive',
    stateMutability: 'view',
    inputs: [{ name: 'solver', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

// Known solver addresses (from env or discovery)
const KNOWN_SOLVERS: `0x${string}`[] = (process.env.OIF_DEV_SOLVER_ADDRESSES || '')
  .split(',')
  .filter((addr): addr is `0x${string}` => addr.startsWith('0x') && addr.length === 42);

// Gas costs per chain (in gwei)
const GAS_COSTS: Record<number, { fillGas: bigint; settlementGas: bigint; baseFee: bigint }> = {
  1: { fillGas: 150_000n, settlementGas: 80_000n, baseFee: 20n * 10n ** 9n },      // Ethereum
  10: { fillGas: 100_000n, settlementGas: 50_000n, baseFee: 1n * 10n ** 6n },       // Optimism
  42161: { fillGas: 100_000n, settlementGas: 50_000n, baseFee: 1n * 10n ** 7n },    // Arbitrum
  8453: { fillGas: 100_000n, settlementGas: 50_000n, baseFee: 1n * 10n ** 6n },     // Base
  11155111: { fillGas: 150_000n, settlementGas: 80_000n, baseFee: 5n * 10n ** 9n }, // Sepolia
  84532: { fillGas: 100_000n, settlementGas: 50_000n, baseFee: 1n * 10n ** 6n },    // Base Sepolia
  11155420: { fillGas: 100_000n, settlementGas: 50_000n, baseFee: 1n * 10n ** 6n }, // OP Sepolia
  421614: { fillGas: 100_000n, settlementGas: 50_000n, baseFee: 1n * 10n ** 7n },   // Arb Sepolia
};

// Default solver profit margin in basis points
const DEFAULT_SOLVER_MARGIN_BPS = 30;

// L2-to-L2 routes are cheaper
const L2_DISCOUNT_BPS = 20;

export interface QuoteParams {
  sourceChain: number;
  destinationChain: number;
  sourceToken: string;
  destinationToken: string;
  amount: string;
}

interface SolverInfo {
  address: `0x${string}`;
  stakedAmount: bigint;
  totalFills: bigint;
  successfulFills: bigint;
  supportedChains: readonly bigint[];
  isActive: boolean;
  reputation: number;
}

// Cache for solver info
const solverCache = new Map<string, { info: SolverInfo; fetchedAt: number }>();
const CACHE_TTL_MS = 30_000;

// Client cache
const clientCache = new Map<number, PublicClient>();

function getClient(chainId: number): PublicClient {
  let client = clientCache.get(chainId);
  if (!client) {
    const chain = getChain(chainId);
    const rpcUrl = getRpcUrl(chainId);
    client = createPublicClient({ chain, transport: http(rpcUrl) });
    clientCache.set(chainId, client);
  }
  return client;
}

async function fetchSolverInfo(address: `0x${string}`): Promise<SolverInfo | null> {
  const cacheKey = address.toLowerCase();
  const cached = solverCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.info;
  }

  const registryChain = IS_TESTNET ? 11155111 : 1;
  const client = getClient(registryChain);
  const registryAddr = SOLVER_REGISTRY_ADDRESS;

  if (!registryAddr || registryAddr === ZERO_ADDRESS) {
    return null;
  }

  const data = await client.readContract({
    address: registryAddr as `0x${string}`,
    abi: SOLVER_REGISTRY_ABI,
    functionName: 'getSolver',
    args: [address],
  });

  if (!data.isActive) return null;

  const totalFills = Number(data.totalFills);
  const successfulFills = Number(data.successfulFills);
  const reputation = totalFills > 0 ? Math.round((successfulFills / totalFills) * 100) : 50;

  const info: SolverInfo = {
    address,
    stakedAmount: data.stakedAmount,
    totalFills: data.totalFills,
    successfulFills: data.successfulFills,
    supportedChains: data.supportedChains,
    isActive: data.isActive,
    reputation,
  };

  solverCache.set(cacheKey, { info, fetchedAt: Date.now() });
  return info;
}

async function getGasPrice(chainId: number): Promise<bigint> {
  const client = getClient(chainId);
  const gasPrice = await client.getGasPrice();
  return gasPrice;
}

function calculateGasCost(sourceChain: number, destChain: number, gasPrice?: bigint): bigint {
  const destCosts = GAS_COSTS[destChain] || GAS_COSTS[1];
  const srcCosts = GAS_COSTS[sourceChain] || GAS_COSTS[1];

  const effectiveGasPrice = gasPrice || destCosts.baseFee;
  const fillCost = destCosts.fillGas * effectiveGasPrice;
  const settlementCost = srcCosts.settlementGas * srcCosts.baseFee;

  return fillCost + settlementCost;
}

function isL2Chain(chainId: number): boolean {
  return [10, 42161, 8453, 11155420, 421614, 84532, 420690, 420691].includes(chainId);
}

export async function getQuotes(params: QuoteParams): Promise<IntentQuote[]> {
  const { sourceChain, destinationChain, sourceToken, destinationToken, amount } = params;
  const inputAmount = BigInt(amount);
  const quotes: IntentQuote[] = [];

  // Get active solvers
  const solverPromises = KNOWN_SOLVERS.map(addr => fetchSolverInfo(addr));
  const solverResults = await Promise.all(solverPromises);
  const activeSolvers = solverResults.filter((s): s is SolverInfo => s !== null);

  // Get current gas price on destination chain
  let destGasPrice: bigint;
  try {
    destGasPrice = await getGasPrice(destinationChain);
  } catch {
    destGasPrice = GAS_COSTS[destinationChain]?.baseFee || 10n ** 9n;
  }

  // Calculate base gas cost
  const gasCost = calculateGasCost(sourceChain, destinationChain, destGasPrice);

  // Generate quotes from each active solver
  for (const solver of activeSolvers) {
    // Check if solver supports both chains
    const supportsSource = solver.supportedChains.some(c => Number(c) === sourceChain);
    const supportsDest = solver.supportedChains.some(c => Number(c) === destinationChain);
    if (!supportsSource || !supportsDest) continue;

    // Calculate fee based on solver margin and gas costs
    let marginBps = DEFAULT_SOLVER_MARGIN_BPS;

    // L2-to-L2 is cheaper
    if (isL2Chain(sourceChain) && isL2Chain(destinationChain)) {
      marginBps -= L2_DISCOUNT_BPS;
    }

    // High reputation solvers can charge slightly more
    if (solver.reputation >= 90) marginBps += 5;
    if (solver.reputation >= 95) marginBps += 5;

    // Calculate output amount
    const marginFee = (inputAmount * BigInt(marginBps)) / 10000n;
    const totalFee = marginFee + gasCost;
    const outputAmount = inputAmount > totalFee ? inputAmount - totalFee : 0n;

    if (outputAmount === 0n) continue; // Skip if fee exceeds input

    // Estimate fill time based on chain and solver history
    let estimatedFillTimeSeconds: number;
    if (isL2Chain(sourceChain) && isL2Chain(destinationChain)) {
      estimatedFillTimeSeconds = 15;
    } else if (sourceChain === 1 || destinationChain === 1) {
      estimatedFillTimeSeconds = 60;
    } else {
      estimatedFillTimeSeconds = 30;
    }

    // Faster solvers with good track record
    if (solver.reputation >= 90 && Number(solver.totalFills) > 10) {
      estimatedFillTimeSeconds = Math.round(estimatedFillTimeSeconds * 0.8);
    }

    const quoteId = keccak256(
      encodePacked(
        ['address', 'uint256', 'uint256', 'uint256'],
        [solver.address, BigInt(sourceChain), BigInt(destinationChain), BigInt(Date.now())]
      )
    );

    quotes.push({
      quoteId,
      sourceChainId: sourceChain as SupportedChainId,
      destinationChainId: destinationChain as SupportedChainId,
      sourceToken: sourceToken as `0x${string}`,
      destinationToken: destinationToken as `0x${string}`,
      inputAmount: amount,
      outputAmount: outputAmount.toString(),
      fee: totalFee.toString(),
      feePercent: marginBps,
      priceImpact: 0, // Same-asset transfers have no price impact
      estimatedFillTimeSeconds,
      validUntil: Math.floor(Date.now() / 1000) + 300, // 5 minutes
      solver: solver.address,
      solverReputation: solver.reputation,
    });
  }

  // If no solvers available, provide a fallback quote
  if (quotes.length === 0) {
    const isL2ToL2 = isL2Chain(sourceChain) && isL2Chain(destinationChain);
    const feePercent = isL2ToL2 ? 30 : 50;
    const fee = (inputAmount * BigInt(feePercent)) / 10000n;
    const outputAmount = inputAmount - fee;

    const quoteId = keccak256(
      encodePacked(
        ['uint256', 'uint256', 'uint256'],
        [BigInt(sourceChain), BigInt(destinationChain), BigInt(Date.now())]
      )
    );

    quotes.push({
      quoteId,
      sourceChainId: sourceChain as SupportedChainId,
      destinationChainId: destinationChain as SupportedChainId,
      sourceToken: sourceToken as `0x${string}`,
      destinationToken: destinationToken as `0x${string}`,
      inputAmount: amount,
      outputAmount: outputAmount.toString(),
      fee: fee.toString(),
      feePercent,
      priceImpact: 10, // Slight impact for fallback quotes
      estimatedFillTimeSeconds: isL2ToL2 ? 30 : 90,
      validUntil: Math.floor(Date.now() / 1000) + 300,
      solver: ZERO_ADDRESS,
      solverReputation: 0,
    });
  }

  // Sort by output amount (best first)
  return quotes.sort((a, b) => {
    const diff = BigInt(b.outputAmount) - BigInt(a.outputAmount);
    if (diff > 0n) return 1;
    if (diff < 0n) return -1;
    return b.solverReputation - a.solverReputation;
  });
}

export const quoteService = {
  getQuotes,
};
