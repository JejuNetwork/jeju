/**
 * DWS Load Balancer
 * Scale-to-zero capable load balancer for decentralized services
 */

import {
  AutoScaler,
  type InstanceFactory,
  LocalInstanceFactory,
} from './auto-scaler'
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker'
import type {
  Instance,
  LoadBalancerConfig,
  LoadBalancerStats,
  QueuedRequest,
  ServiceDefinition,
} from './types'
import { DEFAULT_LB_CONFIG } from './types'

export class LoadBalancer {
  private config: LoadBalancerConfig
  private scaler: AutoScaler
  private circuitBreaker: CircuitBreaker
  private requestQueues = new Map<string, QueuedRequest[]>()
  private requestCounts = new Map<string, number>()
  private latencies: number[] = []
  private totalServed = 0
  private evaluationInterval: ReturnType<typeof setInterval> | null = null
  private queueProcessorInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    config: Partial<LoadBalancerConfig> = {},
    factory?: InstanceFactory,
  ) {
    this.config = { ...DEFAULT_LB_CONFIG, ...config }
    this.scaler = new AutoScaler(
      this.config,
      factory ?? new LocalInstanceFactory(),
    )
    this.circuitBreaker = new CircuitBreaker()
  }

  registerService(service: ServiceDefinition): void {
    this.scaler.registerService(service)
    this.requestQueues.set(service.id, [])
    this.requestCounts.set(service.id, 0)

    // Ensure minimum instances
    this.scaler.ensureMinimum(service.id)
  }

  unregisterService(serviceId: string): void {
    this.scaler.unregisterService(serviceId)
    this.requestQueues.delete(serviceId)
    this.requestCounts.delete(serviceId)
  }

  start(): void {
    // Periodic scaling evaluation
    this.evaluationInterval = setInterval(() => {
      this.evaluateAll()
    }, 5000)

    // Process queued requests
    this.queueProcessorInterval = setInterval(() => {
      this.processQueues()
    }, 100)

    console.log('[LoadBalancer] Started')
  }

  stop(): void {
    if (this.evaluationInterval) {
      clearInterval(this.evaluationInterval)
      this.evaluationInterval = null
    }
    if (this.queueProcessorInterval) {
      clearInterval(this.queueProcessorInterval)
      this.queueProcessorInterval = null
    }
    console.log('[LoadBalancer] Stopped')
  }

  private async evaluateAll(): Promise<void> {
    for (const [serviceId, queue] of this.requestQueues) {
      const instances = this.scaler.getRunningInstances(serviceId)
      const activeConnections = instances.reduce(
        (sum, i) => sum + i.currentConnections,
        0,
      )

      await this.scaler.evaluate(serviceId, queue.length, activeConnections)
    }
  }

  private async processQueues(): Promise<void> {
    for (const [serviceId, queue] of this.requestQueues) {
      if (queue.length === 0) continue

      const instances = this.scaler.getRunningInstances(serviceId)
      if (instances.length === 0) continue

      // Process as many requests as we have capacity
      while (queue.length > 0) {
        const instance = this.selectInstance(instances)
        if (!instance) break

        const request = queue.shift()
        if (!request) break

        // Check deadline
        if (Date.now() > request.deadline) {
          request.reject(new Error('Request timeout'))
          continue
        }

        // Process request
        this.processRequest(instance, request)
      }
    }
  }

  private selectInstance(instances: Instance[]): Instance | null {
    // Weighted round-robin based on available capacity
    const available = instances.filter(
      (i) =>
        i.status === 'running' &&
        i.currentConnections < this.config.targetConcurrency,
    )

    if (available.length === 0) return null

    // Select instance with lowest load
    return available.sort(
      (a, b) => a.currentConnections - b.currentConnections,
    )[0]
  }

  private async processRequest(
    instance: Instance,
    queued: QueuedRequest,
  ): Promise<void> {
    instance.currentConnections++
    instance.lastActivityAt = Date.now()
    const startTime = Date.now()

    try {
      const response = await this.circuitBreaker.execute(
        `${queued.serviceId}:${instance.id}`,
        async () => {
          const url = new URL(queued.request.url)
          const targetUrl = `${instance.endpoint}${url.pathname}${url.search}`

          return fetch(targetUrl, {
            method: queued.request.method,
            headers: queued.request.headers,
            body: queued.request.body,
            signal: AbortSignal.timeout(this.config.requestTimeout),
          })
        },
      )

      const latency = Date.now() - startTime
      this.recordLatency(latency)
      instance.totalRequests++
      instance.avgLatencyMs = instance.avgLatencyMs * 0.9 + latency * 0.1
      this.totalServed++

      queued.resolve(response)
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        // Re-queue the request for another instance
        this.requestQueues.get(queued.serviceId)?.unshift(queued)
      } else {
        queued.reject(error instanceof Error ? error : new Error(String(error)))
      }
    } finally {
      instance.currentConnections--
    }
  }

  async route(serviceId: string, request: Request): Promise<Response> {
    const queue = this.requestQueues.get(serviceId)
    if (!queue) {
      return new Response(JSON.stringify({ error: 'Service not found' }), {
        status: 404,
      })
    }

    if (queue.length >= this.config.maxQueueSize) {
      return new Response(JSON.stringify({ error: 'Service overloaded' }), {
        status: 503,
      })
    }

    // Check for available instances
    const instances = this.scaler.getRunningInstances(serviceId)

    if (instances.length === 0) {
      // Scale up from zero
      const scaling = this.scaler.scaleUp(serviceId)
      if (!scaling) {
        return new Response(JSON.stringify({ error: 'Service unavailable' }), {
          status: 503,
        })
      }
    }

    // Queue the request
    return new Promise((resolve, reject) => {
      const queued: QueuedRequest = {
        id: crypto.randomUUID(),
        serviceId,
        request,
        resolve,
        reject,
        queuedAt: Date.now(),
        deadline: Date.now() + this.config.requestTimeout,
      }

      queue.push(queued)
      this.requestCounts.set(
        serviceId,
        (this.requestCounts.get(serviceId) ?? 0) + 1,
      )
    })
  }

  private recordLatency(latencyMs: number): void {
    this.latencies.push(latencyMs)
    if (this.latencies.length > 10000) {
      this.latencies = this.latencies.slice(-10000)
    }
  }

  getStats(): LoadBalancerStats {
    const sorted = [...this.latencies].sort((a, b) => a - b)
    const p95Index = Math.floor(sorted.length * 0.95)
    const p99Index = Math.floor(sorted.length * 0.99)

    let activeInstances = 0
    let totalInstances = 0
    let queuedRequests = 0

    for (const queue of this.requestQueues.values()) {
      queuedRequests += queue.length
    }

    const scalerStats = this.scaler.getStats()
    activeInstances = scalerStats.runningInstances
    totalInstances = scalerStats.totalInstances

    return {
      activeInstances,
      totalInstances,
      queuedRequests,
      totalRequestsServed: this.totalServed,
      avgLatencyMs:
        sorted.length > 0
          ? sorted.reduce((a, b) => a + b, 0) / sorted.length
          : 0,
      p95LatencyMs: sorted[p95Index] ?? 0,
      p99LatencyMs: sorted[p99Index] ?? 0,
      requestsPerSecond: this.totalServed / (process.uptime() || 1),
      scalingEvents: this.scaler.getScalingEvents(10),
    }
  }

  getInstances(serviceId: string): Instance[] {
    return this.scaler.getInstances(serviceId)
  }

  getCircuitStats(): Record<string, { state: string; failures: number }> {
    return this.circuitBreaker.getStats()
  }
}

export {
  AutoScaler,
  type InstanceFactory,
  LocalInstanceFactory,
} from './auto-scaler'
export { CircuitBreaker, CircuitOpenError } from './circuit-breaker'
// Exports
export * from './types'
