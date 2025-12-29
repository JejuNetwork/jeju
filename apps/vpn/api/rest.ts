/** REST API for VPN operations */

import { Elysia } from 'elysia'
import type { Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
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
import { createBandwidthContractService } from './services/bandwidth-contract'
import type { VPNServiceContext } from './types'

// Initialize contract service (null if not configured)
const bandwidthContract = createBandwidthContractService()

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

const MAX_REQUEST_BODY_SIZE = 1024 * 1024
const MAX_RESPONSE_BODY_SIZE = 10 * 1024 * 1024

export function createRESTRouter(ctx: VPNServiceContext) {
  const router = new Elysia({ prefix: '/api/v1' })
    .onError(({ error, set }) => {
      console.error('REST API error:', error)
      set.status = 500
      const message =
        error instanceof Error ? error.message : 'Internal server error'
      return { error: message }
    })

    .get('/nodes', ({ query }) => {
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

    .get('/nodes/:nodeId', ({ params }) => {
      const { nodeId } = params
      if (!nodeId || nodeId.length === 0) {
        throw new Error('Node ID required')
      }

      const node = getNodeById(ctx, nodeId)
      return { node }
    })

    .get('/countries', () => {
      const countries = getNodesByCountry(ctx)

      return {
        countries: Array.from(countries.entries()).map(([code, count]) => ({
          code,
          nodeCount: count,
        })),
      }
    })

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

    .post('/connect', async ({ request, body }) => {
      const auth = await verifyAuth(request)
      expect(auth.valid, auth.error ?? 'Authentication required')
      if (!auth.address) {
        throw new Error('Authentication address missing')
      }

      const validatedBody = expectValid(
        ConnectRequestSchema,
        body,
        'connect request',
      )

      let targetNode: VPNNodeState | undefined
      if (validatedBody.nodeId) {
        targetNode = getNodeById(ctx, validatedBody.nodeId)
      } else {
        targetNode = findBestNode(ctx, validatedBody.countryCode)
      }

      expect(targetNode !== undefined, 'No available nodes matching criteria')

      const session = createSession(
        ctx,
        auth.address,
        targetNode.nodeId,
        validatedBody.protocol ?? 'wireguard',
      )

      return {
        sessionId: session.sessionId,
        node: {
          nodeId: targetNode.nodeId,
          countryCode: targetNode.countryCode,
          endpoint: targetNode.endpoint,
          publicKey: targetNode.wireguardPubKey,
        },
        protocol: session.protocol,
        wireguardConfig:
          session.protocol === 'wireguard'
            ? {
                endpoint: targetNode.endpoint,
                publicKey: targetNode.wireguardPubKey,
                allowedIPs: ['0.0.0.0/0', '::/0'],
                persistentKeepalive: 25,
              }
            : undefined,
        socks5Config:
          session.protocol === 'socks5'
            ? {
                host: targetNode.endpoint.split(':')[0],
                port: 1080,
                username: session.sessionId,
                password: crypto.randomUUID(),
              }
            : undefined,
      }
    })

    .post('/disconnect', async ({ request, body }) => {
      const auth = await verifyAuth(request)
      expect(auth.valid, auth.error ?? 'Authentication required')
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
      deleteSession(ctx, validatedBody.sessionId)

      return {
        success: true,
        duration: getSessionDuration(session),
        bytesUp: session.bytesUp.toString(),
        bytesDown: session.bytesDown.toString(),
      }
    })

    .get('/session/:sessionId', async ({ request, params }) => {
      const auth = await verifyAuth(request)
      expect(auth.valid, auth.error ?? 'Authentication required')
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

    .post('/proxy', async ({ request, body }) => {
      const paymentHeader = request.headers.get('x-payment')

      const paymentResult = await verifyX402Payment(
        paymentHeader ?? '',
        BigInt(ctx.config.pricing.pricePerRequest),
        'vpn:proxy',
        ctx.config,
      )

      expect(
        paymentResult.valid,
        paymentResult.error ||
          'Payment required. Include x-payment header with valid x402 payment.',
      )

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

      await validateProxyUrlWithDNS(validatedBody.url)

      const exitNode = findBestNode(ctx, validatedBody.countryCode)
      expect(exitNode !== undefined, 'No available nodes matching criteria')

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

    .get('/contribution', async ({ request }) => {
      const auth = await verifyAuth(request)
      expect(auth.valid, auth.error ?? 'Authentication required')
      if (!auth.address) {
        throw new Error('Authentication address missing')
      }

      const contribution = getOrCreateContribution(ctx, auth.address)

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

    .get('/contribution/settings', async ({ request }) => {
      const auth = await verifyAuth(request)
      expect(auth.valid, auth.error ?? 'Authentication required')
      if (!auth.address) {
        throw new Error('Authentication address missing')
      }

      const settings = ctx.contributionSettings.get(auth.address)
      if (!settings) {
        return {
          address: auth.address,
          enabled: true,
          maxBandwidthPercent: 10,
          shareCDN: true,
          shareVPNRelay: true,
          earningMode: false,
          updatedAt: 0,
        }
      }

      return settings
    })

    .post('/contribution/settings', async ({ request, body }) => {
      const auth = await verifyAuth(request)
      expect(auth.valid, auth.error ?? 'Authentication required')
      if (!auth.address) {
        throw new Error('Authentication address missing')
      }

      const validatedBody = expectValid(
        ContributionSettingsRequestSchema,
        body,
        'contribution settings',
      )

      const existingSettings = ctx.contributionSettings.get(auth.address)
      const updatedSettings = {
        address: auth.address,
        enabled: validatedBody.enabled ?? existingSettings?.enabled ?? true,
        maxBandwidthPercent:
          validatedBody.maxBandwidthPercent ??
          existingSettings?.maxBandwidthPercent ??
          10,
        shareCDN: validatedBody.shareCDN ?? existingSettings?.shareCDN ?? true,
        shareVPNRelay:
          validatedBody.shareVPNRelay ??
          existingSettings?.shareVPNRelay ??
          true,
        earningMode:
          validatedBody.earningMode ?? existingSettings?.earningMode ?? false,
        updatedAt: Date.now(),
      }
      ctx.contributionSettings.set(auth.address, updatedSettings)

      return {
        success: true,
        settings: updatedSettings,
      }
    })

    // Residential Proxy / Bandwidth Sharing Endpoints

    .get('/residential-proxy/status', async ({ request }) => {
      const auth = await verifyAuth(request)
      expect(auth.valid, auth.error ?? 'Authentication required')
      if (!auth.address) {
        throw new Error('Authentication address missing')
      }

      // If contract is configured, fetch real data from blockchain
      if (bandwidthContract) {
        const status = await bandwidthContract.getNodeStatus(
          auth.address as Address,
        )
        return status
      }

      // Fallback to in-memory storage (for dev/testing)
      const status = ctx.bandwidthStatus?.get(auth.address)

      if (!status) {
        return {
          is_registered: false,
          is_active: false,
          stake_amount: '0',
          total_bytes_shared: '0',
          total_sessions: 0,
          total_earnings: '0',
          pending_rewards: '0',
          current_connections: 0,
          uptime_score: 0,
          success_rate: 0,
          coordinator_connected: false,
        }
      }

      return status
    })

    .get('/residential-proxy/settings', async ({ request }) => {
      const auth = await verifyAuth(request)
      expect(auth.valid, auth.error ?? 'Authentication required')
      if (!auth.address) {
        throw new Error('Authentication address missing')
      }

      const settings = ctx.bandwidthSettings?.get(auth.address)

      if (!settings) {
        return {
          enabled: false,
          node_type: 'residential',
          max_bandwidth_mbps: 100,
          max_concurrent_connections: 50,
          allowed_ports: [80, 443, 8080, 8443],
          blocked_domains: [],
          schedule_enabled: false,
        }
      }

      return settings
    })

    .post('/residential-proxy/settings', async ({ request, body }) => {
      const auth = await verifyAuth(request)
      expect(auth.valid, auth.error ?? 'Authentication required')
      if (!auth.address) {
        throw new Error('Authentication address missing')
      }

      const settings = body as {
        enabled?: boolean
        node_type?: string
        max_bandwidth_mbps?: number
        max_concurrent_connections?: number
        allowed_ports?: number[]
        blocked_domains?: string[]
        schedule_enabled?: boolean
        schedule_start_hour?: number
        schedule_end_hour?: number
      }

      const existing = ctx.bandwidthSettings?.get(auth.address)
      const updated = {
        enabled: settings.enabled ?? existing?.enabled ?? false,
        node_type: settings.node_type ?? existing?.node_type ?? 'residential',
        max_bandwidth_mbps:
          settings.max_bandwidth_mbps ?? existing?.max_bandwidth_mbps ?? 100,
        max_concurrent_connections:
          settings.max_concurrent_connections ??
          existing?.max_concurrent_connections ??
          50,
        allowed_ports: settings.allowed_ports ??
          existing?.allowed_ports ?? [80, 443, 8080, 8443],
        blocked_domains:
          settings.blocked_domains ?? existing?.blocked_domains ?? [],
        schedule_enabled:
          settings.schedule_enabled ?? existing?.schedule_enabled ?? false,
        schedule_start_hour:
          settings.schedule_start_hour ?? existing?.schedule_start_hour,
        schedule_end_hour:
          settings.schedule_end_hour ?? existing?.schedule_end_hour,
      }

      if (!ctx.bandwidthSettings) {
        ctx.bandwidthSettings = new Map()
      }
      ctx.bandwidthSettings.set(auth.address, updated)

      return {
        success: true,
        settings: updated,
      }
    })

    .get('/residential-proxy/stats', async ({ request }) => {
      const auth = await verifyAuth(request)
      expect(auth.valid, auth.error ?? 'Authentication required')
      if (!auth.address) {
        throw new Error('Authentication address missing')
      }

      const stats = ctx.bandwidthStats?.get(auth.address)

      if (!stats) {
        return {
          bytes_shared_today: '0',
          bytes_shared_week: '0',
          bytes_shared_month: '0',
          sessions_today: 0,
          sessions_week: 0,
          avg_session_duration_ms: 0,
          peak_bandwidth_mbps: 0,
          earnings_today: '0',
          earnings_week: '0',
          earnings_month: '0',
        }
      }

      return stats
    })

    .post('/residential-proxy/register', async ({ request, body }) => {
      const auth = await verifyAuth(request)
      expect(auth.valid, auth.error ?? 'Authentication required')
      if (!auth.address) {
        throw new Error('Authentication address missing')
      }

      const { stake_amount, node_type, region, private_key } = body as {
        stake_amount: string
        node_type?: string
        region?: string
        private_key?: string
      }

      // If contract is configured and we have a private key, register on-chain
      if (bandwidthContract && private_key) {
        const account = privateKeyToAccount(private_key as `0x${string}`)

        if (account.address.toLowerCase() !== auth.address.toLowerCase()) {
          throw new Error('Private key does not match authenticated address')
        }

        const hash = await bandwidthContract.registerNode(
          account,
          node_type ?? 'residential',
          region ?? 'unknown',
          stake_amount,
        )

        return {
          success: true,
          node_address: auth.address,
          stake_amount,
          transaction_hash: hash,
        }
      }

      // Fallback to in-memory storage (for dev/testing without contract)
      if (!ctx.bandwidthStatus) {
        ctx.bandwidthStatus = new Map()
      }

      ctx.bandwidthStatus.set(auth.address, {
        is_registered: true,
        is_active: false,
        node_address: auth.address,
        stake_amount: stake_amount,
        total_bytes_shared: '0',
        total_sessions: 0,
        total_earnings: '0',
        pending_rewards: '0',
        current_connections: 0,
        uptime_score: 0,
        success_rate: 0,
        coordinator_connected: false,
      })

      return {
        success: true,
        node_address: auth.address,
        stake_amount,
      }
    })

    .post('/residential-proxy/claim', async ({ request, body }) => {
      const auth = await verifyAuth(request)
      expect(auth.valid, auth.error ?? 'Authentication required')
      if (!auth.address) {
        throw new Error('Authentication address missing')
      }

      const { private_key } = (body ?? {}) as { private_key?: string }

      // If contract is configured and we have a private key, claim on-chain
      if (bandwidthContract && private_key) {
        const account = privateKeyToAccount(private_key as `0x${string}`)

        if (account.address.toLowerCase() !== auth.address.toLowerCase()) {
          throw new Error('Private key does not match authenticated address')
        }

        const hash = await bandwidthContract.claimRewards(account)

        return {
          success: true,
          transaction_hash: hash,
        }
      }

      // Fallback to in-memory storage (for dev/testing)
      const status = ctx.bandwidthStatus?.get(auth.address)
      expect(status?.is_registered === true, 'Node not registered')

      const pendingRewards = status?.pending_rewards ?? '0'

      if (ctx.bandwidthStatus && status) {
        ctx.bandwidthStatus.set(auth.address, {
          ...status,
          pending_rewards: '0',
          total_earnings: (
            BigInt(status.total_earnings) + BigInt(pendingRewards)
          ).toString(),
        })
      }

      return {
        success: true,
        claimed_amount: pendingRewards,
      }
    })

  return router
}
