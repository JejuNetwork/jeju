/**
 * Jeju Routing Optimizer
 *
 * Maximizes cross-chain traffic through Jeju to capture fees.
 * Routes are optimized to:
 * 1. Route through Jeju whenever possible (hub model)
 * 2. Minimize user costs while maximizing protocol revenue
 * 3. Aggregate liquidity from all supported chains
 * 4. Support x402 payments across all chains
 *
 * Supported Chains:
 * - EVM: Ethereum, Base, BSC, Arbitrum, Optimism, Jeju
 * - Non-EVM: Solana
 *
 * Revenue Streams:
 * - Protocol fees on all routes through Jeju
 * - x402 settlement fees
 * - Solver fees from OIF intents
 * - XLP liquidity provision yields
 */

import type { Address } from 'viem';

// ============ Chain Definitions ============

export const JEJU_CHAIN_ID = 420691;
export const JEJU_TESTNET_CHAIN_ID = 420690;

export enum ChainId {
  // EVM Mainnets
  ETHEREUM = 1,
  BASE = 8453,
  BSC = 56,
  ARBITRUM = 42161,
  OPTIMISM = 10,
  JEJU = 420691,

  // EVM Testnets
  SEPOLIA = 11155111,
  BASE_SEPOLIA = 84532,
  BSC_TESTNET = 97,
  ARBITRUM_SEPOLIA = 421614,
  OPTIMISM_SEPOLIA = 11155420,
  JEJU_TESTNET = 420690,

  // Solana
  SOLANA_MAINNET = 101,
  SOLANA_DEVNET = 103,
}

export interface ChainConfig {
  chainId: ChainId | number;
  name: string;
  network: 'mainnet' | 'testnet';
  type: 'evm' | 'solana';
  rpcUrl: string;
  isJeju: boolean;
  x402Supported: boolean;
  stablecoins: {
    usdc?: Address | string;
    usdt?: Address | string;
  };
  oifContracts?: {
    inputSettler: Address;
    outputSettler: Address;
    solverRegistry: Address;
  };
  bridgeContracts?: {
    zkBridge?: Address;
    eilPaymaster?: Address;
  };
}

