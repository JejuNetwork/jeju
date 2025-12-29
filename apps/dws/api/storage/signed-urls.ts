/**
 * Signed URLs - Time-limited access tokens for content
 *
 * Features:
 * - Time-limited presigned URLs for uploads and downloads
 * - Cryptographic signatures for URL verification
 * - Rate limiting and access control
 * - IP-based restrictions
 * - Custom policies for fine-grained access
 */

import { createHmac, randomBytes } from 'node:crypto'
import { getLocalhostHost } from '@jejunetwork/config'
import type { Address } from 'viem'

// ============ Types ============

export type SignedUrlAction = 'download' | 'upload' | 'delete' | 'list'

export interface SignedUrlPolicy {
  // Time constraints
  expiresAt: number
  notBefore?: number

  // Access constraints
  allowedActions: SignedUrlAction[]
  maxContentSize?: number
  allowedContentTypes?: string[]

  // Network constraints
  allowedIps?: string[]
  allowedRegions?: string[]

  // Rate limiting
  maxUses?: number
  usesPerMinute?: number

  // Content constraints
  cidPattern?: string // Regex pattern for allowed CIDs
  pathPrefix?: string

  // Custom metadata
  customClaims?: Record<string, string>
}

export interface SignedUrl {
  urlId: string
  baseUrl: string
  fullUrl: string
  signature: string
  cid: string
  action: SignedUrlAction
  policy: SignedUrlPolicy
  createdAt: number
  createdBy: Address
  usageCount: number
  lastUsed?: number
}

export interface SignedUrlValidationResult {
  valid: boolean
  url?: SignedUrl
  errors: string[]
  remainingUses?: number
}

export interface UploadPresignedUrl {
  url: string
  fields: Record<string, string>
  headers: Record<string, string>
  cid: string
  maxSize: number
  expiresAt: number
}

export interface SignedUrlStats {
  totalCreated: number
  totalUsed: number
  activeUrls: number
  expiredUrls: number
  revokedUrls: number
  usageByAction: Record<SignedUrlAction, number>
}

export interface SignedUrlConfig {
  signingSecret: string
  baseUrl: string
  defaultExpirySeconds: number
  maxExpirySeconds: number
  defaultMaxUses: number
  enableRateLimiting: boolean
  rateLimit: {
    windowMs: number
    maxRequests: number
  }
}

// ============ Default Configuration ============

const DEFAULT_CONFIG: SignedUrlConfig = {
  signingSecret:
    process.env.SIGNED_URL_SECRET ?? 'dev-secret-change-in-production',
  baseUrl: process.env.DWS_BASE_URL ?? `http://${getLocalhostHost()}:3100`,
  defaultExpirySeconds: 3600, // 1 hour
  maxExpirySeconds: 86400 * 7, // 7 days
  defaultMaxUses: 100,
  enableRateLimiting: true,
  rateLimit: {
    windowMs: 60000, // 1 minute
    maxRequests: 100,
  },
}

// ============ Signed URL Manager ============

export class SignedUrlManager {
  private config: SignedUrlConfig
  private urls: Map<string, SignedUrl> = new Map()
  private revokedUrls: Set<string> = new Set()
  private usageTracking: Map<string, Array<{ timestamp: number; ip: string }>> =
    new Map()
  private ipRateLimits: Map<string, { count: number; windowStart: number }> =
    new Map()

