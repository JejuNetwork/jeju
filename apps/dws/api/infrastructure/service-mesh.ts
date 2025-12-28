import {
  createHash,
  createSign,
  createVerify,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto'
import type { Address } from 'viem'

export type ServiceStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown'

export type LoadBalanceStrategy =
  | 'round-robin'
  | 'least-connections'
  | 'random'
  | 'ip-hash'

export type CircuitState = 'closed' | 'open' | 'half-open'

export interface ServiceDefinition {
  serviceId: string
  name: string
  namespace: string
  endpoints: ServiceEndpoint[]

  // mTLS
  certificate: string
  privateKey: string
  caCertificate: string

  // Policies
  loadBalanceStrategy: LoadBalanceStrategy
  retryPolicy: RetryPolicy
  circuitBreaker: CircuitBreakerConfig
  rateLimit?: RateLimitConfig

  // Metadata
  owner: Address
  createdAt: number
  updatedAt: number
}

export interface ServiceEndpoint {
  endpointId: string
  address: string
  port: number
  weight: number
  status: ServiceStatus
  lastHealthCheck?: number
  activeConnections: number
  metadata: Record<string, string>
}

export interface RetryPolicy {
  maxRetries: number
  retryOn: string[] // e.g., ['5xx', 'reset', 'connect-failure']
  backoffMs: number
  maxBackoffMs: number
}

export interface CircuitBreakerConfig {
  threshold: number // Failure percentage to open
  volumeThreshold: number // Minimum requests before tripping
  sleepWindowMs: number // Time to wait before half-open
  requestTimeoutMs: number
}

export interface RateLimitConfig {
  requestsPerSecond: number
  burstSize: number
  perClient: boolean
}

export interface TrafficPolicy {
  policyId: string
  name: string
  sourceService: string
  destinationService: string
  rules: TrafficRule[]
  priority: number
  enabled: boolean
}

export interface AccessPolicy {
  policyId: string
  name: string
  namespace: string
  rules: Array<{
    action: 'allow' | 'deny'
    from: string[]
    to: string[]
    operations: string[]
  }>
  priority: number
  enabled: boolean
}

export interface ServiceIdentity {
  serviceId: string
  name: string
  namespace: string
  certificate: string
  publicKey: string
  owner: Address
  createdAt: number
}

export interface TrafficRule {
  match: {
    headers?: Record<string, string>
    methods?: string[]
    paths?: string[]
  }
  action: {
    type: 'allow' | 'deny' | 'ratelimit' | 'redirect'
    destination?: string
    rateLimit?: RateLimitConfig
  }
}

// ============================================================================
// Certificate Manager
// ============================================================================

class CertificateAuthority {
  private caCert: string
  private caKey: string
  private issuedCerts = new Map<
    string,
    { cert: string; key: string; expiresAt: number }
  >()

  constructor() {
    // Generate CA certificate (in production, load from secure storage)
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })

    this.caKey = privateKey
    this.caCert = this.generateSelfSignedCert(
      'DWS Service Mesh CA',
      publicKey,
      privateKey,
    )
  }

  private generateSelfSignedCert(
    cn: string,
    publicKey: string,
    privateKey: string,
  ): string {
    // Simplified self-signed certificate generation
    // In production, use a proper X.509 library
    const cert = {
      subject: { CN: cn },
      issuer: { CN: cn },
      notBefore: new Date(),
      notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      publicKey,
      serialNumber: randomBytes(16).toString('hex'),
    }

    // Sign the certificate
    const sign = createSign('SHA256')
    sign.update(JSON.stringify(cert))
    const signature = sign.sign(privateKey, 'base64')

    return `-----BEGIN CERTIFICATE-----\n${Buffer.from(JSON.stringify({ ...cert, signature })).toString('base64')}\n-----END CERTIFICATE-----`
  }

  issueCertificate(
    serviceId: string,
    serviceName: string,
  ): { cert: string; key: string } {
    // Check for existing valid certificate
    const existing = this.issuedCerts.get(serviceId)
    if (existing && existing.expiresAt > Date.now()) {
      return { cert: existing.cert, key: existing.key }
    }

    // Generate new key pair for service
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })

    // Create certificate signed by CA
    const cert = {
      subject: { CN: serviceName, serviceId },
      issuer: { CN: 'DWS Service Mesh CA' },
      notBefore: new Date(),
      notAfter: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      publicKey,
      serialNumber: randomBytes(16).toString('hex'),
      extensions: {
        keyUsage: ['digitalSignature', 'keyEncipherment'],
        extKeyUsage: ['serverAuth', 'clientAuth'],
        san: [`service:${serviceId}`, `dns:${serviceName}.mesh.local`],
      },
    }

    const sign = createSign('SHA256')
    sign.update(JSON.stringify(cert))
    const signature = sign.sign(this.caKey, 'base64')

    const certPem = `-----BEGIN CERTIFICATE-----\n${Buffer.from(JSON.stringify({ ...cert, signature })).toString('base64')}\n-----END CERTIFICATE-----`

    this.issuedCerts.set(serviceId, {
      cert: certPem,
      key: privateKey,
      expiresAt: cert.notAfter.getTime(),
    })

    return { cert: certPem, key: privateKey }
  }

  getCACertificate(): string {
    return this.caCert
  }

  verifyCertificate(cert: string, serviceId: string): boolean {
    try {
      // Parse certificate
      const certData = cert
        .replace(/-----BEGIN CERTIFICATE-----/, '')
        .replace(/-----END CERTIFICATE-----/, '')
        .trim()

      const parsed = JSON.parse(Buffer.from(certData, 'base64').toString())

      // Check expiration
      if (new Date(parsed.notAfter) < new Date()) {
        return false
      }

      // Verify serviceId matches
      if (parsed.subject?.serviceId !== serviceId) {
        return false
      }

      // Verify signature
      const verify = createVerify('SHA256')
      const { signature, ...certWithoutSig } = parsed
      verify.update(JSON.stringify(certWithoutSig))

      return verify.verify(this.caCert, signature, 'base64')
    } catch {
      return false
    }
  }
}

