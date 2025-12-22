/**
 * Circuit Breaker
 * Prevents cascade failures by temporarily stopping requests to failing services
 * 
 * Uses opossum library for battle-tested circuit breaker implementation
 */

import CircuitBreakerLib from 'opossum';
import type { CircuitBreakerConfig, CircuitState, CircuitBreakerState } from './types';

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 30000,
  halfOpenRequests: 3,
};

// Map to track circuit breaker instances per key
const breakers = new Map<string, CircuitBreakerLib<unknown[], unknown>>();
const breakerStates = new Map<string, CircuitBreakerState>();

export class CircuitBreaker {
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config };
  }

  private getBreaker<T>(key: string, fn: () => Promise<T>): CircuitBreakerLib<[], T> {
    if (!breakers.has(key)) {
      const breaker = new CircuitBreakerLib(fn, {
        timeout: 30000,
        errorThresholdPercentage: (this.config.failureThreshold / 10) * 100,
        resetTimeout: this.config.resetTimeout,
        volumeThreshold: this.config.failureThreshold,
      }) as CircuitBreakerLib<[], T>;

      // Initialize state tracking
      breakerStates.set(key, {
        state: 'closed',
        failures: 0,
        lastFailure: 0,
        halfOpenAttempts: 0,
      });

      // Set up event listeners to track state
      breaker.on('open', () => {
        const state = breakerStates.get(key);
        if (state) {
          state.state = 'open';
          state.lastFailure = Date.now();
          console.log(`[CircuitBreaker] ${key}: closed -> open`);
        }
      });

      breaker.on('halfOpen', () => {
        const state = breakerStates.get(key);
        if (state) {
          state.state = 'half-open';
          state.halfOpenAttempts = 0;
          console.log(`[CircuitBreaker] ${key}: open -> half-open`);
        }
      });

      breaker.on('close', () => {
        const state = breakerStates.get(key);
        if (state) {
          state.state = 'closed';
          state.failures = 0;
          state.halfOpenAttempts = 0;
          console.log(`[CircuitBreaker] ${key}: half-open -> closed`);
        }
      });

      breaker.on('failure', () => {
        const state = breakerStates.get(key);
        if (state) {
          state.failures++;
          state.lastFailure = Date.now();
        }
      });

      breaker.on('success', () => {
        const state = breakerStates.get(key);
        if (state) {
          state.failures = Math.max(0, state.failures - 1);
        }
      });

      breakers.set(key, breaker as CircuitBreakerLib<unknown[], unknown>);
    }
    return breakers.get(key) as CircuitBreakerLib<[], T>;
  }

  canExecute(key: string): boolean {
    const state = breakerStates.get(key);
    if (!state) return true;

    switch (state.state) {
      case 'closed':
        return true;
      case 'open':
        // Check if we should transition to half-open
        if (Date.now() - state.lastFailure >= this.config.resetTimeout) {
          return true;
        }
        return false;
      case 'half-open':
        return state.halfOpenAttempts < this.config.halfOpenRequests;
    }
  }

  async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute(key)) {
      throw new CircuitOpenError(key);
    }

    const state = breakerStates.get(key);
    if (state?.state === 'half-open') {
      state.halfOpenAttempts++;
    }

    const breaker = this.getBreaker(key, fn);
    return breaker.fire();
  }

  recordSuccess(key: string): void {
    const state = breakerStates.get(key);
    if (!state) return;

    if (state.state === 'half-open') {
      state.state = 'closed';
      state.failures = 0;
      state.halfOpenAttempts = 0;
    } else if (state.state === 'closed') {
      state.failures = Math.max(0, state.failures - 1);
    }
  }

  recordFailure(key: string): void {
    const state = breakerStates.get(key);
    if (!state) return;

    state.failures++;
    state.lastFailure = Date.now();

    if (state.state === 'half-open') {
      state.state = 'open';
    } else if (state.state === 'closed' && state.failures >= this.config.failureThreshold) {
      state.state = 'open';
    }
  }

  getCircuitState(key: string): CircuitState {
    return breakerStates.get(key)?.state ?? 'closed';
  }

  reset(key: string): void {
    const breaker = breakers.get(key);
    if (breaker) {
      breaker.close();
    }
    breakers.delete(key);
    breakerStates.delete(key);
  }

  getStats(): Record<string, { state: CircuitState; failures: number }> {
    const stats: Record<string, { state: CircuitState; failures: number }> = {};
    for (const [key, state] of breakerStates) {
      stats[key] = { state: state.state, failures: state.failures };
    }
    return stats;
  }
}

export class CircuitOpenError extends Error {
  constructor(public key: string) {
    super(`Circuit breaker open for: ${key}`);
    this.name = 'CircuitOpenError';
  }
}