export const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  // === Mainnets ===
  [ChainId.JEJU]: {
    chainId: ChainId.JEJU,
    name: 'Jeju',
    network: 'mainnet',
    type: 'evm',
    rpcUrl: 'https://rpc.jejunetwork.org',
    isJeju: true,
    x402Supported: true,
    stablecoins: {},
  },
  [ChainId.ETHEREUM]: {
    chainId: ChainId.ETHEREUM,
    name: 'Ethereum',
    network: 'mainnet',
    type: 'evm',
    rpcUrl: 'https://eth.llamarpc.com',
    isJeju: false,
    x402Supported: true,
    stablecoins: {
      usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    },
  },
  [ChainId.BASE]: {
    chainId: ChainId.BASE,
    name: 'Base',
    network: 'mainnet',
    type: 'evm',
    rpcUrl: 'https://mainnet.base.org',
    isJeju: false,
    x402Supported: true,
    stablecoins: {
      usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    },
  },
  [ChainId.BSC]: {
    chainId: ChainId.BSC,
    name: 'BNB Chain',
    network: 'mainnet',
    type: 'evm',
    rpcUrl: 'https://bsc-dataseed.bnbchain.org',
    isJeju: false,
    x402Supported: true,
    stablecoins: {
      usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      usdt: '0x55d398326f99059fF775485246999027B3197955',
    },
  },
  [ChainId.ARBITRUM]: {
    chainId: ChainId.ARBITRUM,
    name: 'Arbitrum One',
    network: 'mainnet',
    type: 'evm',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    isJeju: false,
    x402Supported: true,
    stablecoins: {
      usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      usdt: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    },
  },
  [ChainId.OPTIMISM]: {
    chainId: ChainId.OPTIMISM,
    name: 'Optimism',
    network: 'mainnet',
    type: 'evm',
    rpcUrl: 'https://mainnet.optimism.io',
    isJeju: false,
    x402Supported: true,
    stablecoins: {
      usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      usdt: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    },
  },
  [ChainId.SOLANA_MAINNET]: {
    chainId: ChainId.SOLANA_MAINNET,
    name: 'Solana',
    network: 'mainnet',
    type: 'solana',
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    isJeju: false,
    x402Supported: true,
    stablecoins: {
      usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      usdt: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    },
  },

  // === Testnets ===
  [ChainId.JEJU_TESTNET]: {
    chainId: ChainId.JEJU_TESTNET,
    name: 'Jeju Testnet',
    network: 'testnet',
    type: 'evm',
    rpcUrl: 'https://testnet-rpc.jejunetwork.org',
    isJeju: true,
    x402Supported: true,
    stablecoins: {
      usdc: '0x953F6516E5d2864cE7f13186B45dE418EA665EB2',
    },
  },
  [ChainId.SEPOLIA]: {
    chainId: ChainId.SEPOLIA,
    name: 'Sepolia',
    network: 'testnet',
    type: 'evm',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    isJeju: false,
    x402Supported: true,
    stablecoins: {
      usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    },
  },
  [ChainId.BASE_SEPOLIA]: {
    chainId: ChainId.BASE_SEPOLIA,
    name: 'Base Sepolia',
    network: 'testnet',
    type: 'evm',
    rpcUrl: 'https://sepolia.base.org',
    isJeju: false,
    x402Supported: true,
    stablecoins: {
      usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    },
  },
  [ChainId.BSC_TESTNET]: {
    chainId: ChainId.BSC_TESTNET,
    name: 'BSC Testnet',
    network: 'testnet',
    type: 'evm',
    rpcUrl: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
    isJeju: false,
    x402Supported: true,
    stablecoins: {
      usdt: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd',
    },
  },
  [ChainId.ARBITRUM_SEPOLIA]: {
    chainId: ChainId.ARBITRUM_SEPOLIA,
    name: 'Arbitrum Sepolia',
    network: 'testnet',
    type: 'evm',
    rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
    isJeju: false,
    x402Supported: true,
    stablecoins: {
      usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    },
  },
  [ChainId.OPTIMISM_SEPOLIA]: {
    chainId: ChainId.OPTIMISM_SEPOLIA,
    name: 'Optimism Sepolia',
    network: 'testnet',
    type: 'evm',
    rpcUrl: 'https://sepolia.optimism.io',
    isJeju: false,
    x402Supported: true,
    stablecoins: {
      usdc: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
    },
  },
  [ChainId.SOLANA_DEVNET]: {
    chainId: ChainId.SOLANA_DEVNET,
    name: 'Solana Devnet',
    network: 'testnet',
    type: 'solana',
    rpcUrl: 'https://api.devnet.solana.com',
    isJeju: false,
    x402Supported: true,
    stablecoins: {
      usdc: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    },
  },
};

// ============ Route Types ============

export type RouteStrategy = 'direct' | 'hub' | 'multi_hop';

export interface RouteHop {
  fromChain: ChainId | number;
  toChain: ChainId | number;
  mechanism: 'eil' | 'zkbridge' | 'oif' | 'ccip' | 'wormhole' | 'hyperlane';
  estimatedTimeSec: number;
  feeBps: number;
}

export interface OptimizedRoute {
  id: string;
  strategy: RouteStrategy;
  hops: RouteHop[];
  totalTimeSec: number;
  totalFeeBps: number;
  throughJeju: boolean;
  jejuRevenue: bigint; // Revenue captured by routing through Jeju
  userCost: bigint;
  confidence: number; // 0-100
}

export interface RouteRequest {
  sourceChain: ChainId | number;
  destChain: ChainId | number;
  token: Address | string;
  amount: bigint;
  sender: Address | string;
  recipient: Address | string;
  preferThroughJeju?: boolean;
  maxTimeSec?: number;
  maxFeeBps?: number;
}

// ============ Fee Configuration ============

export interface FeeConfig {
  protocolFeeBps: number; // Base protocol fee (e.g., 10 = 0.1%)
  solverMarginBps: number; // Solver fee margin
  xlpFeeBps: number; // XLP liquidity fee
  x402FeeBps: number; // x402 facilitator fee
}

const DEFAULT_FEES: FeeConfig = {
  protocolFeeBps: 10, // 0.1%
  solverMarginBps: 5, // 0.05%
  xlpFeeBps: 5, // 0.05%
  x402FeeBps: 50, // 0.5% (for x402 payments)
};

// ============ Route Cost Matrix ============

