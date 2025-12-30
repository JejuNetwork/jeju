/**
 * App Router Middleware
 *
 * Routes requests based on hostname to the appropriate app:
 * - appname.testnet.jejunetwork.org → App frontend + API
 * - appname.jns.testnet.jejunetwork.org → JNS-resolved frontend + API
 *
 * Routing logic:
 * - / and frontend routes → IPFS (if deployed) or local CDN (devnet)
 * - /api/*, /health, /a2a, /mcp → Backend worker or container
 */

import {
  getCurrentNetwork,
  getIpfsGatewayUrl,
  getLocalhostHost,
} from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { getAppRegistry } from '../../../src/cdn/app-registry'
import { getLocalCDNServer } from '../../../src/cdn/local-server'
import { getIngressController } from '../../infrastructure'
import { deployedAppState } from '../../state'
import {
  isConfigMapAvailable,
  loadAppsFromConfigMap,
  saveAppsToConfigMap,
} from './configmap-persistence'

// App deployment registry - tracks deployed apps and their configurations
export interface DeployedApp {
  name: string
  jnsName: string
  frontendCid: string | null // IPFS CID for frontend (null = use local CDN)
  backendWorkerId: string | null // DWS worker ID for backend
  backendEndpoint: string | null // Direct backend URL (for containers/services)
  apiPaths: string[] // Paths to route to backend (default: /api, /health, etc.)
  spa: boolean // Single-page app (serve index.html for all non-asset routes)
  enabled: boolean
  deployedAt: number
  updatedAt: number
}

// In-memory cache of deployed apps (loaded from database on startup)
// The cache is synced with SQLit for persistence across pod restarts
const deployedAppsCache = new Map<string, DeployedApp>()

// Domain patterns
const NETWORK = getCurrentNetwork()

// Default API paths to route to backend
const DEFAULT_API_PATHS = [
  '/api',
  '/health',
  '/a2a',
  '/mcp',
  '/oauth',
  '/callback',
  '/webhook',
]

/**
 * Extract app name from hostname
 *
 * Examples:
 * - oauth3.testnet.jejunetwork.org → oauth3
 * - autocrat.jns.testnet.jejunetwork.org → autocrat
 * - dws.jejunetwork.org → dws
 */
function extractAppName(hostname: string): string | null {
  // Handle JNS subdomain: appname.jns.testnet.jejunetwork.org
  const jnsMatch = hostname.match(/^([^.]+)\.jns\./)
  if (jnsMatch?.[1]) {
    return jnsMatch[1]
  }

  // Handle testnet subdomain: appname.testnet.jejunetwork.org
  const testnetMatch = hostname.match(/^([^.]+)\.testnet\./)
  if (testnetMatch?.[1]) {
    // Skip system subdomains
    const systemSubdomains = [
      'dws',
      'api',
      'rpc',
      'ws',
      'explorer',
      'bridge',
      'faucet',
      'docs',
      'gateway',
    ]
    const name = testnetMatch[1]
    if (!systemSubdomains.includes(name)) {
      return name
    }
  }

  // Handle mainnet subdomain: appname.jejunetwork.org
  const mainnetMatch = hostname.match(/^([^.]+)\.jejunetwork\.org$/)
  if (mainnetMatch?.[1]) {
    const systemSubdomains = [
      'dws',
      'api',
      'rpc',
      'ws',
      'explorer',
      'www',
      'docs',
    ]
    const name = mainnetMatch[1]
    if (!systemSubdomains.includes(name)) {
      return name
    }
  }

  return null
}

/**
 * Check if a path should be routed to the backend
 */
