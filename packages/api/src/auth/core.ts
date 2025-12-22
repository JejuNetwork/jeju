import { timingSafeEqual } from 'node:crypto'
import type { Address, Hex } from 'viem'
import { verifyMessage } from 'viem'
import { z } from 'zod'
import {
  type APIKeyConfig,
  type APIKeyValidationResult,
  AuthError,
  AuthErrorCode,
  type AuthHeaders,
  AuthMethod,
  type AuthResult,
  type AuthUser,
  type OAuth3Config,
  type OAuth3ValidationResult,
  type WalletSignatureConfig,
  type WalletSignatureValidationResult,
} from './types.js'

const AddressSchema = z
  .string()
  .regex(
    /^0x[a-fA-F0-9]{40}$/,
    'Invalid Ethereum address',
  ) as z.ZodType<Address>

const HexSchema = z
  .string()
  .min(4, 'Hex string must have at least one byte')
  .regex(/^0x[a-fA-F0-9]+$/, 'Invalid hex string') as z.ZodType<Hex>

const TimestampSchema = z.number().int().positive()

const WalletSignatureHeadersSchema = z
  .object({
    'x-jeju-address': AddressSchema,
    'x-jeju-timestamp': z
      .string()
      .regex(/^\d+$/, 'Timestamp must be a numeric string')
      .transform(Number)
      .pipe(TimestampSchema),
    'x-jeju-signature': HexSchema,
  })
  .strict()

const OAuth3SessionResponseSchema = z
  .object({
    sessionId: HexSchema,
    identityId: HexSchema,
    smartAccount: AddressSchema,
    expiresAt: z.number().int().positive(),
  })
  .strict()

const DEFAULT_WALLET_VALIDITY_WINDOW_MS = 5 * 60 * 1000
const DEFAULT_MESSAGE_PREFIX = 'jeju-dapp'

export function constantTimeCompare(a: string, b: string): boolean {
  const aNorm = a.toLowerCase()
  const bNorm = b.toLowerCase()

  if (aNorm.length !== bNorm.length) {
    return false
  }

  const bufA = Buffer.from(aNorm, 'utf8')
  const bufB = Buffer.from(bNorm, 'utf8')

  return timingSafeEqual(bufA, bufB)
}

export function extractAuthHeaders(
  headers: Record<string, string | undefined> | Headers,
): AuthHeaders {
  const get = (key: string): string | undefined => {
    if (headers instanceof Headers) {
      return headers.get(key) ?? undefined
    }
    return headers[key] ?? headers[key.toLowerCase()]
  }

  return {
    'x-oauth3-session': get('x-oauth3-session'),
    'x-jeju-address': get('x-jeju-address'),
    'x-jeju-timestamp': get('x-jeju-timestamp'),
    'x-jeju-signature': get('x-jeju-signature'),
    'x-api-key': get('x-api-key'),
    authorization: get('authorization'),
  }
}

