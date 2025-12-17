/**
 * Cross-Chain Router
 * 
 * Comprehensive routing, bridging, and arbitrage detection:
 * - CrossChainRouter: Route finding and execution
 * - CCIPAdapter: Chainlink permissionless token transfers
 * - WormholeAdapter: Wormhole bridge for Solana/EVM
 * - MultiBridgeRouter: Optimal route selection across all bridges
 * - ArbitrageDetector: Cross-chain MEV and arbitrage
 * - JejuRoutingOptimizer: Route optimization to maximize Jeju revenue
 */

export * from './cross-chain-router';
export * from './ccip-adapter';
export * from './wormhole-adapter';
export * from './multi-bridge-router';
export * from './arbitrage-detector';
export {
  JejuRoutingOptimizer,
  createJejuRoutingOptimizer,
  isJejuChain,
  isSolanaChain as isJejuSolanaChain,
  isBscChain,
  getChainConfig as getJejuChainConfig,
  getStablecoinAddress,
  ChainId,
  CHAIN_CONFIGS,
  JEJU_CHAIN_ID,
  JEJU_TESTNET_CHAIN_ID,
  type ChainConfig as JejuChainConfig,
  type OptimizedRoute,
  type RouteHop,
  type RouteStrategy,
  type FeeConfig,
} from './jeju-routing-optimizer';
