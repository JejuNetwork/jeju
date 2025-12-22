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

// Contract ABIs
export * from './contracts'
// Transaction decoders
export {
  type DecodedSwap,
  decodeSwapTransaction,
  getAllSwapSelectors,
  isSwapSelector,
} from './decoders'
// Math utilities
export {
  bigintAbsDiff,
  bigintMax,
  bigintMin,
  bigintNthRoot,
  bigintPow,
  bigintSqrt,
  calculateMinProfitableTradeSize,
  calculateNetProfit,
  calculateOptimalCrossPoolArbitrage,
  calculateOptimalMultiHopArbitrage,
  calculateOptimalSandwich,
  calculateOptimalTriangularArbitrage,
  estimateGasCostWei,
  getAmountIn,
  getAmountOut,
  getEffectivePrice,
  getPriceImpactBps,
  getSpotPrice,
} from './math'
// Uniswap V3 support
export {
  calculateV2V3Arbitrage,
  calculateV3SwapOutput,
  FEE_TIERS,
  type FeeTier,
  getAmount0Delta,
  getAmount1Delta,
  getNextSqrtPriceFromInput,
  sqrtPriceX96ToPrice,
  sqrtPriceX96ToTick,
  type TickData,
  tickToSqrtPriceX96,
  UNISWAP_V3_FACTORY_ABI,
  UNISWAP_V3_POOL_ABI,
  UNISWAP_V3_ROUTER_ABI,
  type V3PoolState,
} from './uniswap-v3'
