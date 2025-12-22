/**
 * RPC Gateway Module
 * @deprecated RPC functionality has moved to DWS. This re-exports for backwards compatibility.
 * Use @jeju/dws for new code.
 */

export {
  CHAINS,
  type ChainConfig,
  getChain,
  getMainnetChains,
  getTestnetChains,
  isChainSupported,
} from './config/chains.js'
export {
  getRateLimitStats,
  RATE_LIMITS,
  type RateTier,
  rateLimiter,
} from './middleware/rate-limiter.js'
export {
  getChainStats,
  getEndpointHealth,
  proxyBatchRequest,
  proxyRequest,
} from './proxy/rpc-proxy.js'
// Re-export from DWS for backwards compatibility
export { rpcApp, startRpcServer } from './server.js'
export {
  type ApiKeyRecord,
  createApiKey,
  getApiKeyStats,
  getApiKeysForAddress,
  revokeApiKeyById,
  validateApiKey,
} from './services/api-keys.js'
export {
  addCredits,
  deductCredits,
  generatePaymentRequirement,
  getCredits,
  getMethodPrice,
  getPaymentInfo,
  isX402Enabled,
  parseX402Header,
  processPayment,
  purchaseCredits,
  RPC_PRICING,
  verifyX402Payment,
  type X402Network,
  type X402PaymentHeader,
  type X402PaymentOption,
  type X402PaymentRequirement,
} from './services/x402-payments.js'

// Note: For new code, import directly from DWS
console.warn(
  '[Gateway/RPC] RPC functionality has moved to DWS. Consider importing from @jeju/dws instead.',
)