// ============================================================================
// Circuit Breaker
// ============================================================================

class CircuitBreaker {
  private state: CircuitState = 'closed'
  private failureCount = 0
  private successCount = 0
  private lastFailureTime = 0
  private requestCount = 0
  private config: CircuitBreakerConfig

  constructor(config: CircuitBreakerConfig) {
    this.config = config
  }

  canExecute(): boolean {
    if (this.state === 'closed') return true

    if (this.state === 'open') {
      // Check if sleep window has passed
      if (Date.now() - this.lastFailureTime >= this.config.sleepWindowMs) {
        this.state = 'half-open'
        return true
      }
      return false
    }

    // Half-open: allow one request through
    return true
  }

  recordSuccess(): void {
    this.requestCount++

    if (this.state === 'half-open') {
      this.successCount++
      if (this.successCount >= 3) {
        this.reset()
      }
    }
  }

  recordFailure(): void {
    this.requestCount++
    this.failureCount++
    this.lastFailureTime = Date.now()

    if (this.state === 'half-open') {
      this.trip()
      return
    }

    // Check if we should trip
    if (this.requestCount >= this.config.volumeThreshold) {
      const failureRate = this.failureCount / this.requestCount
      if (failureRate >= this.config.threshold / 100) {
        this.trip()
      }
    }
  }

  private trip(): void {
    this.state = 'open'
    console.log('[CircuitBreaker] Tripped to OPEN state')
  }

  private reset(): void {
    this.state = 'closed'
    this.failureCount = 0
    this.successCount = 0
    this.requestCount = 0
    console.log('[CircuitBreaker] Reset to CLOSED state')
  }

  getState(): CircuitState {
    return this.state
  }
}

// ============================================================================
// Rate Limiter
// ============================================================================

class RateLimiter {
  private tokens: number
  private lastRefill: number
  private config: RateLimitConfig

  constructor(config: RateLimitConfig) {
    this.config = config
    this.tokens = config.burstSize
    this.lastRefill = Date.now()
  }

  allow(): boolean {
    this.refill()

    if (this.tokens >= 1) {
      this.tokens--
      return true
    }

    return false
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    const tokensToAdd = (elapsed / 1000) * this.config.requestsPerSecond

    this.tokens = Math.min(this.config.burstSize, this.tokens + tokensToAdd)
    this.lastRefill = now
  }
}

// ============================================================================
// Service Mesh
// ============================================================================

export class ServiceMesh {
  private services = new Map<string, ServiceDefinition>()
  private servicesByName = new Map<string, string>() // name -> serviceId
  private circuitBreakers = new Map<string, CircuitBreaker>() // endpointId -> breaker
  private rateLimiters = new Map<string, RateLimiter>() // serviceId -> limiter
  private trafficPolicies = new Map<string, TrafficPolicy>()
  private roundRobinCounters = new Map<string, number>()

