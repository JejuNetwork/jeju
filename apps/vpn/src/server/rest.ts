/**
 * REST API for VPN operations
 *
 * All endpoints use Zod validation and fail-fast patterns
 */

import { Elysia } from 'elysia'
import { verifyAuth } from './auth'
import {
  ConnectRequestSchema,
  ContributionSettingsRequestSchema,
  DisconnectRequestSchema,
  expect,
  expectValid,
  NodesQuerySchema,
  ProxyRequestSchema,
  type VPNNodeState,
} from './schemas'
import type { VPNServiceContext } from './types'
import {
  calculateContributionRatio,
  getOrCreateContribution,
  getQuotaRemaining,
  isContributionPeriodExpired,
  resetContributionPeriod,
} from './utils/contributions'
import {
  calculateNodeLoad,
  findBestNode,
  getNodeById,
  getNodesByCountry,
  sortNodesByStatusAndLoad,
} from './utils/nodes'
import { validateProxyUrlWithDNS } from './utils/proxy-validation'
import { readResponseBody } from './utils/response-reader'
import {
  createSession,
  deleteSession,
  getSession,
  getSessionDuration,
  verifySessionOwnership,
} from './utils/sessions'
import { verifyX402Payment } from './x402'

// Maximum request body size (1MB)
const MAX_REQUEST_BODY_SIZE = 1024 * 1024

// Maximum response body size (10MB)
const MAX_RESPONSE_BODY_SIZE = 10 * 1024 * 1024

