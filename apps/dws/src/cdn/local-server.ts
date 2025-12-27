/**
 * Local CDN Server - Serves static frontends for all Jeju apps in devnet mode
 *
 * Provides a unified CDN endpoint for all internal Jeju apps:
 * - Serves files from each app's build directory
 * - Applies cache rules from jeju-manifest.json
 * - Supports SPA routing
 * - Provides /apps/* routes for each registered app
 */

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type AppFrontendConfig,
  getAppRegistry,
  initializeAppRegistry,
} from './app-registry'
import { getEdgeCache } from './cache/edge-cache'

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  mjs: 'application/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  webp: 'image/webp',
  avif: 'image/avif',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  eot: 'application/vnd.ms-fontobject',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  map: 'application/json; charset=utf-8',
}

function getContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

function getCacheControl(app: AppFrontendConfig, path: string): string {
  for (const rule of app.cacheRules) {
    if (matchPattern(path, rule.pattern)) {
      const parts: string[] = ['public']
      parts.push(`max-age=${rule.ttl}`)
      if (rule.strategy === 'immutable') parts.push('immutable')
      if (rule.staleWhileRevalidate)
        parts.push(`stale-while-revalidate=${rule.staleWhileRevalidate}`)
      return parts.join(', ')
    }
  }
  return 'public, max-age=60'
}

function matchPattern(path: string, pattern: string): boolean {
  // Convert glob pattern to regex
  // Handle patterns like /**/*.js (any js file at any depth) and /assets/** (anything under assets)
  const PLACEHOLDER = '__GLOB_DOUBLESTAR__'
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, PLACEHOLDER) // Placeholder for **
    .replace(/\*/g, '[^/]+') // * matches one or more non-slash chars
    .replace(new RegExp(`${PLACEHOLDER}/`, 'g'), '(?:.*/)?') // **/ becomes optional path prefix
    .replace(new RegExp(`/${PLACEHOLDER}`, 'g'), '(?:/.*)?') // /** becomes optional path suffix
    .replace(new RegExp(PLACEHOLDER, 'g'), '.*') // standalone ** matches anything

  const regex = new RegExp(`^${regexStr}$`)
  return regex.test(path)
}

async function serveFile(
  app: AppFrontendConfig,
  requestPath: string,
): Promise<Response | null> {
  const filePath = join(app.absoluteDir, requestPath)

  // Security check - ensure path is within app directory
  if (!filePath.startsWith(app.absoluteDir)) {
    return new Response('Forbidden', { status: 403 })
  }

  const fileStat = await stat(filePath).catch(() => null)

  if (!fileStat?.isFile()) {
    // For SPA, try index.html for paths without extensions
    if (app.spa && !requestPath.includes('.')) {
      return serveFile(app, '/index.html')
    }
    return null
  }

  const content = await readFile(filePath)
  const contentType = getContentType(requestPath)
  const cacheControl = getCacheControl(app, requestPath)

  return new Response(content, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(content.length),
      'Cache-Control': cacheControl,
      'X-CDN-App': app.name,
      'X-CDN-Source': 'local',
    },
  })
}

export interface LocalCDNConfig {
  appsDir?: string
  cacheEnabled?: boolean
}

export class LocalCDNServer {
  private config: LocalCDNConfig
  private cache = getEdgeCache()
  private initialized = false

  constructor(config: LocalCDNConfig = {}) {
    this.config = config
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    await initializeAppRegistry(this.config.appsDir)
    this.initialized = true
    console.log('[LocalCDN] Server initialized')
  }

  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const pathname = url.pathname

    // Handle /apps/:appName/* routes
    if (pathname.startsWith('/apps/')) {
      const [, , appName, ...rest] = pathname.split('/')
      const appPath = `/${rest.join('/')}`

      const registry = getAppRegistry()
      const app = registry.getApp(appName)

      if (!app) {
        return new Response(
          JSON.stringify({ error: `App not found: ${appName}` }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      // Check cache first
      const cacheKey = `${appName}:${appPath}`
      const { entry, status } = this.cache.get(cacheKey)

      if (entry && (status === 'HIT' || status === 'STALE')) {
        const headers: Record<string, string> = {
          ...entry.metadata.headers,
          'X-Cache': status,
          'X-CDN-App': appName,
        }
        if (entry.metadata.contentType)
          headers['Content-Type'] = entry.metadata.contentType
        if (entry.metadata.cacheControl)
          headers['Cache-Control'] = entry.metadata.cacheControl
        if (entry.metadata.etag) headers.ETag = entry.metadata.etag

        return new Response(new Uint8Array(entry.data), { headers })
      }

      // Serve from filesystem
      const response = await serveFile(app, appPath || '/index.html')

      if (response) {
        // Cache the response
        if (this.config.cacheEnabled !== false) {
          const body = await response.clone().arrayBuffer()
          this.cache.set(cacheKey, Buffer.from(body), {
            contentType: response.headers.get('Content-Type') ?? undefined,
            cacheControl: response.headers.get('Cache-Control') ?? undefined,
            origin: 'local',
          })
        }

        return response
      }

      return new Response(JSON.stringify({ error: 'File not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Handle /cdn/apps - list all registered apps
    if (pathname === '/cdn/apps') {
      const registry = getAppRegistry()
      const apps = registry.getEnabledApps().map((app) => ({
        name: app.name,
        displayName: app.displayName,
        jnsName: app.jnsName,
        port: app.port,
        spa: app.spa,
        cid: app.cid,
      }))

      return new Response(JSON.stringify({ apps }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  getRegisteredApps(): AppFrontendConfig[] {
    return getAppRegistry().getEnabledApps()
  }
}

let localCDN: LocalCDNServer | null = null

export function getLocalCDNServer(): LocalCDNServer {
  if (!localCDN) {
    localCDN = new LocalCDNServer()
  }
  return localCDN
}

export async function initializeLocalCDN(
  config?: LocalCDNConfig,
): Promise<LocalCDNServer> {
  localCDN = new LocalCDNServer(config)
  await localCDN.initialize()
  return localCDN
}

export function resetLocalCDN(): void {
  localCDN = null
}
