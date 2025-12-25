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

import { generateKeyPairSync, X509Certificate } from 'node:crypto'
import { Elysia, t } from 'elysia'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes } from 'viem'

// Types

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

// Certificate Authority
interface CACredentials {
  cert: string
  key: string
  publicKey: string
}

let caCredentials: CACredentials | null = null

function getOrCreateCA(): CACredentials {
  if (caCredentials) return caCredentials

  // Check if CA is provided via environment
  if (process.env.DWS_MESH_CA_CERT && process.env.DWS_MESH_CA_KEY) {
    caCredentials = {
      cert: process.env.DWS_MESH_CA_CERT,
      key: process.env.DWS_MESH_CA_KEY,
      publicKey: '',
    }
    // Extract public key from cert
    const caCert = new X509Certificate(caCredentials.cert)
    caCredentials.publicKey = caCert.publicKey.export({
      type: 'spki',
      format: 'pem',
    }) as string
    console.log('[ServiceMesh] Using provided CA certificate')
    return caCredentials
  }

  // Generate a new CA for this mesh instance
  console.log('[ServiceMesh] Generating new CA certificate')
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  })

  const now = new Date()
  const _notAfter = new Date(now.getTime() + 10 * 365 * 24 * 60 * 60 * 1000) // 10 years

  // Self-signed CA certificate using node:crypto
  // Build certificate manually since node:crypto doesn't have a high-level API
  const caPrivateKeyPem = privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  }) as string
  const caPublicKeyPem = publicKey.export({
    type: 'spki',
    format: 'pem',
  }) as string

  // Use Bun's native crypto for certificate generation
  const caCertPem = generateSelfSignedCert({
    commonName: 'DWS Mesh CA',
    isCA: true,
    privateKey: caPrivateKeyPem,
    publicKey: caPublicKeyPem,
    validDays: 3650,
  })

  caCredentials = {
    cert: caCertPem,
    key: caPrivateKeyPem,
    publicKey: caPublicKeyPem,
  }

  return caCredentials
}

function generateSelfSignedCert(options: {
  commonName: string
  isCA: boolean
  privateKey: string
  publicKey: string
  validDays: number
  issuerCert?: string
  issuerKey?: string
}): string {
  // Use openssl-like certificate generation via Bun subprocess
  // For production, use the @peculiar/x509 library or similar
  const { spawnSync } = require('node:child_process')

  const subject = `/CN=${options.commonName}`
  const now = new Date()
  const _notAfter = new Date(
    now.getTime() + options.validDays * 24 * 60 * 60 * 1000,
  )

  // Create temp files for openssl
  const tmpDir = require('node:os').tmpdir()
  const keyPath = `${tmpDir}/mesh-key-${Date.now()}.pem`
  const certPath = `${tmpDir}/mesh-cert-${Date.now()}.pem`
  const csrPath = `${tmpDir}/mesh-csr-${Date.now()}.pem`

  require('node:fs').writeFileSync(keyPath, options.privateKey)

  // Generate CSR
  const csrResult = spawnSync(
    'openssl',
    ['req', '-new', '-key', keyPath, '-subj', subject, '-out', csrPath],
    { encoding: 'utf-8' },
  )

  if (csrResult.status !== 0) {
    throw new Error(`Failed to generate CSR: ${csrResult.stderr}`)
  }

  // Self-sign or sign with CA
  const signArgs = options.isCA
    ? [
        'x509',
        '-req',
        '-in',
        csrPath,
        '-signkey',
        keyPath,
        '-out',
        certPath,
        '-days',
        String(options.validDays),
        '-extfile',
        '/dev/stdin',
      ]
    : [
        'x509',
        '-req',
        '-in',
        csrPath,
        '-CA',
        `${tmpDir}/ca-cert.pem`,
        '-CAkey',
        `${tmpDir}/ca-key.pem`,
        '-CAcreateserial',
        '-out',
        certPath,
        '-days',
        String(options.validDays),
      ]

  const extConfig = options.isCA
    ? 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign'
    : 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth,clientAuth'

  const signResult = spawnSync('openssl', signArgs, {
    input: extConfig,
    encoding: 'utf-8',
  })

  if (signResult.status !== 0) {
    throw new Error(`Failed to sign certificate: ${signResult.stderr}`)
  }

  const cert = require('node:fs').readFileSync(certPath, 'utf-8')

  // Cleanup temp files
  require('node:fs').unlinkSync(keyPath)
  require('node:fs').unlinkSync(csrPath)
  require('node:fs').unlinkSync(certPath)

  return cert
}

