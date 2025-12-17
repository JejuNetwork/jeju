/**
 * XLP (Cross-chain Liquidity Provider) Module
 *
 * Provides instant cross-chain liquidity for users
 * and earns fees for liquidity providers.
 */

export {
  XLPService,
  createXLPService,
  type XLPConfig,
  type LiquidityPosition,
  type FillRequest,
  type RouteStats,
  type XLPStats,
  isSolanaChain,
  getSolanaTokenMint,
  getEvmTokenAddress,
} from './xlp-service.js';

export {
  JupiterClient,
  createJupiterClient,
  XLPJupiterFiller,
  createXLPJupiterFiller,
  type JupiterConfig,
  type JupiterQuote,
  type JupiterRoutePlan,
  type JupiterSwapResult,
  type JupiterPrice,
  SOLANA_TOKENS,
} from './jupiter-integration.js';

