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
import { deployedAppState, isDegradedMode } from '../../state'
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
  staticFiles: Record<string, string> | null // Map of path -> CID for individual files
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

// Last sync timestamp for cache invalidation
let lastSyncTimestamp = 0
const SYNC_INTERVAL_MS = 15000 // Sync every 15 seconds
const POD_ID = `pod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

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
    // Skip system subdomains (these are core infrastructure, not JNS apps)
    // NOTE: Apps that are deployed via DWS (like indexer) should NOT be in this list
    const systemSubdomains = [
      'dws',
      'api',
      'rpc',
      'ws',
      'explorer',
      'bridge',
      'faucet',
      'docs',
      'ipfs',
      'ipfs-api',
      'storage',
      'git',
      'npm',
      'hub',
      'registry',
      'jns',
      'bundler',
      'relay',
      'kms',
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
        staticFiles: app.staticFiles,
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

  // Notify other pods to sync their cache (fire-and-forget)
  notifyOtherPods()
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
 * Reload cache from persistence (ConfigMap or SQLit)
 * Called periodically and on demand via /apps/sync endpoint
 */
export async function reloadCacheFromPersistence(): Promise<{
  loaded: number
  source: 'configmap' | 'sqlit' | 'none'
}> {
  let loaded = 0
  let source: 'configmap' | 'sqlit' | 'none' = 'none'

  // Try ConfigMap first (K8s environment)
  if (isConfigMapAvailable()) {
    try {
      const configMapApps = await loadAppsFromConfigMap()
      if (configMapApps.length > 0) {
        // Clear cache and reload
        deployedAppsCache.clear()
        for (const app of configMapApps) {
          deployedAppsCache.set(app.name, app)
        }
        loaded = configMapApps.length
        source = 'configmap'
        lastSyncTimestamp = Date.now()
        console.log(`[AppRouter] Synced ${loaded} apps from ConfigMap`)
      }
    } catch (error) {
      console.warn(
        `[AppRouter] ConfigMap sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  // Fall back to SQLit
  if (source === 'none') {
    try {
      const dbApps = await deployedAppState.listEnabled()
      if (dbApps.length > 0) {
        // Merge with existing cache (don't clear - SQLit might have stale data)
        for (const row of dbApps) {
          // Only update if newer than what we have
          const existing = deployedAppsCache.get(row.name)
          if (!existing || row.updated_at > existing.updatedAt) {
            const app: DeployedApp = {
              name: row.name,
              jnsName: row.jns_name,
              frontendCid: row.frontend_cid,
              staticFiles: row.static_files
                ? JSON.parse(row.static_files)
                : null,
              backendWorkerId: row.backend_worker_id,
              backendEndpoint: row.backend_endpoint,
              apiPaths: JSON.parse(row.api_paths),
              spa: row.spa === 1,
              enabled: row.enabled === 1,
              deployedAt: row.deployed_at,
              updatedAt: row.updated_at,
            }
            deployedAppsCache.set(app.name, app)
            loaded++
          }
        }
        source = 'sqlit'
        lastSyncTimestamp = Date.now()
        console.log(`[AppRouter] Synced ${loaded} apps from SQLit`)
      }
    } catch (error) {
      console.warn(
        `[AppRouter] SQLit sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  return { loaded, source }
}

/**
 * Start background sync task
 * Periodically reloads cache from persistence to stay in sync with other pods
 */
let syncIntervalId: ReturnType<typeof setInterval> | null = null

export function startBackgroundSync(): void {
  if (syncIntervalId) return // Already running

  console.log(
    `[AppRouter] Starting background sync (interval: ${SYNC_INTERVAL_MS}ms, pod: ${POD_ID})`,
  )

  syncIntervalId = setInterval(async () => {
    try {
      const { loaded, source } = await reloadCacheFromPersistence()
      if (loaded > 0) {
        console.log(
          `[AppRouter] Background sync: ${loaded} apps from ${source}`,
        )
      }
    } catch (error) {
      console.warn(
        `[AppRouter] Background sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }, SYNC_INTERVAL_MS)
}

export function stopBackgroundSync(): void {
  if (syncIntervalId) {
    clearInterval(syncIntervalId)
    syncIntervalId = null
    console.log('[AppRouter] Stopped background sync')
  }
}

/**
 * Notify other pods of app registration changes
 * Uses the K8s service discovery to find other DWS pods
 */