const services = new Map<string, ServiceIdentity>()
const accessPolicies = new Map<string, AccessPolicy>()
const trafficPolicies = new Map<string, TrafficPolicy>()
const serviceMetrics = new Map<string, ServiceMetrics>()
const serviceCertificates = new Map<
  string,
  { cert: string; key: string; expiresAt: number }
>()

export class ServiceMesh {
  selfIdentity: ServiceIdentity | null = null

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
    // Check cache for valid certificate
    const cached = serviceCertificates.get(service.id)
    if (cached && cached.expiresAt > Date.now() + 24 * 60 * 60 * 1000) {
      return { cert: cached.cert, key: cached.key }
    }

    // Get or create CA
    const ca = getOrCreateCA()

    // Generate key pair for service
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    })

    const servicePrivateKeyPem = privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string
    const _servicePublicKeyPem = publicKey.export({
      type: 'spki',
      format: 'pem',
    }) as string

    // Generate certificate signed by CA
    const commonName = `${service.name}.${service.namespace}.mesh.dws`
    const validDays = 365

    const { spawnSync } = require('node:child_process')
    const fs = require('node:fs')
    const tmpDir = require('node:os').tmpdir()
    const timestamp = Date.now()

    // Write CA cert and key to temp files
    const caCertPath = `${tmpDir}/ca-cert-${timestamp}.pem`
    const caKeyPath = `${tmpDir}/ca-key-${timestamp}.pem`
    const serviceKeyPath = `${tmpDir}/svc-key-${timestamp}.pem`
    const csrPath = `${tmpDir}/svc-csr-${timestamp}.pem`
    const certPath = `${tmpDir}/svc-cert-${timestamp}.pem`
    const extPath = `${tmpDir}/svc-ext-${timestamp}.cnf`

    fs.writeFileSync(caCertPath, ca.cert)
    fs.writeFileSync(caKeyPath, ca.key)
    fs.writeFileSync(serviceKeyPath, servicePrivateKeyPem)

    // Generate CSR
    const csrResult = spawnSync(
      'openssl',
      [
        'req',
        '-new',
        '-key',
        serviceKeyPath,
        '-subj',
        `/CN=${commonName}`,
        '-out',
        csrPath,
      ],
      { encoding: 'utf-8' },
    )

    if (csrResult.status !== 0) {
      throw new Error(`Failed to generate CSR: ${csrResult.stderr}`)
    }

    // Create extensions file for SAN
    const extConfig = `
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth,clientAuth
subjectAltName=DNS:${commonName},DNS:${service.name}.${service.namespace},DNS:${service.name}
`
    fs.writeFileSync(extPath, extConfig)

    // Sign with CA
    const signResult = spawnSync(
      'openssl',
      [
        'x509',
        '-req',
        '-in',
        csrPath,
        '-CA',
        caCertPath,
        '-CAkey',
        caKeyPath,
        '-CAcreateserial',
        '-out',
        certPath,
        '-days',
        String(validDays),
        '-extfile',
        extPath,
      ],
      { encoding: 'utf-8' },
    )

    if (signResult.status !== 0) {
      throw new Error(`Failed to sign certificate: ${signResult.stderr}`)
    }

    const cert = fs.readFileSync(certPath, 'utf-8')

    // Cleanup temp files
    fs.unlinkSync(caCertPath)
    fs.unlinkSync(caKeyPath)
    fs.unlinkSync(serviceKeyPath)
    fs.unlinkSync(csrPath)
    fs.unlinkSync(certPath)
    fs.unlinkSync(extPath)
    // CA serial file
    try {
      fs.unlinkSync(`${tmpDir}/ca-cert-${timestamp}.srl`)
    } catch {
      // Ignore if doesn't exist
    }

    // Cache the certificate
    const expiresAt = Date.now() + validDays * 24 * 60 * 60 * 1000
    serviceCertificates.set(service.id, {
      cert,
      key: servicePrivateKeyPem,
      expiresAt,
    })

    console.log(`[ServiceMesh] Generated certificate for ${commonName}`)
    return { cert, key: servicePrivateKeyPem }
  }

  /**
   * Verify a peer certificate
   */
  async verifyCertificate(
    cert: string,
    expectedService?: ServiceSelector,
  ): Promise<{
    valid: boolean
    service?: ServiceIdentity
  }> {
    const ca = getOrCreateCA()

    // Parse and verify the certificate
    let x509: X509Certificate
    try {
      x509 = new X509Certificate(cert)
    } catch {
      return { valid: false }
    }

    // Verify against CA
    const caCert = new X509Certificate(ca.cert)
    if (!x509.verify(caCert.publicKey)) {
      console.warn(
        '[ServiceMesh] Certificate verification failed: invalid CA signature',
      )
      return { valid: false }
    }

    // Check expiration
    const now = new Date()
    if (new Date(x509.validTo) < now) {
      console.warn('[ServiceMesh] Certificate verification failed: expired')
      return { valid: false }
    }
    if (new Date(x509.validFrom) > now) {
      console.warn(
        '[ServiceMesh] Certificate verification failed: not yet valid',
      )
      return { valid: false }
    }

    // Extract service identity from CN
    const cnMatch = x509.subject.match(/CN=([^,]+)/)
    if (!cnMatch) {
      return { valid: false }
    }

    const cn = cnMatch[1]
    const parts = cn.split('.')
    if (parts.length < 4 || parts[parts.length - 1] !== 'dws') {
      return { valid: false }
    }

    const serviceName = parts[0]
    const namespace = parts[1]

    // Find the service
    const service = await this.discoverService(serviceName, namespace)
    if (!service) {
      return { valid: true } // Certificate is valid but service not registered
    }

    // Check if matches expected service
    if (expectedService) {
      if (!this.matchesSelector(service, expectedService)) {
        console.warn(
          '[ServiceMesh] Certificate verification failed: service mismatch',
        )
        return { valid: false }
      }
    }

    return { valid: true, service }
  }

  /**
   * Get the CA certificate (for trust anchoring)
   */
  getCACertificate(): string {
    const ca = getOrCreateCA()
    return ca.cert
  }

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

