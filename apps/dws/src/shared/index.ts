/**
 * Shared utilities for DWS
 */

// x402 Payment handling
export {
  x402Middleware,
  calculatePrice,
  create402Response,
  createPaymentRequirement,
  verifyPayment,
  parsePaymentProof,
  GIT_PRICING_RULES,
  PKG_PRICING_RULES,
  TIERS,
  getTierPrice,
  tierAllows,
  type PaymentConfig,
  type PaymentRequirement,
  type PaymentProof,
  type PricingRule,
  type TierDefinition,
} from './x402';

// Reputation integration
export {
  ReputationManager,
  type ReputationManagerConfig,
  type ReputationScore,
  type MetricsInput,
} from './reputation';

