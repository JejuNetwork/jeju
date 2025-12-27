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
 * Certificate operations performed via DWS exec API.
 */

import { Elysia, t } from 'elysia'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes } from 'viem'

// Config injected at startup
export interface ServiceMeshConfig {
  execUrl: string
  caProvided?: { cert: string; key: string }
}

let meshConfig: ServiceMeshConfig = {
  execUrl: 'http://localhost:4020/exec',
}

export function configureServiceMesh(c: Partial<ServiceMeshConfig>): void {
  meshConfig = { ...meshConfig, ...c }
}

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

// DWS Exec API

interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

async function exec(
  command: string[],
  options?: { stdin?: string },
): Promise<ExecResult> {
  const response = await fetch(meshConfig.execUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, ...options }),
  })
  if (!response.ok) {
    throw new Error(`Exec API error: ${response.status}`)
  }
  return response.json() as Promise<ExecResult>
}

// Certificate Authority

interface CACredentials {
  cert: string
  key: string
}

let caCredentials: CACredentials | null = null

async function getOrCreateCA(): Promise<CACredentials> {
  if (caCredentials) return caCredentials

  // Check if CA provided in config
  if (meshConfig.caProvided) {
    caCredentials = meshConfig.caProvided
    console.log('[ServiceMesh] Using provided CA certificate')
    return caCredentials
  }

  // Generate new CA via openssl
  console.log('[ServiceMesh] Generating new CA certificate')

  // Generate EC private key
  const keyResult = await exec([
    'openssl',
    'ecparam',
    '-genkey',
    '-name',
    'prime256v1',
    '-noout',
  ])
  if (keyResult.exitCode !== 0) {
    throw new Error(`Failed to generate CA key: ${keyResult.stderr}`)
  }
  const caKey = keyResult.stdout

  // Generate self-signed CA cert
  const certResult = await exec(
    [
      'openssl',
      'req',
      '-new',
      '-x509',
      '-key',
      '/dev/stdin',
      '-days',
      '3650',
      '-subj',
      '/CN=DWS Mesh CA',
      '-addext',
      'basicConstraints=critical,CA:TRUE',
      '-addext',
      'keyUsage=critical,keyCertSign,cRLSign',
    ],
    { stdin: caKey },
  )

  if (certResult.exitCode !== 0) {
    throw new Error(`Failed to generate CA cert: ${certResult.stderr}`)
  }

  caCredentials = { cert: certResult.stdout, key: caKey }
  return caCredentials
}

