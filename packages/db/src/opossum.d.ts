declare module 'opossum' {
  export interface CircuitBreakerOptions {
    timeout?: number
    errorThresholdPercentage?: number
    resetTimeout?: number
    volumeThreshold?: number
    rollingCountTimeout?: number
    rollingCountBuckets?: number
    name?: string
    group?: string
    rollingPercentilesEnabled?: boolean
    capacity?: number
    allowWarmUp?: boolean
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

  // Event callback type map for type-safe event handling
  export interface CircuitBreakerEventMap<
    TArgs extends readonly unknown[],
    TReturn,
  > {
    success: (result: TReturn, latencyMs: number) => void
    timeout: (latencyMs: number) => void
    reject: (error: Error) => void
    open: () => void
    halfOpen: () => void
    close: () => void
    fallback: (result: TReturn, error: Error) => void
    failure: (error: Error, latencyMs: number, args: TArgs) => void
    semaphoreLocked: () => void
    healthCheckFailed: (error: Error) => void
  }

  class CircuitBreaker<
    TArgs extends readonly unknown[] = readonly unknown[],
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

    toJSON(): {
      state: 'OPEN' | 'HALF_OPEN' | 'CLOSED'
      stats: CircuitBreakerStats
    }

    fire(...args: TArgs): Promise<TReturn>
    clearCache(): void
    open(): void
    close(): void
    disable(): void
    enable(): void
    shutdown(): void
    on<E extends CircuitBreakerEvent>(
      event: E,
      listener: CircuitBreakerEventMap<TArgs, TReturn>[E],
    ): this
    once<E extends CircuitBreakerEvent>(
      event: E,
      listener: CircuitBreakerEventMap<TArgs, TReturn>[E],
    ): this
    off<E extends CircuitBreakerEvent>(
      event: E,
      listener: CircuitBreakerEventMap<TArgs, TReturn>[E],
    ): this
    removeListener<E extends CircuitBreakerEvent>(
      event: E,
      listener: CircuitBreakerEventMap<TArgs, TReturn>[E],
    ): this
    fallback(fn: (...args: TArgs) => TReturn | Promise<TReturn>): this
    healthCheck(fn: () => Promise<void>, interval?: number): void
  }

  export default CircuitBreaker
}