// Cost (in bps) and time (in seconds) for direct routes between chains
interface RouteCost {
  feeBps: number;
  timeSec: number;
  mechanism: RouteHop['mechanism'];
}

const DIRECT_ROUTE_COSTS: Record<string, RouteCost> = {
  // EVM L2 to L2 (via EIL - fast)
  'evm_l2_to_l2': { feeBps: 10, timeSec: 12, mechanism: 'eil' },

  // EVM to Solana (via ZK Bridge)
  'evm_to_solana': { feeBps: 20, timeSec: 60, mechanism: 'zkbridge' },
  'solana_to_evm': { feeBps: 20, timeSec: 60, mechanism: 'zkbridge' },

  // EVM L1 to L2 (via canonical bridge - slow)
  'evm_l1_to_l2': { feeBps: 5, timeSec: 900, mechanism: 'ccip' },
  'evm_l2_to_l1': { feeBps: 5, timeSec: 604800, mechanism: 'ccip' }, // 7 days for optimistic

  // Through OIF (solver-based)
  'oif_solver': { feeBps: 25, timeSec: 30, mechanism: 'oif' },

  // BSC specific (CCIP)
  'bsc_to_evm': { feeBps: 30, timeSec: 600, mechanism: 'ccip' },
  'evm_to_bsc': { feeBps: 30, timeSec: 600, mechanism: 'ccip' },
};

// ============ Jeju Routing Optimizer ============

export class JejuRoutingOptimizer {
  private fees: FeeConfig;
  private network: 'mainnet' | 'testnet';

  constructor(
    fees: FeeConfig = DEFAULT_FEES,
    network: 'mainnet' | 'testnet' = 'testnet'
  ) {
    this.fees = fees;
    this.network = network;
  }

  /**
   * Find optimal routes for a cross-chain transfer
   * Prioritizes routing through Jeju when beneficial
   */
  async findOptimalRoutes(request: RouteRequest): Promise<OptimizedRoute[]> {
    const routes: OptimizedRoute[] = [];

    const srcConfig = CHAIN_CONFIGS[request.sourceChain];
    const dstConfig = CHAIN_CONFIGS[request.destChain];

    if (!srcConfig || !dstConfig) {
      throw new Error(`Unsupported chain: ${request.sourceChain} or ${request.destChain}`);
    }

    // Ensure same network type
    if (srcConfig.network !== dstConfig.network) {
      throw new Error('Cannot route between mainnet and testnet');
    }

    const jejuChainId = srcConfig.network === 'mainnet' 
      ? ChainId.JEJU 
      : ChainId.JEJU_TESTNET;

    // 1. Direct route (if available)
    const directRoute = this.buildDirectRoute(request, srcConfig, dstConfig);
    if (directRoute) {
      routes.push(directRoute);
    }

    // 2. Hub route through Jeju (Source -> Jeju -> Dest)
    if (!srcConfig.isJeju && !dstConfig.isJeju) {
      const hubRoute = this.buildHubRoute(request, srcConfig, dstConfig, jejuChainId);
      if (hubRoute) {
        routes.push(hubRoute);
      }
    }

    // 3. OIF solver route (uses intents)
    const oifRoute = this.buildOIFRoute(request, srcConfig, dstConfig);
    if (oifRoute) {
      routes.push(oifRoute);
    }

    // Sort by preference
    return this.rankRoutes(routes, request);
  }

  /**
   * Calculate the revenue Jeju captures from a route
   */
  calculateJejuRevenue(route: OptimizedRoute, amount: bigint): bigint {
    if (!route.throughJeju) {
      // Even direct routes may capture some revenue via x402 fees
      return (amount * BigInt(this.fees.x402FeeBps)) / 10000n;
    }

    // Hub routes capture full protocol fees
    const protocolFee = (amount * BigInt(this.fees.protocolFeeBps)) / 10000n;
    const xlpFee = (amount * BigInt(this.fees.xlpFeeBps)) / 10000n;
    const solverFee = (amount * BigInt(this.fees.solverMarginBps)) / 10000n;

    return protocolFee + xlpFee + solverFee;
  }

  /**
   * Get all supported chains for current network
   */
  getSupportedChains(): ChainConfig[] {
    return Object.values(CHAIN_CONFIGS).filter(c => c.network === this.network);
  }

