/**
 * Multi-Bridge Router
 * Integrates ZKSolBridge, Wormhole, CCIP, and other bridges for optimal routing
 * 
 * Provides automatic path selection based on:
 * - Cost (fees + gas)
 * - Speed (finality time)
 * - Liquidity (available depth)
 * - Reliability (historical success rate)
 */

import { EventEmitter } from 'events';
import { type Address, type Hex, formatUnits, parseUnits } from 'viem';

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
import { CrossChainRouter, type RouterConfig } from './cross-chain-router.js';
import { WormholeAdapter, type WormholeConfig } from './wormhole-adapter.js';
import { CCIPAdapter, type CCIPTransferRequest } from './ccip-adapter.js';
import { isSolanaChain } from '../xlp/xlp-service.js';

export interface CCIPConfig {
  enabled: boolean;
  rpcUrls?: Record<number, string>;
}

export type BridgeProvider = 'zksolbridge' | 'wormhole' | 'ccip' | 'layerzero' | 'hyperlane';

export interface BridgeRoute {
  provider: BridgeProvider;
  sourceChainId: number;
  destChainId: number;
  sourceToken: Address | string;
  destToken: Address | string;
  estimatedOutput: bigint;
  bridgeFee: bigint;
  gasCost: bigint;
  estimatedTimeSeconds: number;
  reliability: number; // 0-100
  liquidityDepth: bigint;
}

export interface MultiBridgeConfig {
  enabledProviders: BridgeProvider[];
  zksolbridgeConfig?: RouterConfig;
  wormholeConfig?: WormholeConfig;
  ccipConfig?: CCIPConfig;
  preferredProvider?: BridgeProvider;
  maxSlippageBps?: number;
  minReliability?: number;
}

export interface TransferParams {
  sourceChainId: number;
  destChainId: number;
  token: Address | string;
  amount: bigint;
  recipient: Address | string;
  preferSpeed?: boolean;
  preferCost?: boolean;
  forceProvider?: BridgeProvider;
}

export interface TransferResult {
  success: boolean;
  provider: BridgeProvider;
  sourceTxHash?: Hex | string;
  destTxHash?: Hex | string;
  actualOutput?: bigint;
  totalFees?: bigint;
  error?: string;
}

// Bridge characteristics for scoring
const BRIDGE_CHARACTERISTICS: Record<BridgeProvider, {
  avgTimeSeconds: number;
  reliabilityScore: number;
  feeMultiplier: number;
}> = {
  zksolbridge: {
    avgTimeSeconds: 900, // 15 mins for ZK proof
    reliabilityScore: 95, // High - trustless
    feeMultiplier: 1.0,
  },
  wormhole: {
    avgTimeSeconds: 300, // 5 mins
    reliabilityScore: 90, // Good - guardian network
    feeMultiplier: 0.8,
  },
  ccip: {
    avgTimeSeconds: 600, // 10 mins
    reliabilityScore: 95, // High - Chainlink
    feeMultiplier: 1.2,
  },
  layerzero: {
    avgTimeSeconds: 120, // 2 mins
    reliabilityScore: 85, // Good - oracle network
    feeMultiplier: 0.7,
  },
  hyperlane: {
    avgTimeSeconds: 180, // 3 mins
    reliabilityScore: 88, // Good - validator set
    feeMultiplier: 0.75,
  },
};

// Chain support matrix
const BRIDGE_CHAIN_SUPPORT: Record<BridgeProvider, { evm: boolean; solana: boolean; hyperliquid: boolean }> = {
  zksolbridge: { evm: true, solana: true, hyperliquid: false },
  wormhole: { evm: true, solana: true, hyperliquid: false },
  ccip: { evm: true, solana: false, hyperliquid: true },
  layerzero: { evm: true, solana: true, hyperliquid: false },
  hyperlane: { evm: true, solana: true, hyperliquid: true },
};

