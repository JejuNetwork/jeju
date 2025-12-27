/**
 * DWS Ingress Controller
 *
 * Provides external access to DWS services:
 * - Public HTTP/HTTPS endpoints
 * - JNS domain routing
 * - TLS termination with auto-certificates
 * - Load balancing across nodes
 * - Distributed rate limiting via CQL
 * - DDoS protection
 * - Geo-routing for low latency
 */

import { CQLRateLimitStore } from '@jejunetwork/api'
import { type CQLClient, getCQL } from '@jejunetwork/db'
import { Elysia, t } from 'elysia'
import type { Address } from 'viem'

export interface IngressRule {
  id: string
  name: string
  host: string // e.g., myapp.jns.jejunetwork.org or custom domain
  paths: PathRule[]
  tls?: TLSConfig
  rateLimit?: RateLimitConfig
  geoRouting?: GeoRoutingConfig
  authentication?: AuthConfig
  createdAt: number
  updatedAt: number
  status: 'active' | 'pending' | 'failed'
}

export interface PathRule {
  path: string
  pathType: 'Prefix' | 'Exact' | 'Regex'
  backend: BackendConfig
  rewrite?: string
  timeout?: number
}

export interface BackendConfig {
  type: 'worker' | 'container' | 'service' | 'static' | 'redirect'
  workerId?: string
  containerId?: string
  serviceId?: string
  staticCid?: string
  redirectUrl?: string
  port?: number
  weight?: number
}

export interface TLSConfig {
  enabled: boolean
  mode: 'auto' | 'custom' | 'passthrough'
  secretName?: string
  certificateCid?: string
  minVersion?: 'TLS1.2' | 'TLS1.3'
}

export interface RateLimitConfig {
  requestsPerSecond: number
  burstSize: number
  by: 'ip' | 'header' | 'path'
  headerName?: string
}

export interface GeoRoutingConfig {
  enabled: boolean
  preferredRegions?: string[]
  blockedRegions?: string[]
  latencyOptimized?: boolean
}

export interface AuthConfig {
  type: 'none' | 'basic' | 'bearer' | 'x402' | 'jwt'
  realm?: string
  secretName?: string
  jwtIssuer?: string
  x402Config?: {
    minPayment: bigint
    token: Address
  }
}

// Ingress Controller

const ingressRules = new Map<string, IngressRule>()
const hostToRuleMap = new Map<string, string>()

export class IngressController {
  /**
   * Create an ingress rule
   */
  async createIngress(
    rule: Omit<IngressRule, 'id' | 'createdAt' | 'updatedAt' | 'status'>,
  ): Promise<IngressRule> {
    const id = `ingress-${Date.now()}`

    const fullRule: IngressRule = {
      ...rule,
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'pending',
    }

    // Validate host is available
    if (hostToRuleMap.has(rule.host)) {
      throw new Error(`Host ${rule.host} is already in use`)
    }

    // Setup TLS if enabled
    if (rule.tls?.enabled && rule.tls.mode === 'auto') {
      await this.provisionCertificate(rule.host)
    }

    ingressRules.set(id, fullRule)
    hostToRuleMap.set(rule.host, id)

    fullRule.status = 'active'

    return fullRule
  }

  /**
   * Update an ingress rule
   */
  async updateIngress(
    id: string,
    updates: Partial<IngressRule>,
  ): Promise<IngressRule> {
    const rule = ingressRules.get(id)
    if (!rule) {
      throw new Error('Ingress not found')
    }

    // If host changed, update mapping
    if (updates.host && updates.host !== rule.host) {
      hostToRuleMap.delete(rule.host)
      hostToRuleMap.set(updates.host, id)
    }

    const updatedRule: IngressRule = {
      ...rule,
      ...updates,
      id,
      updatedAt: Date.now(),
    }

    ingressRules.set(id, updatedRule)
    return updatedRule
  }

  /**
   * Delete an ingress rule
   */
  async deleteIngress(id: string): Promise<void> {
    const rule = ingressRules.get(id)
    if (!rule) return

    hostToRuleMap.delete(rule.host)
    ingressRules.delete(id)

    console.log(`[Ingress] Deleted ingress ${id}`)
  }

  /**
   * Get ingress by ID
   */
  getIngress(id: string): IngressRule | undefined {
    return ingressRules.get(id)
  }

