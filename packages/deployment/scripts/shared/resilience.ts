/**
 * Resilience Configuration
 *
 * Handles failure modes, caching, backup and recovery for:
 * - Multi-cloud failover
 * - Node restart recovery
 * - Data persistence
 * - Circuit breakers
 *
 * Usage in deployment scripts:
 *   import { ResilienceManager, ResilienceConfig } from './resilience'
 *   const rm = new ResilienceManager(config)
 *   await rm.healthCheck()
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ResilienceConfig {
  network: 'localnet' | 'testnet' | 'mainnet'

  // Multi-layer caching
  cache: {
    l1: {
      type: 'redis' | 'memory'
      endpoint?: string
      ttl: number // seconds
      maxSize: number // MB
    }
    l2: {
      type: 'ipfs' | 's3' | 'gcs'
      endpoint?: string
      replication: number
      pinning: string[]
    }
  }

  // Automatic failover
  failover: {
    rpc: {
      primary: string
      fallbacks: string[]
      healthCheckInterval: number // ms
      failureThreshold: number
      recoveryThreshold: number
    }
    dws: {
      primary: string
      fallbacks: string[]
      healthCheckInterval: number
    }
  }

  // State backup
  backup: {
    enabled: boolean
    interval: number // seconds
    targets: ('arweave' | 'ipfs' | 's3' | 'gcs')[]
    encryption: boolean
    retention: number // days
  }

  // Circuit breakers
  circuitBreaker: {
    enabled: boolean
    failureThreshold: number
    resetTimeout: number // ms
    halfOpenRequests: number
  }

  // Retry configuration
  retry: {
    maxAttempts: number
    initialDelay: number // ms
    maxDelay: number // ms
    backoffMultiplier: number
  }
}

// Environment-specific configurations
export const RESILIENCE_CONFIGS: Record<string, ResilienceConfig> = {
  localnet: {
    network: 'localnet',
    cache: {
      l1: {
        type: 'memory',
        ttl: 60,
        maxSize: 100,
      },
      l2: {
        type: 'ipfs',
        endpoint: 'http://localhost:5001',
        replication: 1,
        pinning: ['local'],
      },
    },
    failover: {
      rpc: {
        primary: 'http://localhost:6546',
        fallbacks: ['http://localhost:6545'],
        healthCheckInterval: 5000,
        failureThreshold: 2,
        recoveryThreshold: 1,
      },
      dws: {
        primary: 'http://localhost:4030',
        fallbacks: [],
        healthCheckInterval: 5000,
      },
    },
    backup: {
      enabled: false,
      interval: 3600,
      targets: ['ipfs'],
      encryption: false,
      retention: 7,
    },
    circuitBreaker: {
      enabled: false,
      failureThreshold: 5,
      resetTimeout: 30000,
      halfOpenRequests: 3,
    },
    retry: {
      maxAttempts: 3,
      initialDelay: 100,
      maxDelay: 1000,
      backoffMultiplier: 2,
    },
  },

  testnet: {
    network: 'testnet',
    cache: {
      l1: {
        type: 'redis',
        endpoint: 'redis://redis.jeju-system.svc.cluster.local:6379',
        ttl: 300,
        maxSize: 1000,
      },
      l2: {
        type: 'ipfs',
        endpoint: 'https://ipfs.testnet.jejunetwork.org',
        replication: 3,
        pinning: ['pinata', 'infura', 'local'],
      },
    },
    failover: {
      rpc: {
        primary: 'https://testnet-rpc.jejunetwork.org',
        fallbacks: [
          'https://testnet-rpc.gcp.jejunetwork.org',
          'https://sepolia.base.org',
        ],
        healthCheckInterval: 10000,
        failureThreshold: 3,
        recoveryThreshold: 2,
      },
      dws: {
        primary: 'https://dws.testnet.jejunetwork.org',
        fallbacks: ['https://dws.testnet.gcp.jejunetwork.org'],
        healthCheckInterval: 10000,
      },
    },
    backup: {
      enabled: true,
      interval: 3600, // 1 hour
      targets: ['ipfs', 's3'],
      encryption: true,
      retention: 30,
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 5,
      resetTimeout: 60000,
      halfOpenRequests: 3,
    },
    retry: {
      maxAttempts: 5,
      initialDelay: 500,
      maxDelay: 30000,
      backoffMultiplier: 2,
    },
  },

  mainnet: {
    network: 'mainnet',
    cache: {
      l1: {
        type: 'redis',
        endpoint: 'redis://redis-cluster.jeju-system.svc.cluster.local:6379',
        ttl: 60,
        maxSize: 10000,
      },
      l2: {
        type: 'ipfs',
        replication: 5,
        pinning: ['pinata', 'infura', 'web3storage', 'local'],
      },
    },
    failover: {
      rpc: {
        primary: 'https://rpc.jejunetwork.org',
        fallbacks: [
          'https://rpc.gcp.jejunetwork.org',
          'https://rpc.aws.jejunetwork.org',
          'https://mainnet.base.org',
        ],
        healthCheckInterval: 5000,
        failureThreshold: 2,
        recoveryThreshold: 3,
      },
      dws: {
        primary: 'https://dws.jejunetwork.org',
        fallbacks: [
          'https://dws.gcp.jejunetwork.org',
          'https://dws.aws.jejunetwork.org',
        ],
        healthCheckInterval: 5000,
      },
    },
    backup: {
      enabled: true,
      interval: 900, // 15 minutes
      targets: ['arweave', 'ipfs', 's3', 'gcs'],
      encryption: true,
      retention: 365,
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 3,
      resetTimeout: 30000,
      halfOpenRequests: 5,
    },
    retry: {
      maxAttempts: 10,
      initialDelay: 100,
      maxDelay: 60000,
      backoffMultiplier: 2,
    },
  },
}

export function getResilienceConfig(network: string): ResilienceConfig {
  const config = RESILIENCE_CONFIGS[network]
  if (!config) {
    throw new Error(`Unknown network: ${network}`)
  }
  return config
}

// Circuit breaker states
enum CircuitState {
  Closed = 'closed',
  Open = 'open',
  HalfOpen = 'half-open',
}

interface CircuitBreakerState {
  state: CircuitState
  failures: number
  lastFailure: number
  successesSinceHalfOpen: number
}

/**
 * Resilience Manager
 *
 * Provides:
 * - RPC failover with health checks
 * - Circuit breakers
 * - Retry with exponential backoff
 * - State persistence for restart recovery
 */
