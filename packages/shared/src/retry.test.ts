/**
 * Retry Utilities Tests
 */

import { describe, expect, mock, test } from 'bun:test'
import {
  isRetryableError,
  retryIfRetryable,
  retryWithCondition,
  sleep,
} from './retry'

describe('sleep', () => {
  test('resolves after specified time', async () => {
    const start = Date.now()
    await sleep(50)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(45)
  })

  test('resolves to undefined', async () => {
    const result = await sleep(1)
    expect(result).toBeUndefined()
  })
})

describe('isRetryableError', () => {
  test('returns true for TypeError with fetch message', () => {
    const error = new TypeError('fetch failed')
    expect(isRetryableError(error)).toBe(true)
  })

  test('returns true for 500 status', () => {
    expect(isRetryableError({ status: 500 })).toBe(true)
  })

  test('returns true for 502 status', () => {
    expect(isRetryableError({ status: 502 })).toBe(true)
  })

  test('returns true for 503 status', () => {
    expect(isRetryableError({ status: 503 })).toBe(true)
  })

  test('returns true for 429 rate limit', () => {
    expect(isRetryableError({ status: 429 })).toBe(true)
  })

  test('returns false for 400 bad request', () => {
    expect(isRetryableError({ status: 400 })).toBe(false)
  })

  test('returns false for 404 not found', () => {
    expect(isRetryableError({ status: 404 })).toBe(false)
  })

  test('returns false for regular Error', () => {
    expect(isRetryableError(new Error('some error'))).toBe(false)
  })

  test('returns false for null', () => {
    expect(isRetryableError(null)).toBe(false)
  })

  test('returns false for undefined', () => {
    expect(isRetryableError(undefined)).toBe(false)
  })
})

describe('retryIfRetryable', () => {
  test('returns result on first success', async () => {
    const operation = mock(() => Promise.resolve('success'))
    const result = await retryIfRetryable(operation)
    expect(result).toBe('success')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  test('retries on retryable error', async () => {
    let attempts = 0
    const operation = mock(() => {
      attempts++
      if (attempts < 3) {
        const error = new Error('Server error') as Error & { status: number }
        error.status = 500
        return Promise.reject(error)
      }
      return Promise.resolve('success')
    })

    const result = await retryIfRetryable(operation, {
      maxAttempts: 5,
      initialDelayMs: 1,
      maxDelayMs: 10,
    })

    expect(result).toBe('success')
    expect(attempts).toBe(3)
  })

  test('throws immediately on non-retryable error', async () => {
    const error = new Error('Bad request')
    const operation = mock(() => Promise.reject(error))

    await expect(retryIfRetryable(operation)).rejects.toThrow('Bad request')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  test('throws after max attempts', async () => {
    const error = new Error('Server error') as Error & { status: number }
    error.status = 500
    const operation = mock(() => Promise.reject(error))

    await expect(
      retryIfRetryable(operation, {
        maxAttempts: 3,
        initialDelayMs: 1,
        maxDelayMs: 10,
      }),
    ).rejects.toThrow('Server error')

    expect(operation).toHaveBeenCalledTimes(3)
  })

  test('calls onRetry callback', async () => {
    let attempts = 0
    const operation = mock(() => {
      attempts++
      if (attempts < 2) {
        const error = new Error('Server error') as Error & { status: number }
        error.status = 500
        return Promise.reject(error)
      }
      return Promise.resolve('success')
    })

    const onRetry = mock(() => {})

    await retryIfRetryable(operation, {
      maxAttempts: 3,
      initialDelayMs: 1,
      maxDelayMs: 10,
      onRetry,
    })

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  test('uses exponential backoff', async () => {
    let attempts = 0
    const delays: number[] = []
    const operation = mock(() => {
      attempts++
      if (attempts < 4) {
        const error = new Error('Server error') as Error & { status: number }
        error.status = 500
        return Promise.reject(error)
      }
      return Promise.resolve('success')
    })

    await retryIfRetryable(operation, {
      maxAttempts: 5,
      initialDelayMs: 100,
      maxDelayMs: 1000,
      backoffMultiplier: 2,
      onRetry: (_, __, delay) => delays.push(delay),
    })

    // Delays should be 100, 200, 400 (capped by exponential backoff)
    expect(delays[0]).toBe(100)
    expect(delays[1]).toBe(200)
    expect(delays[2]).toBe(400)
  })

  test('respects maxDelayMs', async () => {
    let attempts = 0
    const delays: number[] = []
    const operation = mock(() => {
      attempts++
      if (attempts < 6) {
        const error = new Error('Server error') as Error & { status: number }
        error.status = 500
        return Promise.reject(error)
      }
      return Promise.resolve('success')
    })

    await retryIfRetryable(operation, {
      maxAttempts: 10,
      initialDelayMs: 100,
      maxDelayMs: 300,
      backoffMultiplier: 2,
      onRetry: (_, __, delay) => delays.push(delay),
    })

    // All delays after the third should be capped at 300
    expect(delays[0]).toBe(100)
    expect(delays[1]).toBe(200)
    expect(delays[2]).toBe(300)
    expect(delays[3]).toBe(300)
    expect(delays[4]).toBe(300)
  })
})

describe('retryWithCondition', () => {
  test('retries based on custom condition', async () => {
    let attempts = 0
    const operation = mock(() => {
      attempts++
      if (attempts < 3) {
        return Promise.reject(new Error('CustomError'))
      }
      return Promise.resolve('success')
    })

    const result = await retryWithCondition(
      operation,
      (error) => error instanceof Error && error.message === 'CustomError',
      { maxAttempts: 5, initialDelayMs: 1, maxDelayMs: 10 },
    )

    expect(result).toBe('success')
    expect(attempts).toBe(3)
  })

  test('does not retry when condition returns false', async () => {
    const operation = mock(() => Promise.reject(new Error('NotRetryable')))

    await expect(
      retryWithCondition(operation, () => false, { maxAttempts: 5 }),
    ).rejects.toThrow('NotRetryable')

    expect(operation).toHaveBeenCalledTimes(1)
  })

  test('throws after max attempts even with retry condition met', async () => {
    const operation = mock(() => Promise.reject(new Error('Always fails')))

    await expect(
      retryWithCondition(operation, () => true, {
        maxAttempts: 3,
        initialDelayMs: 1,
        maxDelayMs: 10,
      }),
    ).rejects.toThrow('Always fails')

    expect(operation).toHaveBeenCalledTimes(3)
  })
})
