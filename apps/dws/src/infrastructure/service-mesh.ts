/**
 * DWS Service Mesh
 *
 * Provides secure service-to-service communication:
 * - mTLS between services
 * - Service discovery via JNS
 * - Access control policies
 * - Traffic management (retries, circuit breaking)
 * - Observability (metrics, tracing)
 *
 * Architecture:
 * - Each DWS node runs a mesh proxy
 * - Services register with local proxy
 * - Proxy handles routing, auth, and encryption
 * - Policies are stored on-chain or via P2P gossip
 */

import { expectValid } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes } from 'viem'
import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

export interface ServiceIdentity {
  id: string
  name: string
  namespace: string
  owner: Address
  publicKey: Hex
  certificate?: string
  endpoints: string[]
  tags: string[]
  createdAt: number
}

export interface AccessPolicy {
  id: string
  name: string
  source: ServiceSelector
  destination: ServiceSelector
  action: 'allow' | 'deny'
  conditions?: PolicyCondition[]
  priority: number
}

export interface ServiceSelector {
  namespace?: string
  name?: string
  tags?: string[]
  owner?: Address
}

export interface PolicyCondition {
  type: 'header' | 'path' | 'method' | 'time' | 'rate'
  key?: string
  operator: 'equals' | 'contains' | 'regex' | 'exists'
  value?: string
}

export interface TrafficPolicy {
  id: string
  service: ServiceSelector
  retries: {
    maxRetries: number
    retryOn: string[]
    backoffMs: number
  }
  timeout: {
    requestMs: number
    idleMs: number
  }
  circuitBreaker: {
    maxFailures: number
    windowMs: number
    cooldownMs: number
  }
  rateLimit?: {
    requestsPerSecond: number
    burstSize: number
  }
}

export interface ServiceMetrics {
  serviceId: string
  requests: {
    total: number
    success: number
    failure: number
  }
  latency: {
    p50: number
    p95: number
    p99: number
  }
  connections: {
    active: number
    total: number
  }
}

// ============================================================================
// Service Registry
// ============================================================================

const services = new Map<string, ServiceIdentity>()
const accessPolicies = new Map<string, AccessPolicy>()
const trafficPolicies = new Map<string, TrafficPolicy>()
const serviceMetrics = new Map<string, ServiceMetrics>()

export class ServiceMesh {
  /**
   * Register this service with the mesh
   */
  async registerService(
    identity: Omit<ServiceIdentity, 'id' | 'createdAt'>,
  ): Promise<ServiceIdentity> {
    const id = this.generateServiceId(identity.name, identity.namespace)

    const service: ServiceIdentity = {
      ...identity,
      id,
      createdAt: Date.now(),
    }

    services.set(id, service)
    this.selfIdentity = service

    // Initialize metrics
    serviceMetrics.set(id, {
      serviceId: id,
      requests: { total: 0, success: 0, failure: 0 },
      latency: { p50: 0, p95: 0, p99: 0 },
      connections: { active: 0, total: 0 },
    })

    console.log(
      `[ServiceMesh] Registered service: ${identity.namespace}/${identity.name}`,
    )
    return service
  }

  /**
   * Discover a service by name
   */
  async discoverService(
    name: string,
    namespace = 'default',
  ): Promise<ServiceIdentity | null> {
    const id = this.generateServiceId(name, namespace)
    return services.get(id) ?? null
  }

  /**
   * List services matching selector
   */
  async listServices(selector: ServiceSelector): Promise<ServiceIdentity[]> {
    const results: ServiceIdentity[] = []

    for (const service of services.values()) {
      if (this.matchesSelector(service, selector)) {
        results.push(service)
      }
    }

    return results
  }

  /**
   * Check if a request is allowed by access policies
   */
  async checkAccess(
    source: ServiceIdentity,
    destination: ServiceIdentity,
    request: { method: string; path: string; headers: Record<string, string> },
  ): Promise<{ allowed: boolean; policy?: AccessPolicy }> {
    const applicablePolicies: AccessPolicy[] = []

    for (const policy of accessPolicies.values()) {
      if (
        this.matchesSelector(source, policy.source) &&
        this.matchesSelector(destination, policy.destination)
      ) {
        applicablePolicies.push(policy)
      }
    }

    // Sort by priority (higher priority first)
    applicablePolicies.sort((a, b) => b.priority - a.priority)

    for (const policy of applicablePolicies) {
      if (this.evaluateConditions(policy.conditions ?? [], request)) {
        return {
          allowed: policy.action === 'allow',
          policy,
        }
      }
    }

    // Default deny if no policies match
    return { allowed: false }
  }

