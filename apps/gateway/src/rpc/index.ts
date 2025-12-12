/**
 * RPC Gateway Module
 * Multi-chain RPC proxy with stake-based rate limiting
 */

export { rpcApp, startRpcServer } from './server.js';
export { CHAINS, getChain, isChainSupported, getMainnetChains, getTestnetChains, type ChainConfig } from './config/chains.js';
export { rateLimiter, RATE_LIMITS, getRateLimitStats, type RateTier } from './middleware/rate-limiter.js';
export { proxyRequest, proxyBatchRequest, getEndpointHealth, getChainStats } from './proxy/rpc-proxy.js';
export { createApiKey, validateApiKey, getApiKeysForAddress, revokeApiKeyById, getApiKeyStats, type ApiKeyRecord } from './services/api-keys.js';
export {
  isX402Enabled,
  generatePaymentRequirement,
  getPaymentInfo,
  getCredits,
  addCredits,
  purchaseCredits,
  processPayment,
  getMethodPrice,
  verifyX402Payment,
  parseX402Header,
  deductCredits,
  RPC_PRICING,
  type X402PaymentRequirement,
  type X402PaymentOption,
  type X402PaymentHeader,
  type X402Network,
} from './services/x402-payments.js';
