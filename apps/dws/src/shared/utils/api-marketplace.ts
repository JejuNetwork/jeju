/**
 * API Marketplace utilities
 * Business logic extracted from routes
 */

/**
 * Extract origin domain from request headers
 */
export function extractOriginDomain(origin: string | undefined, referer: string | undefined): string | undefined {
  const url = origin || referer;
  if (!url) return undefined;
  
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