// State

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

  async discoverService(
    name: string,
    namespace = 'default',
  ): Promise<ServiceIdentity | null> {
    const id = this.generateServiceId(name, namespace)
    return services.get(id) ?? null
  }

  async listServices(selector: ServiceSelector): Promise<ServiceIdentity[]> {
    const results: ServiceIdentity[] = []
    for (const service of services.values()) {
      if (this.matchesSelector(service, selector)) {
        results.push(service)
      }
    }
    return results
  }

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

    applicablePolicies.sort((a, b) => b.priority - a.priority)

    for (const policy of applicablePolicies) {
      if (this.evaluateConditions(policy.conditions ?? [], request)) {
        return { allowed: policy.action === 'allow', policy }
      }
    }

    return { allowed: false }
  }

  async createAccessPolicy(
    policy: Omit<AccessPolicy, 'id'>,
  ): Promise<AccessPolicy> {
    const id = `policy-${Date.now()}`
    const fullPolicy: AccessPolicy = { ...policy, id }
    accessPolicies.set(id, fullPolicy)
    return fullPolicy
  }

  async createTrafficPolicy(
    policy: Omit<TrafficPolicy, 'id'>,
  ): Promise<TrafficPolicy> {
    const id = `traffic-${Date.now()}`
    const fullPolicy: TrafficPolicy = { ...policy, id }
    trafficPolicies.set(id, fullPolicy)
    return fullPolicy
  }

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

  recordRequest(serviceId: string, success: boolean, latencyMs: number): void {
    const metrics = serviceMetrics.get(serviceId)
    if (!metrics) return

    metrics.requests.total++
    if (success) {
      metrics.requests.success++
    } else {
      metrics.requests.failure++
    }

    metrics.latency.p50 = metrics.latency.p50 * 0.9 + latencyMs * 0.1
    metrics.latency.p95 = Math.max(metrics.latency.p95, latencyMs)
  }

  getMetrics(serviceId: string): ServiceMetrics | null {
    return serviceMetrics.get(serviceId) ?? null
  }

  async generateCertificate(
    service: ServiceIdentity,
  ): Promise<{ cert: string; key: string }> {
    const cached = serviceCertificates.get(service.id)
    if (cached && cached.expiresAt > Date.now() + 24 * 60 * 60 * 1000) {
      return { cert: cached.cert, key: cached.key }
    }

    const ca = await getOrCreateCA()
    const commonName = `${service.name}.${service.namespace}.mesh.dws`
    const validDays = 365

    // Generate service key
    const keyResult = await exec([
      'openssl',
      'ecparam',
      '-genkey',
      '-name',
      'prime256v1',
      '-noout',
    ])
    if (keyResult.exitCode !== 0) {
      throw new Error(`Failed to generate service key: ${keyResult.stderr}`)
    }
    const serviceKey = keyResult.stdout

    // Generate CSR
    const csrResult = await exec(
      [
        'openssl',
        'req',
        '-new',
        '-key',
        '/dev/stdin',
        '-subj',
        `/CN=${commonName}`,
      ],
      { stdin: serviceKey },
    )
    if (csrResult.exitCode !== 0) {
      throw new Error(`Failed to generate CSR: ${csrResult.stderr}`)
    }
    const csr = csrResult.stdout

    // Sign with CA (using a script that takes stdin for both)
    const signScript = `
set -e
TMPDIR=$(mktemp -d)
cat > $TMPDIR/csr.pem
echo '${ca.key}' > $TMPDIR/ca.key
echo '${ca.cert}' > $TMPDIR/ca.crt
cat > $TMPDIR/ext.cnf << EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth,clientAuth
subjectAltName=DNS:${commonName},DNS:${service.name}.${service.namespace},DNS:${service.name}
EOF
openssl x509 -req -in $TMPDIR/csr.pem -CA $TMPDIR/ca.crt -CAkey $TMPDIR/ca.key -CAcreateserial -days ${validDays} -extfile $TMPDIR/ext.cnf
rm -rf $TMPDIR
`

    const signResult = await exec(['sh', '-c', signScript], { stdin: csr })
    if (signResult.exitCode !== 0) {
      throw new Error(`Failed to sign certificate: ${signResult.stderr}`)
    }

    const cert = signResult.stdout
    const expiresAt = Date.now() + validDays * 24 * 60 * 60 * 1000

    serviceCertificates.set(service.id, { cert, key: serviceKey, expiresAt })
    console.log(`[ServiceMesh] Generated certificate for ${commonName}`)

    return { cert, key: serviceKey }
  }

  async verifyCertificate(
    certPem: string,
    expectedService?: ServiceSelector,
  ): Promise<{ valid: boolean; service?: ServiceIdentity }> {
    const ca = await getOrCreateCA()

    // Verify via openssl
    const verifyScript = `
set -e
TMPDIR=$(mktemp -d)
cat > $TMPDIR/cert.pem
echo '${ca.cert}' > $TMPDIR/ca.crt
openssl verify -CAfile $TMPDIR/ca.crt $TMPDIR/cert.pem
openssl x509 -in $TMPDIR/cert.pem -noout -subject -dates
rm -rf $TMPDIR
`

    const result = await exec(['sh', '-c', verifyScript], { stdin: certPem })
    if (result.exitCode !== 0) {
      console.warn(
        '[ServiceMesh] Certificate verification failed:',
        result.stderr,
      )
      return { valid: false }
    }

    // Extract CN from output
    const cnMatch = result.stdout.match(/CN\s*=\s*([^\s,]+)/)
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

    const service = await this.discoverService(serviceName, namespace)
    if (!service) {
      return { valid: true }
    }

    if (expectedService && !this.matchesSelector(service, expectedService)) {
      console.warn(
        '[ServiceMesh] Certificate verification failed: service mismatch',
      )
      return { valid: false }
    }

    return { valid: true, service }
  }

  async getCACertificate(): Promise<string> {
    const ca = await getOrCreateCA()
    return ca.cert
  }

  private generateServiceId(name: string, namespace: string): string {
    return keccak256(toBytes(`${namespace}/${name}`)).slice(0, 18)
  }

  private matchesSelector(
    service: ServiceIdentity,
    selector: ServiceSelector,
  ): boolean {
    if (selector.namespace && service.namespace !== selector.namespace)
      return false
    if (selector.name && service.name !== selector.name) return false
    if (selector.owner && service.owner !== selector.owner) return false
    if (selector.tags && selector.tags.length > 0) {
      if (!selector.tags.every((tag) => service.tags.includes(tag)))
        return false
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

// Elysia Router

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
  return new Elysia({ prefix: '/mesh' })
    .get('/health', () => ({ status: 'healthy', services: services.size }))
    .get('/ca', async () => ({ cert: await mesh.getCACertificate() }))
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
      const tags = query.tags?.split(',') ?? []

      const serviceList = await mesh.listServices({ namespace, tags })
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
        const selector: ServiceSelector | undefined = body.expectedService
          ? {
              ...body.expectedService,
              owner: body.expectedService.owner as Address | undefined,
            }
          : undefined
        const result = await mesh.verifyCertificate(body.cert, selector)
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