  private ca: CertificateAuthority
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.ca = new CertificateAuthority()
  }

  // =========================================================================
  // Service Registration
  // =========================================================================

  registerService(
    owner: Address,
    name: string,
    namespace: string,
    endpoints: Array<{ address: string; port: number; weight?: number }>,
    config: {
      loadBalanceStrategy?: LoadBalanceStrategy
      retryPolicy?: Partial<RetryPolicy>
      circuitBreaker?: Partial<CircuitBreakerConfig>
      rateLimit?: RateLimitConfig
    } = {},
  ): ServiceDefinition {
    const serviceId = createHash('sha256')
      .update(`${namespace}/${name}`)
      .digest('hex')
      .slice(0, 16)

    // Issue mTLS certificate
    const { cert, key } = this.ca.issueCertificate(serviceId, name)

    const service: ServiceDefinition = {
      serviceId,
      name,
      namespace,
      endpoints: endpoints.map((ep, i) => ({
        endpointId: `${serviceId}-${i}`,
        address: ep.address,
        port: ep.port,
        weight: ep.weight ?? 1,
        status: 'unknown',
        activeConnections: 0,
        metadata: {},
      })),
      certificate: cert,
      privateKey: key,
      caCertificate: this.ca.getCACertificate(),
      loadBalanceStrategy: config.loadBalanceStrategy ?? 'round-robin',
      retryPolicy: {
        maxRetries: config.retryPolicy?.maxRetries ?? 3,
        retryOn: config.retryPolicy?.retryOn ?? [
          '5xx',
          'reset',
          'connect-failure',
        ],
        backoffMs: config.retryPolicy?.backoffMs ?? 100,
        maxBackoffMs: config.retryPolicy?.maxBackoffMs ?? 5000,
      },
      circuitBreaker: {
        threshold: config.circuitBreaker?.threshold ?? 50,
        volumeThreshold: config.circuitBreaker?.volumeThreshold ?? 10,
        sleepWindowMs: config.circuitBreaker?.sleepWindowMs ?? 30000,
        requestTimeoutMs: config.circuitBreaker?.requestTimeoutMs ?? 10000,
      },
      rateLimit: config.rateLimit,
      owner,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.services.set(serviceId, service)
    this.servicesByName.set(`${namespace}/${name}`, serviceId)

    // Initialize circuit breakers for each endpoint
    for (const endpoint of service.endpoints) {
      this.circuitBreakers.set(
        endpoint.endpointId,
        new CircuitBreaker(service.circuitBreaker),
      )
    }

    // Initialize rate limiter if configured
    if (config.rateLimit) {
      this.rateLimiters.set(serviceId, new RateLimiter(config.rateLimit))
    }

    console.log(
      `[ServiceMesh] Registered service ${namespace}/${name} with ${endpoints.length} endpoints`,
    )

    return service
  }

  updateEndpoints(
    serviceId: string,
    endpoints: Array<{ address: string; port: number; weight?: number }>,
  ): void {
    const service = this.services.get(serviceId)
    if (!service) throw new Error(`Service not found: ${serviceId}`)

    // Remove old circuit breakers
    for (const ep of service.endpoints) {
      this.circuitBreakers.delete(ep.endpointId)
    }

    // Update endpoints
    service.endpoints = endpoints.map((ep, i) => ({
      endpointId: `${serviceId}-${i}`,
      address: ep.address,
      port: ep.port,
      weight: ep.weight ?? 1,
      status: 'unknown',
      activeConnections: 0,
      metadata: {},
    }))

    // Create new circuit breakers
    for (const endpoint of service.endpoints) {
      this.circuitBreakers.set(
        endpoint.endpointId,
        new CircuitBreaker(service.circuitBreaker),
      )
    }

    service.updatedAt = Date.now()
  }

  deregisterService(serviceId: string): void {
    const service = this.services.get(serviceId)
    if (!service) return

    // Cleanup
    for (const ep of service.endpoints) {
      this.circuitBreakers.delete(ep.endpointId)
    }
    this.rateLimiters.delete(serviceId)
    this.servicesByName.delete(`${service.namespace}/${service.name}`)
    this.services.delete(serviceId)

    console.log(
      `[ServiceMesh] Deregistered service ${service.namespace}/${service.name}`,
    )
  }

  // =========================================================================
  // Service Discovery & Load Balancing
  // =========================================================================

  resolveService(name: string, namespace = 'default'): ServiceEndpoint | null {
    const serviceId = this.servicesByName.get(`${namespace}/${name}`)
    if (!serviceId) return null

    const service = this.services.get(serviceId)
    if (!service) return null

    // Rate limiting
    const limiter = this.rateLimiters.get(serviceId)
    if (limiter && !limiter.allow()) {
      console.log(`[ServiceMesh] Rate limited request to ${name}`)
      return null
    }

    // Filter healthy endpoints with open circuit breakers
    const healthyEndpoints = service.endpoints.filter((ep) => {
      if (ep.status === 'unhealthy') return false
      const breaker = this.circuitBreakers.get(ep.endpointId)
      return breaker?.canExecute() ?? true
    })

    if (healthyEndpoints.length === 0) {
      console.log(`[ServiceMesh] No healthy endpoints for ${name}`)
      return null
    }

    // Load balance
    const endpoint = this.selectEndpoint(
      serviceId,
      healthyEndpoints,
      service.loadBalanceStrategy,
    )

    return endpoint
  }

  private selectEndpoint(
    serviceId: string,
    endpoints: ServiceEndpoint[],
    strategy: LoadBalanceStrategy,
  ): ServiceEndpoint {
    switch (strategy) {
      case 'round-robin': {
        const counter = this.roundRobinCounters.get(serviceId) ?? 0
        const endpoint = endpoints[counter % endpoints.length]
        this.roundRobinCounters.set(serviceId, counter + 1)
        return endpoint
      }

      case 'least-connections': {
        return endpoints.reduce((min, ep) =>
          ep.activeConnections < min.activeConnections ? ep : min,
        )
      }

      case 'random': {
        return endpoints[Math.floor(Math.random() * endpoints.length)]
      }

      case 'ip-hash': {
        // Would hash client IP
        return endpoints[0]
      }

      default:
        return endpoints[0]
    }
  }

  // =========================================================================
  // Request Handling
  // =========================================================================

  async proxyRequest(
    serviceName: string,
    namespace: string,
    request: Request,
    sourceCert?: string,
  ): Promise<Response> {
    // Verify source certificate
    if (sourceCert) {
      const sourceServiceId = this.extractServiceId(sourceCert)
      if (
        sourceServiceId &&
        !this.ca.verifyCertificate(sourceCert, sourceServiceId)
      ) {
        return new Response('Unauthorized', { status: 401 })
      }
    }

    const service = this.getServiceByName(serviceName, namespace)
    if (!service) {
      return new Response('Service not found', { status: 503 })
    }

    const retryPolicy = service.retryPolicy
    let lastError: Error | null = null
    let backoffMs = retryPolicy.backoffMs

    for (let attempt = 0; attempt <= retryPolicy.maxRetries; attempt++) {
      const endpoint = this.resolveService(serviceName, namespace)
      if (!endpoint) {
        await this.sleep(backoffMs)
        backoffMs = Math.min(backoffMs * 2, retryPolicy.maxBackoffMs)
        continue
      }

      const breaker = this.circuitBreakers.get(endpoint.endpointId)

      try {
        endpoint.activeConnections++

        const targetUrl = `https://${endpoint.address}:${endpoint.port}${new URL(request.url).pathname}`

        const response = await Promise.race([
          fetch(targetUrl, {
            method: request.method,
            headers: request.headers,
            body: request.body,
          }),
          this.timeout(service.circuitBreaker.requestTimeoutMs),
        ])

        endpoint.activeConnections--

        if (response.ok) {
          breaker?.recordSuccess()
          return response
        }

        // Check if we should retry on this status
        const status = `${Math.floor(response.status / 100)}xx`
        if (retryPolicy.retryOn.includes(status)) {
          breaker?.recordFailure()
          lastError = new Error(`HTTP ${response.status}`)
          await this.sleep(backoffMs)
          backoffMs = Math.min(backoffMs * 2, retryPolicy.maxBackoffMs)
          continue
        }

        breaker?.recordSuccess()
        return response
      } catch (error) {
        endpoint.activeConnections--
        breaker?.recordFailure()
        lastError = error instanceof Error ? error : new Error(String(error))

        if (retryPolicy.retryOn.includes('connect-failure')) {
          await this.sleep(backoffMs)
          backoffMs = Math.min(backoffMs * 2, retryPolicy.maxBackoffMs)
          continue
        }

        throw error
      }
    }

    console.error(
      `[ServiceMesh] All retries failed for ${serviceName}:`,
      lastError,
    )
    return new Response('Service unavailable', { status: 503 })
  }

  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), ms)
    })
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private extractServiceId(cert: string): string | null {
    try {
      const certData = cert
        .replace(/-----BEGIN CERTIFICATE-----/, '')
        .replace(/-----END CERTIFICATE-----/, '')
        .trim()
      const parsed = JSON.parse(Buffer.from(certData, 'base64').toString())
      return parsed.subject?.serviceId ?? null
    } catch {
      return null
    }
  }

  // =========================================================================
  // Traffic Policies
  // =========================================================================

  addTrafficPolicy(policy: Omit<TrafficPolicy, 'policyId'>): TrafficPolicy {
    const policyId = createHash('sha256')
      .update(
        `${policy.sourceService}-${policy.destinationService}-${Date.now()}`,
      )
      .digest('hex')
      .slice(0, 16)

    const fullPolicy: TrafficPolicy = { ...policy, policyId }
    this.trafficPolicies.set(policyId, fullPolicy)

    return fullPolicy
  }

  removeTrafficPolicy(policyId: string): void {
    this.trafficPolicies.delete(policyId)
  }

  // =========================================================================
  // Health Checks
  // =========================================================================

  startHealthChecks(intervalMs = 10000): void {
    if (this.healthCheckInterval) return

    this.healthCheckInterval = setInterval(() => {
      this.runHealthChecks().catch(console.error)
    }, intervalMs)
  }

  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
  }

  private async runHealthChecks(): Promise<void> {
    for (const service of this.services.values()) {
      for (const endpoint of service.endpoints) {
        try {
          const response = await fetch(
            `https://${endpoint.address}:${endpoint.port}/health`,
            {
              method: 'GET',
              signal: AbortSignal.timeout(5000),
            },
          )

          endpoint.status = response.ok ? 'healthy' : 'degraded'
        } catch {
          endpoint.status = 'unhealthy'
        }

        endpoint.lastHealthCheck = Date.now()
      }
    }
  }

  // =========================================================================
  // Queries
  // =========================================================================

  getService(serviceId: string): ServiceDefinition | undefined {
    return this.services.get(serviceId)
  }

  getServiceByName(
    name: string,
    namespace = 'default',
  ): ServiceDefinition | undefined {
    const serviceId = this.servicesByName.get(`${namespace}/${name}`)
    return serviceId ? this.services.get(serviceId) : undefined
  }

  listServices(namespace?: string): ServiceDefinition[] {
    const services = Array.from(this.services.values())
    return namespace
      ? services.filter((s) => s.namespace === namespace)
      : services
  }

  getEndpointHealth(
    serviceId: string,
  ): Array<{ endpoint: ServiceEndpoint; circuitState: CircuitState }> {
    const service = this.services.get(serviceId)
    if (!service) return []

    return service.endpoints.map((ep) => ({
      endpoint: ep,
      circuitState:
        this.circuitBreakers.get(ep.endpointId)?.getState() ?? 'closed',
    }))
  }
}