// Service Mesh Router

const ServiceSelectorSchema = t.Object({
  namespace: t.Optional(t.String()),
  name: t.Optional(t.String()),
  tags: t.Optional(t.Array(t.String())),
  owner: t.Optional(t.String()),
})

const AccessPolicyBody = t.Object({
  name: t.String(),
  source: ServiceSelectorSchema,
  destination: ServiceSelectorSchema,
  action: t.Union([t.Literal('allow'), t.Literal('deny')]),
  conditions: t.Optional(
    t.Array(
      t.Object({
        type: t.Union([
          t.Literal('header'),
          t.Literal('path'),
          t.Literal('method'),
          t.Literal('time'),
          t.Literal('rate'),
        ]),
        key: t.Optional(t.String()),
        operator: t.Union([
          t.Literal('equals'),
          t.Literal('contains'),
          t.Literal('regex'),
          t.Literal('exists'),
        ]),
        value: t.Optional(t.String()),
      }),
    ),
  ),
  priority: t.Optional(t.Number({ default: 0 })),
})

const TrafficPolicyBody = t.Object({
  service: t.Object({
    namespace: t.Optional(t.String()),
    name: t.Optional(t.String()),
  }),
  retries: t.Object({
    maxRetries: t.Optional(t.Number({ default: 3 })),
    retryOn: t.Optional(t.Array(t.String())),
    backoffMs: t.Optional(t.Number({ default: 100 })),
  }),
  timeout: t.Object({
    requestMs: t.Optional(t.Number({ default: 30000 })),
    idleMs: t.Optional(t.Number({ default: 60000 })),
  }),
  circuitBreaker: t.Object({
    maxFailures: t.Optional(t.Number({ default: 5 })),
    windowMs: t.Optional(t.Number({ default: 60000 })),
    cooldownMs: t.Optional(t.Number({ default: 30000 })),
  }),
  rateLimit: t.Optional(
    t.Object({
      requestsPerSecond: t.Number(),
      burstSize: t.Number(),
    }),
  ),
})

