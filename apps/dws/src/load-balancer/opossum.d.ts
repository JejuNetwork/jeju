declare module 'opossum' {
  interface CircuitBreakerOptions {
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

  type CircuitBreakerEventName =
    | 'success'
    | 'timeout'
    | 'reject'
    | 'open'
    | 'halfOpen'
    | 'close'
    | 'fallback'
    | 'semaphoreLocked'
    | 'healthCheckFailed'
    | 'failure'

  class CircuitBreaker<TArgs extends unknown[], TReturn> {
    constructor(
      action: (...args: TArgs) => Promise<TReturn>,
      options?: CircuitBreakerOptions,
    )

    fire(...args: TArgs): Promise<TReturn>
    open(): void
    close(): void
    disable(): void
    enable(): void
    isOpen(): boolean
    isClosed(): boolean
    isHalfOpen(): boolean
    shutdown(): void

    on(
      event: CircuitBreakerEventName,
      callback: (...args: unknown[]) => void,
    ): this
    removeListener(
      event: CircuitBreakerEventName,
      callback: (...args: unknown[]) => void,
    ): this
  }

  export default CircuitBreaker
}