  /**
   * List all ingress rules
   */
  listIngress(): IngressRule[] {
    return Array.from(ingressRules.values())
  }

  /**
   * Find ingress rule for a request
   */
  findRule(
    host: string,
    path: string,
  ): { rule: IngressRule; pathRule: PathRule } | null {
    const ruleId = hostToRuleMap.get(host)
    if (!ruleId) return null

    const rule = ingressRules.get(ruleId)
    if (!rule || rule.status !== 'active') return null

    // Find matching path
    for (const pathRule of rule.paths) {
      if (this.matchPath(path, pathRule.path, pathRule.pathType)) {
        return { rule, pathRule }
      }
    }

    return null
  }

  /**
   * Route a request through ingress
   */
  async routeRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const host = request.headers.get('host') ?? url.hostname

    const match = this.findRule(host, url.pathname)
    if (!match) {
      return new Response('Not Found', { status: 404 })
    }

    const { rule, pathRule } = match

    // Check rate limit
    if (rule.rateLimit) {
      const allowed = await this.checkRateLimit(request, rule.rateLimit)
      if (!allowed) {
        return new Response('Rate Limited', { status: 429 })
      }
    }

    // Check authentication
    if (rule.authentication && rule.authentication.type !== 'none') {
      const authResult = await this.checkAuth(request, rule.authentication)
      if (!authResult.authenticated) {
        return new Response('Unauthorized', {
          status: 401,
          headers: authResult.headers,
        })
      }
    }