  /**
   * Create an access policy
   */
  async createAccessPolicy(
    policy: Omit<AccessPolicy, 'id'>,
  ): Promise<AccessPolicy> {
    const id = `policy-${Date.now()}`
    const fullPolicy: AccessPolicy = { ...policy, id }
    accessPolicies.set(id, fullPolicy)
    return fullPolicy
  }

  /**
   * Create a traffic policy
   */
  async createTrafficPolicy(
    policy: Omit<TrafficPolicy, 'id'>,
  ): Promise<TrafficPolicy> {
    const id = `traffic-${Date.now()}`
    const fullPolicy: TrafficPolicy = { ...policy, id }
    trafficPolicies.set(id, fullPolicy)
    return fullPolicy
  }

  /**
   * Get traffic policy for a service
   */
  async getTrafficPolicy(
    service: ServiceIdentity,
  ): Promise<TrafficPolicy | null> {
    for (const policy of trafficPolicies.values()) {
      if (this.matchesSelector(service, policy.service)) {
        return policy
      }
    }
    return null
  }

  /**
   * Record request metrics
   */
  recordRequest(serviceId: string, success: boolean, latencyMs: number): void {
    const metrics = serviceMetrics.get(serviceId)
    if (!metrics) return

    metrics.requests.total++
    if (success) {
      metrics.requests.success++
    } else {
      metrics.requests.failure++
    }

    // Update latency (simple moving average)
    metrics.latency.p50 = metrics.latency.p50 * 0.9 + latencyMs * 0.1
    metrics.latency.p95 = Math.max(metrics.latency.p95, latencyMs)
  }

  /**
   * Get service metrics
   */
  getMetrics(serviceId: string): ServiceMetrics | null {
    return serviceMetrics.get(serviceId) ?? null
  }

  /**
   * Generate mTLS certificate for service
   */
  async generateCertificate(
    service: ServiceIdentity,
  ): Promise<{ cert: string; key: string }> {
    // In production, this would use a proper CA
    // For now, return a placeholder
    const certData = {
      subject: `CN=${service.name}.${service.namespace}.mesh.dws`,
      issuer: 'CN=DWS Mesh CA',
      notBefore: new Date().toISOString(),
      notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      publicKey: service.publicKey,
    }

    return {
      cert: `-----BEGIN CERTIFICATE-----\n${Buffer.from(JSON.stringify(certData)).toString('base64')}\n-----END CERTIFICATE-----`,
      key: `-----BEGIN PRIVATE KEY-----\nPLACEHOLDER\n-----END PRIVATE KEY-----`,
    }
  }

