/**
 * Access Control
 *
 * Domain and endpoint allowlisting/blacklisting for API listings
 */

import { type CacheClient, getCacheClient } from '@jejunetwork/shared'
import type { Address } from 'viem'
import type { AccessControl, APIListing, UsageLimits } from './types'

// API Marketplace only supports these 5 HTTP methods
type ApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
const API_METHODS = new Set<ApiMethod>([
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
])

function isApiMethod(value: string): value is ApiMethod {
  return API_METHODS.has(value.toUpperCase() as ApiMethod)
}

// Rate Limiting State

interface RateLimitState {
  second: { count: number; reset: number }
  minute: { count: number; reset: number }
  day: { count: number; reset: number }
  month: { count: number; reset: number }
  lastAccess: number
}

// Distributed rate limit cache - TTL capped at 7 days (cache server max)
// Rate limits reset within windows anyway, so shorter TTL is fine
const RATE_LIMIT_TTL_SECONDS = 7 * 24 * 60 * 60 // 7 days (604800)

let rateLimitCache: CacheClient | null = null

function getRateLimitCache(): CacheClient {
  if (!rateLimitCache) {
    rateLimitCache = getCacheClient('api-marketplace-ratelimit')
  }
  return rateLimitCache
}

// Pattern Matching

// Max pattern length to prevent ReDoS attacks
const MAX_PATTERN_LENGTH = 500

/**
 * Convert a glob pattern to regex
 * Supports: * (any chars), ** (any path), ? (single char)
 * Protected against ReDoS with pattern length limits and non-backtracking patterns
 */
function globToRegex(pattern: string): RegExp {
  // Prevent ReDoS by limiting pattern length
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error(`Pattern too long (max ${MAX_PATTERN_LENGTH} characters)`)
  }

  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
    .replace(/\*\*/g, '{{GLOBSTAR}}') // Temp replace **
    .replace(/\*/g, '[^/]*?') // * matches anything except / (non-greedy to prevent backtracking)
    .replace(/\?/g, '[^/]') // ? matches single char (more restrictive)
    .replace(/{{GLOBSTAR}}/g, '.*?') // ** matches anything (non-greedy)

  return new RegExp(`^${escaped}$`, 'i')
}

/**
 * Check if a string matches any pattern in a list
 */
function matchesAnyPattern(value: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern === '*') return true
    const regex = globToRegex(pattern)
    if (regex.test(value)) return true
  }
  return false
}

// Domain Access Control

/**
 * Check if a domain is allowed
 */
export function isDomainAllowed(
  domain: string,
  accessControl: AccessControl,
): { allowed: boolean; reason?: string } {
  // Check blocklist first
  if (matchesAnyPattern(domain, accessControl.blockedDomains)) {
    return { allowed: false, reason: `Domain '${domain}' is blocked` }
  }

  // Check allowlist
  if (!matchesAnyPattern(domain, accessControl.allowedDomains)) {
    return { allowed: false, reason: `Domain '${domain}' is not in allowlist` }
  }

  return { allowed: true }
}

// Endpoint Access Control

/**
 * Check if an endpoint is allowed
 */
export function isEndpointAllowed(
  endpoint: string,
  accessControl: AccessControl,
): { allowed: boolean; reason?: string } {
  // Normalize endpoint (remove leading slash, query params)
  const normalizedEndpoint = endpoint.split('?')[0].replace(/^\/+/, '')

  // Check blocklist first
  if (matchesAnyPattern(normalizedEndpoint, accessControl.blockedEndpoints)) {
    return { allowed: false, reason: `Endpoint '${endpoint}' is blocked` }
  }
  if (matchesAnyPattern(endpoint, accessControl.blockedEndpoints)) {
    return { allowed: false, reason: `Endpoint '${endpoint}' is blocked` }
  }

  // Check allowlist
  if (
    !matchesAnyPattern(normalizedEndpoint, accessControl.allowedEndpoints) &&
    !matchesAnyPattern(endpoint, accessControl.allowedEndpoints)
  ) {
    return {
      allowed: false,
      reason: `Endpoint '${endpoint}' is not in allowlist`,
    }
  }

  return { allowed: true }
}

