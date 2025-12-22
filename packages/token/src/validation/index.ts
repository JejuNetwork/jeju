/**
 * Validation Module
 *
 * Provides Zod-based validation for all external inputs.
 * Use these validators at system boundaries (user input, API responses, config files).
 */

import { type ZodError, type ZodSchema } from 'zod';
import {
  addressSchema,
  bridgeRequestSchema,
  chainConfigSchema,
  deploymentConfigSchema,
  tokenDeploymentConfigSchema,
  tokenEconomicsSchema,
} from './schemas';

// Re-export all schemas
export * from './schemas';

// =============================================================================
// VALIDATION ERROR
// =============================================================================

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: ZodError['issues']
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

// =============================================================================
// VALIDATOR FUNCTIONS
// =============================================================================

/**
 * Parse and validate data with a Zod schema
 * Throws ValidationError if validation fails
 */
export function validate<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errorMessages = result.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ');
    throw new ValidationError(
      `Validation failed: ${errorMessages}`,
      result.error.issues
    );
  }
  return result.data;
}

/**
 * Safe parse - returns result object instead of throwing
 */
export function safeParse<T>(
  schema: ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: ZodError } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

// =============================================================================
// SPECIFIC VALIDATORS
// =============================================================================

/**
 * Validate an Ethereum address
 */
export function validateAddress(address: string): string {
  return validate(addressSchema, address);
}

/**
 * Parse and validate unknown data as a chain configuration
 * Use this when parsing external data (JSON, API responses)
 * For already-typed ChainConfig, use validateChainConfig from ./config/chains
 */
export function parseChainConfig(
  config: unknown
): ReturnType<typeof chainConfigSchema.parse> {
  return validate(chainConfigSchema, config);
}

/**
 * Validate token economics configuration
 */
export function validateTokenEconomics(
  config: unknown
): ReturnType<typeof tokenEconomicsSchema.parse> {
  return validate(tokenEconomicsSchema, config);
}

/**
 * Validate a full deployment configuration
 */
export function validateDeploymentConfig(
  config: unknown
): ReturnType<typeof deploymentConfigSchema.parse> {
  return validate(deploymentConfigSchema, config);
}

/**
 * Validate a bridge request
 */
export function validateBridgeRequest(
  request: unknown
): ReturnType<typeof bridgeRequestSchema.parse> {
  return validate(bridgeRequestSchema, request);
}

/**
 * Validate token deployment configuration
 */
export function validateTokenDeploymentConfig(
  config: unknown
): ReturnType<typeof tokenDeploymentConfigSchema.parse> {
  return validate(tokenDeploymentConfigSchema, config);
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Check if a string is a valid Ethereum address
 */
export function isValidAddress(address: string): boolean {
  return addressSchema.safeParse(address).success;
}

/**
 * Check if a value is a valid chain ID
 */
export function isValidChainId(chainId: unknown): boolean {
  return (
    (typeof chainId === 'number' && chainId > 0) ||
    chainId === 'solana-mainnet' ||
    chainId === 'solana-devnet'
  );
}

/**
 * Check if a string is a valid hex string
 */
export function isValidHex(hex: string): boolean {
  return /^0x[a-fA-F0-9]+$/.test(hex);
}