  constructor(config?: Partial<SignedUrlConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ============ URL Creation ============

  createSignedUrl(
    cid: string,
    action: SignedUrlAction,
    options?: {
      expirySeconds?: number
      policy?: Partial<SignedUrlPolicy>
      createdBy?: Address
    },
  ): SignedUrl {
    const urlId = `url_${Date.now()}_${randomBytes(12).toString('hex')}`
    const now = Date.now()

    const expirySeconds = Math.min(
      options?.expirySeconds ?? this.config.defaultExpirySeconds,
      this.config.maxExpirySeconds,
    )

    const policy: SignedUrlPolicy = {
      expiresAt: now + expirySeconds * 1000,
      allowedActions: [action],
      maxUses: options?.policy?.maxUses ?? this.config.defaultMaxUses,
      ...options?.policy,
    }

    // Generate signature
    const signaturePayload = this.createSignaturePayload(
      urlId,
      cid,
      action,
      policy,
    )
    const signature = this.sign(signaturePayload)

    // Build URL
    const queryParams = new URLSearchParams({
      urlId,
      action,
      signature,
      expires: String(policy.expiresAt),
    })

    const fullUrl = `${this.config.baseUrl}/storage/${cid}?${queryParams.toString()}`

    const signedUrl: SignedUrl = {
      urlId,
      baseUrl: this.config.baseUrl,
      fullUrl,
      signature,
      cid,
      action,
      policy,
      createdAt: now,
      createdBy:
        options?.createdBy ?? '0x0000000000000000000000000000000000000000',
      usageCount: 0,
    }

    this.urls.set(urlId, signedUrl)
    return signedUrl
  }

  createUploadUrl(options: {
    maxSizeBytes: number
    allowedContentTypes?: string[]
    expirySeconds?: number
    metadata?: Record<string, string>
  }): UploadPresignedUrl {
    // Generate a placeholder CID for upload URL
    const uploadId = randomBytes(16).toString('hex')
    const cid = `upload_${uploadId}`

    const signedUrl = this.createSignedUrl(cid, 'upload', {
      expirySeconds: options.expirySeconds,
      policy: {
        maxContentSize: options.maxSizeBytes,
        allowedContentTypes: options.allowedContentTypes,
        customClaims: options.metadata,
      },
    })

    // Build multipart upload fields
    const fields: Record<string, string> = {
      'x-url-id': signedUrl.urlId,
      'x-signature': signedUrl.signature,
      'x-expires': String(signedUrl.policy.expiresAt),
      'x-max-size': String(options.maxSizeBytes),
    }

    if (options.allowedContentTypes) {
      fields['x-allowed-types'] = options.allowedContentTypes.join(',')
    }

    if (options.metadata) {
      for (const [key, value] of Object.entries(options.metadata)) {
        fields[`x-meta-${key}`] = value
      }
    }

    return {
      url: `${this.config.baseUrl}/storage/upload`,
      fields,
      headers: {
        'x-url-id': signedUrl.urlId,
        'x-signature': signedUrl.signature,
      },
      cid,
      maxSize: options.maxSizeBytes,
      expiresAt: signedUrl.policy.expiresAt,
    }
  }

  createDownloadUrl(
    cid: string,
    options?: {
      expirySeconds?: number
      allowedIps?: string[]
      maxDownloads?: number
    },
  ): SignedUrl {
    return this.createSignedUrl(cid, 'download', {
      expirySeconds: options?.expirySeconds,
      policy: {
        allowedIps: options?.allowedIps,
        maxUses: options?.maxDownloads,
      },
    })
  }

  createBatchUrls(
    cids: string[],
    action: SignedUrlAction,
    options?: {
      expirySeconds?: number
      policy?: Partial<SignedUrlPolicy>
    },
  ): SignedUrl[] {
    return cids.map((cid) => this.createSignedUrl(cid, action, options))
  }

  // ============ URL Validation ============

  validateSignedUrl(
    urlId: string,
    action: SignedUrlAction,
    providedSignature: string,
    clientIp?: string,
    clientRegion?: string,
  ): SignedUrlValidationResult {
    const errors: string[] = []

    // Check if URL exists
    const signedUrl = this.urls.get(urlId)
    if (!signedUrl) {
      return { valid: false, errors: ['URL not found'] }
    }

    // Check if revoked
    if (this.revokedUrls.has(urlId)) {
      return { valid: false, errors: ['URL has been revoked'] }
    }

    const policy = signedUrl.policy
    const now = Date.now()

    // Verify signature
    const signaturePayload = this.createSignaturePayload(
      urlId,
      signedUrl.cid,
      signedUrl.action,
      policy,
    )
    const expectedSignature = this.sign(signaturePayload)

    if (providedSignature !== expectedSignature) {
      errors.push('Invalid signature')
    }

    // Check expiry
    if (now > policy.expiresAt) {
      errors.push('URL has expired')
    }

    // Check not before
    if (policy.notBefore && now < policy.notBefore) {
      errors.push('URL is not yet valid')
    }

    // Check action
    if (!policy.allowedActions.includes(action)) {
      errors.push(`Action '${action}' not allowed`)
    }

    // Check IP restrictions
    if (
      policy.allowedIps &&
      clientIp &&
      !policy.allowedIps.includes(clientIp)
    ) {
      errors.push('IP address not allowed')
    }

    // Check region restrictions
    if (
      policy.allowedRegions &&
      clientRegion &&
      !policy.allowedRegions.includes(clientRegion)
    ) {
      errors.push('Region not allowed')
    }

    // Check max uses
    if (policy.maxUses && signedUrl.usageCount >= policy.maxUses) {
      errors.push('Maximum uses exceeded')
    }

    // Check rate limiting
    if (this.config.enableRateLimiting && clientIp) {
      if (!this.checkRateLimit(clientIp)) {
        errors.push('Rate limit exceeded')
      }
    }

    // Check per-URL rate limiting
    if (policy.usesPerMinute && clientIp) {
      if (!this.checkUrlRateLimit(urlId, clientIp, policy.usesPerMinute)) {
        errors.push('URL rate limit exceeded')
      }
    }

    const valid = errors.length === 0

    return {
      valid,
      url: valid ? signedUrl : undefined,
      errors,
      remainingUses: policy.maxUses
        ? policy.maxUses - signedUrl.usageCount
        : undefined,
    }
  }

  recordUsage(urlId: string, clientIp: string): void {
    const signedUrl = this.urls.get(urlId)
    if (!signedUrl) return

    signedUrl.usageCount++
    signedUrl.lastUsed = Date.now()

    // Track usage for rate limiting
    const tracking = this.usageTracking.get(urlId) ?? []
    tracking.push({ timestamp: Date.now(), ip: clientIp })

    // Keep only last hour of tracking data
    const oneHourAgo = Date.now() - 3600000
    this.usageTracking.set(
      urlId,
      tracking.filter((t) => t.timestamp > oneHourAgo),
    )
  }

  // ============ URL Management ============

  revokeUrl(urlId: string): boolean {
    if (!this.urls.has(urlId)) {
      return false
    }

    this.revokedUrls.add(urlId)
    return true
  }

  revokeAllForCid(cid: string): number {
    let count = 0
    for (const [urlId, url] of this.urls) {
      if (url.cid === cid && !this.revokedUrls.has(urlId)) {
        this.revokedUrls.add(urlId)
        count++
      }
    }
    return count
  }

  getUrl(urlId: string): SignedUrl | undefined {
    return this.urls.get(urlId)
  }

  getUrlsForCid(cid: string): SignedUrl[] {
    return Array.from(this.urls.values()).filter((url) => url.cid === cid)
  }

  getActiveUrls(): SignedUrl[] {
    const now = Date.now()
    return Array.from(this.urls.values()).filter(
      (url) =>
        url.policy.expiresAt > now &&
        !this.revokedUrls.has(url.urlId) &&
        (!url.policy.maxUses || url.usageCount < url.policy.maxUses),
    )
  }

  cleanupExpired(): number {
    const now = Date.now()
    let cleaned = 0

    for (const [urlId, url] of this.urls) {
      if (url.policy.expiresAt < now) {
        this.urls.delete(urlId)
        this.usageTracking.delete(urlId)
        cleaned++
      }
    }

    return cleaned
  }

  // ============ Rate Limiting ============

  private checkRateLimit(clientIp: string): boolean {
    const now = Date.now()
    const limit = this.ipRateLimits.get(clientIp)

    if (!limit || now - limit.windowStart > this.config.rateLimit.windowMs) {
      this.ipRateLimits.set(clientIp, { count: 1, windowStart: now })
      return true
    }

    if (limit.count >= this.config.rateLimit.maxRequests) {
      return false
    }

    limit.count++
    return true
  }

  private checkUrlRateLimit(
    urlId: string,
    clientIp: string,
    maxPerMinute: number,
  ): boolean {
    const tracking = this.usageTracking.get(urlId) ?? []
    const oneMinuteAgo = Date.now() - 60000

    const recentUses = tracking.filter(
      (t) => t.timestamp > oneMinuteAgo && t.ip === clientIp,
    ).length

    return recentUses < maxPerMinute
  }

  // ============ Signature Methods ============

  private createSignaturePayload(
    urlId: string,
    cid: string,
    action: SignedUrlAction,
    policy: SignedUrlPolicy,
  ): string {
    const data = {
      urlId,
      cid,
      action,
      expiresAt: policy.expiresAt,
      notBefore: policy.notBefore,
      allowedActions: policy.allowedActions.sort(),
      maxContentSize: policy.maxContentSize,
      allowedIps: policy.allowedIps?.sort(),
      cidPattern: policy.cidPattern,
    }

    return JSON.stringify(data)
  }

  private sign(payload: string): string {
    const hmac = createHmac('sha256', this.config.signingSecret)
    hmac.update(payload)
    return hmac.digest('hex')
  }

  // ============ Statistics ============

  getStats(): SignedUrlStats {
    const now = Date.now()
    let activeCount = 0
    let expiredCount = 0
    const usageByAction: Record<SignedUrlAction, number> = {
      download: 0,
      upload: 0,
      delete: 0,
      list: 0,
    }

    let totalUsed = 0

    for (const url of this.urls.values()) {
      if (url.policy.expiresAt > now && !this.revokedUrls.has(url.urlId)) {
        activeCount++
      } else {
        expiredCount++
      }

      totalUsed += url.usageCount
      usageByAction[url.action] += url.usageCount
    }

    return {
      totalCreated: this.urls.size,
      totalUsed,
      activeUrls: activeCount,
      expiredUrls: expiredCount,
      revokedUrls: this.revokedUrls.size,
      usageByAction,
    }
  }
}

// ============ Singleton Factory ============

let signedUrlManager: SignedUrlManager | null = null

export function getSignedUrlManager(
  config?: Partial<SignedUrlConfig>,
): SignedUrlManager {
  if (!signedUrlManager) {
    signedUrlManager = new SignedUrlManager(config)
  }
  return signedUrlManager
}

// ============ Express Middleware ============

export interface SignedUrlMiddlewareOptions {
  manager: SignedUrlManager
  allowedActions?: SignedUrlAction[]
  getClientIp?: (req: { headers: Record<string, string> }) => string
  getClientRegion?: (req: { headers: Record<string, string> }) => string
}

export function createSignedUrlMiddleware(options: SignedUrlMiddlewareOptions) {
  const { manager, allowedActions, getClientIp, getClientRegion } = options

  return (
    req: {
      query: Record<string, string>
      params: Record<string, string>
      headers: Record<string, string>
      method: string
    },
    res: {
      status: (code: number) => {
        json: (data: Record<string, unknown>) => void
      }
    },
    next: () => void,
  ) => {
    const urlId = req.query.urlId ?? req.headers['x-url-id']
    const signature = req.query.signature ?? req.headers['x-signature']

    if (!urlId || !signature) {
      res.status(401).json({ error: 'Missing signed URL parameters' })
      return
    }

    // Determine action from HTTP method
    let action: SignedUrlAction
    switch (req.method.toUpperCase()) {
      case 'GET':
        action = 'download'
        break
      case 'PUT':
      case 'POST':
        action = 'upload'
        break
      case 'DELETE':
        action = 'delete'
        break
      default:
        action = 'list'
    }

    if (allowedActions && !allowedActions.includes(action)) {
      res.status(403).json({ error: 'Action not allowed' })
      return
    }

    const clientIp = getClientIp
      ? getClientIp(req)
      : (req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? 'unknown')
    const clientRegion = getClientRegion ? getClientRegion(req) : undefined

    const result = manager.validateSignedUrl(
      urlId,
      action,
      signature,
      clientIp,
      clientRegion,
    )

    if (!result.valid) {
      res.status(403).json({
        error: 'Invalid signed URL',
        details: result.errors,
      })
      return
    }

    // Record usage
    manager.recordUsage(urlId, clientIp)

    next()
  }
}

// ============ URL Parsing Utilities ============

export function parseSignedUrl(url: string): {
  urlId: string
  signature: string
  cid: string
  action: SignedUrlAction
  expires: number
} | null {
  const parsed = new URL(url)
  const urlId = parsed.searchParams.get('urlId')
  const signature = parsed.searchParams.get('signature')
  const action = parsed.searchParams.get('action') as SignedUrlAction | null
  const expires = parsed.searchParams.get('expires')

  if (!urlId || !signature || !action || !expires) {
    return null
  }

  // Extract CID from path
  const pathParts = parsed.pathname.split('/')
  const cidIndex = pathParts.indexOf('storage') + 1
  const cid = pathParts[cidIndex]

  if (!cid) {
    return null
  }

  return {
    urlId,
    signature,
    cid,
    action,
    expires: Number.parseInt(expires, 10),
  }
}

export function isSignedUrlExpired(url: string): boolean {
  const parsed = parseSignedUrl(url)
  if (!parsed) return true
  return Date.now() > parsed.expires
}
