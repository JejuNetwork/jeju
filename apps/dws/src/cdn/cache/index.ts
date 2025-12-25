/**
 * Cache Module Exports
 */

export type { EdgeCacheConfig } from './edge-cache'
export { EdgeCache, getEdgeCache, resetEdgeCache } from './edge-cache'

export {
  getOriginFetcher,
  OriginFetcher,
  resetOriginFetcher,
} from './origin-fetcher'