  /**
   * Check if a direct route exists between two chains
   */
  hasDirectRoute(sourceChain: ChainId | number, destChain: ChainId | number): boolean {
    const src = CHAIN_CONFIGS[sourceChain];
    const dst = CHAIN_CONFIGS[destChain];

    if (!src || !dst) return false;

    // EVM L2 <-> L2 via EIL
    if (src.type === 'evm' && dst.type === 'evm') {
      return true;
    }

    // EVM <-> Solana via ZK Bridge
    if (
      (src.type === 'evm' && dst.type === 'solana') ||
      (src.type === 'solana' && dst.type === 'evm')
    ) {
      return true;
    }

    return false;
  }

  // ============ Private Methods ============

  private buildDirectRoute(
    request: RouteRequest,
    src: ChainConfig,
    dst: ChainConfig
  ): OptimizedRoute | null {
    let cost: RouteCost;

    // Determine route type and cost
    if (src.type === 'evm' && dst.type === 'evm') {
      // Both EVM
      if (src.chainId === ChainId.BSC || dst.chainId === ChainId.BSC ||
          src.chainId === ChainId.BSC_TESTNET || dst.chainId === ChainId.BSC_TESTNET) {
        cost = DIRECT_ROUTE_COSTS['bsc_to_evm'];
      } else {
        cost = DIRECT_ROUTE_COSTS['evm_l2_to_l2'];
      }
    } else if (src.type === 'solana' || dst.type === 'solana') {
      // Solana involved
      cost = src.type === 'solana' 
        ? DIRECT_ROUTE_COSTS['solana_to_evm']
        : DIRECT_ROUTE_COSTS['evm_to_solana'];
    } else {
      return null;
    }

    const hop: RouteHop = {
      fromChain: request.sourceChain,
      toChain: request.destChain,
      mechanism: cost.mechanism,
      estimatedTimeSec: cost.timeSec,
      feeBps: cost.feeBps,
    };

    const throughJeju = src.isJeju || dst.isJeju;

    return {
      id: `direct-${Date.now()}`,
      strategy: 'direct',
      hops: [hop],
      totalTimeSec: hop.estimatedTimeSec,
      totalFeeBps: hop.feeBps,
      throughJeju,
      jejuRevenue: throughJeju 
        ? (request.amount * BigInt(this.fees.protocolFeeBps)) / 10000n
        : 0n,
      userCost: (request.amount * BigInt(hop.feeBps)) / 10000n,
      confidence: 95,
    };
  }

  private buildHubRoute(
    request: RouteRequest,
    src: ChainConfig,
    dst: ChainConfig,
    jejuChainId: ChainId
  ): OptimizedRoute | null {
    // Build: Source -> Jeju -> Destination
    const hop1Cost = this.getRouteCost(src, CHAIN_CONFIGS[jejuChainId]);
    const hop2Cost = this.getRouteCost(CHAIN_CONFIGS[jejuChainId], dst);

    if (!hop1Cost || !hop2Cost) return null;

    const hop1: RouteHop = {
      fromChain: request.sourceChain,
      toChain: jejuChainId,
      mechanism: hop1Cost.mechanism,
      estimatedTimeSec: hop1Cost.timeSec,
      feeBps: hop1Cost.feeBps,
    };

    const hop2: RouteHop = {
      fromChain: jejuChainId,
      toChain: request.destChain,
      mechanism: hop2Cost.mechanism,
      estimatedTimeSec: hop2Cost.timeSec,
      feeBps: hop2Cost.feeBps,
    };

    const totalFeeBps = hop1.feeBps + hop2.feeBps + this.fees.protocolFeeBps;
    const protocolRevenue = (request.amount * BigInt(this.fees.protocolFeeBps + this.fees.xlpFeeBps)) / 10000n;

    return {
      id: `hub-${Date.now()}`,
      strategy: 'hub',
      hops: [hop1, hop2],
      totalTimeSec: hop1.estimatedTimeSec + hop2.estimatedTimeSec,
      totalFeeBps,
      throughJeju: true,
      jejuRevenue: protocolRevenue,
      userCost: (request.amount * BigInt(totalFeeBps)) / 10000n,
      confidence: 90,
    };
  }