/**
 * Check if HTTP method is allowed
 */
export function isMethodAllowed(
  method: string,
  accessControl: AccessControl,
): { allowed: boolean; reason?: string } {
  const upperMethod = method.toUpperCase()

  // Validate it's a known API method
  if (!isApiMethod(upperMethod)) {
    return { allowed: false, reason: `Unknown HTTP method '${method}'` }
  }

  if (!accessControl.allowedMethods.includes(upperMethod)) {
    return { allowed: false, reason: `HTTP method '${method}' is not allowed` }
  }

  return { allowed: true }
}

// Rate Limiting

/**
 * Get rate limit key for a user+listing combination
 */
function getRateLimitKey(userAddress: Address, listingId: string): string {
  return `${userAddress.toLowerCase()}:${listingId}`
}

/**
 * Get current rate limit state from distributed cache
 */
async function getRateLimitState(key: string): Promise<RateLimitState> {
  const cache = getRateLimitCache()
  const cacheKey = `marketplace-ratelimit:${key}`
  const now = Date.now()

  const cached = await cache.get(cacheKey)
  let state: RateLimitState

  if (cached) {
    state = JSON.parse(cached)
  } else {
    state = {
      second: { count: 0, reset: now + 1000 },
      minute: { count: 0, reset: now + 60000 },
      day: { count: 0, reset: now + 86400000 },
      month: { count: 0, reset: now + 2592000000 },
      lastAccess: now,
    }
  }

  // Update last access time
  state.lastAccess = now

  // Reset expired windows
  if (now >= state.second.reset) {
    state.second = { count: 0, reset: now + 1000 }
  }
  if (now >= state.minute.reset) {
    state.minute = { count: 0, reset: now + 60000 }
  }
  if (now >= state.day.reset) {
    state.day = { count: 0, reset: now + 86400000 }
  }
  if (now >= state.month.reset) {
    state.month = { count: 0, reset: now + 2592000000 }
  }

  return state
}

/**
 * Save rate limit state to distributed cache
 */
async function saveRateLimitState(
  key: string,
  state: RateLimitState,
): Promise<void> {
  const cache = getRateLimitCache()
  const cacheKey = `marketplace-ratelimit:${key}`
  await cache.set(cacheKey, JSON.stringify(state), RATE_LIMIT_TTL_SECONDS)
}

/**
 * Check if request is within rate limits
 */
export async function checkRateLimit(
  userAddress: Address,
  listingId: string,
  limits: UsageLimits,
): Promise<{ allowed: boolean; reason?: string; retryAfter?: number }> {
  const key = getRateLimitKey(userAddress, listingId)
  const state = await getRateLimitState(key)
  const now = Date.now()

  // Check each limit
  if (state.second.count >= limits.requestsPerSecond) {
    return {
      allowed: false,
      reason: `Rate limit exceeded: ${limits.requestsPerSecond}/second`,
      retryAfter: Math.ceil((state.second.reset - now) / 1000),
    }
  }

  if (state.minute.count >= limits.requestsPerMinute) {
    return {
      allowed: false,
      reason: `Rate limit exceeded: ${limits.requestsPerMinute}/minute`,
      retryAfter: Math.ceil((state.minute.reset - now) / 1000),
    }
  }

  if (state.day.count >= limits.requestsPerDay) {
    return {
      allowed: false,
      reason: `Rate limit exceeded: ${limits.requestsPerDay}/day`,
      retryAfter: Math.ceil((state.day.reset - now) / 1000),
    }
  }

  if (state.month.count >= limits.requestsPerMonth) {
    return {
      allowed: false,
      reason: `Rate limit exceeded: ${limits.requestsPerMonth}/month`,
      retryAfter: Math.ceil((state.month.reset - now) / 1000),
    }
  }

  return { allowed: true }
}

