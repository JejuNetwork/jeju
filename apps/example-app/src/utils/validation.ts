/**
 * Validation Utilities with Expect/Throw Patterns
 * 
 * Fail-fast validation helpers that throw on invalid data.
 * No defensive programming - we want to expose bugs immediately.
 * 
 * Re-exports shared validation helpers and provides app-specific extensions.
 */

import type { ZodType, ZodTypeDef, ZodError } from 'zod';

// Re-export shared validation helpers for convenience
export {
  expect,
  expectTrue,
  expectNonEmpty,
  expectPositive,
  expectNonNegative,
  expectAddress,
  expectHex,
  expectChainId,
  expectBigInt,
  expectNonEmptyString,
  expectJson,
  validateOrNull,
} from '@jejunetwork/types';

/**
 * Custom validation error class with Zod error details.
 * App-specific error class that preserves the original ZodError for detailed diagnostics.
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly zodError?: ZodError
  ) {
    super(message);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Checks if an error is a ValidationError.
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

/**
 * Formats a Zod error into a readable message.
 */
function formatZodError(error: ZodError, context?: string): string {
  const issues = error.issues.map(issue => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
    return `${path}: ${issue.message}`;
  });
  
  const message = issues.join('; ');
  return context ? `${context}: ${message}` : message;
}

/**
 * Validates data against a schema and throws ValidationError if invalid.
 * Use this for all input validation - no fallbacks, no silent failures.
 * 
 * Note: Output type O can differ from input type I when schema has transforms.
 * Throws ValidationError (with zodError details) instead of standard Error.
 */
export function expectValid<O, D extends ZodTypeDef = ZodTypeDef, I = O>(
  schema: ZodType<O, D, I>,
  data: unknown,
  context?: string
): O {
  const result = schema.safeParse(data);
  
  if (!result.success) {
    const errorMessage = formatZodError(result.error, context);
    throw new ValidationError(errorMessage, result.error);
  }
  
  return result.data;
}

/**
 * Validates data and returns the result or throws.
 * Alias for expectValid.
 */
export function validateOrThrow<O, D extends ZodTypeDef = ZodTypeDef, I = O>(
  schema: ZodType<O, D, I>,
  data: unknown,
  context?: string
): O {
  return expectValid(schema, data, context);
}

/**
 * Expects a value to be defined (not null or undefined).
 * Throws ValidationError immediately if value is missing.
 */
export function expectDefined<T>(value: T | null | undefined, message?: string): T {
  if (value === null || value === undefined) {
    throw new ValidationError(message || 'Expected value to be defined');
  }
  return value;
}

/**
 * Expects a value to be truthy.
 * Throws ValidationError immediately if value is falsy.
 */
export function expectTruthy<T>(value: T | null | undefined | false | 0 | '' | 0n, message?: string): T {
  if (!value) {
    throw new ValidationError(message || 'Expected value to be truthy');
  }
  return value;
}

/**
 * Expects a number to be within a range.
 */
export function expectInRange(value: number, min: number, max: number, context?: string): number {
  if (value < min || value > max) {
    throw new ValidationError(
      context 
        ? `${context}: Expected value between ${min} and ${max}, got ${value}`
        : `Expected value between ${min} and ${max}, got ${value}`
    );
  }
  return value;
}

/**
 * Expects a string to match a pattern.
 */
export function expectMatch(value: string, pattern: RegExp, message?: string): string {
  if (!pattern.test(value)) {
    throw new ValidationError(message || `Expected string to match pattern ${pattern}, got: ${value}`);
  }
  return value;
}

/**
 * Expects an array to have at least N elements.
 */
export function expectMinLength<T>(array: T[], minLength: number, context?: string): T[] {
  if (array.length < minLength) {
    throw new ValidationError(
      context
        ? `${context}: Expected array with at least ${minLength} elements, got ${array.length}`
        : `Expected array with at least ${minLength} elements, got ${array.length}`
    );
  }
  return array;
}

/**
 * Expects an array to have at most N elements.
 */
export function expectMaxLength<T>(array: T[], maxLength: number, context?: string): T[] {
  if (array.length > maxLength) {
    throw new ValidationError(
      context
        ? `${context}: Expected array with at most ${maxLength} elements, got ${array.length}`
        : `Expected array with at most ${maxLength} elements, got ${array.length}`
    );
  }
  return array;
}
