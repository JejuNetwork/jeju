/**
 * Shared validation utilities for fail-fast error handling
 * Re-exports from @jejunetwork/types/validation for DRY
 */

export {
  expect,
  expectTrue,
  expectDefined as expectExists,
  expectNonEmpty,
  expectPositive,
  expectNonNegative,
  expectValid,
  validateOrThrow,
  validateOrNull,
  expectAddress,
  expectHex,
  expectChainId,
  expectBigInt,
  expectNonEmptyString,
  expectJson,
} from '@jejunetwork/types';
