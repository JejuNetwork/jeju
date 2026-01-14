/**
 * Browser shim for @jejunetwork/cache
 * The cache client is server-side only - these are no-op stubs for browser
 */

export interface CacheClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttl?: number): Promise<void>
  delete(key: string): Promise<void>
  keys(pattern: string): Promise<string[]>
}

// Browser stub - returns a no-op cache client
export function getCacheClient(): CacheClient {
  return {
    get: async () => null,
    set: async () => {},
    delete: async () => {},
    keys: async () => [],
  }
}

export function resetCacheClients(): void {
  // No-op in browser
}

export function safeParseCached<T>(
  cached: string | null,
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T } },
): T | null {
  if (cached === null) return null
  try {
    const parsed = JSON.parse(cached)
    const result = schema.safeParse(parsed)
    if (result.success && result.data !== undefined) {
      return result.data
    }
    return null
  } catch {
    return null
  }
}

export const CacheClient = {} as const
