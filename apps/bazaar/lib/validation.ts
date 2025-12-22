/**
 * Shared validation utilities for fail-fast error handling
 * Re-exports from @jejunetwork/types/validation for app-wide use
 */

export {
  expect,
  expectTrue,
  expectNonEmpty,
  expectPositive,
  expectNonNegative,
  expectValid,
  expectDefined as expectExists,
  validateOrThrow,
  validateOrNull,
  expectAddress,
  expectHex,
  expectChainId,
  expectBigInt,
  expectNonEmptyString,
  expectJson,
} from '@jejunetwork/types/validation';
