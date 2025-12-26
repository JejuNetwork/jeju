/**
 * Circuit Breaker
 * Prevents cascade failures by temporarily stopping requests to failing services
 *
 * Custom implementation without external dependencies for better type safety
 */

import type {
  CircuitBreakerConfig,
  CircuitBreakerState,
  CircuitState,
} from './types'

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 30000,
  halfOpenRequests: 3,
}

// Map to track circuit breaker state per key
const breakerStates = new Map<string, CircuitBreakerState>()

export class CircuitBreaker {
  private config: CircuitBreakerConfig

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config }
  }

  private getOrCreateState(key: string): CircuitBreakerState {
    let state = breakerStates.get(key)
    if (!state) {
      state = {
        state: 'closed',
        failures: 0,
        lastFailure: 0,
        halfOpenAttempts: 0,
      }
      breakerStates.set(key, state)
    }
    return state
  }

  private transitionState(key: string, newState: CircuitState): void {
    const state = this.getOrCreateState(key)
    const oldState = state.state
    state.state = newState

    if (newState === 'closed') {
      state.failures = 0
      state.halfOpenAttempts = 0
    }

    console.log(`[CircuitBreaker] ${key}: ${oldState} -> ${newState}`)
  }

  canExecute(key: string): boolean {
    const state = breakerStates.get(key)
    if (!state) return true

    switch (state.state) {
      case 'closed':
        return true
      case 'open':
        // Check if we should transition to half-open
        if (Date.now() - state.lastFailure >= this.config.resetTimeout) {
          this.transitionState(key, 'half-open')
          return true
        }
        return false
      case 'half-open':
        return state.halfOpenAttempts < this.config.halfOpenRequests
    }
  }

  async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute(key)) {
      throw new CircuitOpenError(key)
    }

    const state = this.getOrCreateState(key)
    if (state.state === 'half-open') {
      state.halfOpenAttempts++
    }

    try {
      const result = await fn()
      this.recordSuccess(key)
      return result
    } catch (error) {
      this.recordFailure(key)
      throw error
    }
  }

  recordSuccess(key: string): void {
    const state = breakerStates.get(key)
    if (!state) return

    if (state.state === 'half-open') {
      this.transitionState(key, 'closed')
    } else if (state.state === 'closed') {
      state.failures = Math.max(0, state.failures - 1)
    }
  }

  recordFailure(key: string): void {
    const state = this.getOrCreateState(key)

    state.failures++
    state.lastFailure = Date.now()

    if (state.state === 'half-open') {
      this.transitionState(key, 'open')
    } else if (
      state.state === 'closed' &&
      state.failures >= this.config.failureThreshold
    ) {
      this.transitionState(key, 'open')
    }
  }

  getCircuitState(key: string): CircuitState {
    return breakerStates.get(key)?.state ?? 'closed'
  }

  reset(key: string): void {
    breakerStates.delete(key)
  }

  getStats(): Record<string, { state: CircuitState; failures: number }> {
    const stats: Record<string, { state: CircuitState; failures: number }> = {}
    for (const [key, state] of breakerStates) {
      stats[key] = { state: state.state, failures: state.failures }
    }
    return stats
  }
}

export class CircuitOpenError extends Error {
  constructor(public readonly key: string) {
    super(`Circuit breaker open for: ${key}`)
    this.name = 'CircuitOpenError'
  }
}