export class MultiBridgeRouter extends EventEmitter {
  private config: MultiBridgeConfig;
  private zksolbridge: CrossChainRouter | null = null;
  private wormhole: WormholeAdapter | null = null;
  private ccip: CCIPAdapter | null = null;
  
  // Historical success tracking
  private successRates: Map<BridgeProvider, { success: number; total: number }> = new Map();
  private avgExecutionTimes: Map<BridgeProvider, number[]> = new Map();

  constructor(config: MultiBridgeConfig) {
    super();
    this.config = config;

    // Initialize enabled providers
    if (config.enabledProviders.includes('zksolbridge') && config.zksolbridgeConfig) {
      this.zksolbridge = new CrossChainRouter(config.zksolbridgeConfig);
    }

    if (config.enabledProviders.includes('wormhole') && config.wormholeConfig) {
      this.wormhole = new WormholeAdapter(config.wormholeConfig);
    }

    if (config.enabledProviders.includes('ccip') && config.ccipConfig?.enabled) {
      this.ccip = new CCIPAdapter();
    }

    // Initialize tracking
    for (const provider of config.enabledProviders) {
      this.successRates.set(provider, { success: 0, total: 0 });
      this.avgExecutionTimes.set(provider, []);
    }
  }

  /**
   * Find all available routes for a cross-chain transfer
   */
  async findRoutes(params: TransferParams): Promise<BridgeRoute[]> {
    const routes: BridgeRoute[] = [];

    const isSolanaSrc = isSolanaChain(params.sourceChainId);
    const isSolanaDst = isSolanaChain(params.destChainId);

    for (const provider of this.config.enabledProviders) {
      const support = BRIDGE_CHAIN_SUPPORT[provider];

      // Check if provider supports the chains
      if (isSolanaSrc || isSolanaDst) {
        if (!support.solana) continue;
      }

      // Get route details from provider
      const route = await this.getRouteFromProvider(provider, params);
      if (route) {
        routes.push(route);
      }
    }

    // Sort by optimal criteria
    return this.rankRoutes(routes, params);
  }

  /**
   * Get route details from a specific provider
   */
  private async getRouteFromProvider(
    provider: BridgeProvider,
    params: TransferParams
  ): Promise<BridgeRoute | null> {
    const characteristics = BRIDGE_CHARACTERISTICS[provider];

    switch (provider) {
      case 'zksolbridge':
        if (!this.zksolbridge) return null;
        return this.getZKSolBridgeRoute(params, characteristics);

      case 'wormhole':
        if (!this.wormhole) return null;
        return this.getWormholeRoute(params, characteristics);

      case 'ccip':
        if (!this.ccip) return null;
        return this.getCCIPRoute(params, characteristics);

      default:
        return null;
    }
  }

  private async getZKSolBridgeRoute(
    params: TransferParams,
    characteristics: { avgTimeSeconds: number; reliabilityScore: number; feeMultiplier: number }
  ): Promise<BridgeRoute | null> {
    // Base fee is 0.1% for ZKSolBridge
    const bridgeFee = params.amount * 10n / 10000n;
    const gasCost = parseUnits('0.001', 18); // Estimated gas

    return {
      provider: 'zksolbridge',
      sourceChainId: params.sourceChainId,
      destChainId: params.destChainId,
      sourceToken: params.token,
      destToken: params.token, // Wrapped token on dest
      estimatedOutput: params.amount - bridgeFee,
      bridgeFee,
      gasCost,
      estimatedTimeSeconds: characteristics.avgTimeSeconds,
      reliability: this.getAdjustedReliability('zksolbridge', characteristics.reliabilityScore),
      liquidityDepth: parseUnits('1000000', 18), // 1M USD equivalent
    };
  }

