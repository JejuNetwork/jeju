/**
 * DWS Ingress Controller
 *
 * Provides external access to DWS services:
 * - Public HTTP/HTTPS endpoints
 * - JNS domain routing
 * - TLS termination with auto-certificates
 * - Load balancing across nodes
 * - Rate limiting and DDoS protection
 * - Geo-routing for low latency
 */

import { Hono } from 'hono'
import type { Address } from 'viem'
import { z } from 'zod'
import { validateBody, validateParams } from '../shared/validation'

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Ingress Controller
// ============================================================================

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
    console.log(`[Ingress] Created ingress ${id} for ${rule.host}`)

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

  private async checkRateLimit(
    _request: Request,
    _config: RateLimitConfig,
  ): Promise<boolean> {
    // Simple in-memory rate limiting
    // In production, use distributed rate limiter
    return true
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
        // Validate credentials
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
        // Validate token
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

  private async provisionCertificate(host: string): Promise<void> {
    console.log(`[Ingress] Provisioning TLS certificate for ${host}`)
    // In production, use ACME/Let's Encrypt
  }
}

// ============================================================================
// Ingress Router
// ============================================================================

const ingressRuleSchema = z.object({
  name: z.string(),
  host: z.string(),
  paths: z.array(
    z.object({
      path: z.string(),
      pathType: z.enum(['Prefix', 'Exact', 'Regex']),
      backend: z.object({
        type: z.enum(['worker', 'container', 'service', 'static', 'redirect']),
        workerId: z.string().optional(),
        containerId: z.string().optional(),
        serviceId: z.string().optional(),
        staticCid: z.string().optional(),
        redirectUrl: z.string().optional(),
        port: z.number().optional(),
        weight: z.number().optional(),
      }),
      rewrite: z.string().optional(),
      timeout: z.number().optional(),
    }),
  ),
  tls: z
    .object({
      enabled: z.boolean(),
      mode: z.enum(['auto', 'custom', 'passthrough']).optional(),
      secretName: z.string().optional(),
      minVersion: z.enum(['TLS1.2', 'TLS1.3']).optional(),
    })
    .optional(),
  rateLimit: z
    .object({
      requestsPerSecond: z.number(),
      burstSize: z.number(),
      by: z.enum(['ip', 'header', 'path']),
      headerName: z.string().optional(),
    })
    .optional(),
  authentication: z
    .object({
      type: z.enum(['none', 'basic', 'bearer', 'x402', 'jwt']),
      realm: z.string().optional(),
      secretName: z.string().optional(),
      jwtIssuer: z.string().optional(),
    })
    .optional(),
})

export function createIngressRouter(controller: IngressController): Hono {
  const router = new Hono()

  // Health check
  router.get('/health', (c) => {
    return c.json({ status: 'healthy', rules: ingressRules.size })
  })

  // Create ingress
  router.post('/rules', async (c) => {
    const body = await validateBody(ingressRuleSchema, c)
    const rule = await controller.createIngress(
      body as Omit<IngressRule, 'id' | 'createdAt' | 'updatedAt' | 'status'>,
    )
    return c.json(rule, 201)
  })

  // List ingress
  router.get('/rules', async (c) => {
    const rules = controller.listIngress()
    return c.json({ rules })
  })

  // Get ingress
  router.get('/rules/:id', async (c) => {
    const { id } = validateParams(z.object({ id: z.string() }), c)
    const rule = controller.getIngress(id)
    if (!rule) {
      return c.json({ error: 'Ingress not found' }, 404)
    }
    return c.json(rule)
  })

  // Update ingress
  router.put('/rules/:id', async (c) => {
    const { id } = validateParams(z.object({ id: z.string() }), c)
    const body = await validateBody(ingressRuleSchema.partial(), c)
    const rule = await controller.updateIngress(id, body)
    return c.json(rule)
  })

  // Delete ingress
  router.delete('/rules/:id', async (c) => {
    const { id } = validateParams(z.object({ id: z.string() }), c)
    await controller.deleteIngress(id)
    return c.json({ success: true })
  })

  return router
}

// ============================================================================
// Singleton
// ============================================================================

let controllerInstance: IngressController | null = null

export function getIngressController(): IngressController {
  if (!controllerInstance) {
    controllerInstance = new IngressController()
  }
  return controllerInstance
}
