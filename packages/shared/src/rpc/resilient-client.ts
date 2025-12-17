/**
 * Resilient RPC Client with multi-endpoint fallback
 * 
 * Handles DNS failures by falling back to direct IPs, ENS, or on-chain registry
 */

export interface RPCEndpoint {
  url: string
  priority: number
  type: 'dns' | 'direct' | 'ens'
  region?: string
}

// Default endpoints - update with actual IPs after deployment
const DEFAULT_ENDPOINTS: RPCEndpoint[] = [
  // Primary DNS endpoints
  { url: 'https://rpc.jejunetwork.org', priority: 1, type: 'dns', region: 'global' },
  { url: 'https://testnet-rpc.jejunetwork.org', priority: 1, type: 'dns', region: 'global' },
  
  // Direct IP fallbacks (update after deployment)
  // AWS us-east-1
  // { url: 'https://52.x.x.x', priority: 2, type: 'direct', region: 'aws-east' },
  // GCP us-central1  
  // { url: 'https://35.x.x.x', priority: 2, type: 'direct', region: 'gcp-central' },
  
  // ENS fallback
  { url: 'jeju.eth', priority: 3, type: 'ens', region: 'global' },
]

interface HealthStatus {
  healthy: boolean
  lastCheck: number
  latency: number
  consecutiveFailures: number
}

export class ResilientRPCClient {
  private endpoints: RPCEndpoint[]
  private healthStatus: Map<string, HealthStatus> = new Map()
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null
  private readonly healthCheckIntervalMs = 30000
  private readonly maxConsecutiveFailures = 3

  constructor(endpoints?: RPCEndpoint[]) {
    this.endpoints = endpoints ?? DEFAULT_ENDPOINTS
    this.initializeHealthStatus()
    this.startHealthChecks()
  }

  private initializeHealthStatus(): void {
    for (const endpoint of this.endpoints) {
      this.healthStatus.set(endpoint.url, {
        healthy: true, // Assume healthy initially
        lastCheck: 0,
        latency: 0,
        consecutiveFailures: 0,
      })
    }
  }

  private startHealthChecks(): void {
    // Initial check
    this.checkAllEndpoints()
    
    // Periodic checks
    this.healthCheckInterval = setInterval(() => {
      this.checkAllEndpoints()
    }, this.healthCheckIntervalMs)
  }

  private async checkAllEndpoints(): Promise<void> {
    await Promise.all(
      this.endpoints.map(endpoint => this.checkEndpointHealth(endpoint))
    )
  }

  private async checkEndpointHealth(endpoint: RPCEndpoint): Promise<void> {
    const start = Date.now()
    const status = this.healthStatus.get(endpoint.url)
    if (!status) return

    try {
      const url = await this.resolveUrl(endpoint)
      const response = await fetch(`${url}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })

      const latency = Date.now() - start

      if (response.ok) {
        this.healthStatus.set(endpoint.url, {
          healthy: true,
          lastCheck: Date.now(),
          latency,
          consecutiveFailures: 0,
        })
      } else {
        this.markUnhealthy(endpoint.url, status)
      }
    } catch {
      this.markUnhealthy(endpoint.url, status)
    }
  }

  private markUnhealthy(url: string, status: HealthStatus): void {
    const failures = status.consecutiveFailures + 1
    this.healthStatus.set(url, {
      healthy: failures < this.maxConsecutiveFailures,
      lastCheck: Date.now(),
      latency: status.latency,
      consecutiveFailures: failures,
    })
  }

  private async resolveUrl(endpoint: RPCEndpoint): Promise<string> {
    switch (endpoint.type) {
      case 'dns':
      case 'direct':
        return endpoint.url
      case 'ens':
        return this.resolveENS(endpoint.url)
      default:
        return endpoint.url
    }
  }

  private async resolveENS(ensName: string): Promise<string> {
    // Simple ENS resolution via public resolver
    // In production, use @ensdomains/ensjs
    try {
      const response = await fetch(
        `https://api.ensdomains.io/resolve/${ensName}`,
        { signal: AbortSignal.timeout(5000) }
      )
      if (response.ok) {
        const data = await response.json() as { address?: string }
        return data.address ?? ensName
      }
    } catch {
      // Fall through to return original name
    }
    return ensName
  }

  private getHealthyEndpoints(): RPCEndpoint[] {
    return this.endpoints
      .filter(e => {
        const status = this.healthStatus.get(e.url)
        return status?.healthy !== false
      })
      .sort((a, b) => {
        // Sort by priority, then by latency
        if (a.priority !== b.priority) {
          return a.priority - b.priority
        }
        const latencyA = this.healthStatus.get(a.url)?.latency ?? Infinity
        const latencyB = this.healthStatus.get(b.url)?.latency ?? Infinity
        return latencyA - latencyB
      })
  }

  async call<T>(method: string, params: unknown[]): Promise<T> {
    const healthyEndpoints = this.getHealthyEndpoints()
    
    if (healthyEndpoints.length === 0) {
      // All endpoints failed - try all anyway as last resort
      healthyEndpoints.push(...this.endpoints)
    }

    let lastError: Error | null = null

    for (const endpoint of healthyEndpoints) {
      try {
        const url = await this.resolveUrl(endpoint)
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method,
            params,
          }),
          signal: AbortSignal.timeout(30000),
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const data = await response.json() as { result?: T; error?: { message: string } }
        
        if (data.error) {
          throw new Error(data.error.message)
        }

        return data.result as T
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        // Mark as potentially unhealthy
        const status = this.healthStatus.get(endpoint.url)
        if (status) {
          this.markUnhealthy(endpoint.url, status)
        }
      }
    }

    throw new Error(`All RPC endpoints failed. Last error: ${lastError?.message}`)
  }

  getStatus(): { endpoint: string; healthy: boolean; latency: number }[] {
    return this.endpoints.map(e => {
      const status = this.healthStatus.get(e.url)
      return {
        endpoint: e.url,
        healthy: status?.healthy ?? false,
        latency: status?.latency ?? 0,
      }
    })
  }

  destroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
  }
}

// Singleton instance for convenience
let defaultClient: ResilientRPCClient | null = null

export function getResilientRPCClient(): ResilientRPCClient {
  if (!defaultClient) {
    defaultClient = new ResilientRPCClient()
  }
  return defaultClient
}

export function createResilientRPCClient(endpoints: RPCEndpoint[]): ResilientRPCClient {
  return new ResilientRPCClient(endpoints)
}


