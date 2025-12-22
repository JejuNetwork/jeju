/**
 * Leaderboard Authentication
 *
 * Uses OAuth3 + MPC KMS for token verification.
 * Supports both wallet-signed tokens and MPC-signed tokens.
 */

import { type TokenClaims, verifyToken } from '@jejunetwork/kms'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes, verifyMessage } from 'viem'
import { GitHubUserResponseSchema } from '../lib/validation.js'
import { LEADERBOARD_CONFIG } from './config.js'
import { query } from './db.js'

type GitHubUserResponse = {
  id: number
  login: string
  name?: string | null
  email?: string | null
  avatar_url: string
}

export interface AuthenticatedUser {
  /** GitHub username */
  username: string
  /** GitHub avatar URL */
  avatarUrl: string
  /** Linked wallet address (if any) */
  wallet?: Address
  /** Chain ID (CAIP-2 format) */
  chainId?: string
  /** Token claims */
  claims: TokenClaims
}

export interface AuthResult {
  success: true
  user: AuthenticatedUser
}

export interface AuthError {
  success: false
  error: string
  status: 400 | 401 | 403 | 404 | 500
}

export type AuthOutcome = AuthResult | AuthError

/**
 * Rate limiting state using LRU cache to prevent memory leaks
 * SECURITY: Bounded cache prevents memory exhaustion attacks
 */
import { LRUCache } from 'lru-cache'

const rateLimitState = new LRUCache<string, { count: number; resetAt: number }>(
  {
    max: 50000, // Max 50k unique clients tracked
    ttl: 60 * 60 * 1000, // 1 hour TTL
  },
)

/**
 * Check rate limit for a client
 */
export function checkRateLimit(
  clientId: string,
  config: { requests: number; windowMs: number },
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now()
  const key = clientId
  const state = rateLimitState.get(key)

  if (!state || now > state.resetAt) {
    rateLimitState.set(key, { count: 1, resetAt: now + config.windowMs })
    return {
      allowed: true,
      remaining: config.requests - 1,
      resetAt: now + config.windowMs,
    }
  }

  if (state.count >= config.requests) {
    return { allowed: false, remaining: 0, resetAt: state.resetAt }
  }

  state.count++
  return {
    allowed: true,
    remaining: config.requests - state.count,
    resetAt: state.resetAt,
  }
}

/**
 * Check if an IP is a private/local address that could be spoofed
 * SECURITY: Filter out private IPs from X-Forwarded-For to prevent spoofing
 */
function isPrivateIp(ip: string): boolean {
  if (
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('127.') ||
    ip.startsWith('172.16.') ||
    ip.startsWith('172.17.') ||
    ip.startsWith('172.18.') ||
    ip.startsWith('172.19.') ||
    ip.startsWith('172.20.') ||
    ip.startsWith('172.21.') ||
    ip.startsWith('172.22.') ||
    ip.startsWith('172.23.') ||
    ip.startsWith('172.24.') ||
    ip.startsWith('172.25.') ||
    ip.startsWith('172.26.') ||
    ip.startsWith('172.27.') ||
    ip.startsWith('172.28.') ||
    ip.startsWith('172.29.') ||
    ip.startsWith('172.30.') ||
    ip.startsWith('172.31.') ||
    ip === 'localhost' ||
    ip === '::1'
  ) {
    return true
  }
  return false
}

/**
 * Get client identifier from request
 * SECURITY: Uses rightmost non-private IP from X-Forwarded-For to prevent spoofing
 * The rightmost IP is added by our most trusted proxy
 */
export function getClientId(request: Request): string {
  // X-Real-IP is typically set by nginx and is more trustworthy
  const realIp = request.headers.get('x-real-ip')
  if (realIp) {
    return realIp.trim()
  }

  // For X-Forwarded-For, we take the rightmost non-private IP
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    // Split and reverse to get rightmost first
    const ips = forwarded
      .split(',')
      .map((ip) => ip.trim())
      .reverse()
    for (const ip of ips) {
      if (ip && !isPrivateIp(ip)) {
        return ip
      }
    }
    // If all IPs are private, use the last one (closest to us)
    if (ips[0]) return ips[0]
  }

  return 'unknown'
}

/**
 * Authenticate request using Authorization header
 *
 * Supports:
 * - Bearer <token> - JWT-like token (MPC or wallet signed)
 * - GitHub <pat> - GitHub personal access token (legacy)
 */