export async function validateOAuth3Session(
  sessionId: string,
  config: OAuth3Config,
): Promise<OAuth3ValidationResult> {
  const sessionResult = HexSchema.safeParse(sessionId)
  if (!sessionResult.success) {
    return {
      valid: false,
      error: 'Invalid session ID format',
    }
  }

  const response = await fetch(`${config.teeAgentUrl}/session/${sessionId}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-App-Id': String(config.appId),
    },
  })

  if (!response.ok) {
    if (response.status === 404) {
      return {
        valid: false,
        error: 'Session not found',
      }
    }
    return {
      valid: false,
      error: `Session validation failed: ${response.status}`,
    }
  }

  const data = await response.json()
  const sessionData = OAuth3SessionResponseSchema.safeParse(data)

  if (!sessionData.success) {
    return {
      valid: false,
      error: 'Invalid session data from TEE agent',
    }
  }

  const session = sessionData.data
  const now = Date.now()
  const validityWindow = config.sessionValidityWindowMs ?? 0

  if (session.expiresAt < now - validityWindow) {
    return {
      valid: false,
      expired: true,
      error: 'Session expired',
    }
  }

  return {
    valid: true,
    user: {
      address: session.smartAccount,
      method: AuthMethod.OAUTH3,
      sessionId: session.sessionId,
    },
  }
}

/**
 * Validate OAuth3 from headers
 */
export async function validateOAuth3FromHeaders(
  headers: AuthHeaders,
  config: OAuth3Config,
): Promise<OAuth3ValidationResult> {
  const sessionId = headers['x-oauth3-session']
  if (!sessionId) {
    return { valid: false, error: 'Missing x-oauth3-session header' }
  }

  return validateOAuth3Session(sessionId, config)
}

export async function validateWalletSignature(
  address: Address,
  timestamp: number,
  signature: Hex,
  config: WalletSignatureConfig,
): Promise<WalletSignatureValidationResult> {
  const now = Date.now()
  const validityWindow =
    config.validityWindowMs ?? DEFAULT_WALLET_VALIDITY_WINDOW_MS
  const prefix = config.messagePrefix ?? DEFAULT_MESSAGE_PREFIX

  if (timestamp > now) {
    return {
      valid: false,
      error: 'Timestamp is in the future',
    }
  }

  if (timestamp < now - validityWindow) {
    return {
      valid: false,
      expired: true,
      error: 'Signature expired',
    }
  }

  const message = `${prefix}:${timestamp}`

  const valid = await verifyMessage({
    address,
    message,
    signature,
  })

  if (!valid) {
    return {
      valid: false,
      error: 'Invalid signature',
    }
  }

  return {
    valid: true,
    user: {
      address,
      method: AuthMethod.WALLET_SIGNATURE,
    },
  }
}

/**
 * Validate wallet signature from headers
 */
export async function validateWalletSignatureFromHeaders(
  headers: AuthHeaders,
  config: WalletSignatureConfig,
): Promise<WalletSignatureValidationResult> {
  const addressStr = headers['x-jeju-address']
  const timestampStr = headers['x-jeju-timestamp']
  const signatureStr = headers['x-jeju-signature']

  if (!addressStr || !timestampStr || !signatureStr) {
    return {
      valid: false,
      error: 'Missing wallet signature headers',
    }
  }

  const validated = WalletSignatureHeadersSchema.safeParse({
    'x-jeju-address': addressStr,
    'x-jeju-timestamp': timestampStr,
    'x-jeju-signature': signatureStr,
  })

  if (!validated.success) {
    const errors = validated.error.issues.map((i) => i.message).join(', ')
    return {
      valid: false,
      error: `Invalid headers: ${errors}`,
    }
  }

  return validateWalletSignature(
    validated.data['x-jeju-address'],
    validated.data['x-jeju-timestamp'],
    validated.data['x-jeju-signature'] as Hex,
    config,
  )
}

export function validateAPIKey(
  apiKey: string,
  config: APIKeyConfig,
): APIKeyValidationResult {
  for (const [key, info] of config.keys) {
    if (constantTimeCompare(apiKey, key)) {
      if (info.expiresAt && info.expiresAt < Date.now()) {
        return {
          valid: false,
          error: 'API key expired',
        }
      }

      return {
        valid: true,
        user: {
          address: info.address,
          method: AuthMethod.API_KEY,
          permissions: info.permissions,
        },
        rateLimitTier: info.rateLimitTier,
      }
    }
  }

  return {
    valid: false,
    error: 'Invalid API key',
  }
}

/**
 * Validate API key from headers
 */
export function validateAPIKeyFromHeaders(
  headers: AuthHeaders,
  config: APIKeyConfig,
): APIKeyValidationResult {
  const headerName = config.headerName ?? 'x-api-key'
  const apiKey =
    headers['x-api-key'] ?? extractBearerToken(headers.authorization)

  if (!apiKey) {
    return {
      valid: false,
      error: `Missing ${headerName} header or Authorization bearer token`,
    }
  }

  return validateAPIKey(apiKey, config)
}

/**
 * Extract bearer token from Authorization header
 */
function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]
}

export interface CombinedAuthConfig {
  oauth3?: OAuth3Config
  walletSignature?: WalletSignatureConfig
  apiKey?: APIKeyConfig
  /** Order of authentication methods to try */
  priority?: AuthMethod[]
}

export async function authenticate(
  headers: AuthHeaders,
  config: CombinedAuthConfig,
): Promise<AuthResult> {
  const priority = config.priority ?? [
    AuthMethod.OAUTH3,
    AuthMethod.WALLET_SIGNATURE,
    AuthMethod.API_KEY,
  ]

  for (const method of priority) {
    switch (method) {
      case AuthMethod.OAUTH3: {
        if (!config.oauth3) continue
        if (!headers['x-oauth3-session']) continue

        const result = await validateOAuth3FromHeaders(headers, config.oauth3)
        if (result.valid && result.user) {
          return {
            authenticated: true,
            user: result.user,
            method: AuthMethod.OAUTH3,
          }
        }
        if (headers['x-oauth3-session']) {
          return {
            authenticated: false,
            error: result.error,
            method: AuthMethod.OAUTH3,
          }
        }
        break
      }

      case AuthMethod.WALLET_SIGNATURE: {
        if (!config.walletSignature) continue
        if (!headers['x-jeju-address']) continue

        const result = await validateWalletSignatureFromHeaders(
          headers,
          config.walletSignature,
        )
        if (result.valid && result.user) {
          return {
            authenticated: true,
            user: result.user,
            method: AuthMethod.WALLET_SIGNATURE,
          }
        }
        if (headers['x-jeju-address']) {
          return {
            authenticated: false,
            error: result.error,
            method: AuthMethod.WALLET_SIGNATURE,
          }
        }
        break
      }

      case AuthMethod.API_KEY: {
        if (!config.apiKey) continue
        const hasApiKey = headers['x-api-key'] || headers.authorization
        if (!hasApiKey) continue

        const result = validateAPIKeyFromHeaders(headers, config.apiKey)
        if (result.valid && result.user) {
          return {
            authenticated: true,
            user: result.user,
            method: AuthMethod.API_KEY,
          }
        }
        if (hasApiKey) {
          return {
            authenticated: false,
            error: result.error,
            method: AuthMethod.API_KEY,
          }
        }
        break
      }
    }
  }

  return {
    authenticated: false,
    error: 'No authentication credentials provided',
  }
}

/**
 * Require authentication - throws AuthError if not authenticated
 */
export async function requireAuth(
  headers: AuthHeaders,
  config: CombinedAuthConfig,
): Promise<AuthUser> {
  const result = await authenticate(headers, config)

  if (!result.authenticated || !result.user) {
    throw new AuthError(
      result.error ?? 'Authentication required',
      result.error?.includes('expired')
        ? AuthErrorCode.SESSION_EXPIRED
        : AuthErrorCode.MISSING_CREDENTIALS,
      401,
    )
  }

  return result.user
}

export function createWalletAuthMessage(
  timestamp: number,
  prefix: string = DEFAULT_MESSAGE_PREFIX,
): string {
  return `${prefix}:${timestamp}`
}

/**
 * Parse a wallet auth message to extract the timestamp
 */
export function parseWalletAuthMessage(
  message: string,
  prefix: string = DEFAULT_MESSAGE_PREFIX,
): { timestamp: number } | null {
  const pattern = new RegExp(`^${prefix}:(\\d+)$`)
  const match = message.match(pattern)
  if (!match) return null

  const timestamp = parseInt(match[1], 10)
  if (Number.isNaN(timestamp)) return null

  return { timestamp }
}