function isApiPath(pathname: string, apiPaths: string[]): boolean {
  return apiPaths.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

/**
 * Check if a path is a static asset
 */
function isAssetPath(pathname: string): boolean {
  const assetExtensions = [
    '.js',
    '.css',
    '.json',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.svg',
    '.woff',
    '.woff2',
    '.ttf',
    '.eot',
    '.ico',
    '.webp',
    '.avif',
    '.mp4',
    '.webm',
    '.mp3',
    '.wav',
    '.pdf',
    '.map',
  ]
  return assetExtensions.some((ext) => pathname.endsWith(ext))
}

/**
 * Register a deployed app (persists to ConfigMap in K8s, SQLit otherwise)
 */
export async function registerDeployedApp(
  app: Omit<DeployedApp, 'deployedAt' | 'updatedAt'>,
): Promise<void> {
  const now = Date.now()
  const existing = deployedAppsCache.get(app.name)

  const deployedApp: DeployedApp = {
    ...app,
    deployedAt: existing?.deployedAt ?? now,
    updatedAt: now,
  }

  // Update cache first
  deployedAppsCache.set(app.name, deployedApp)

  // Persist to ConfigMap (primary for K8s) or SQLit (fallback)
  if (isConfigMapAvailable()) {
    // Save all apps to ConfigMap
    const allApps = Array.from(deployedAppsCache.values())
    await saveAppsToConfigMap(allApps)
  } else {
    // Try SQLit as fallback (for local development)
    try {
      await deployedAppState.save({
        name: app.name,
        jnsName: app.jnsName,
        frontendCid: app.frontendCid,
        backendWorkerId: app.backendWorkerId,
        backendEndpoint: app.backendEndpoint,
        apiPaths: app.apiPaths,
        spa: app.spa,
        enabled: app.enabled,
      })
    } catch (_error) {
      // Neither ConfigMap nor SQLit available - cache-only mode
      console.log(
        `[AppRouter] Running in memory-only mode (no persistence): ${app.name}`,
      )
    }
  }

  console.log(
    `[AppRouter] Registered app: ${app.name} (frontend: ${app.frontendCid ?? 'local'}, backend: ${app.backendWorkerId ?? app.backendEndpoint ?? 'none'})`,
  )
}

/**
 * Unregister a deployed app (removes from ConfigMap/database)
 */
export async function unregisterDeployedApp(name: string): Promise<boolean> {
  const existed = deployedAppsCache.has(name)

  // Remove from cache
  deployedAppsCache.delete(name)

  // Persist removal to ConfigMap or SQLit
  if (isConfigMapAvailable()) {
    const allApps = Array.from(deployedAppsCache.values())
    await saveAppsToConfigMap(allApps)
  } else {
    try {
      await deployedAppState.delete(name)
    } catch (_error) {
      console.log(`[AppRouter] Database delete failed: ${name}`)
    }
  }

  if (existed) {
    console.log(`[AppRouter] Unregistered app: ${name}`)
  }
  return existed
}

/**
 * Get a deployed app by name (from cache)
 */
export function getDeployedApp(name: string): DeployedApp | undefined {
  return deployedAppsCache.get(name)
}

/**
 * Get all deployed apps (from cache)
 */
export function getDeployedApps(): DeployedApp[] {
  return Array.from(deployedAppsCache.values())
}

/**
 * Serve frontend from IPFS gateway
 *
 * The frontend CID represents a directory. We use the IPFS gateway
 * to fetch files within that directory.
 */
async function serveFrontendFromIPFS(
  cid: string,
  pathname: string,
  spa: boolean,
): Promise<Response> {
  // Determine the file path to fetch
  let path = pathname
  if (path === '/' || path === '') {
    path = '/index.html'
  }

  // For SPA, non-asset routes serve index.html (client-side routing)
  if (spa && !isAssetPath(path)) {
    path = '/index.html'
  }

  // Use IPFS gateway to fetch from directory CID
  const gateway = getIpfsGatewayUrl(NETWORK)
  const url = `${gateway}/ipfs/${cid}${path}`

  console.log(`[AppRouter] Fetching from IPFS: ${url}`)

  const response = await fetch(url, {
    headers: {
      Accept: '*/*',
    },
  })

  if (!response.ok) {
    // For SPA, try index.html on 404 (fallback for client-side routes)
    if (spa && response.status === 404 && path !== '/index.html') {
      const indexUrl = `${gateway}/ipfs/${cid}/index.html`
      const indexResponse = await fetch(indexUrl)
      if (indexResponse.ok) {
        return new Response(indexResponse.body, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'X-DWS-Source': 'ipfs',
            'X-DWS-CID': cid,
          },
        })
      }
    }
    console.log(`[AppRouter] IPFS fetch failed: ${response.status} for ${url}`)
    return new Response('Not Found', { status: 404 })
  }

  // Determine content type based on file extension
  const contentType = getContentType(path)

  // Clone response with DWS headers
  const headers = new Headers(response.headers)
  headers.set('X-DWS-Source', 'ipfs')
  headers.set('X-DWS-CID', cid)
  if (!headers.get('Content-Type')) {
    headers.set('Content-Type', contentType)
  }

  return new Response(response.body, {
    status: response.status,
    headers,
  })
}