/**
 * Increment rate limit counters after successful request
 */
export async function incrementRateLimit(
  userAddress: Address,
  listingId: string,
): Promise<void> {
  const key = getRateLimitKey(userAddress, listingId)
  const state = await getRateLimitState(key)

  state.second.count++
  state.minute.count++
  state.day.count++
  state.month.count++

  await saveRateLimitState(key, state)
}

/**
 * Get current rate limit usage
 */
export async function getRateLimitUsage(
  userAddress: Address,
  listingId: string,
  limits: UsageLimits,
): Promise<{
  second: { used: number; limit: number; reset: number }
  minute: { used: number; limit: number; reset: number }
  day: { used: number; limit: number; reset: number }
  month: { used: number; limit: number; reset: number }
}> {
  const key = getRateLimitKey(userAddress, listingId)
  const state = await getRateLimitState(key)

  return {
    second: {
      used: state.second.count,
      limit: limits.requestsPerSecond,
      reset: state.second.reset,
    },
    minute: {
      used: state.minute.count,
      limit: limits.requestsPerMinute,
      reset: state.minute.reset,
    },
    day: {
      used: state.day.count,
      limit: limits.requestsPerDay,
      reset: state.day.reset,
    },
    month: {
      used: state.month.count,
      limit: limits.requestsPerMonth,
      reset: state.month.reset,
    },
  }
}

// Full Access Check

export interface AccessCheckResult {
  allowed: boolean
  reason?: string
  retryAfter?: number
}

/**
 * Perform full access control check
 */
export async function checkAccess(
  userAddress: Address,
  listing: APIListing,
  endpoint: string,
  method: string,
  originDomain?: string,
): Promise<AccessCheckResult> {
  // Check if listing is active
  if (!listing.active) {
    return { allowed: false, reason: 'Listing is not active' }
  }

  // Check domain if provided
  if (originDomain) {
    const domainCheck = isDomainAllowed(originDomain, listing.accessControl)
    if (!domainCheck.allowed) {
      return domainCheck
    }
  }

  // Check endpoint
  const endpointCheck = isEndpointAllowed(endpoint, listing.accessControl)
  if (!endpointCheck.allowed) {
    return endpointCheck
  }

  // Check method
  const methodCheck = isMethodAllowed(method, listing.accessControl)
  if (!methodCheck.allowed) {
    return methodCheck
  }

  // Check rate limits
  const rateLimitCheck = await checkRateLimit(
    userAddress,
    listing.id,
    listing.limits,
  )
  if (!rateLimitCheck.allowed) {
    return rateLimitCheck
  }

  return { allowed: true }
}

// Access Control Builder

/**
 * Builder for creating access control configurations
 */
export class AccessControlBuilder {
  private config: AccessControl = {
    allowedDomains: ['*'],
    blockedDomains: [],
    allowedEndpoints: ['*'],
    blockedEndpoints: [],
    allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  }

  allowDomains(...domains: string[]): this {
    this.config.allowedDomains = domains
    return this
  }

  blockDomains(...domains: string[]): this {
    this.config.blockedDomains = domains
    return this
  }

  allowEndpoints(...endpoints: string[]): this {
    this.config.allowedEndpoints = endpoints
    return this
  }

  blockEndpoints(...endpoints: string[]): this {
    this.config.blockedEndpoints = endpoints
    return this
  }

  allowMethods(...methods: AccessControl['allowedMethods']): this {
    this.config.allowedMethods = methods
    return this
  }

  readOnly(): this {
    this.config.allowedMethods = ['GET']
    return this
  }

  build(): AccessControl {
    return { ...this.config }
  }
}

/**
 * Create a new access control builder
 */
export function accessControl(): AccessControlBuilder {
  return new AccessControlBuilder()
}
