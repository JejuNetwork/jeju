#!/usr/bin/env bun

/**
 * P2P Threshold Signer Service
 *
 * Security: API key auth, rate limiting, 10s replay window, origin validation
 *
 * Usage: SIGNER_PRIVATE_KEY=0x... SIGNER_API_KEY=... bun run signer-service.ts
 */

import { createHash, randomBytes } from 'node:crypto'
import { Elysia } from 'elysia'
import { privateKeyToAccount } from 'viem/accounts'
import {
  expectValid,
  type SignResponse,
  SignResponseSchema,
} from '../../schemas'

interface SignRequest {
  digest: string
  requestId: string
  timestamp: number
  context?: string
}

interface TypedSignRequest extends SignRequest {
  domain: {
    name: string
    version: string
    chainId: number
    verifyingContract: `0x${string}`
  }
  types: Record<string, Array<{ name: string; type: string }>>
  message: Record<string, unknown>
}
const REPLAY_WINDOW_MS = 10_000
const RATE_LIMIT_WINDOW_MS = 1000
const RATE_LIMIT_MAX = 10
const MAX_PROCESSED_REQUESTS = 10_000
class ThresholdSignerService {
  private account: ReturnType<typeof privateKeyToAccount>
  private app: Elysia
  private apiKeyHash: string
  private allowedOrigins: Set<string>
  private rateLimits = new Map<string, { count: number; resetAt: number }>()
  private processedRequests = new Set<string>()
  private stats = {
    requestsReceived: 0,
    signaturesIssued: 0,
    startTime: Date.now(),
  }
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    privateKey: string,
    apiKey: string,
    allowedOrigins: string[] = [],
  ) {
    this.account = privateKeyToAccount(privateKey as `0x${string}`)
    this.app = new Elysia()
    this.apiKeyHash = createHash('sha256').update(apiKey).digest('hex')
    this.allowedOrigins = new Set(allowedOrigins)
    this.setupRoutes()
    this.cleanupInterval = setInterval(() => this.cleanup(), 30_000)
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [k, v] of this.rateLimits)
      if (now >= v.resetAt) this.rateLimits.delete(k)
    if (this.processedRequests.size > MAX_PROCESSED_REQUESTS)
      this.processedRequests.clear()
  }

  private checkAuth(authHeader: string | undefined): boolean {
    if (!authHeader) return false
    return (
      createHash('sha256')
        .update(authHeader.replace('Bearer ', ''))
        .digest('hex') === this.apiKeyHash
    )
  }

  private checkRateLimit(clientId: string): boolean {
    const now = Date.now()
    const entry = this.rateLimits.get(clientId)
    if (!entry || now >= entry.resetAt) {
      this.rateLimits.set(clientId, {
        count: 1,
        resetAt: now + RATE_LIMIT_WINDOW_MS,
      })
      return true
    }
    return ++entry.count <= RATE_LIMIT_MAX
  }

  private validateRequest(body: SignRequest): string | null {
    if (!body.digest || !body.requestId) return 'Missing digest or requestId'
    if (!body.digest.startsWith('0x') || body.digest.length !== 66)
      return 'Invalid digest format'
    if (!body.timestamp || Date.now() - body.timestamp > REPLAY_WINDOW_MS)
      return 'Request expired'
    if (this.processedRequests.has(body.requestId))
      return 'Request already processed'
    return null
  }

  private errorResponse(requestId: string, error: string, status: number) {
    return {
      json: {
        requestId,
        signature: '',
        signer: this.account.address,
        error,
      } as SignResponse,
      status,
    }
  }

  private setupRoutes(): void {
    // Health check - no auth required
    this.app.get('/health', () => ({
      status: 'ok',
      address: this.account.address,
      uptime: Date.now() - this.stats.startTime,
    }))

    // Protected routes with auth middleware
    const protectedRoutes = new Elysia()
      .onBeforeHandle(({ request, set }) => {
        const authHeader = request.headers.get('Authorization')
        if (!this.checkAuth(authHeader ?? undefined)) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const clientId = request.headers.get('X-Forwarded-For') ?? 'unknown'
        if (!this.checkRateLimit(clientId)) {
          set.status = 429
          return { error: 'Rate limited' }
        }
        const origin =
          request.headers.get('Origin') ?? request.headers.get('X-Origin')
        if (
          this.allowedOrigins.size > 0 &&
          origin &&
          !this.allowedOrigins.has(origin)
        ) {
          set.status = 403
          return { error: 'Origin blocked' }
        }
        return undefined
      })
      .get('/info', () => ({
        address: this.account.address,
        signaturesIssued: this.stats.signaturesIssued,
        uptime: Date.now() - this.stats.startTime,
      }))
      .get('/stats', () => ({
        signaturesIssued: this.stats.signaturesIssued,
        uptime: Date.now() - this.stats.startTime,
      }))
      .post('/sign-digest', async ({ body, set }) => {
        this.stats.requestsReceived++
        const typedBody = body as SignRequest
        const err = this.validateRequest(typedBody)
        if (err) {
          set.status = 400
          return this.errorResponse(typedBody.requestId ?? '', err, 400).json
        }
        this.processedRequests.add(typedBody.requestId)

        const signature = await this.account.signMessage({
          message: { raw: typedBody.digest as `0x${string}` },
        })
        this.stats.signaturesIssued++
        console.log(`[Signer] Signed ${typedBody.requestId.slice(0, 8)}...`)
        return {
          requestId: typedBody.requestId,
          signature,
          signer: this.account.address,
        } satisfies SignResponse
      })
      .post('/sign-typed', async ({ body, set }) => {
        this.stats.requestsReceived++
        const typedBody = body as TypedSignRequest
        if (!typedBody.domain || !typedBody.types || !typedBody.message) {
          set.status = 400
          return this.errorResponse(
            typedBody.requestId ?? '',
            'Missing typed data fields',
            400,
          ).json
        }
        const err = this.validateRequest(typedBody)
        if (err) {
          set.status = 400
          return this.errorResponse(typedBody.requestId, err, 400).json
        }
        this.processedRequests.add(typedBody.requestId)

        const signature = await this.account.signTypedData({
          domain: typedBody.domain,
          types: typedBody.types,
          primaryType: Object.keys(typedBody.types)[0],
          message: typedBody.message,
        })
        this.stats.signaturesIssued++
        console.log(
          `[Signer] Signed typed ${typedBody.requestId.slice(0, 8)}...`,
        )
        return {
          requestId: typedBody.requestId,
          signature,
          signer: this.account.address,
        } satisfies SignResponse
      })

    this.app.use(protectedRoutes)
  }

  getApp(): Elysia {
    return this.app
  }

  getAddress(): `0x${string}` {
    return this.account.address
  }
}
export class SignatureCollector {
  constructor(
    private peerUrls: Map<string, string>,
    private apiKey: string,
    private timeout = 5000,
  ) {}