export function createRESTRouter(ctx: VPNServiceContext) {
  const router = new Elysia({ prefix: '/api/v1' })
    // Error handling middleware
    .onError(({ error, set }) => {
      console.error('REST API error:', error)
      set.status = 500
      const message =
        error instanceof Error ? error.message : 'Internal server error'
      return { error: message }
    })

    // ========== Public Endpoints ==========

    /**
     * GET /nodes - List available VPN nodes
     */
    .get('/nodes', ({ query }) => {
      // Convert query to plain object for Zod validation
      const queryParams: Record<string, string | undefined> = {}
      for (const [key, value] of Object.entries(query)) {
        queryParams[key] = Array.isArray(value) ? value[0] : value
      }
      const validatedQuery = expectValid(
        NodesQuerySchema,
        queryParams,
        'nodes query params',
      )

      let nodes = Array.from(ctx.nodes.values())

      if (validatedQuery.country) {
        nodes = nodes.filter((n) => n.countryCode === validatedQuery.country)
      }

      // Sort by status and connections
      nodes = sortNodesByStatusAndLoad(nodes)

      return {
        nodes: nodes.map((n) => ({
          nodeId: n.nodeId,
          countryCode: n.countryCode,
          endpoint: n.endpoint,
          status: n.status,
          load: calculateNodeLoad(n),
        })),
        total: nodes.length,
      }
    })

    /**
     * GET /nodes/:nodeId - Get node details
     */
    .get('/nodes/:nodeId', ({ params }) => {
      const { nodeId } = params
      if (!nodeId || nodeId.length === 0) {
        throw new Error('Node ID required')
      }

      const node = getNodeById(ctx, nodeId)
      return { node }
    })

    /**
     * GET /countries - List available countries
     */
    .get('/countries', () => {
      const countries = getNodesByCountry(ctx)

      return {
        countries: Array.from(countries.entries()).map(([code, count]) => ({
          code,
          nodeCount: count,
        })),
      }
    })

    /**
     * GET /pricing - Get VPN pricing
     */
    .get('/pricing', () => {
      return {
        freeTier: {
          description: 'Unlimited VPN with fair contribution',
          contributionRequired: '10% bandwidth, capped at 3x usage',
          features: ['Unlimited VPN', 'All countries', 'WireGuard & SOCKS5'],
        },
        paidTier: {
          pricePerGB: ctx.config.pricing.pricePerGB.toString(),
          pricePerHour: ctx.config.pricing.pricePerHour.toString(),
          pricePerRequest: ctx.config.pricing.pricePerRequest.toString(),
          features: [
            'Priority routing',
            'No contribution required',
            'Higher speeds',
          ],
          paymentTokens: ctx.config.pricing.supportedTokens,
        },
      }
    })

    // ========== Authenticated Endpoints ==========

    /**
     * POST /connect - Establish VPN connection
     */
    .post('/connect', async ({ request, body }) => {
      const auth = await verifyAuth(request)
      expect(auth.valid, auth.error || 'Authentication required')
      if (!auth.address) {
        throw new Error('Authentication address missing')
      }

      const validatedBody = expectValid(
        ConnectRequestSchema,
        body,
        'connect request',
      )

      // Find best node
      let targetNode: VPNNodeState | undefined
      if (validatedBody.nodeId) {
        targetNode = getNodeById(ctx, validatedBody.nodeId)
      } else {
        targetNode = findBestNode(ctx, validatedBody.countryCode)
      }

      expect(targetNode !== undefined, 'No available nodes matching criteria')

      // Create session using utility
      const session = createSession(
        ctx,
        auth.address,
        targetNode.nodeId,
        validatedBody.protocol || 'wireguard',
      )

      // Return connection details
      return {
        sessionId: session.sessionId,
        node: {
          nodeId: targetNode.nodeId,
          countryCode: targetNode.countryCode,
          endpoint: targetNode.endpoint,
          publicKey: targetNode.wireguardPubKey,
        },
        protocol: session.protocol,
        // For WireGuard, return config
        wireguardConfig:
          session.protocol === 'wireguard'
            ? {
                endpoint: targetNode.endpoint,
                publicKey: targetNode.wireguardPubKey,
                allowedIPs: ['0.0.0.0/0', '::/0'],
                persistentKeepalive: 25,
              }
            : undefined,
        // For SOCKS5, return proxy details
        // SECURITY: Generate a random token instead of using wallet address as password
        socks5Config:
          session.protocol === 'socks5'
            ? {
                host: targetNode.endpoint.split(':')[0],
                port: 1080,
                username: session.sessionId,
                password: crypto.randomUUID(), // Random token, not sensitive address
              }
            : undefined,
      }
    })

    /**
     * POST /disconnect - End VPN session
     */
    .post('/disconnect', async ({ request, body }) => {
      const auth = await verifyAuth(request)
      expect(auth.valid, auth.error || 'Authentication required')
      if (!auth.address) {
        throw new Error('Authentication address missing')
      }

      const validatedBody = expectValid(
        DisconnectRequestSchema,
        body,
        'disconnect request',
      )

      const session = getSession(ctx, validatedBody.sessionId)
      verifySessionOwnership(session, auth.address)

      // End session
      deleteSession(ctx, validatedBody.sessionId)

      return {
        success: true,
        duration: getSessionDuration(session),
        bytesUp: session.bytesUp.toString(),
        bytesDown: session.bytesDown.toString(),
      }
    })

    /**
     * GET /session/:sessionId - Get session status
     */
    .get('/session/:sessionId', async ({ request, params }) => {
      const auth = await verifyAuth(request)
      expect(auth.valid, auth.error || 'Authentication required')
      if (!auth.address) {
        throw new Error('Authentication address missing')
      }

      const { sessionId } = params
      if (!sessionId || sessionId.length === 0) {
        throw new Error('Session ID required')
      }

      const session = getSession(ctx, sessionId)
      verifySessionOwnership(session, auth.address)

      return {
        sessionId: session.sessionId,
        nodeId: session.nodeId,
        protocol: session.protocol,
        startTime: session.startTime,
        duration: getSessionDuration(session),
        bytesUp: session.bytesUp.toString(),
        bytesDown: session.bytesDown.toString(),
        isPaid: session.isPaid,
      }
    })

    /**
     * POST /proxy - Make a proxied HTTP request (requires x402 payment)
     */
    .post('/proxy', async ({ request, body }) => {
      const paymentHeader = request.headers.get('x-payment')

      // Verify x402 payment for proxy requests
      const paymentResult = await verifyX402Payment(
        paymentHeader || '',
        BigInt(ctx.config.pricing.pricePerRequest),
        'vpn:proxy',
        ctx.config,
      )

      expect(
        paymentResult.valid,
        paymentResult.error ||
          'Payment required. Include x-payment header with valid x402 payment.',
      )

      // SECURITY: Check content-length before parsing body
      const contentLength = request.headers.get('content-length')
      if (
        contentLength &&
        parseInt(contentLength, 10) > MAX_REQUEST_BODY_SIZE
      ) {
        throw new Error(
          `Request body too large. Max size: ${MAX_REQUEST_BODY_SIZE} bytes`,
        )
      }

      const validatedBody = expectValid(
        ProxyRequestSchema,
        body,
        'proxy request',
      )

      // SECURITY: Validate URL with DNS resolution to prevent SSRF and DNS rebinding attacks
      await validateProxyUrlWithDNS(validatedBody.url)

      // Find exit node
      const exitNode = findBestNode(ctx, validatedBody.countryCode)
      expect(exitNode !== undefined, 'No available nodes matching criteria')

      // Make proxied request with timeout
      const startTime = Date.now()
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)

      const response = await fetch(validatedBody.url, {
        method: validatedBody.method,
        headers: validatedBody.headers,
        body: validatedBody.body,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId))

      const responseBody = await readResponseBody(
        response,
        MAX_RESPONSE_BODY_SIZE,
      )

      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((v, k) => {
        responseHeaders[k] = v
      })

      return {
        status: response.status,
        headers: responseHeaders,
        body: responseBody,
        exitNode: exitNode.nodeId,
        exitCountry: exitNode.countryCode,
        latencyMs: Date.now() - startTime,
      }
    })

    /**
     * GET /contribution - Get contribution status
     */
    .get('/contribution', async ({ request }) => {
      const auth = await verifyAuth(request)
      expect(auth.valid, auth.error || 'Authentication required')
      if (!auth.address) {
        throw new Error('Authentication address missing')
      }

      const contribution = getOrCreateContribution(ctx, auth.address)

      // Check if this is a new user (no usage yet)
      if (
        contribution.bytesUsed === BigInt(0) &&
        contribution.bytesContributed === BigInt(0)
      ) {
        const now = Date.now()
        const periodEnd = now + 30 * 24 * 60 * 60 * 1000
        return {
          bytesUsed: '0',
          bytesContributed: '0',
          cap: '0',
          quotaRemaining: '0',
          periodStart: now,
          periodEnd,
          isNewUser: true,
        }
      }

      // Check if period expired and reset if needed
      if (isContributionPeriodExpired(contribution)) {
        resetContributionPeriod(contribution)
      }

      const quotaRemaining = getQuotaRemaining(contribution)
      const contributionRatio = calculateContributionRatio(contribution)

      return {
        bytesUsed: contribution.bytesUsed.toString(),
        bytesContributed: contribution.bytesContributed.toString(),
        cap: contribution.cap.toString(),
        quotaRemaining: quotaRemaining.toString(),
        periodStart: contribution.periodStart,
        periodEnd: contribution.periodEnd,
        contributionRatio,
      }
    })

    /**
     * POST /contribution/settings - Update contribution settings
     */
    .post('/contribution/settings', async ({ request, body }) => {
      const auth = await verifyAuth(request)
      expect(auth.valid, auth.error || 'Authentication required')
      if (!auth.address) {
        throw new Error('Authentication address missing')
      }

      const validatedBody = expectValid(
        ContributionSettingsRequestSchema,
        body,
        'contribution settings',
      )

      // Store settings (would persist to DB in production)
      return {
        success: true,
        settings: validatedBody,
      }
    })

  return router
}
