/**
 * Shared utilities for DWS
 */

// Re-export zod for convenience
export { z } from 'zod';

// Re-export utilities
export * from './utils/common';
export * from './utils/rpc';
export * from './utils/api-marketplace';

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

// Validation utilities and schemas
export {
  expectValid,
  validateBody,
  validateQuery,
  validateParams,
  validateHeaders,
  validateRequest,
  addressSchema,
  hexSchema,
  strictHexSchema,
  cidSchema,
  positiveIntSchema,
  nonNegativeIntSchema,
  positiveBigIntSchema,
  nonEmptyStringSchema,
  urlSchema,
  emailSchema,
  isoDateSchema,
  timestampSchema,
  paginationSchema,
  jejuAddressHeaderSchema,
  jejuAuthHeadersSchema,
  errorResponseSchema,
  // JSON types
  type JSONPrimitive,
  type JSONArray,
  type JSONObject,
  type JSONValue,
  JSONValueSchema,
  JSONObjectSchema,
  JSONArraySchema,
} from './validation';

export * from './schemas';

