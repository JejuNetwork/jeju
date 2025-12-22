/**
 * Shared utilities for DWS
 */

// Re-export zod for convenience
export { z } from 'zod'
// Reputation integration
export {
  type MetricsInput,
  ReputationManager,
  type ReputationManagerConfig,
  type ReputationScore,
} from './reputation'
export * from './schemas'
export * from './utils/api-marketplace'
// Re-export utilities
export * from './utils/common'
export * from './utils/crypto'
export * from './utils/rpc'

// Validation utilities and schemas
export {
  addressSchema,
  cidSchema,
  emailSchema,
  errorResponseSchema,
  expectValid,
  hexSchema,
  isoDateSchema,
  type JSONArray,
  JSONArraySchema,
  type JSONObject,
  JSONObjectSchema,
  // JSON types
  type JSONPrimitive,
  type JSONValue,
  JSONValueSchema,
  jejuAddressHeaderSchema,
  jejuAuthHeadersSchema,
  nonEmptyStringSchema,
  nonNegativeIntSchema,
  paginationSchema,
  positiveBigIntSchema,
  positiveIntSchema,
  strictHexSchema,
  timestampSchema,
  urlSchema,
  validateBody,
  validateHeaders,
  validateParams,
  validateQuery,
  validateRequest,
} from './validation'
// x402 Payment handling
export {
  calculatePrice,
  create402Response,
  createPaymentRequirement,
  GIT_PRICING_RULES,
  getTierPrice,
  type PaymentConfig,
  type PaymentProof,
  type PaymentRequirement,
  PKG_PRICING_RULES,
  type PricingRule,
  parsePaymentProof,
  TIERS,
  type TierDefinition,
  tierAllows,
  verifyPayment,
  x402Middleware,
} from './x402'
