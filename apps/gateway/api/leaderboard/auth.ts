import { isProductionEnv } from '@jejunetwork/config'
import { type TokenClaims, verifyToken } from '@jejunetwork/kms'
import { LRUCache } from 'lru-cache'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes, verifyMessage } from 'viem'
import { GitHubUserResponseSchema } from '../../lib/validation'
import { isPrivateIp } from '../rpc/middleware/rate-limiter'
import { LEADERBOARD_CONFIG } from './config'
import { query } from './db'

type GitHubUserResponse = {
  id: number
  login: string
  name?: string | null
  email?: string | null
  avatar_url: string
}

export interface AuthenticatedUser {
  username: string
  avatarUrl: string
  wallet?: Address
  chainId?: string
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
 * Type guard to check if an auth result is an error
 */
export function isAuthError(result: AuthOutcome): result is AuthError {
  return result.success === false
}

const rateLimitState = new LRUCache<string, { count: number; resetAt: number }>(
  {
    max: 50000,
    ttl: 60 * 60 * 1000,
  },
)

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
 * SECURITY: Validate IP address format to prevent header injection
 */
function isValidIpAddress(ip: string): boolean {
  const ipv4Regex =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
  const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$/
  return ipv4Regex.test(ip) || ipv6Regex.test(ip)
}

/**
 * SECURITY: Only trust proxy headers in development or when explicitly configured
 */
const TRUST_PROXY_HEADERS =
  !isProductionEnv() || process.env.TRUST_PROXY_HEADERS === 'true'

export function getClientId(request: Request): string {
  // SECURITY: Only trust proxy headers if explicitly configured
  if (TRUST_PROXY_HEADERS) {
    const realIp = request.headers.get('x-real-ip')
    if (realIp) {
      const trimmedIp = realIp.trim()
      // SECURITY: Validate IP format to prevent header injection
      if (isValidIpAddress(trimmedIp)) {
        return trimmedIp
      }
    }

    const forwarded = request.headers.get('x-forwarded-for')
    if (forwarded) {
      const ips = forwarded
        .split(',')
        .map((ip) => ip.trim())
        .filter(isValidIpAddress)
        .reverse()
      for (const ip of ips) {
        if (ip && !isPrivateIp(ip)) {
          return ip
        }
      }
      if (ips[0]) return ips[0]
    }
  }

  return 'unknown'
}

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

  const users = await query<{ username: string; avatar_url: string }>(
    'SELECT username, avatar_url FROM users WHERE username = ?',
    [username],
  )

  if (users.length === 0) {
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

export function verifyUserOwnership(
  user: AuthenticatedUser,
  username: string,
): boolean {
  return user.username.toLowerCase() === username.toLowerCase()
}

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

export async function verifyWalletSignature(
  walletAddress: Address,
  message: string,
  signature: Hex,
): Promise<boolean> {
  return verifyMessage({ address: walletAddress, message, signature })
}

export function generateNonce(username: string): string {
  const data = `${username}-${Date.now()}-${Math.random()}`
  return keccak256(toBytes(data)).slice(0, 18)
}

/**
 * SECURITY: Allowed CORS origins for production
 */
const ALLOWED_CORS_ORIGINS = new Set(
  (process.env.LEADERBOARD_CORS_ORIGINS ?? '').split(',').filter(Boolean),
)
const isProduction = isProductionEnv()

export function getCorsHeaders(request: Request): Record<string, string> {
  const requestOrigin = request.headers.get('origin')

  // SECURITY: In production, validate origin against allowlist
  let allowedOrigin: string
  if (isProduction) {
    if (requestOrigin && ALLOWED_CORS_ORIGINS.has(requestOrigin)) {
      allowedOrigin = requestOrigin
    } else {
      // Return first allowed origin or empty if none configured
      allowedOrigin = ALLOWED_CORS_ORIGINS.values().next().value ?? ''
    }
  } else {
    // In development, allow any origin
    allowedOrigin = requestOrigin ?? '*'
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  }
}