async function notifyOtherPods(): Promise<void> {
  // In K8s, pods can be discovered via the service DNS
  // DWS service: dws.dws.svc.cluster.local
  // We call the /apps/sync endpoint on the service which load-balances across pods

  // Only attempt if running in K8s
  if (!isConfigMapAvailable()) return

  const podNamespace = process.env.POD_NAMESPACE ?? 'dws'
  const serviceName = process.env.DWS_SERVICE_NAME ?? 'dws'
  const serviceUrl = `http://${serviceName}.${podNamespace}.svc.cluster.local`

  // Fire-and-forget - don't block on pod notification
  // Call sync endpoint multiple times to hit different pods (load balancer will distribute)
  for (let i = 0; i < 3; i++) {
    fetch(`${serviceUrl}/apps/sync`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    }).catch(() => {
      // Ignore errors - best effort notification
    })
  }
}

/**
 * Serve frontend from DWS storage (using individual file CIDs)
 *
 * For decentralized frontends, we store individual files with their own CIDs
 * and use a staticFiles map to look up the CID for each path.
 */
async function serveFrontendFromStorage(
  app: DeployedApp,
  pathname: string,
): Promise<Response> {
  // Determine the file path to fetch
  let path = pathname
  if (path === '/' || path === '') {
    path = 'index.html'
  } else {
    // Remove leading slash for map lookup
    path = path.replace(/^\//, '')
  }

  // For SPA, non-asset routes serve index.html (client-side routing)
  if (app.spa && !isAssetPath(`/${path}`)) {
    path = 'index.html'
  }

  // Try to find CID for this path in staticFiles map
  let fileCid: string | null = null
  if (app.staticFiles) {
    fileCid = app.staticFiles[path] ?? null
    // Also try with dist/ prefix for legacy paths like /dist/web/main.js
    if (!fileCid && path.startsWith('dist/')) {
      const withoutDist = path.replace(/^dist\//, '')
      fileCid = app.staticFiles[withoutDist] ?? null
    }
    // Try web/ prefix for /dist/web/* paths
    if (!fileCid && path.startsWith('dist/web/')) {
      const withoutDistWeb = path.replace(/^dist\/web\//, 'web/')
      fileCid = app.staticFiles[withoutDistWeb] ?? null
    }
  }

  // Fallback to frontendCid as directory (legacy behavior)
  if (!fileCid && app.frontendCid) {
    // Try using IPFS gateway with directory CID
    const gateway = getIpfsGatewayUrl(NETWORK)
    const url = `${gateway}/ipfs/${app.frontendCid}/${path}`
    console.log(`[AppRouter] Trying IPFS directory: ${url}`)

    const response = await fetch(url, {
      headers: { Accept: '*/*' },
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)

    if (response?.ok) {
      const contentType = getContentType(path)
      return new Response(response.body, {
        headers: {
          'Content-Type': contentType,
          'X-DWS-Source': 'ipfs-gateway',
          'X-DWS-CID': app.frontendCid,
        },
      })
    }

    // If IPFS gateway fails, use frontendCid directly as the index.html CID
    if (path === 'index.html') {
      fileCid = app.frontendCid
    }
  }

  if (!fileCid) {
    console.log(`[AppRouter] No CID found for path: ${path}`)
    return new Response('Not Found', { status: 404 })
  }

  // Fetch from DWS storage using the file's CID
  const host = getLocalhostHost()
  const storageUrl =
    NETWORK === 'localnet'
      ? `http://${host}:4030/storage/download/${fileCid}`
      : `https://dws.${NETWORK === 'testnet' ? 'testnet.' : ''}jejunetwork.org/storage/download/${fileCid}`

  console.log(`[AppRouter] Fetching from storage: ${storageUrl}`)

  const response = await fetch(storageUrl, {
    signal: AbortSignal.timeout(10000),
  }).catch((err: Error) => {
    console.error(`[AppRouter] Storage fetch failed: ${err.message}`)
    return null
  })

  if (!response?.ok) {
    console.log(
      `[AppRouter] Storage fetch failed: ${response?.status ?? 'timeout'} for ${fileCid}`,
    )
    return new Response('Not Found', { status: 404 })
  }

  // Determine content type based on file extension
  const contentType = getContentType(path)

  return new Response(response.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control':
        path.includes('.') && !path.endsWith('.html')
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=300',
      'X-DWS-Source': 'storage',
      'X-DWS-CID': fileCid,
    },
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

// Cache for deployed worker function IDs (CID -> functionId)
const workerDeploymentCache = new Map<string, string>()

/**
 * Check if string looks like an IPFS CID
 */
function isIPFSCid(str: string): boolean {
  return str.startsWith('Qm') || str.startsWith('bafy')
}

/**
 * Deploy a worker from CID if not already deployed on this pod
 * @internal Reserved for future lazy worker deployment
 */
export async function ensureWorkerDeployed(
  workerId: string,
  appName: string,
): Promise<string> {
  // If it's a UUID (already deployed), return as-is
  if (!isIPFSCid(workerId)) {
    return workerId
  }

  // Check if we've already deployed this CID on this pod
  const cached = workerDeploymentCache.get(workerId)
  if (cached) {
    return cached
  }

  // Deploy the worker from CID
  const host = getLocalhostHost()
  console.log(`[AppRouter] Deploying worker for ${appName} from CID: ${workerId}`)

  const response = await fetch(`http://${host}:4030/workers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': '0x0000000000000000000000000000000000000000',
    },
    body: JSON.stringify({
      name: appName,
      codeCid: workerId,
      runtime: 'bun',
      handler: 'fetch',
      memory: 512,
      timeout: 60000,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    console.error(`[AppRouter] Failed to deploy worker: ${error}`)
    throw new Error(`Worker deployment failed: ${error}`)
  }

  const result = (await response.json()) as { functionId: string }
  console.log(`[AppRouter] Worker deployed: ${result.functionId}`)

  // Cache the function ID
  workerDeploymentCache.set(workerId, result.functionId)
  return result.functionId
}

/**
 * Proxy request to backend
 */
export async function proxyToBackend(
  request: Request,
  app: DeployedApp,
  pathname: string,
): Promise<Response> {
  let targetUrl: string

  if (app.backendEndpoint) {
    // Direct endpoint (container or external service)
    targetUrl = `${app.backendEndpoint}${pathname}`
  } else if (app.backendWorkerId) {
    // DWS worker - route through workers runtime
    // Pass the CID/functionId directly - workers router handles lazy deployment
    // This ensures each pod can deploy the worker on-demand from IPFS
    const host = getLocalhostHost()
    // Use the CID directly - workers router will lazy-deploy from IPFS if needed
    targetUrl = `http://${host}:4030/workers/${app.backendWorkerId}/http${pathname}`
  } else {
    return new Response(JSON.stringify({ error: 'No backend configured' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const url = new URL(request.url)
  const targetUrlObj = new URL(targetUrl)

  // Copy headers but override Host to match target
  const proxyHeaders = new Headers(request.headers)
  proxyHeaders.set('Host', targetUrlObj.host)
  proxyHeaders.set('X-Forwarded-Host', request.headers.get('host') ?? '')

  const proxyRequest = new Request(targetUrl + url.search, {
    method: request.method,
    headers: proxyHeaders,
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
              staticFiles: null,
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

        // Route to frontend using DWS storage (handles both staticFiles map and frontendCid)
        if (app.frontendCid || app.staticFiles) {
          return serveFrontendFromStorage(app, pathname)
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
            staticFiles: app.staticFiles,
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

      // Sync endpoint - forces cache reload from persistence
      // Use this after updates to ensure all pods have the same state
      .post('/apps/sync', async () => {
        const { loaded, source } = await reloadCacheFromPersistence()
        return {
          success: true,
          podId: POD_ID,
          loaded,
          source,
          cacheSize: deployedAppsCache.size,
          lastSync: lastSyncTimestamp,
        }
      })

      // Health check for app router specifically
      .get('/apps/health', () => ({
        status: 'healthy',
        podId: POD_ID,
        cacheSize: deployedAppsCache.size,
        lastSync: lastSyncTimestamp,
        syncIntervalMs: SYNC_INTERVAL_MS,
        configMapAvailable: isConfigMapAvailable(),
        degradedMode: isDegradedMode(),
      }))

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
          staticFiles: row.static_files ? JSON.parse(row.static_files) : null,
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
          `[AppRouter] Loaded from database: ${app.name} (frontend: ${app.frontendCid ?? 'none'}, staticFiles: ${app.staticFiles ? Object.keys(app.staticFiles).length : 0}, backend: ${app.backendWorkerId ?? app.backendEndpoint ?? 'none'})`,
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
        staticFiles: null,
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
          staticFiles: null,
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

  console.log(
    `[AppRouter] Initialized with ${deployedAppsCache.size} apps (pod: ${POD_ID})`,
  )

  // Start background sync for cross-pod state consistency
  startBackgroundSync()
}
