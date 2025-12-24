/**
 * Access Control
 *
 * Domain and endpoint allowlisting/blacklisting for API listings
 */

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
  lastAccess: number // Track last access time for cleanup
}

const rateLimits = new Map<string, RateLimitState>()

// Memory safety: max entries and cleanup interval
const MAX_RATE_LIMIT_ENTRIES = 100000
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60_000 // 1 minute
const RATE_LIMIT_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000 // 24 hours

// Cleanup stale rate limit entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, state] of rateLimits) {
    // Remove entries that haven't been accessed in 24 hours
    if (now - state.lastAccess > RATE_LIMIT_STALE_THRESHOLD_MS) {
      rateLimits.delete(key)
    }
  }
}, RATE_LIMIT_CLEANUP_INTERVAL_MS)

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
 * Get current rate limit state
 * Includes bounds checking to prevent memory exhaustion
 */
function getRateLimitState(key: string): RateLimitState {
  const now = Date.now()
  let state = rateLimits.get(key)

  if (!state) {
    // Prevent memory exhaustion - evict oldest entries if at limit
    if (rateLimits.size >= MAX_RATE_LIMIT_ENTRIES) {
      // Find and remove the oldest entry (by lastAccess)
      let oldestKey: string | null = null
      let oldestAccess = Infinity
      for (const [k, s] of rateLimits) {
        if (s.lastAccess < oldestAccess) {
          oldestAccess = s.lastAccess
          oldestKey = k
        }
      }
      if (oldestKey) {
        rateLimits.delete(oldestKey)
      }
    }

    state = {
      second: { count: 0, reset: now + 1000 },
      minute: { count: 0, reset: now + 60000 },
      day: { count: 0, reset: now + 86400000 },
      month: { count: 0, reset: now + 2592000000 },
      lastAccess: now,
    }
    rateLimits.set(key, state)
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
 * Check if request is within rate limits
 */
export function checkRateLimit(
  userAddress: Address,
  listingId: string,
  limits: UsageLimits,
): { allowed: boolean; reason?: string; retryAfter?: number } {
  const key = getRateLimitKey(userAddress, listingId)
  const state = getRateLimitState(key)
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
export function incrementRateLimit(
  userAddress: Address,
  listingId: string,
): void {
  const key = getRateLimitKey(userAddress, listingId)
  const state = getRateLimitState(key)

  state.second.count++
  state.minute.count++
  state.day.count++
  state.month.count++
}

/**
 * Get current rate limit usage
 */
export function getRateLimitUsage(
  userAddress: Address,
  listingId: string,
  limits: UsageLimits,
): {
  second: { used: number; limit: number; reset: number }
  minute: { used: number; limit: number; reset: number }
  day: { used: number; limit: number; reset: number }
  month: { used: number; limit: number; reset: number }
} {
  const key = getRateLimitKey(userAddress, listingId)
  const state = getRateLimitState(key)

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
export function checkAccess(
  userAddress: Address,
  listing: APIListing,
  endpoint: string,
  method: string,
  originDomain?: string,
): AccessCheckResult {
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
  const rateLimitCheck = checkRateLimit(userAddress, listing.id, listing.limits)
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