// ============================================================================
// Factory
// ============================================================================

let serviceMesh: ServiceMesh | null = null

export function getServiceMesh(): ServiceMesh {
  if (!serviceMesh) {
    serviceMesh = new ServiceMesh()
    serviceMesh.startHealthChecks()
  }
  return serviceMesh
}

// ============================================================================
// Elysia Router
// ============================================================================

import { Elysia } from 'elysia'

export function createServiceMeshRouter(mesh: ServiceMesh) {
  return new Elysia({ prefix: '/mesh' })
    .get('/services', () => {
      return { services: mesh.listServices() }
    })
    .get('/services/by-namespace/:namespace', ({ params }) => {
      return { services: mesh.listServices(params.namespace) }
    })
    .get('/services/by-name/:namespace/:name', ({ params }) => {
      const service = mesh.getServiceByName(params.name, params.namespace)
      if (!service) {
        return { error: 'Service not found' }
      }
      return { service }
    })
    .get('/services/health/:serviceId', ({ params }) => {
      return { endpoints: mesh.getEndpointHealth(params.serviceId) }
    })
    .get('/services/detail/:serviceId', ({ params }) => {
      const service = mesh.getService(params.serviceId)
      if (!service) {
        return { error: 'Service not found' }
      }
      return { service }
    })
    .post('/services', async ({ body }) => {
      const { name, namespace, owner, endpoints } = body as {
        name: string
        namespace?: string
        owner: Address
        endpoints: Array<{ address: string; port: number }>
      }

      const result = await mesh.registerService(
        owner,
        name,
        namespace ?? 'default',
        endpoints,
        {}, // Use default config
      )

      return { service: result }
    })
    .delete('/services/:serviceId', async ({ params }) => {
      await mesh.deregisterService(params.serviceId)
      return { success: true }
    })
}