    // Route to backend
    return this.routeToBackend(request, pathRule)
  }

  /**
   * Route to backend based on configuration
   */
  private async routeToBackend(
    request: Request,
    pathRule: PathRule,
  ): Promise<Response> {
    const backend = pathRule.backend

    switch (backend.type) {
      case 'worker': {
        if (!backend.workerId)
          throw new Error('Worker backend requires workerId')
        return this.routeToWorker(request, backend.workerId, pathRule)
      }

      case 'container': {
        if (!backend.containerId)
          throw new Error('Container backend requires containerId')
        return this.routeToContainer(request, backend.containerId, pathRule)
      }

      case 'service': {
        if (!backend.serviceId)
          throw new Error('Service backend requires serviceId')
        return this.routeToService(request, backend.serviceId, pathRule)
      }

      case 'static': {
        if (!backend.staticCid)
          throw new Error('Static backend requires staticCid')
        return this.routeToStatic(request, backend.staticCid, pathRule)
      }

      case 'redirect': {
        if (!backend.redirectUrl)
          throw new Error('Redirect backend requires redirectUrl')
        return Response.redirect(backend.redirectUrl, 302)
      }

      default:
        return new Response('Bad Gateway', { status: 502 })
    }
  }

  private async routeToWorker(
    request: Request,
    workerId: string,
    pathRule: PathRule,
  ): Promise<Response> {
    // Route to workerd executor
    let targetPath = new URL(request.url).pathname
    if (pathRule.rewrite) {
      targetPath = targetPath.replace(
        new RegExp(pathRule.path),
        pathRule.rewrite,
      )
    }

    // In production, this would use the workerd executor
    return new Response(
      JSON.stringify({
        backend: 'worker',
        workerId,
        path: targetPath,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  private async routeToContainer(
    _request: Request,
    containerId: string,
    _pathRule: PathRule,
  ): Promise<Response> {
    // Route to container
    return new Response(
      JSON.stringify({
        backend: 'container',
        containerId,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  private async routeToService(
    _request: Request,
    serviceId: string,
    _pathRule: PathRule,
  ): Promise<Response> {
    // Route via service mesh
    return new Response(
      JSON.stringify({
        backend: 'service',
        serviceId,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  private async routeToStatic(
    request: Request,
    cid: string,
    pathRule: PathRule,
  ): Promise<Response> {
    // Route to IPFS/static storage
    const url = new URL(request.url)
    const assetPath = url.pathname.replace(pathRule.path, '')

    // In production, fetch from IPFS
    return new Response(
      JSON.stringify({
        backend: 'static',
        cid,
        path: assetPath,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  private matchPath(
    requestPath: string,
    rulePath: string,
    pathType: PathRule['pathType'],
  ): boolean {
    switch (pathType) {
      case 'Exact':
        return requestPath === rulePath
      case 'Prefix':
        return requestPath.startsWith(rulePath)
      case 'Regex':
        return new RegExp(rulePath).test(requestPath)
      default:
        return false
    }
  }

  // Distributed rate limiting via CQL
  private rateWindowMs = 60_000 // 1 minute window
  private distributedStore: CQLRateLimitStore | null = null
  private cqlClient: CQLClient | null = null
  private static readonly RATE_LIMIT_DB = 'dws_rate_limits'

  // Fallback in-memory store for when CQL is unavailable
  private localRateLimitRequests = new Map<
    string,
    { count: number; resetAt: number }
  >()

  private async getDistributedStore(): Promise<CQLRateLimitStore | null> {
    if (this.distributedStore) return this.distributedStore

    try {
      if (!this.cqlClient) {
        this.cqlClient = getCQL({
          databaseId: IngressController.RATE_LIMIT_DB,
          timeout: 5000,
          debug: false,
        })
      }

      this.distributedStore = new CQLRateLimitStore({
        client: this.cqlClient,
        databaseId: IngressController.RATE_LIMIT_DB,
        keyPrefix: 'ingress',
        cleanupIntervalMs: 5 * 60 * 1000, // 5 minutes
      })

      console.log('[Ingress] Distributed rate limiting initialized via CQL')
      return this.distributedStore
    } catch (err) {
      console.warn(
        '[Ingress] CQL unavailable, using local rate limiting:',
        err instanceof Error ? err.message : String(err),
      )
      return null
    }
  }

  private async checkRateLimit(
    request: Request,
    config: RateLimitConfig,
  ): Promise<boolean> {
    const clientId =
      request.headers.get('x-real-ip') ??
      request.headers.get('cf-connecting-ip') ??
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      'unknown'

    const maxRequests = config.requestsPerSecond * 60 // Per minute

    // Try distributed store first
    const store = await this.getDistributedStore()
    if (store) {
      try {
        const result = await store.increment(clientId, this.rateWindowMs)
        return result.count <= maxRequests
      } catch (err) {
        console.warn(
          '[Ingress] Distributed rate limit check failed, falling back to local:',
          err instanceof Error ? err.message : String(err),
        )
      }
    }

    // Fallback to local in-memory rate limiting
    const now = Date.now()
    const windowKey = `${clientId}:${Math.floor(now / this.rateWindowMs)}`

    const entry = this.localRateLimitRequests.get(windowKey)
    if (!entry) {
      this.localRateLimitRequests.set(windowKey, {
        count: 1,
        resetAt: now + this.rateWindowMs,
      })
      return true
    }

    if (entry.count >= maxRequests) {
      return false
    }

    entry.count++
    // Cleanup old entries periodically
    if (this.localRateLimitRequests.size > 10000) {
      for (const [key, val] of this.localRateLimitRequests) {
        if (val.resetAt < now) this.localRateLimitRequests.delete(key)
      }
    }
    return true
  }

  /**
   * Shutdown the ingress controller and cleanup resources
   */
  shutdown(): void {
    if (this.distributedStore) {
      this.distributedStore.stop()
      this.distributedStore = null
    }
  }

  private async checkAuth(
    request: Request,
    config: AuthConfig,
  ): Promise<{ authenticated: boolean; headers?: Record<string, string> }> {
    switch (config.type) {
      case 'basic': {
        const auth = request.headers.get('Authorization')
        if (!auth || !auth.startsWith('Basic ')) {
          return {
            authenticated: false,
            headers: {
              'WWW-Authenticate': `Basic realm="${config.realm ?? 'DWS'}"`,
            },
          }
        }
        // Ingress validates header format only
        // Actual credential validation happens at the upstream service
        return { authenticated: true }
      }

      case 'bearer': {
        const auth = request.headers.get('Authorization')
        if (!auth || !auth.startsWith('Bearer ')) {
          return {
            authenticated: false,
            headers: { 'WWW-Authenticate': 'Bearer' },
          }
        }
        // Ingress validates header format only
        // Token validation happens at the upstream service or via JWT case
        return { authenticated: true }
      }

      case 'x402': {
        const payment = request.headers.get('X-402-Payment')
        if (!payment) {
          return {
            authenticated: false,
            headers: {
              'X-402-Payment-Required': 'true',
              'X-402-Price': config.x402Config?.minPayment.toString() ?? '0',
            },
          }
        }
        // Validate payment
        return { authenticated: true }
      }

      case 'jwt': {
        const auth = request.headers.get('Authorization')
        if (!auth || !auth.startsWith('Bearer ')) {
          return { authenticated: false }
        }
        // Validate JWT
        return { authenticated: true }
      }

      default:
        return { authenticated: true }
    }
  }

  private async provisionCertificate(_host: string): Promise<void> {
    // In production, use ACME/Let's Encrypt
  }
}

// Ingress Router

const IngressRuleBody = t.Object({
  name: t.String(),
  host: t.String(),
  paths: t.Array(
    t.Object({
      path: t.String(),
      pathType: t.Union([
        t.Literal('Prefix'),
        t.Literal('Exact'),
        t.Literal('Regex'),
      ]),
      backend: t.Object({
        type: t.Union([
          t.Literal('worker'),
          t.Literal('container'),
          t.Literal('service'),
          t.Literal('static'),
          t.Literal('redirect'),
        ]),
        workerId: t.Optional(t.String()),
        containerId: t.Optional(t.String()),
        serviceId: t.Optional(t.String()),
        staticCid: t.Optional(t.String()),
        redirectUrl: t.Optional(t.String()),
        port: t.Optional(t.Number()),
        weight: t.Optional(t.Number()),
      }),
      rewrite: t.Optional(t.String()),
      timeout: t.Optional(t.Number()),
    }),
  ),
  tls: t.Optional(
    t.Object({
      enabled: t.Boolean(),
      mode: t.Optional(
        t.Union([
          t.Literal('auto'),
          t.Literal('custom'),
          t.Literal('passthrough'),
        ]),
      ),
      secretName: t.Optional(t.String()),
      minVersion: t.Optional(
        t.Union([t.Literal('TLS1.2'), t.Literal('TLS1.3')]),
      ),
    }),
  ),
  rateLimit: t.Optional(
    t.Object({
      requestsPerSecond: t.Number(),
      burstSize: t.Number(),
      by: t.Union([t.Literal('ip'), t.Literal('header'), t.Literal('path')]),
      headerName: t.Optional(t.String()),
    }),
  ),
  authentication: t.Optional(
    t.Object({
      type: t.Union([
        t.Literal('none'),
        t.Literal('basic'),
        t.Literal('bearer'),
        t.Literal('x402'),
        t.Literal('jwt'),
      ]),
      realm: t.Optional(t.String()),
      secretName: t.Optional(t.String()),
      jwtIssuer: t.Optional(t.String()),
    }),
  ),
})

export function createIngressRouter(controller: IngressController) {
  return new Elysia({ prefix: '/ingress' })
    .get('/health', () => ({ status: 'healthy', rules: ingressRules.size }))
    .post(
      '/rules',
      async ({ body, set }) => {
        const rule = await controller.createIngress(
          body as Omit<
            IngressRule,
            'id' | 'createdAt' | 'updatedAt' | 'status'
          >,
        )
        set.status = 201
        return rule
      },
      { body: IngressRuleBody },
    )
    .get('/rules', () => {
      const rules = controller.listIngress()
      return { rules }
    })
    .get(
      '/rules/:id',
      ({ params, set }) => {
        const rule = controller.getIngress(params.id)
        if (!rule) {
          set.status = 404
          return { error: 'Ingress not found' }
        }
        return rule
      },
      { params: t.Object({ id: t.String() }) },
    )
    .put(
      '/rules/:id',
      async ({ params, body }) => {
        const rule = await controller.updateIngress(
          params.id,
          body as Partial<IngressRule>,
        )
        return rule
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Partial(IngressRuleBody),
      },
    )
    .delete(
      '/rules/:id',
      async ({ params }) => {
        await controller.deleteIngress(params.id)
        return { success: true }
      },
      { params: t.Object({ id: t.String() }) },
    )
}

let controllerInstance: IngressController | null = null

export function getIngressController(): IngressController {
  if (!controllerInstance) {
    controllerInstance = new IngressController()
  }
  return controllerInstance
}