  private async getWormholeRoute(
    params: TransferParams,
    characteristics: { avgTimeSeconds: number; reliabilityScore: number; feeMultiplier: number }
  ): Promise<BridgeRoute | null> {
    if (!this.wormhole) return null;

    const bridgeFee = await this.wormhole.estimateBridgeFee(params.sourceChainId);
    const gasCost = parseUnits('0.002', 18);

    // Check if wrapped asset exists
    const destToken = await this.wormhole.getWrappedAsset(
      params.destChainId,
      params.sourceChainId,
      params.token as Address
    );

    return {
      provider: 'wormhole',
      sourceChainId: params.sourceChainId,
      destChainId: params.destChainId,
      sourceToken: params.token,
      destToken: destToken || params.token,
      estimatedOutput: params.amount, // Wormhole doesn't take %
      bridgeFee,
      gasCost,
      estimatedTimeSeconds: characteristics.avgTimeSeconds,
      reliability: this.getAdjustedReliability('wormhole', characteristics.reliabilityScore),
      liquidityDepth: parseUnits('5000000', 18), // 5M USD
    };
  }

  private async getCCIPRoute(
    params: TransferParams,
    characteristics: { avgTimeSeconds: number; reliabilityScore: number; feeMultiplier: number }
  ): Promise<BridgeRoute | null> {
    if (!this.ccip) return null;

    // CCIP doesn't support Solana
    if (isSolanaChain(params.sourceChainId) || isSolanaChain(params.destChainId)) {
      return null;
    }

    const request: CCIPTransferRequest = {
      sourceChainId: params.sourceChainId,
      destChainId: params.destChainId,
      recipient: params.recipient as Address,
      token: params.token as Address,
      amount: params.amount,
    };

    const feeResult = await this.ccip.estimateFee(request);

    return {
      provider: 'ccip',
      sourceChainId: params.sourceChainId,
      destChainId: params.destChainId,
      sourceToken: params.token,
      destToken: params.token,
      estimatedOutput: params.amount,
      bridgeFee: feeResult.nativeFee,
      gasCost: parseUnits('0.003', 18),
      estimatedTimeSeconds: characteristics.avgTimeSeconds,
      reliability: this.getAdjustedReliability('ccip', characteristics.reliabilityScore),
      liquidityDepth: parseUnits('10000000', 18), // 10M USD
    };
  }

  /**
   * Adjust reliability based on historical performance
   */
  private getAdjustedReliability(provider: BridgeProvider, baseReliability: number): number {
    const stats = this.successRates.get(provider);
    if (!stats || stats.total < 10) {
      return baseReliability;
    }

    const historicalRate = (stats.success / stats.total) * 100;
    // Weighted average: 70% historical, 30% base
    return Math.round(historicalRate * 0.7 + baseReliability * 0.3);
  }

  /**
   * Rank routes by optimal criteria
   */
  private rankRoutes(routes: BridgeRoute[], params: TransferParams): BridgeRoute[] {
    return routes.sort((a, b) => {
      // If user prefers speed
      if (params.preferSpeed) {
        if (a.estimatedTimeSeconds !== b.estimatedTimeSeconds) {
          return a.estimatedTimeSeconds - b.estimatedTimeSeconds;
        }
      }

      // If user prefers cost
      if (params.preferCost) {
        const aCost = a.bridgeFee + a.gasCost;
        const bCost = b.bridgeFee + b.gasCost;
        if (aCost !== bCost) {
          return Number(aCost - bCost);
        }
      }

      // Default: score based on multiple factors
      const aScore = this.calculateRouteScore(a);
      const bScore = this.calculateRouteScore(b);
      return bScore - aScore; // Higher score is better
    });
  }

  /**
   * Calculate composite route score
   */
  private calculateRouteScore(route: BridgeRoute): number {
    // Weights for different factors
    const weights = {
      reliability: 0.35,
      cost: 0.25,
      speed: 0.20,
      liquidity: 0.20,
    };

    // Normalize metrics to 0-100 scale
    const reliabilityScore = route.reliability;
    
    // Cost score: lower is better, normalize assuming max 0.1 ETH total fees
    const totalCost = Number(formatUnits(route.bridgeFee + route.gasCost, 18));
    const costScore = Math.max(0, 100 - (totalCost / 0.1) * 100);

    // Speed score: faster is better, normalize assuming max 1 hour
    const speedScore = Math.max(0, 100 - (route.estimatedTimeSeconds / 3600) * 100);

    // Liquidity score: higher is better, normalize assuming 10M max
    const liquidityUsd = Number(formatUnits(route.liquidityDepth, 18));
    const liquidityScore = Math.min(100, (liquidityUsd / 10_000_000) * 100);

    return (
      reliabilityScore * weights.reliability +
      costScore * weights.cost +
      speedScore * weights.speed +
      liquidityScore * weights.liquidity
    );
  }

