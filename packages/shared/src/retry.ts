/**
 * Retry Utility for Async Operations
 *
 * @description Provides retry logic for async operations with exponential backoff.
 * Automatically retries on network errors, 5xx server errors, and rate limit (429) responses.
 */

/**
 * Retry configuration options
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number
  /** Initial delay in milliseconds before first retry (default: 100) */
  initialDelayMs?: number
  /** Maximum delay in milliseconds between retries (default: 2000) */
  maxDelayMs?: number
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number
  /** Optional callback for logging retry attempts */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry'>> = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 2000,
  backoffMultiplier: 2,
}

/** Error with HTTP status code */
interface ErrorWithStatus {
  status: number
}

/** Type guard to check if error has a status property */
function hasStatus(error: unknown): error is ErrorWithStatus {
  return (
    error !== null &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as ErrorWithStatus).status === 'number'
  )
}

/**
 * Check if error is retryable (network errors, 5xx, rate limits)
 *
 * @description Determines if an error should trigger a retry based on error type
 * and HTTP status code. Retries on network errors, 5xx server errors, and 429
 * rate limit responses.
 *
 * @param error - The error to check
 * @returns True if the error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true // Network errors
  }

  if (hasStatus(error)) {
    // Retry on 5xx errors and 429 (rate limit)
    return error.status >= 500 || error.status === 429
  }

  return false
}

/**
 * Sleep for specified milliseconds
 *
 * @description Creates a promise that resolves after the specified delay.
 * Used for exponential backoff delays between retry attempts.
 *
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Retry an async operation if it fails with a retryable error
 *
 * @description Executes an async operation and automatically retries on retryable
 * errors (network errors, 5xx, 429) with exponential backoff. Throws immediately
 * on non-retryable errors.
 *
 * @template T - Return type of the operation
 * @param operation - Async operation to retry
 * @param options - Retry configuration options
 * @returns Result of the operation
 *
 * @example
 * ```typescript
 * const data = await retryIfRetryable(
 *   () => fetch('/api/data').then(r => r.json()),
 *   { maxAttempts: 5, initialDelayMs: 200 }
 * );
 * ```
 */
export async function retryIfRetryable<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  // Edge case: if maxAttempts is 0, just run once without retries
  if (opts.maxAttempts <= 0) {
    return operation()
  }

  let lastError: Error | undefined

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error as Error

      // Check if we should retry
      if (!isRetryableError(error)) {
        throw error // Not retryable, throw immediately
      }

      // Don't retry if we've exhausted attempts
      if (attempt === opts.maxAttempts - 1) {
        throw error
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        opts.initialDelayMs * opts.backoffMultiplier ** attempt,
        opts.maxDelayMs,
      )

      // Call optional retry callback
      options.onRetry?.(attempt + 1, lastError, delay)

      await sleep(delay)
    }
  }

  // This should be unreachable - if we exhaust attempts, we throw on the last iteration
  throw lastError as Error
}

/**
 * Retry with custom retry condition
 *
 * @description Executes an async operation and retries based on a custom condition
 * function. Allows fine-grained control over which errors trigger retries.
 *
 * @template T - Return type of the operation
 * @param operation - Async operation to retry
 * @param shouldRetry - Function that determines if error should retry
 * @param options - Retry configuration options
 * @returns Result of the operation
 *
 * @example
 * ```typescript
 * const result = await retryWithCondition(
 *   () => processData(),
 *   (error) => error instanceof CustomError && error.isRetryable,
 *   { maxAttempts: 3 }
 * );
 * ```
 */
export async function retryWithCondition<T>(
  operation: () => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
  options: RetryOptions = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  // Edge case: if maxAttempts is 0, just run once without retries
  if (opts.maxAttempts <= 0) {
    return operation()
  }

  let lastError: Error | undefined

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error as Error

      if (!shouldRetry(error)) {
        throw error
      }

      if (attempt === opts.maxAttempts - 1) {
        throw error
      }

      const delay = Math.min(
        opts.initialDelayMs * opts.backoffMultiplier ** attempt,
        opts.maxDelayMs,
      )

      // Call optional retry callback
      options.onRetry?.(attempt + 1, lastError, delay)

      await sleep(delay)
    }
  }

  // This should be unreachable - if we exhaust attempts, we throw on the last iteration
  throw lastError as Error
}
