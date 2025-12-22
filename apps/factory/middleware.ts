/**
 * Factory Middleware
 *
 * Security middleware for Next.js API routes:
 * - Security headers (CSP, X-Frame-Options, etc.)
 * - Request size validation
 * - Rate limiting headers
 *
 * Note: Rate limiting should be implemented at the edge/CDN level for production.
 * This middleware adds headers that can be used by upstream rate limiters.
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

// Maximum request body size (10MB)
const MAX_BODY_SIZE = 10 * 1024 * 1024

// Rate limit window (1 minute)
const RATE_LIMIT_WINDOW = 60

// Maximum requests per window
const RATE_LIMIT_MAX = 100

// Security headers to add to all responses
const securityHeaders = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // Rate limit headers (informational - actual enforcement should be at edge)
  'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
  'X-RateLimit-Window': String(RATE_LIMIT_WINDOW),
}

// CSP header (separate due to complexity)
const cspHeader = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Required for Next.js
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https: blob:",
  "font-src 'self' data:",
  "connect-src 'self' wss: ws: https:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

export function middleware(request: NextRequest) {
  // Check content-length for POST/PUT/PATCH requests
  if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
    const contentLength = request.headers.get('content-length')
    if (contentLength) {
      const size = parseInt(contentLength, 10)
      if (size > MAX_BODY_SIZE) {
        return new NextResponse(
          JSON.stringify({
            error: {
              code: 'PAYLOAD_TOO_LARGE',
              message: 'Request body exceeds maximum size',
            },
          }),
          {
            status: 413,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }
    }
  }

  // Get response and add security headers
  const response = NextResponse.next()

  // Add security headers
  for (const [key, value] of Object.entries(securityHeaders)) {
    response.headers.set(key, value)
  }

  // Add CSP header
  response.headers.set('Content-Security-Policy', cspHeader)

  // Add client IP header for rate limiting (when behind proxy)
  const clientIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.ip ||
    'unknown'
  response.headers.set('X-Client-IP', clientIp)

  return response
}

// Configure which routes this middleware runs on
export const config = {
  matcher: [
    // Apply to all API routes
    '/api/:path*',
    // Apply to main pages but exclude static files
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)',
  ],
}