  private buildOIFRoute(
    request: RouteRequest,
    _src: ChainConfig,
    _dst: ChainConfig
  ): OptimizedRoute | null {
    // OIF solver route - uses intent-based settlement
    const cost = DIRECT_ROUTE_COSTS['oif_solver'];

    const hop: RouteHop = {
      fromChain: request.sourceChain,
      toChain: request.destChain,
      mechanism: 'oif',
      estimatedTimeSec: cost.timeSec,
      feeBps: cost.feeBps + this.fees.solverMarginBps,
    };

    return {
      id: `oif-${Date.now()}`,
      strategy: 'direct',
      hops: [hop],
      totalTimeSec: hop.estimatedTimeSec,
      totalFeeBps: hop.feeBps,
      throughJeju: true, // OIF intents settle on Jeju
      jejuRevenue: (request.amount * BigInt(this.fees.solverMarginBps)) / 10000n,
      userCost: (request.amount * BigInt(hop.feeBps)) / 10000n,
      confidence: 85,
    };
  }

  private getRouteCost(src: ChainConfig, dst: ChainConfig): RouteCost | null {
    if (src.type === 'evm' && dst.type === 'evm') {
      if (src.chainId === ChainId.BSC || dst.chainId === ChainId.BSC ||
          src.chainId === ChainId.BSC_TESTNET || dst.chainId === ChainId.BSC_TESTNET) {
        return DIRECT_ROUTE_COSTS['bsc_to_evm'];
      }
      return DIRECT_ROUTE_COSTS['evm_l2_to_l2'];
    }

    if (src.type === 'solana') {
      return DIRECT_ROUTE_COSTS['solana_to_evm'];
    }

    if (dst.type === 'solana') {
      return DIRECT_ROUTE_COSTS['evm_to_solana'];
    }

    return null;
  }

  private rankRoutes(routes: OptimizedRoute[], request: RouteRequest): OptimizedRoute[] {
    return routes.sort((a, b) => {
      // If user prefers Jeju routing, prioritize hub routes
      if (request.preferThroughJeju) {
        if (a.throughJeju && !b.throughJeju) return -1;
        if (!a.throughJeju && b.throughJeju) return 1;
      }

      // Apply max constraints
      if (request.maxTimeSec) {
        if (a.totalTimeSec <= request.maxTimeSec && b.totalTimeSec > request.maxTimeSec) return -1;
        if (a.totalTimeSec > request.maxTimeSec && b.totalTimeSec <= request.maxTimeSec) return 1;
      }

      if (request.maxFeeBps) {
        if (a.totalFeeBps <= request.maxFeeBps && b.totalFeeBps > request.maxFeeBps) return -1;
        if (a.totalFeeBps > request.maxFeeBps && b.totalFeeBps <= request.maxFeeBps) return 1;
      }

      // Balance: revenue opportunity vs user cost
      // Score = (jejuRevenue / userCost) * confidence
      const aScore = a.userCost > 0n 
        ? Number((a.jejuRevenue * 100n) / a.userCost) * a.confidence / 100
        : a.confidence;
      const bScore = b.userCost > 0n 
        ? Number((b.jejuRevenue * 100n) / b.userCost) * b.confidence / 100
        : b.confidence;

      return bScore - aScore;
    });
  }
}

// ============ Factory ============

export function createJejuRoutingOptimizer(
  fees?: Partial<FeeConfig>,
  network: 'mainnet' | 'testnet' = 'testnet'
): JejuRoutingOptimizer {
  return new JejuRoutingOptimizer(
    { ...DEFAULT_FEES, ...fees },
    network
  );
}

// ============ Utility Functions ============

export function isJejuChain(chainId: ChainId | number): boolean {
  return chainId === ChainId.JEJU || chainId === ChainId.JEJU_TESTNET;
}

export function isSolanaChain(chainId: ChainId | number): boolean {
  return chainId === ChainId.SOLANA_MAINNET || chainId === ChainId.SOLANA_DEVNET;
}

export function isBscChain(chainId: ChainId | number): boolean {
  return chainId === ChainId.BSC || chainId === ChainId.BSC_TESTNET;
}

export function getChainConfig(chainId: ChainId | number): ChainConfig | undefined {
  return CHAIN_CONFIGS[chainId];
}

export function getStablecoinAddress(
  chainId: ChainId | number,
  token: 'usdc' | 'usdt'
): Address | string | undefined {
  return CHAIN_CONFIGS[chainId]?.stablecoins[token];
}

