import {
  BrokenCircuitError,
  type CircuitBreakerPolicy,
  CircuitState as CockatielState,
  ConsecutiveBreaker,
  circuitBreaker,
  handleAll,
} from 'cockatiel'
import type { CircuitBreakerConfig, CircuitState } from './types'

export { BrokenCircuitError }

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 30000,
  halfOpenRequests: 3,
}

function mapState(state: CockatielState): CircuitState {
  switch (state) {
    case CockatielState.Closed:
      return 'closed'
    case CockatielState.Open:
    case CockatielState.Isolated:
      return 'open'
    case CockatielState.HalfOpen:
      return 'half-open'
    default: {
      const _exhaustive: never = state
      throw new Error(`Unknown circuit state: ${_exhaustive}`)
    }
  }
}

interface BreakerEntry {
  policy: CircuitBreakerPolicy
  failures: number
  lastFailure: number
}

export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig
  private readonly breakers = new Map<string, BreakerEntry>()

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config }
  }

  private getOrCreate(key: string): BreakerEntry {
    let entry = this.breakers.get(key)
    if (entry) return entry

    const policy = circuitBreaker(handleAll, {
      halfOpenAfter: this.config.resetTimeout,
      breaker: new ConsecutiveBreaker(this.config.failureThreshold),
    })

    entry = { policy, failures: 0, lastFailure: 0 }

    policy.onFailure(() => {
      const e = this.breakers.get(key)
      if (e) {
        e.failures++
        e.lastFailure = Date.now()
      }
    })

    policy.onSuccess(() => {
      const e = this.breakers.get(key)
      if (e) e.failures = Math.max(0, e.failures - 1)
    })

    this.breakers.set(key, entry)
    return entry
  }

  getState(key: string): CircuitState {
    const entry = this.breakers.get(key)
    if (!entry) return 'closed'
    return mapState(entry.policy.state)
  }

  canExecute(key: string): boolean {
    return this.getState(key) !== 'open'
  }

  async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const { policy } = this.getOrCreate(key)
    return policy.execute(fn)
  }

  reset(key: string): void {
    this.breakers.delete(key)
  }

  resetAll(): void {
    this.breakers.clear()
  }

  getStats(): Record<string, { state: CircuitState; failures: number }> {
    const stats: Record<string, { state: CircuitState; failures: number }> = {}
    for (const [key, entry] of this.breakers) {
      stats[key] = {
        state: mapState(entry.policy.state),
        failures: entry.failures,
      }
    }
    return stats
  }
}
