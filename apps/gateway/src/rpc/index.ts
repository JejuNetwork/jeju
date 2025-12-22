/**
 * RPC Gateway Module
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
  rateLimiterPlugin,
} from './middleware/rate-limiter.js'
export {
  getChainStats,
  getEndpointHealth,
  proxyBatchRequest,
  proxyRequest,
} from './proxy/rpc-proxy.js'
export { type RpcApp, rpcApp, startRpcServer } from './server.js'
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