export async function authenticateRequest(
  request: Request,
): Promise<AuthOutcome> {
  const authHeader = request.headers.get('authorization')

  if (!authHeader) {
    return {
      success: false,
      error: 'Authorization header required',
      status: 401,
    }
  }

  const [scheme, credential] = authHeader.split(' ', 2)

  if (scheme.toLowerCase() === 'bearer') {
    return authenticateToken(credential)
  }

  if (scheme.toLowerCase() === 'github') {
    return authenticateGitHub(credential)
  }

  return {
    success: false,
    error: 'Unsupported authorization scheme',
    status: 401,
  }
}

/**
 * Authenticate using JWT-like token
 */
async function authenticateToken(token: string): Promise<AuthOutcome> {
  const result = await verifyToken(token, {
    issuer: LEADERBOARD_CONFIG.domain.tokenIssuer,
    audience: LEADERBOARD_CONFIG.domain.tokenAudience,
  })

  if (!result.valid || !result.claims) {
    return {
      success: false,
      error: result.error || 'Invalid token',
      status: 401,
    }
  }

  const claims = result.claims

  if (!claims.sub) {
    return { success: false, error: 'Token missing subject', status: 401 }
  }

  // Look up user
  const users = await query<{ username: string; avatar_url: string }>(
    'SELECT username, avatar_url FROM users WHERE username = ?',
    [claims.sub],
  )

  if (users.length === 0) {
    return { success: false, error: 'User not found', status: 404 }
  }

  return {
    success: true,
    user: {
      username: users[0].username,
      avatarUrl: users[0].avatar_url,
      wallet: claims.wallet,
      chainId: claims.chainId,
      claims,
    },
  }
}

/**
 * Authenticate using GitHub token (PAT or OAuth token)
 */
async function authenticateGitHub(token: string): Promise<AuthOutcome> {
  let profile: GitHubUserResponse

  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    })

    if (!response.ok) {
      return { success: false, error: 'Invalid GitHub token', status: 401 }
    }

    const rawProfile = await response.json()
    const parseResult = GitHubUserResponseSchema.safeParse(rawProfile)
    if (!parseResult.success) {
      return {
        success: false,
        error: 'Invalid GitHub API response',
        status: 401,
      }
    }
    profile = parseResult.data
  } catch {
    return { success: false, error: 'GitHub API error', status: 401 }
  }

  const username = profile.login
  const avatarUrl = profile.avatar_url || ''

  // Ensure user exists in database
  const users = await query<{ username: string; avatar_url: string }>(
    'SELECT username, avatar_url FROM users WHERE username = ?',
    [username],
  )

  if (users.length === 0) {
    // Create user if not exists
    await query(
      'INSERT OR IGNORE INTO users (username, avatar_url, is_bot, last_updated) VALUES (?, ?, 0, ?)',
      [username, avatarUrl, new Date().toISOString()],
    )
  }

  return {
    success: true,
    user: {
      username,
      avatarUrl,
      claims: {
        sub: username,
        iss: LEADERBOARD_CONFIG.domain.tokenIssuer,
        aud: LEADERBOARD_CONFIG.domain.tokenAudience,
        iat: Math.floor(Date.now() / 1000),
        exp:
          Math.floor(Date.now() / 1000) +
          LEADERBOARD_CONFIG.tokens.expirySeconds,
        jti: crypto.randomUUID(),
        provider: 'github',
      },
    },
  }
}

/**
 * Verify that authenticated user owns the requested resource
 */
export function verifyUserOwnership(
  user: AuthenticatedUser,
  username: string,
): boolean {
  return user.username.toLowerCase() === username.toLowerCase()
}

/**
 * Generate verification message for wallet signing
 */
export function generateVerificationMessage(
  username: string,
  walletAddress: string | null,
  timestamp: number,
  nonce: string,
): string {
  const walletPart = walletAddress ? `\nWallet: ${walletAddress}` : ''
  return `I verify that GitHub user "${username}" owns this wallet.
${walletPart}
Timestamp: ${timestamp}
Nonce: ${nonce}
Domain: ${LEADERBOARD_CONFIG.domain.domain}
Purpose: ERC-8004 Identity Verification

This signature proves wallet ownership and allows reputation attestation on the Network.`
}

/**
 * Verify wallet signature
 */
export async function verifyWalletSignature(
  walletAddress: Address,
  message: string,
  signature: Hex,
): Promise<boolean> {
  return verifyMessage({ address: walletAddress, message, signature })
}

/**
 * Generate nonce for verification
 */
export function generateNonce(username: string): string {
  const data = `${username}-${Date.now()}-${Math.random()}`
  return keccak256(toBytes(data)).slice(0, 18)
}

/**
 * CORS headers for API responses
 */
export function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') || '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  }
}