/**
 * Get content type from file path
 */
function getContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const mimeTypes: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    js: 'application/javascript',
    mjs: 'application/javascript',
    css: 'text/css',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    eot: 'application/vnd.ms-fontobject',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    pdf: 'application/pdf',
    txt: 'text/plain',
    xml: 'application/xml',
  }
  return mimeTypes[ext] ?? 'application/octet-stream'
}

/**
 * Serve frontend from local CDN (devnet)
 */
async function serveFrontendFromLocalCDN(
  appName: string,
  pathname: string,
): Promise<Response> {
  const localCDN = getLocalCDNServer()

  // Build request for local CDN
  const cdnRequest = new Request(`http://localhost/apps/${appName}${pathname}`)
  const response = await localCDN.handleRequest(cdnRequest)

  // Add DWS headers
  const headers = new Headers(response.headers)
  headers.set('X-DWS-Source', 'local-cdn')

  return new Response(response.body, {
    status: response.status,
    headers,
  })
}

/**
 * Proxy request to backend
 */
async function proxyToBackend(
  request: Request,
  app: DeployedApp,
  pathname: string,
): Promise<Response> {
  let targetUrl: string

  if (app.backendEndpoint) {
    // Direct endpoint (container or external service)
    targetUrl = `${app.backendEndpoint}${pathname}`
  } else if (app.backendWorkerId) {
    // DWS worker - route through workerd executor
    // For now, use the DWS compute endpoint
    const host = getLocalhostHost()
    targetUrl = `http://${host}:4030/workerd/execute/${app.backendWorkerId}${pathname}`
  } else {
    return new Response(JSON.stringify({ error: 'No backend configured' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const url = new URL(request.url)

  const proxyRequest = new Request(targetUrl + url.search, {
    method: request.method,
    headers: request.headers,
    body:
      request.method !== 'GET' && request.method !== 'HEAD'
        ? request.body
        : undefined,
  })

  const response = await fetch(proxyRequest)

  // Clone response with DWS headers
  const headers = new Headers(response.headers)
  headers.set(
    'X-DWS-Backend',
    app.backendWorkerId ?? app.backendEndpoint ?? 'unknown',
  )

  return new Response(response.body, {
    status: response.status,
    headers,
  })
}

/**
 * Create the app router
 *
 * This router handles hostname-based app routing at the DWS level.
 * It should be mounted as middleware BEFORE other routes.
 */
export function createAppRouter() {
  console.log('[AppRouter] Creating app router middleware')
  return (
    new Elysia({ name: 'app-router' })
      .derive(({ request }) => {
        // Log at derive level to ensure middleware chain is working
        const host = request.headers.get('host')
        console.log(`[AppRouter.derive] host=${host}`)
        return {}
      })
      // Middleware that checks every request for app routing
      .onBeforeHandle(async ({ request }): Promise<Response | undefined> => {
        const url = new URL(request.url)
        const hostHeader = request.headers.get('host')
        const hostname = hostHeader ?? url.hostname
        const pathname = url.pathname

        // Log ALL requests through the app router
        console.log(
          `[AppRouter] Request received: host=${hostHeader}, hostname=${hostname}, pathname=${pathname}`,
        )

        // Skip if this is the DWS service itself
        if (
          hostname.startsWith('dws.') ||
          hostname === 'localhost' ||
          hostname.startsWith('127.')
        ) {
          console.log(`[AppRouter] Skipping DWS service: ${hostname}`)
          return undefined
        }

        // Log non-DWS hostnames
        console.log(
          `[AppRouter] Processing app request: ${hostname}${pathname}`,
        )

        // Extract app name from hostname
        const appName = extractAppName(hostname)
        console.log(`[AppRouter] hostname=${hostname}, appName=${appName}`)
        if (!appName) {
          return undefined
        }

        // Look up deployed app (from cache)
        let app = deployedAppsCache.get(appName)
        console.log(
          `[AppRouter] Found app: ${app?.name}, apiPaths: ${JSON.stringify(app?.apiPaths)}`,
        )

        // If not in deployed apps, check local app registry (devnet fallback)
        if (!app) {
          const registry = getAppRegistry()
          const localApp = registry.getApp(appName)

          if (localApp) {
            // Create a temporary deployment entry from local app
            app = {
              name: localApp.name,
              jnsName: localApp.jnsName,
              frontendCid: localApp.cid ?? null,
              backendWorkerId: null,
              backendEndpoint: `http://${getLocalhostHost()}:${localApp.port}`,
              apiPaths: DEFAULT_API_PATHS,
              spa: localApp.spa,
              enabled: true,
              deployedAt: Date.now(),
              updatedAt: Date.now(),
            }
          }
        }

        if (!app || !app.enabled) {
          // App not found - let request fall through to 404
          console.log(`[AppRouter] App not found or disabled: ${appName}`)
          return undefined
        }

        // Route to backend for API paths
        const shouldProxyToBackend = isApiPath(pathname, app.apiPaths)
        console.log(
          `[AppRouter] pathname=${pathname}, apiPaths=${JSON.stringify(app.apiPaths)}, shouldProxy=${shouldProxyToBackend}`,
        )
        if (shouldProxyToBackend) {
          console.log(
            `[AppRouter] Proxying to backend: ${app.backendEndpoint}${pathname}`,
          )
          return proxyToBackend(request, app, pathname)
        }

        console.log(`[AppRouter] Serving frontend for ${appName}${pathname}`)

        // Route to frontend
        if (app.frontendCid) {
          // Serve from IPFS
          return serveFrontendFromIPFS(app.frontendCid, pathname, app.spa)
        }

        // Serve from local CDN (devnet)
        return serveFrontendFromLocalCDN(app.name, pathname)
      })

      // Management endpoints for app deployments
      .get('/apps/deployed', () => {
        const apps = getDeployedApps()
        return {
          count: apps.length,
          apps: apps.map((app) => ({
            name: app.name,
            jnsName: app.jnsName,
            frontendCid: app.frontendCid,
            backendWorkerId: app.backendWorkerId,
            backendEndpoint: app.backendEndpoint,
            enabled: app.enabled,
            deployedAt: app.deployedAt,
            updatedAt: app.updatedAt,
          })),
        }
      })

      .get('/apps/deployed/:name', ({ params, set }) => {
        const app = getDeployedApp(params.name)
        if (!app) {
          set.status = 404
          return { error: `App not found: ${params.name}` }
        }
        return app
      })

      .post('/apps/deployed', async ({ body, set }) => {
        const data = body as Omit<DeployedApp, 'deployedAt' | 'updatedAt'>
        if (!data.name) {
          set.status = 400
          return { error: 'App name is required' }
        }
        await registerDeployedApp(data)
        return { success: true, app: getDeployedApp(data.name) }
      })

      .delete('/apps/deployed/:name', async ({ params }) => {
        const deleted = await unregisterDeployedApp(params.name)
        return { success: deleted }
      })
  )
}

/**
 * Initialize app router from ConfigMap, database, ingress rules, and local apps
 */
export async function initializeAppRouter(): Promise<void> {
  console.log('[AppRouter] Initializing...')

  // Try ConfigMap first (Kubernetes environment)
  if (isConfigMapAvailable()) {
    console.log('[AppRouter] ConfigMap persistence available')
    try {
      const configMapApps = await loadAppsFromConfigMap()
      for (const app of configMapApps) {
        deployedAppsCache.set(app.name, app)
        console.log(
          `[AppRouter] Loaded from ConfigMap: ${app.name} (frontend: ${app.frontendCid ?? 'none'}, backend: ${app.backendWorkerId ?? app.backendEndpoint ?? 'none'})`,
        )
      }
    } catch (error) {
      console.log(
        `[AppRouter] Failed to load from ConfigMap: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  } else {
    // Load from SQLit database (local development)
    console.log('[AppRouter] ConfigMap not available, trying SQLit')
    try {
      const dbApps = await deployedAppState.listEnabled()
      for (const row of dbApps) {
        const app: DeployedApp = {
          name: row.name,
          jnsName: row.jns_name,
          frontendCid: row.frontend_cid,
          backendWorkerId: row.backend_worker_id,
          backendEndpoint: row.backend_endpoint,
          apiPaths: JSON.parse(row.api_paths),
          spa: row.spa === 1,
          enabled: row.enabled === 1,
          deployedAt: row.deployed_at,
          updatedAt: row.updated_at,
        }
        deployedAppsCache.set(app.name, app)
        console.log(
          `[AppRouter] Loaded from database: ${app.name} (frontend: ${app.frontendCid ?? 'none'}, backend: ${app.backendWorkerId ?? app.backendEndpoint ?? 'none'})`,
        )
      }
    } catch (error) {
      // SQLit may not be available - this is fine for testnet/devnet
      // Apps can still be registered via the /apps/deployed API
      console.log(
        `[AppRouter] Failed to load from database: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
      console.log('[AppRouter] Apps can be registered via POST /apps/deployed')
    }
  }

  // Load from local app registry (devnet)
  try {
    const registry = getAppRegistry()
    await registry.initialize()

    const localApps = registry.getEnabledApps()
    for (const app of localApps) {
      await registerDeployedApp({
        name: app.name,
        jnsName: app.jnsName,
        frontendCid: app.cid ?? null,
        backendWorkerId: null,
        backendEndpoint: `http://${getLocalhostHost()}:${app.port}`,
        apiPaths: DEFAULT_API_PATHS,
        spa: app.spa,
        enabled: true,
      })
    }
  } catch (_error) {
    console.log('[AppRouter] Local app registry not available, skipping')
  }

  // Load from ingress rules (for production deployments)
  try {
    const ingress = getIngressController()
    const rules = ingress.listIngress()
    for (const rule of rules) {
      // Extract app name from host
      const appName = extractAppName(rule.host)
      if (!appName) continue

      // Find static CID and worker ID from paths
      let frontendCid: string | null = null
      let backendWorkerId: string | null = null

      for (const pathRule of rule.paths) {
        if (pathRule.backend.type === 'static' && pathRule.backend.staticCid) {
          frontendCid = pathRule.backend.staticCid
        }
        if (pathRule.backend.type === 'worker' && pathRule.backend.workerId) {
          backendWorkerId = pathRule.backend.workerId
        }
      }

      // Only register if we have either frontend or backend
      if (frontendCid || backendWorkerId) {
        await registerDeployedApp({
          name: appName,
          jnsName: `${appName}.jeju`,
          frontendCid,
          backendWorkerId,
          backendEndpoint: null,
          apiPaths: DEFAULT_API_PATHS,
          spa: true,
          enabled: rule.status === 'active',
        })
      }
    }
  } catch (_error) {
    console.log('[AppRouter] Ingress controller not available, skipping')
  }

  console.log(`[AppRouter] Initialized with ${deployedAppsCache.size} apps`)
}