  /**
   * Execute transfer using optimal route
   */
  async transfer(params: TransferParams): Promise<TransferResult> {
    // Get routes
    const routes = await this.findRoutes(params);

    if (routes.length === 0) {
      return {
        success: false,
        provider: 'zksolbridge',
        error: 'No available routes for this transfer',
      };
    }

    // Select route
    let selectedRoute: BridgeRoute;
    if (params.forceProvider) {
      const forced = routes.find(r => r.provider === params.forceProvider);
      if (!forced) {
        return {
          success: false,
          provider: params.forceProvider,
          error: `Requested provider ${params.forceProvider} not available for this route`,
        };
      }
      selectedRoute = forced;
    } else if (this.config.preferredProvider) {
      const preferred = routes.find(r => r.provider === this.config.preferredProvider);
      selectedRoute = preferred || routes[0];
    } else {
      selectedRoute = routes[0]; // Best ranked
    }

    // Execute based on provider
    const startTime = Date.now();
    let result: TransferResult;

    try {
      switch (selectedRoute.provider) {
        case 'zksolbridge':
          result = await this.executeZKSolBridgeTransfer(params);
          break;
        case 'wormhole':
          result = await this.executeWormholeTransfer(params);
          break;
        case 'ccip':
          result = await this.executeCCIPTransfer(params);
          break;
        default:
          result = {
            success: false,
            provider: selectedRoute.provider,
            error: `Provider ${selectedRoute.provider} not implemented`,
          };
      }
    } catch (error) {
      result = {
        success: false,
        provider: selectedRoute.provider,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    // Update tracking
    const stats = this.successRates.get(selectedRoute.provider);
    if (stats) {
      stats.total++;
      if (result.success) stats.success++;
    }

    const executionTime = (Date.now() - startTime) / 1000;
    const times = this.avgExecutionTimes.get(selectedRoute.provider);
    if (times) {
      times.push(executionTime);
      if (times.length > 100) times.shift(); // Keep last 100
    }

    this.emit('transferComplete', {
      params,
      result,
      route: selectedRoute,
      executionTime,
    });

    return result;
  }

  private async executeZKSolBridgeTransfer(params: TransferParams): Promise<TransferResult> {
    if (!this.zksolbridge) {
      return { success: false, provider: 'zksolbridge', error: 'ZKSolBridge not configured' };
    }

    // Build route request for ZKSolBridge
    const routeRequest = {
      sourceChain: this.chainIdToRouterChain(params.sourceChainId),
      destChain: this.chainIdToRouterChain(params.destChainId),
      sourceToken: params.token,
      destToken: params.token,
      amount: params.amount,
      sender: params.recipient, // For now, sender == recipient for self-transfers
      recipient: params.recipient,
      slippageBps: 100, // 1% default slippage
      preferTrustless: true,
    };

    // Find available routes
    const routes = await this.zksolbridge.findRoutes(routeRequest);
    if (routes.length === 0) {
      return { success: false, provider: 'zksolbridge', error: 'No routes available' };
    }

    // Execute the best route (first one, already sorted)
    const selectedRoute = routes[0];
    const result = await this.zksolbridge.executeRoute(selectedRoute, routeRequest);

    return {
      success: result.success,
      provider: 'zksolbridge',
      sourceTxHash: result.transactionHash as Hex | undefined,
      error: result.error,
    };
  }

  private chainIdToRouterChain(chainId: number): string {
    // Map numeric chain IDs to router chain format
    if (isSolanaChain(chainId)) {
      return chainId === 101 ? 'solana:mainnet' : 'solana:devnet';
    }
    return `eip155:${chainId}`;
  }

  private async executeWormholeTransfer(params: TransferParams): Promise<TransferResult> {
    if (!this.wormhole) {
      return { success: false, provider: 'wormhole', error: 'Wormhole not configured' };
    }

    const isSolanaSrc = isSolanaChain(params.sourceChainId);
    const isSolanaDst = isSolanaChain(params.destChainId);

    if (isSolanaSrc && !isSolanaDst) {
      const result = await this.wormhole.transferSolanaToEVM({
        tokenMint: params.token as string,
        amount: params.amount,
        destChainId: params.destChainId,
        recipient: params.recipient as Address,
      });
      return {
        success: result.success,
        provider: 'wormhole',
        sourceTxHash: result.txHash,
        error: result.error,
      };
    } else if (!isSolanaSrc && isSolanaDst) {
      const result = await this.wormhole.transferEVMToSolana({
        sourceChainId: params.sourceChainId,
        token: params.token as Address,
        amount: params.amount,
        recipient: params.recipient as string,
      });
      return {
        success: result.success,
        provider: 'wormhole',
        sourceTxHash: result.txHash,
        error: result.error,
      };
    } else {
      const result = await this.wormhole.transferEVMToEVM({
        sourceChainId: params.sourceChainId,
        destChainId: params.destChainId,
        token: params.token as Address,
        amount: params.amount,
        recipient: params.recipient as string,
      });
      return {
        success: result.success,
        provider: 'wormhole',
        sourceTxHash: result.txHash,
        error: result.error,
      };
    }
  }

  private async executeCCIPTransfer(params: TransferParams): Promise<TransferResult> {
    if (!this.ccip) {
      return { success: false, provider: 'ccip', error: 'CCIP not configured' };
    }

    const request: CCIPTransferRequest = {
      sourceChainId: params.sourceChainId,
      destChainId: params.destChainId,
      recipient: params.recipient as Address,
      token: params.token as Address,
      amount: params.amount,
    };

    const result = await this.ccip.transfer(request);

    return {
      success: true,
      provider: 'ccip',
      sourceTxHash: result.messageId,
    };
  }

  /**
   * Get provider statistics
   */
  getProviderStats(): Record<BridgeProvider, {
    successRate: number;
    avgExecutionTimeSeconds: number;
    totalTransfers: number;
  }> {
    const stats: Record<string, { successRate: number; avgExecutionTimeSeconds: number; totalTransfers: number }> = {};

    for (const provider of this.config.enabledProviders) {
      const successStats = this.successRates.get(provider);
      const times = this.avgExecutionTimes.get(provider);

      const successRate = successStats && successStats.total > 0
        ? (successStats.success / successStats.total) * 100
        : 100;

      const avgTime = times && times.length > 0
        ? times.reduce((a, b) => a + b, 0) / times.length
        : BRIDGE_CHARACTERISTICS[provider]?.avgTimeSeconds || 0;

      stats[provider] = {
        successRate,
        avgExecutionTimeSeconds: avgTime,
        totalTransfers: successStats?.total || 0,
      };
    }

    return stats as Record<BridgeProvider, { successRate: number; avgExecutionTimeSeconds: number; totalTransfers: number }>;
  }

  /**
   * Get recommended provider for a route
   */
  async getRecommendedProvider(
    sourceChainId: number,
    destChainId: number,
    token?: Address
  ): Promise<BridgeProvider | null> {
    const routes = await this.findRoutes({
      sourceChainId,
      destChainId,
      token: token || ZERO_ADDRESS,
      amount: parseUnits('1000', 18),
      recipient: ZERO_ADDRESS,
    });

    return routes[0]?.provider || null;
  }
}

export function createMultiBridgeRouter(config: MultiBridgeConfig): MultiBridgeRouter {
  return new MultiBridgeRouter(config);
}

