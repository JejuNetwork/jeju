// Browser shim for @jejunetwork/cache
// Cache is server-only, return empty implementation for browser
import type { z } from 'zod'

export const cache = {
  get: async () => undefined,
  set: async () => {},
  delete: async () => {},
  clear: async () => {},
}

export function getCacheClient(namespace: string): typeof cache {
  return cache
}

export function safeParseCached<T>(
  cached: string | null,
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T } },
): T | null {
  if (cached === null) return null
  try {
    const parsed = JSON.parse(cached)
    const result = schema.safeParse(parsed)
    return result.success && result.data ? result.data : null
  } catch {
    return null
  }
}

export type CacheClient = typeof cache

export default cache
