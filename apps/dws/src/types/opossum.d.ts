declare module 'opossum' {
  export interface CircuitBreakerOptions {
    /** Time in milliseconds that action should be allowed to execute before timing out */
    timeout?: number
    /** Error percentage at which to open the circuit */
    errorThresholdPercentage?: number
    /** Time in milliseconds to wait before setting breaker to half-open state */
    resetTimeout?: number
    /** Minimum number of requests within the rolling window before the circuit opens */
    volumeThreshold?: number
    /** Rolling statistics window size in milliseconds */
    rollingCountTimeout?: number
    /** Number of buckets the rolling statistical window is divided into */
    rollingCountBuckets?: number
    /** Name for the circuit breaker */
    name?: string
    /** Whether this breaker is in the semaphore-locked state */
    group?: string
    /** Percentile window duration */
    rollingPercentilesEnabled?: boolean
    /** Capacity - max concurrent requests when circuit is half-open */
    capacity?: number
    /** Whether to fire on reject when half-open */
    allowWarmUp?: boolean
    /** Enable request volume threshold */
    enabled?: boolean
  }

  export interface CircuitBreakerStats {
    failures: number
    fallbacks: number
    successes: number
    rejects: number
    fires: number
    timeouts: number
    cacheHits: number
    cacheMisses: number
    semaphoreRejections: number
    percentiles: Record<number, number>
    latencyTimes: number[]
    latencyMean: number
  }

  export type CircuitBreakerEvent =
    | 'success'
    | 'timeout'
    | 'reject'
    | 'open'
    | 'halfOpen'
    | 'close'
    | 'fallback'
    | 'failure'
    | 'semaphoreLocked'
    | 'healthCheckFailed'

  class CircuitBreaker<
    TArgs extends readonly unknown[] = readonly [],
    TReturn = void,
  > {
    readonly name: string
    readonly group: string
    readonly enabled: boolean
    readonly pendingClose: boolean
    readonly closed: boolean
    readonly opened: boolean
    readonly halfOpen: boolean
    readonly isShutdown: boolean
    readonly status: { stats: CircuitBreakerStats }
    readonly stats: CircuitBreakerStats
    readonly warmUp: boolean
    readonly volumeThreshold: number

    constructor(
      action: (...args: TArgs) => Promise<TReturn>,
      options?: CircuitBreakerOptions,
    )

    /** Returns the current state of the circuit breaker */
    toJSON(): {
      state: 'OPEN' | 'HALF_OPEN' | 'CLOSED'
      stats: CircuitBreakerStats
    }

    /** Fire the circuit breaker action */
    fire(...args: TArgs): Promise<TReturn>

    /** Clears the cache */
    clearCache(): void

    /** Opens the circuit breaker */
    open(): void

    /** Closes the circuit breaker */
    close(): void

    /** Disables the circuit breaker */
    disable(): void

    /** Enables the circuit breaker */
    enable(): void

    /** Shuts down the circuit breaker */
    shutdown(): void

    /** Registers an event listener */
    on(event: 'success', listener: (result: TReturn) => void): this
    on(
      event: 'failure' | 'timeout' | 'healthCheckFailed',
      listener: (error: Error) => void,
    ): this
    on(
      event: 'fallback',
      listener: (result: TReturn, error?: Error) => void,
    ): this
    on(
      event: 'open' | 'halfOpen' | 'close' | 'semaphoreLocked' | 'reject',
      listener: () => void,
    ): this

    /** Registers a one-time event listener */
    once(event: 'success', listener: (result: TReturn) => void): this
    once(
      event: 'failure' | 'timeout' | 'healthCheckFailed',
      listener: (error: Error) => void,
    ): this
    once(
      event: 'fallback',
      listener: (result: TReturn, error?: Error) => void,
    ): this
    once(
      event: 'open' | 'halfOpen' | 'close' | 'semaphoreLocked' | 'reject',
      listener: () => void,
    ): this

    /** Removes an event listener */
    off(event: CircuitBreakerEvent, listener: () => void): this

    /** Removes an event listener */
    removeListener(event: CircuitBreakerEvent, listener: () => void): this

    /** Sets a fallback function to execute when the circuit is open */
    fallback(fn: (...args: TArgs) => TReturn | Promise<TReturn>): this

    /** Health check function */
    healthCheck(fn: () => Promise<void>, interval?: number): void
  }

  export default CircuitBreaker
}