  /**
   * Verify a peer certificate
   */
  async verifyCertificate(
    cert: string,
    _expectedService?: ServiceSelector,
  ): Promise<{
    valid: boolean
    service?: ServiceIdentity
  }> {
    // Extract service identity from certificate
    // In production, verify against CA

    if (cert.includes('PLACEHOLDER')) {
      return { valid: true }
    }

    return { valid: false }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private generateServiceId(name: string, namespace: string): string {
    return keccak256(toBytes(`${namespace}/${name}`)).slice(0, 18)
  }

  private matchesSelector(
    service: ServiceIdentity,
    selector: ServiceSelector,
  ): boolean {
    if (selector.namespace && service.namespace !== selector.namespace) {
      return false
    }
    if (selector.name && service.name !== selector.name) {
      return false
    }
    if (selector.owner && service.owner !== selector.owner) {
      return false
    }
    if (selector.tags && selector.tags.length > 0) {
      if (!selector.tags.every((tag) => service.tags.includes(tag))) {
        return false
      }
    }
    return true
  }

  private evaluateConditions(
    conditions: PolicyCondition[],
    request: { method: string; path: string; headers: Record<string, string> },
  ): boolean {
    for (const condition of conditions) {
      if (!this.evaluateCondition(condition, request)) {
        return false
      }
    }
    return true
  }

  private evaluateCondition(
    condition: PolicyCondition,
    request: { method: string; path: string; headers: Record<string, string> },
  ): boolean {
    let value: string | undefined

    switch (condition.type) {
      case 'method':
        value = request.method
        break
      case 'path':
        value = request.path
        break
      case 'header':
        value = condition.key ? request.headers[condition.key] : undefined
        break
      default:
        return true
    }

    if (value === undefined) {
      return condition.operator !== 'exists'
    }

    switch (condition.operator) {
      case 'equals':
        return value === condition.value
      case 'contains':
        return condition.value ? value.includes(condition.value) : false
      case 'regex':
        return condition.value ? new RegExp(condition.value).test(value) : false
      case 'exists':
        return true
      default:
        return true
    }
  }
}

// ============================================================================
// Service Mesh Router
// ============================================================================

const accessPolicySchema = z.object({
  name: z.string(),
  source: z.object({
    namespace: z.string().optional(),
    name: z.string().optional(),
    tags: z.array(z.string()).optional(),
    owner: z.string().optional(),
  }),
  destination: z.object({
    namespace: z.string().optional(),
    name: z.string().optional(),
    tags: z.array(z.string()).optional(),
    owner: z.string().optional(),
  }),
  action: z.enum(['allow', 'deny']),
  conditions: z
    .array(
      z.object({
        type: z.enum(['header', 'path', 'method', 'time', 'rate']),
        key: z.string().optional(),
        operator: z.enum(['equals', 'contains', 'regex', 'exists']),
        value: z.string().optional(),
      }),
    )
    .optional(),
  priority: z.number().default(0),
})

const trafficPolicySchema = z.object({
  service: z.object({
    namespace: z.string().optional(),
    name: z.string().optional(),
  }),
  retries: z.object({
    maxRetries: z.number().default(3),
    retryOn: z.array(z.string()).default(['5xx']),
    backoffMs: z.number().default(100),
  }),
  timeout: z.object({
    requestMs: z.number().default(30000),
    idleMs: z.number().default(60000),
  }),
  circuitBreaker: z.object({
    maxFailures: z.number().default(5),
    windowMs: z.number().default(60000),
    cooldownMs: z.number().default(30000),
  }),
  rateLimit: z
    .object({
      requestsPerSecond: z.number(),
      burstSize: z.number(),
    })
    .optional(),
})

export function createServiceMeshRouter(mesh: ServiceMesh) {
  const registerServiceSchema = z.object({
    name: z.string(),
    namespace: z.string().default('default'),
    publicKey: z.string(),
    endpoints: z.array(z.string()),
    tags: z.array(z.string()).default([]),
  })

  return (
    new Elysia({ prefix: '/mesh' })
      // Health check
      .get('/health', () => ({ status: 'healthy', services: services.size }))

      // Register service
      .post('/services', async ({ body, request, set }) => {
        const validated = expectValid(
          registerServiceSchema,
          body,
          'Service registration body',
        )

        const owner = request.headers.get('x-jeju-address') as Address

        const service = await mesh.registerService({
          name: validated.name,
          namespace: validated.namespace,
          owner,
          publicKey: validated.publicKey as Hex,
          endpoints: validated.endpoints,
          tags: validated.tags,
        })

        set.status = 201
        return service
      })

      // Discover service
      .get('/services/:namespace/:name', async ({ params, set }) => {
        const service = await mesh.discoverService(
          params.name,
          params.namespace,
        )
        if (!service) {
          set.status = 404
          return { error: 'Service not found' }
        }

        return service
      })

      // List services
      .get('/services', async ({ query }) => {
        const namespace = query.namespace
        const tags = query.tags?.split(',')

        const serviceList = await mesh.listServices({
          namespace,
          tags,
        })

        return { services: serviceList }
      })

      // Create access policy
      .post('/policies/access', async ({ body, set }) => {
        const validated = expectValid(
          accessPolicySchema,
          body,
          'Access policy body',
        )
        const policy = await mesh.createAccessPolicy(
          validated as Omit<AccessPolicy, 'id'>,
        )
        set.status = 201
        return policy
      })

      // List access policies
      .get('/policies/access', () => ({
        policies: Array.from(accessPolicies.values()),
      }))

      // Create traffic policy
      .post('/policies/traffic', async ({ body, set }) => {
        const validated = expectValid(
          trafficPolicySchema,
          body,
          'Traffic policy body',
        )
        const policy = await mesh.createTrafficPolicy(
          validated as Omit<TrafficPolicy, 'id'>,
        )
        set.status = 201
        return policy
      })

      // Get metrics
      .get('/metrics/:serviceId', ({ params, set }) => {
        const metrics = mesh.getMetrics(params.serviceId)
        if (!metrics) {
          set.status = 404
          return { error: 'Service not found' }
        }
        return metrics
      })

      // Generate certificate
      .post('/certificates', async ({ body, set }) => {
        const validated = expectValid(
          z.object({ serviceId: z.string() }),
          body,
          'Certificate request body',
        )

        const service = services.get(validated.serviceId)
        if (!service) {
          set.status = 404
          return { error: 'Service not found' }
        }

        const cert = await mesh.generateCertificate(service)
        return cert
      })
  )
}

// ============================================================================
// Singleton
// ============================================================================

let meshInstance: ServiceMesh | null = null

export function getServiceMesh(): ServiceMesh {
  if (!meshInstance) {
    meshInstance = new ServiceMesh()
  }
  return meshInstance
}