  static fromRecord(
    urls: Record<string, string>,
    apiKey: string,
    timeout = 5000,
  ) {
    return new SignatureCollector(
      new Map(Object.entries(urls).map(([a, u]) => [a.toLowerCase(), u])),
      apiKey,
      timeout,
    )
  }

  async collect(
    digest: string,
    threshold: number,
    selfSig?: { signature: string; signer: string },
  ) {
    const signatures = selfSig ? [selfSig.signature] : []
    const signers = selfSig ? [selfSig.signer] : []
    const requestId = `${randomBytes(16).toString('hex')}-${Date.now()}`

    const results = await Promise.all(
      Array.from(this.peerUrls.entries())
        .filter(([addr]) => !signers.includes(addr))
        .map(async ([_addr, url]) => {
          const ctrl = new AbortController()
          const tid = setTimeout(() => ctrl.abort(), this.timeout)
          try {
            const res = await fetch(`${url}/sign-digest`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
              },
              body: JSON.stringify({
                digest,
                requestId,
                timestamp: Date.now(),
              }),
              signal: ctrl.signal,
            })
            clearTimeout(tid)
            if (!res.ok) return null
            const rRaw = await res.json()
            const r = expectValid(SignResponseSchema, rRaw, 'sign response')
            return r.error ? null : { signature: r.signature, signer: r.signer }
          } catch {
            return null
          }
        }),
    )

    for (const r of results)
      if (r && signatures.length < threshold) {
        signatures.push(r.signature)
        signers.push(r.signer)
      }
    return { signatures, signers }
  }
}
async function main(): Promise<void> {
  const {
    SIGNER_PRIVATE_KEY: pk,
    SIGNER_API_KEY: key,
    SIGNER_PORT,
    SIGNER_ALLOWED_ORIGINS,
  } = process.env
  if (!pk || !key) {
    console.error('SIGNER_PRIVATE_KEY and SIGNER_API_KEY required')
    process.exit(1)
  }

  const port = parseInt(SIGNER_PORT ?? '4100', 10)
  const origins = (SIGNER_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean)
  const svc = new ThresholdSignerService(pk, key, origins)

  console.log(`🔐 Signer v2.0.0 | ${svc.getAddress()} | :${port}`)
  svc.getApp().listen(port)

  process.on('SIGINT', () => {
    svc.stop()
    svc.getApp().stop()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    svc.stop()
    svc.getApp().stop()
    process.exit(0)
  })
}

// Only run main when executed directly
if (import.meta.main) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}

export { ThresholdSignerService }
