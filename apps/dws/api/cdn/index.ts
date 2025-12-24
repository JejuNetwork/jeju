/**
 * CDN Module
 * Provides edge caching and content delivery functionality
 */

export interface EdgeCache {
  get(key: string): Promise<Response | null>
  put(key: string, response: Response, ttl?: number): Promise<void>
  delete(key: string): Promise<void>
}

// In-memory cache for development
const memoryCache = new Map<string, { response: Response; expires: number }>()

class MemoryEdgeCache implements EdgeCache {
  async get(key: string): Promise<Response | null> {
    const entry = memoryCache.get(key)
    if (!entry) return null
    if (entry.expires < Date.now()) {
      memoryCache.delete(key)
      return null
    }
    return entry.response.clone()
  }

  async put(key: string, response: Response, ttl = 3600): Promise<void> {
    memoryCache.set(key, {
      response: response.clone(),
      expires: Date.now() + ttl * 1000,
    })
  }

  async delete(key: string): Promise<void> {
    memoryCache.delete(key)
  }
}

let edgeCache: EdgeCache | null = null

export function getEdgeCache(): EdgeCache {
  if (!edgeCache) {
    edgeCache = new MemoryEdgeCache()
  }
  return edgeCache
}

export interface OriginFetcher {
  fetch(url: string, init?: RequestInit): Promise<Response>
}

class DefaultOriginFetcher implements OriginFetcher {
  async fetch(url: string, init?: RequestInit): Promise<Response> {
    return fetch(url, init)
  }
}

let originFetcher: OriginFetcher | null = null

export function getOriginFetcher(): OriginFetcher {
  if (!originFetcher) {
    originFetcher = new DefaultOriginFetcher()
  }
  return originFetcher
}