const RegisterServiceBody = t.Object({
  name: t.String(),
  namespace: t.Optional(t.String()),
  publicKey: t.String(),
  endpoints: t.Array(t.String()),
  tags: t.Optional(t.Array(t.String())),
})

export function createServiceMeshRouter(mesh: ServiceMesh) {
  return new Elysia({ prefix: '' })
    .get('/health', () => ({ status: 'healthy', services: services.size }))
    .get('/ca', () => ({ cert: mesh.getCACertificate() }))
    .post(
      '/services',
      async ({ body, headers, set }) => {
        const owner = headers['x-jeju-address'] as Address

        const service = await mesh.registerService({
          name: body.name,
          namespace: body.namespace ?? 'default',
          owner,
          publicKey: body.publicKey as Hex,
          endpoints: body.endpoints,
          tags: body.tags ?? [],
        })

        set.status = 201
        return service
      },
      { body: RegisterServiceBody },
    )
    .get(
      '/services/:namespace/:name',
      async ({ params, set }) => {
        const service = await mesh.discoverService(
          params.name,
          params.namespace,
        )
        if (!service) {
          set.status = 404
          return { error: 'Service not found' }
        }
        return service
      },
      { params: t.Object({ namespace: t.String(), name: t.String() }) },
    )
    .get('/services', async ({ query }) => {
      const namespace = query.namespace
      const tags = query.tags?.split(',')

      const serviceList = await mesh.listServices({
        namespace,
        tags,
      })

      return { services: serviceList }
    })
    .post(
      '/policies/access',
      async ({ body, set }) => {
        const policy = await mesh.createAccessPolicy({
          name: body.name,
          source: body.source as ServiceSelector,
          destination: body.destination as ServiceSelector,
          action: body.action,
          conditions: body.conditions as PolicyCondition[] | undefined,
          priority: body.priority ?? 0,
        })
        set.status = 201
        return policy
      },
      { body: AccessPolicyBody },
    )
    .get('/policies/access', () => ({
      policies: Array.from(accessPolicies.values()),
    }))
    .post(
      '/policies/traffic',
      async ({ body, set }) => {
        const policy = await mesh.createTrafficPolicy({
          service: body.service,
          retries: {
            maxRetries: body.retries.maxRetries ?? 3,
            retryOn: body.retries.retryOn ?? ['5xx'],
            backoffMs: body.retries.backoffMs ?? 100,
          },
          timeout: {
            requestMs: body.timeout.requestMs ?? 30000,
            idleMs: body.timeout.idleMs ?? 60000,
          },
          circuitBreaker: {
            maxFailures: body.circuitBreaker.maxFailures ?? 5,
            windowMs: body.circuitBreaker.windowMs ?? 60000,
            cooldownMs: body.circuitBreaker.cooldownMs ?? 30000,
          },
          rateLimit: body.rateLimit,
        })
        set.status = 201
        return policy
      },
      { body: TrafficPolicyBody },
    )
    .get(
      '/metrics/:serviceId',
      ({ params, set }) => {
        const metrics = mesh.getMetrics(params.serviceId)
        if (!metrics) {
          set.status = 404
          return { error: 'Service not found' }
        }
        return metrics
      },
      { params: t.Object({ serviceId: t.String() }) },
    )
    .post(
      '/certificates',
      async ({ body, set }) => {
        const service = services.get(body.serviceId)
        if (!service) {
          set.status = 404
          return { error: 'Service not found' }
        }
        const cert = await mesh.generateCertificate(service)
        return cert
      },
      { body: t.Object({ serviceId: t.String() }) },
    )
    .post(
      '/certificates/verify',
      async ({ body }) => {
        const result = await mesh.verifyCertificate(
          body.cert,
          body.expectedService,
        )
        return result
      },
      {
        body: t.Object({
          cert: t.String(),
          expectedService: t.Optional(ServiceSelectorSchema),
        }),
      },
    )
}

let meshInstance: ServiceMesh | null = null

export function getServiceMesh(): ServiceMesh {
  if (!meshInstance) {
    meshInstance = new ServiceMesh()
  }
  return meshInstance
}
