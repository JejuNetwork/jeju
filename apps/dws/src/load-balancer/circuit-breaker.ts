/**
 * Circuit Breaker
 * Prevents cascade failures by temporarily stopping requests to failing services
 */

import type { CircuitBreakerConfig, CircuitState, CircuitBreakerState } from './types';

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 30000,
  halfOpenRequests: 3,
};

export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private states = new Map<string, CircuitBreakerState>();

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config };
  }

  private getState(key: string): CircuitBreakerState {
    let state = this.states.get(key);
    if (!state) {
      state = {
        state: 'closed',
        failures: 0,
        lastFailure: 0,
        halfOpenAttempts: 0,
      };
      this.states.set(key, state);
    }
    return state;
  }

  canExecute(key: string): boolean {
    const state = this.getState(key);
    const now = Date.now();

    switch (state.state) {
      case 'closed':
        return true;

      case 'open':
        // Check if we should transition to half-open
        if (now - state.lastFailure >= this.config.resetTimeout) {
          state.state = 'half-open';
          state.halfOpenAttempts = 0;
          return true;
        }
        return false;

      case 'half-open':
        // Allow limited requests in half-open
        return state.halfOpenAttempts < this.config.halfOpenRequests;
    }
  }

  async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute(key)) {
      throw new CircuitOpenError(key);
    }

    const state = this.getState(key);
    
    if (state.state === 'half-open') {
      state.halfOpenAttempts++;
    }

    try {
      const result = await fn();
      this.recordSuccess(key);
      return result;
    } catch (error) {
      this.recordFailure(key);
      throw error;
    }
  }

  recordSuccess(key: string): void {
    const state = this.getState(key);
    
    if (state.state === 'half-open') {
      // Success in half-open transitions back to closed
      state.state = 'closed';
      state.failures = 0;
      state.halfOpenAttempts = 0;
      console.log(`[CircuitBreaker] ${key}: half-open -> closed`);
    } else if (state.state === 'closed') {
      // Reset failure count on success
      state.failures = Math.max(0, state.failures - 1);
    }
  }

  recordFailure(key: string): void {
    const state = this.getState(key);
    state.failures++;
    state.lastFailure = Date.now();

    if (state.state === 'half-open') {
      // Failure in half-open goes back to open
      state.state = 'open';
      console.log(`[CircuitBreaker] ${key}: half-open -> open`);
    } else if (state.state === 'closed' && state.failures >= this.config.failureThreshold) {
      // Too many failures opens the circuit
      state.state = 'open';
      console.log(`[CircuitBreaker] ${key}: closed -> open (${state.failures} failures)`);
    }
  }

  getCircuitState(key: string): CircuitState {
    return this.getState(key).state;
  }

  reset(key: string): void {
    this.states.delete(key);
  }

  getStats(): Record<string, { state: CircuitState; failures: number }> {
    const stats: Record<string, { state: CircuitState; failures: number }> = {};
    for (const [key, state] of this.states) {
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

