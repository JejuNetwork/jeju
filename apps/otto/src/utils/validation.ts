/**
 * Shared Validation Utilities
 * Common validation helpers and schemas
 */

import { z } from 'zod';
import {
  AddressSchema,
  HexSchema,
  expectAddress,
  expectHex,
  expectValid,
} from '@jejunetwork/types';
import { PlatformSchema } from '../schemas';

// ============================================================================
// Environment Validation
// ============================================================================

/**
 * Get a required environment variable, with optional default for development
 */
export function getRequiredEnv(key: string, defaultForDev?: string): string {
  const value = process.env[key];
  if (value) return value;
  if (process.env.NODE_ENV === 'development' && defaultForDev) {
    return defaultForDev;
  }
  throw new Error(`Missing required environment variable: ${key}`);
}

// Re-export shared schemas and helpers
export { AddressSchema, HexSchema, expectAddress, expectHex, expectValid };
export { PlatformSchema };

// Backwards-compatible aliases
export const AddressParamSchema = AddressSchema;
export const HexParamSchema = HexSchema;
export const PlatformParamSchema = PlatformSchema;

// ============================================================================
// App-Specific Validation Schemas
// ============================================================================

export const SessionIdSchema = z.string().min(1);

export const NonceSchema = z.string().min(1);

export const CrcTokenSchema = z.string().min(1);

// ============================================================================
// App-Specific Validation Helpers
// ============================================================================

/**
 * Validate address parameter
 * @deprecated Use expectAddress from @jejunetwork/types/validation instead
 */
export const validateAddress = expectAddress;

/**
 * Validate hex parameter
 * @deprecated Use expectHex from @jejunetwork/types/validation instead
 */
export const validateHex = expectHex;

/**
 * Validate platform parameter
 */
export function validatePlatform(platform: string): 'discord' | 'telegram' | 'whatsapp' | 'farcaster' | 'twitter' | 'web' {
  return expectValid(PlatformParamSchema, platform, 'platform parameter');
}

/**
 * Validate session ID
 */
export function validateSessionId(sessionId: string): string {
  return expectValid(SessionIdSchema, sessionId, 'session ID');
}

/**
 * Validate nonce
 */
export function validateNonce(nonce: string): string {
  return expectValid(NonceSchema, nonce, 'nonce');
}

/**
 * Validate CRC token for Twitter webhook
 */
export function validateCrcToken(crcToken: string): string {
  return expectValid(CrcTokenSchema, crcToken, 'CRC token');
}

/**
 * Validate query parameter
 */
export function validateQueryParam(param: string | undefined, name: string, schema: z.ZodSchema<string>): string {
  if (!param) {
    throw new Error(`Missing required query parameter: ${name}`);
  }
  return expectValid(schema, param, `query parameter ${name}`);
}

/**
 * Validate header parameter
 */
export function validateHeader(header: string | undefined, name: string, schema: z.ZodSchema<string>): string {
  if (!header) {
    throw new Error(`Missing required header: ${name}`);
  }
  return expectValid(schema, header, `header ${name}`);
}