export class ResilienceManager {
  private config: ResilienceConfig
  private stateFile: string
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map()
  private healthyEndpoints: Map<string, boolean> = new Map()
  private healthCheckIntervals: Map<string, ReturnType<typeof setInterval>> =
    new Map()

  constructor(config: ResilienceConfig, stateDir?: string) {
    this.config = config
    const dir = stateDir ?? join(process.cwd(), '.resilience')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    this.stateFile = join(dir, `${config.network}-state.json`)
    this.loadState()
  }

  private loadState(): void {
    if (existsSync(this.stateFile)) {
      try {
        const data = JSON.parse(readFileSync(this.stateFile, 'utf-8'))
        this.circuitBreakers = new Map(
          Object.entries(data.circuitBreakers ?? {}),
        )
        this.healthyEndpoints = new Map(
          Object.entries(data.healthyEndpoints ?? {}),
        )
        console.log('[Resilience] Loaded state from disk')
      } catch {
        console.log('[Resilience] Could not load state, starting fresh')
      }
    }
  }

  private saveState(): void {
    const data = {
      circuitBreakers: Object.fromEntries(this.circuitBreakers),
      healthyEndpoints: Object.fromEntries(this.healthyEndpoints),
      savedAt: new Date().toISOString(),
    }
    writeFileSync(this.stateFile, JSON.stringify(data, null, 2))
  }

  /**
   * Start health check monitoring
   */
  startHealthChecks(): void {
    // RPC health checks
    const rpcConfig = this.config.failover.rpc
    const allRpcs = [rpcConfig.primary, ...rpcConfig.fallbacks]

    for (const endpoint of allRpcs) {
      this.startEndpointHealthCheck(endpoint, rpcConfig.healthCheckInterval)
    }

    // DWS health checks
    const dwsConfig = this.config.failover.dws
    const allDws = [dwsConfig.primary, ...dwsConfig.fallbacks]

    for (const endpoint of allDws) {
      this.startEndpointHealthCheck(endpoint, dwsConfig.healthCheckInterval)
    }

    console.log('[Resilience] Health checks started')
  }

