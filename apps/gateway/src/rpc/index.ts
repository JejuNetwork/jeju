/**
 * RPC Gateway Module
 * @deprecated RPC functionality has moved to DWS. This re-exports for backwards compatibility.
 * Use @jeju/dws for new code.
 */

// Re-export from DWS for backwards compatibility
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

// Note: For new code, import directly from DWS
console.warn('[Gateway/RPC] RPC functionality has moved to DWS. Consider importing from @jeju/dws instead.');
