/**
 * Jeju x402 Facilitator
 * Entry point for the x402 HTTP facilitator service
 *
 * @module @jeju/facilitator
 */

import { startServer } from './server';

// Export server
export { createServer, startServer } from './server';

// Export config
export { config, getConfig, validateConfig, resetConfig } from './config';

// Export types
export type {
  PaymentPayload,
  PaymentRequirements,
  VerifyRequest,
  VerifyResponse,
  SettleRequest,
  SettleResponse,
  SupportedResponse,
  StatsResponse,
  HealthResponse,
  DecodedPayment,
  VerificationResult,
  SettlementResult,
  ChainConfig,
  TokenConfig,
} from './lib/types';

// Export lib utilities
export { CHAIN_CONFIGS, getChainConfig, getTokenConfig } from './lib/chains';

export {
  X402_FACILITATOR_ABI,
  ERC20_ABI,
  EIP712_DOMAIN,
  EIP712_TYPES,
} from './lib/contracts';

// Export services
export {
  decodePaymentHeader,
  verifyPayment,
  verifySignatureOnly,
  encodePaymentHeader,
} from './services/verifier';

export {
  createClients,
  getFacilitatorStats,
  settlePayment,
  settleGaslessPayment,
  calculateProtocolFee,
  formatAmount,
} from './services/settler';

export {
  generateNonce,
  isNonceUsed,
  clearNonceCache,
} from './services/nonce-manager';

// Start server when run directly
startServer().catch((err) => {
  console.error('[Facilitator] Failed to start server:', err);
  process.exit(1);
});
