/**
 * Common utilities shared across routes
 * Business logic extracted from routes
 */

/**
 * Parse pagination parameters from query string
 */
export function parsePagination(
  page: string | undefined,
  perPage: string | undefined,
  defaultPage = 1,
  defaultPerPage = 30
): { page: number; perPage: number; offset: number } {
  const pageNum = page ? parseInt(page, 10) : defaultPage;
  const perPageNum = perPage ? parseInt(perPage, 10) : defaultPerPage;
  
  return {
    page: Math.max(1, pageNum),
    perPage: Math.max(1, Math.min(100, perPageNum)),
    offset: (Math.max(1, pageNum) - 1) * Math.max(1, Math.min(100, perPageNum)),
  };
}

/**
 * Extract client region from headers
 */
export function extractClientRegion(
  xRegion: string | undefined,
  cfIpCountry: string | undefined,
  defaultRegion = 'unknown'
): string {
  return xRegion ?? cfIpCountry ?? defaultRegion;
}

/**
 * Normalize package name (handle URL encoding)
 */
export function normalizePackageName(packageName: string): string {
  return packageName.replace(/%2f/gi, '/').replace(/%2F/gi, '/');
}