  private startEndpointHealthCheck(endpoint: string, interval: number): void {
    const check = async () => {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)

        const response = await fetch(endpoint, {
          method: endpoint.includes('rpc') ? 'POST' : 'GET',
          headers: { 'Content-Type': 'application/json' },
          body: endpoint.includes('rpc')
            ? JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_blockNumber',
                params: [],
                id: 1,
              })
            : undefined,
          signal: controller.signal,
        })

        clearTimeout(timeout)
        this.healthyEndpoints.set(endpoint, response.ok)
      } catch {
        this.healthyEndpoints.set(endpoint, false)
      }
    }

    // Initial check
    check()

    // Periodic checks
    const intervalId = setInterval(check, interval)
    this.healthCheckIntervals.set(endpoint, intervalId)
  }

  /**
   * Stop health check monitoring
   */
  stopHealthChecks(): void {
    for (const [, intervalId] of this.healthCheckIntervals) {
      clearInterval(intervalId)
    }
    this.healthCheckIntervals.clear()
    this.saveState()
    console.log('[Resilience] Health checks stopped')
  }

  /**
   * Get the best available RPC endpoint
   */
  getRpcEndpoint(): string {
    const rpcConfig = this.config.failover.rpc

    // Try primary first
    if (this.healthyEndpoints.get(rpcConfig.primary) !== false) {
      return rpcConfig.primary
    }

    // Try fallbacks
    for (const fallback of rpcConfig.fallbacks) {
      if (this.healthyEndpoints.get(fallback) !== false) {
        console.log(`[Resilience] Falling back to RPC: ${fallback}`)
        return fallback
      }
    }

    // All unhealthy, return primary anyway
    console.warn('[Resilience] All RPC endpoints unhealthy, using primary')
    return rpcConfig.primary
  }

  /**
   * Get the best available DWS endpoint
   */
  getDwsEndpoint(): string {
    const dwsConfig = this.config.failover.dws

    if (this.healthyEndpoints.get(dwsConfig.primary) !== false) {
      return dwsConfig.primary
    }

    for (const fallback of dwsConfig.fallbacks) {
      if (this.healthyEndpoints.get(fallback) !== false) {
        console.log(`[Resilience] Falling back to DWS: ${fallback}`)
        return fallback
      }
    }

    return dwsConfig.primary
  }

  /**
   * Execute with circuit breaker
   */
  async withCircuitBreaker<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (!this.config.circuitBreaker.enabled) {
      return fn()
    }

    let state = this.circuitBreakers.get(key)
    if (!state) {
      state = {
        state: CircuitState.Closed,
        failures: 0,
        lastFailure: 0,
        successesSinceHalfOpen: 0,
      }
      this.circuitBreakers.set(key, state)
    }

    // Check if circuit is open
    if (state.state === CircuitState.Open) {
      const timeSinceFailure = Date.now() - state.lastFailure
      if (timeSinceFailure < this.config.circuitBreaker.resetTimeout) {
        throw new Error(`Circuit breaker open for ${key}`)
      }
      // Try half-open
      state.state = CircuitState.HalfOpen
      state.successesSinceHalfOpen = 0
    }

    try {
      const result = await fn()

      // Success
      if (state.state === CircuitState.HalfOpen) {
        state.successesSinceHalfOpen++
        if (
          state.successesSinceHalfOpen >=
          this.config.circuitBreaker.halfOpenRequests
        ) {
          state.state = CircuitState.Closed
          state.failures = 0
        }
      } else {
        state.failures = 0
      }

      return result
    } catch (error) {
      // Failure
      state.failures++
      state.lastFailure = Date.now()

      if (state.failures >= this.config.circuitBreaker.failureThreshold) {
        state.state = CircuitState.Open
        console.warn(`[Resilience] Circuit breaker opened for ${key}`)
      }

      throw error
    }
  }

  /**
   * Execute with retry and exponential backoff
   */
  async withRetry<T>(fn: () => Promise<T>, operation?: string): Promise<T> {
    const { maxAttempts, initialDelay, maxDelay, backoffMultiplier } =
      this.config.retry

    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn()
      } catch (error) {
        lastError = error as Error
        if (attempt === maxAttempts) break

        const delay = Math.min(
          initialDelay * backoffMultiplier ** (attempt - 1),
          maxDelay,
        )
        console.log(
          `[Resilience] ${operation ?? 'Operation'} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms`,
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    throw lastError
  }

  /**
   * Get health status of all endpoints
   */
  getHealthStatus(): Record<string, boolean> {
    return Object.fromEntries(this.healthyEndpoints)
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus(): Record<string, CircuitBreakerState> {
    return Object.fromEntries(this.circuitBreakers)
  }
}

/**
 * Create a resilience manager for the current network
 */
export function createResilienceManager(
  network: string,
  stateDir?: string,
): ResilienceManager {
  const config = getResilienceConfig(network)
  return new ResilienceManager(config, stateDir)
}

// Export types
export type { CircuitBreakerState }
