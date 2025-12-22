/**
 * XLP (Cross-chain Liquidity Provider) Module
 *
 * Provides instant cross-chain liquidity for users
 * and earns fees for liquidity providers.
 */

export {
  createJupiterClient,
  createXLPJupiterFiller,
  JupiterClient,
  type JupiterConfig,
  type JupiterPrice,
  type JupiterQuote,
  type JupiterRoutePlan,
  type JupiterSwapResult,
  SOLANA_TOKENS,
  XLPJupiterFiller,
} from './jupiter-integration.js'
export {
  createXLPService,
  type FillRequest,
  getEvmTokenAddress,
  getSolanaTokenMint,
  isSolanaChain,
  type LiquidityPosition,
  type RouteStats,
  type XLPConfig,
  XLPService,
  type XLPStats,
} from './xlp-service.js'
