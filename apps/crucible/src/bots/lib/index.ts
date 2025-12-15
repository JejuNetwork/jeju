/**
 * MEV Bot Libraries - Mathematical and Utility Functions
 * 
 * This module provides:
 * - AMM math for swap calculations
 * - Optimal arbitrage sizing with closed-form solutions
 * - Uniswap V3 concentrated liquidity math
 * - Transaction decoders for V2, V3, and Universal Router
 * - Contract ABIs
 */

// Math utilities
export {
  bigintSqrt,
  bigintNthRoot,
  bigintPow,
  bigintAbsDiff,
  bigintMin,
  bigintMax,
  getAmountOut,
  getAmountIn,
  getSpotPrice,
  getEffectivePrice,
  getPriceImpactBps,
  calculateOptimalCrossPoolArbitrage,
  calculateOptimalTriangularArbitrage,
  calculateOptimalMultiHopArbitrage,
  calculateOptimalSandwich,
  estimateGasCostWei,
  calculateMinProfitableTradeSize,
  calculateNetProfit,
} from './math';

// Uniswap V3 support
export {
  FEE_TIERS,
  type FeeTier,
  type V3PoolState,
  type TickData,
  tickToSqrtPriceX96,
  sqrtPriceX96ToTick,
  sqrtPriceX96ToPrice,
  getAmount0Delta,
  getAmount1Delta,
  getNextSqrtPriceFromInput,
  calculateV3SwapOutput,
  calculateV2V3Arbitrage,
  UNISWAP_V3_POOL_ABI,
  UNISWAP_V3_FACTORY_ABI,
  UNISWAP_V3_ROUTER_ABI,
} from './uniswap-v3';

// Transaction decoders
export {
  decodeSwapTransaction,
  isSwapSelector,
  getAllSwapSelectors,
  type DecodedSwap,
} from './decoders';

// Contract ABIs
export * from './contracts';
