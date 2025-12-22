/**
 * Shared validation utilities for fail-fast error handling
 * Re-exports from @jejunetwork/types/validation for DRY
 */

export {
  expect,
  expectAddress,
  expectBigInt,
  expectChainId,
  expectDefined as expectExists,
  expectHex,
  expectJson,
  expectNonEmpty,
  expectNonEmptyString,
  expectNonNegative,
  expectPositive,
  expectTrue,
  expectValid,
  validateOrNull,
  validateOrThrow,
} from '@jejunetwork/types'
