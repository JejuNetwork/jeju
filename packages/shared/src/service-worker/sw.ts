/**
 * Jeju Network Service Worker
 * Provides offline support, caching, and decentralized fallbacks
 */

/// <reference lib="webworker" />
/// <reference lib="webworker.importscripts" />

// ServiceWorker types
interface ExtendableEvent extends Event {
  waitUntil(fn: Promise<unknown>): void
}

interface FetchEvent extends ExtendableEvent {
  request: Request
  respondWith(response: Promise<Response> | Response): void
}

interface ExtendableMessageEvent extends ExtendableEvent {
  data: unknown
  source: Client | ServiceWorker | MessagePort | null
}

declare const self: {
  skipWaiting(): void
  clients: Clients
  addEventListener(
    type: 'install',
    listener: (event: ExtendableEvent) => void,
  ): void
  addEventListener(
    type: 'activate',
    listener: (event: ExtendableEvent) => void,
  ): void
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void
  addEventListener(
    type: 'message',
    listener: (event: ExtendableMessageEvent) => void,
  ): void
}

export type {} // Make this a module

// Cache names
const STATIC_CACHE = 'jeju-static-v1'
const DYNAMIC_CACHE = 'jeju-dynamic-v1'
const API_CACHE = 'jeju-api-v1'

// JNS Gateway URLs for fallback
const JNS_GATEWAYS = [
  'https://jns.jejunetwork.org',
  'https://ipfs.jejunetwork.org',
  'https://cloudflare-ipfs.com',
  'https://dweb.link',
]

// IPFS Gateways for fallback
const IPFS_GATEWAYS = [
  'https://ipfs.jejunetwork.org',
  'https://cloudflare-ipfs.com',
  'https://dweb.link',
  'https://ipfs.io',
]

interface CacheConfig {
  staticAssets: string[]
  apiPatterns: RegExp[]
  immutablePatterns: RegExp[]
  offlinePages: string[]
}

// Default configuration
const defaultConfig: CacheConfig = {
  staticAssets: ['/', '/index.html', '/offline.html'],
  apiPatterns: [/\/api\//],
  immutablePatterns: [/\/assets\/[a-f0-9]{8,}\./, /\.immutable\./],
  offlinePages: ['/offline.html'],
}

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(defaultConfig.staticAssets)
    }),
  )
  // Activate immediately
  self.skipWaiting()
})

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => !key.startsWith('jeju-'))
          .map((key) => caches.delete(key)),
      )
    }),
  )
  // Take control of all clients
  self.clients.claim()
})

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return
  }

  // Skip chrome-extension and other non-http requests
  if (!url.protocol.startsWith('http')) {
    return
  }

  // Handle API requests
  if (defaultConfig.apiPatterns.some((p) => p.test(url.pathname))) {
    event.respondWith(handleApiRequest(event.request))
    return
  }

  // Handle immutable assets (content-addressed)
  if (defaultConfig.immutablePatterns.some((p) => p.test(url.pathname))) {
    event.respondWith(handleImmutableRequest(event.request))
    return
  }

  // Handle IPFS requests
  if (url.pathname.startsWith('/ipfs/') || url.pathname.startsWith('/ipns/')) {
    event.respondWith(handleIpfsRequest(event.request))
    return
  }

  // Handle JNS requests
  if (url.hostname.endsWith('.jeju') || url.pathname.startsWith('/jns/')) {
    event.respondWith(handleJnsRequest(event.request))
    return
  }

  // Default: stale-while-revalidate
  event.respondWith(handleStaleWhileRevalidate(event.request))
})

async function handleApiRequest(request: Request): Promise<Response> {
  const cacheKey = new Request(request.url, { headers: request.headers })

  // Try network first for API
  try {
    const response = await fetch(request)

    // Cache successful GET responses
    if (response.ok) {
      const cache = await caches.open(API_CACHE)
      // Clone response before caching
      cache.put(cacheKey, response.clone())
    }

    return response
  } catch {
    // Fall back to cache
    const cached = await caches.match(cacheKey)
    if (cached) {
      return cached
    }

    // Return offline response
    return new Response(
      JSON.stringify({ error: 'offline', message: 'Network unavailable' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )
  }
}

async function handleImmutableRequest(request: Request): Promise<Response> {
  // Try cache first for immutable assets
  const cached = await caches.match(request)
  if (cached) {
    return cached
  }

  // Fetch and cache permanently
  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE)
    cache.put(request, response.clone())
  }

  return response
}

async function handleIpfsRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const ipfsPath = url.pathname

  // Try cache first
  const cached = await caches.match(request)
  if (cached) {
    return cached
  }

  // Try each gateway
  for (const gateway of IPFS_GATEWAYS) {
    try {
      const gatewayUrl = `${gateway}${ipfsPath}`
      const response = await fetch(gatewayUrl, {
        headers: request.headers,
      })

      if (response.ok) {
        // Cache IPFS content permanently (content-addressed)
        if (ipfsPath.startsWith('/ipfs/')) {
          const cache = await caches.open(STATIC_CACHE)
          cache.put(request, response.clone())
        }
        return response
      }
    } catch (error) {
      // Gateway unavailable, try next one
      console.debug(
        `[SW] IPFS gateway ${gateway} failed:`,
        error instanceof Error ? error.message : 'Unknown error',
      )
    }
  }

  return new Response('Content not found', { status: 404 })
}

async function handleJnsRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)

  // Try each JNS gateway
  for (const gateway of JNS_GATEWAYS) {
    try {
      const jnsUrl = `${gateway}${url.pathname}${url.search}`
      const response = await fetch(jnsUrl, {
        headers: request.headers,
      })

      if (response.ok) {
        return response
      }
    } catch (error) {
      // Gateway unavailable, try next one
      console.debug(
        `[SW] JNS gateway ${gateway} failed:`,
        error instanceof Error ? error.message : 'Unknown error',
      )
    }
  }

  // Try to get from cache as last resort
  const cached = await caches.match(request)
  if (cached) {
    return cached
  }

  return new Response('JNS resolution failed', { status: 502 })
}

async function handleStaleWhileRevalidate(request: Request): Promise<Response> {
  const cache = await caches.open(DYNAMIC_CACHE)
  const cached = await cache.match(request)

  // Revalidate in background
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone())
      }
      return response
    })
    .catch(() => cached ?? new Response('Offline', { status: 503 }))

  // Return cached immediately if available, otherwise wait for network
  return cached ?? (await fetchPromise)
}

// Message handler for cache control
self.addEventListener('message', (event) => {
  const data = event.data as { type: string; urls?: string[] }
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }

  if (data.type === 'CACHE_URLS' && data.urls) {
    event.waitUntil(
      caches.open(STATIC_CACHE).then((cache) => {
        return cache.addAll(data.urls as string[])
      }),
    )
  }

  if (data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((keys) => {
        return Promise.all(keys.map((key) => caches.delete(key)))
      }),
    )
  }
})
