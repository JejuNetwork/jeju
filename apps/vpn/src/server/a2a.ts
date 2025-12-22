/**
 * A2A Protocol Handler for VPN
 *
 * Enables agent-to-agent VPN access following the Jeju A2A protocol.
 *
 * Uses fail-fast validation patterns.
 *
 * Proxy Strategy:
 * - proxy skill: Proxies A2A agent requests to external URLs (keep fetch)
 *   Uses raw fetch to proxy user-submitted requests to external services.
 *   Cannot use Eden as target URLs are user-provided and external.
 */

import { Elysia } from 'elysia'
import type { Address } from 'viem'
import type { z } from 'zod'
import { verifyAuth } from './auth'
import {
  A2ARequestSchema,
  A2ASkillDataSchema,
  expect,
  expectValid,
  ProxyRequestSchema,
} from './schemas'
import type { VPNServiceContext } from './types'
import {
  calculateContributionRatio,
  getOrCreateContribution,
  getQuotaRemaining,
} from './utils/contributions'
import {
  calculateNodeLoad,
  filterNodesByCountry,
  filterNodesByStatus,
  findBestNode,
} from './utils/nodes'
import { validateProxyUrlWithDNS } from './utils/proxy-validation'
import { readResponseBody } from './utils/response-reader'
import {
  createSession,
  deleteSession,
  getSession,
  getSessionBytesTransferred,
  getSessionDuration,
  verifySessionOwnership,
} from './utils/sessions'
import { verifyX402Payment } from './x402'

// Infer types from Zod schemas
type A2ARequest = z.infer<typeof A2ARequestSchema>

// Maximum response body size for A2A proxy (10MB)
const A2A_MAX_RESPONSE_BODY_SIZE = 10 * 1024 * 1024

export function createA2ARouter(ctx: VPNServiceContext) {
  const router = new Elysia({ prefix: '/a2a' })
    // Error handling middleware
    .onError(({ error, set }) => {
      console.error('A2A API error:', error)
      set.status = 500
      const message = error instanceof Error ? error.message : 'Internal error'
      return {
        jsonrpc: '2.0',
        id: 0,
        error: { code: -32603, message },
      }
    })

    .post('/', async ({ request, body }) => {
      const auth = await verifyAuth(request)
      // auth.address is already validated as Address by verifyAuth when valid
      const address = auth.valid && auth.address ? auth.address : null

      const a2aRequest = expectValid(A2ARequestSchema, body, 'A2A request')

      // Route based on method
      switch (a2aRequest.method) {
        case 'message/send':
          return handleMessage(request, ctx, a2aRequest, address)

        case 'agent/card':
          return {
            jsonrpc: '2.0',
            id: a2aRequest.id,
            result: await getAgentCard(ctx),
          }

        default:
          return {
            jsonrpc: '2.0',
            id: a2aRequest.id,
            error: {
              code: -32601,
              message: `Method not found: ${a2aRequest.method}`,
            },
          }
      }
    })

  return router
}

// ============================================================================
// Message Handler
// ============================================================================

async function handleMessage(
  request: Request,
  ctx: VPNServiceContext,
  a2aRequest: A2ARequest,
  address: Address | null,
) {
  const message = a2aRequest.params.message

  // Extract skill and params from message
  const dataPart = message.parts.find((p) => p.kind === 'data')
  if (!dataPart || !dataPart.data) {
    throw new Error('Message must contain a data part with data object')
  }

  // Validate skill data with Zod schema
  const skillData = expectValid(
    A2ASkillDataSchema,
    dataPart.data,
    'A2A skill data',
  )
  const { skillId, params } = skillData

  // Handle each skill
  switch (skillId) {
    case 'vpn_connect':
      return handleConnect(ctx, a2aRequest, params, address)

    case 'vpn_disconnect':
      return handleDisconnect(ctx, a2aRequest, params, address)

    case 'get_nodes':
      return handleGetNodes(ctx, a2aRequest, params)

    case 'proxy_request':
      return handleProxyRequest(request, ctx, a2aRequest, params)

    case 'get_contribution':
      return handleGetContribution(ctx, a2aRequest, address)

    default:
      return {
        jsonrpc: '2.0',
        id: a2aRequest.id,
        error: { code: -32601, message: `Unknown skill: ${skillId}` },
      }
  }
}

async function handleConnect(
  ctx: VPNServiceContext,
  a2aRequest: A2ARequest,
  params: Record<string, unknown>,
  address: Address | null,
) {
  if (!address) {
    throw new Error('Authentication required for VPN connection')
  }

  const countryCode =
    typeof params.countryCode === 'string' ? params.countryCode : undefined
  const protocol =
    typeof params.protocol === 'string' ? params.protocol : 'wireguard'

  expect(
    ['wireguard', 'socks5', 'http'].includes(protocol),
    `Invalid protocol: ${protocol}`,
  )

  const node = findBestNode(ctx, countryCode)
  if (!node) {
    throw new Error('No available nodes matching criteria')
  }

  // Create session using utility
  const session = createSession(
    ctx,
    address,
    node.nodeId,
    protocol as 'wireguard' | 'socks5' | 'http',
  )

  return {
    jsonrpc: '2.0',
    id: a2aRequest.id,
    result: {
      parts: [
        {
          kind: 'text',
          text: `Connected to VPN node in ${node.countryCode}`,
        },
        {
          kind: 'data',
          data: {
            connectionId: session.sessionId,
            endpoint: node.endpoint,
            publicKey: node.wireguardPubKey,
            countryCode: node.countryCode,
          },
        },
      ],
    },
  }
}

async function handleDisconnect(
  ctx: VPNServiceContext,
  a2aRequest: A2ARequest,
  params: Record<string, unknown>,
  address: Address | null,
) {
  const connectionId =
    typeof params.connectionId === 'string' ? params.connectionId : null
  if (!connectionId || connectionId.length === 0) {
    throw new Error('connectionId must be a non-empty string')
  }

  if (!address) {
    throw new Error('Authentication required for disconnect')
  }

  const session = getSession(ctx, connectionId)
  verifySessionOwnership(session, address)

  const bytesTransferred = getSessionBytesTransferred(session)
  deleteSession(ctx, connectionId)

  return {
    jsonrpc: '2.0',
    id: a2aRequest.id,
    result: {
      parts: [
        {
          kind: 'text',
          text: 'VPN disconnected successfully',
        },
        {
          kind: 'data',
          data: {
            success: true,
            bytesTransferred: bytesTransferred.toString(),
            duration: getSessionDuration(session),
          },
        },
      ],
    },
  }
}

async function handleGetNodes(
  ctx: VPNServiceContext,
  a2aRequest: A2ARequest,
  params: Record<string, unknown>,
) {
  const countryCode =
    typeof params.countryCode === 'string' ? params.countryCode : undefined

  let nodes = filterNodesByStatus(Array.from(ctx.nodes.values()), 'online')
  if (countryCode) {
    nodes = filterNodesByCountry(nodes, countryCode)
  }

  return {
    jsonrpc: '2.0',
    id: a2aRequest.id,
    result: {
      parts: [
        {
          kind: 'text',
          text: `Found ${nodes.length} available VPN nodes`,
        },
        {
          kind: 'data',
          data: {
            nodes: nodes.map((n) => ({
              nodeId: n.nodeId,
              countryCode: n.countryCode,
              status: n.status,
              load: calculateNodeLoad(n),
            })),
          },
        },
      ],
    },
  }
}

async function handleProxyRequest(
  request: Request,
  ctx: VPNServiceContext,
  a2aRequest: A2ARequest,
  params: Record<string, unknown>,
) {
  // Proxy requests require x402 payment
  const paymentHeader = request.headers.get('x-payment')
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

  // Validate proxy request params
  const proxyRequest = expectValid(
    ProxyRequestSchema,
    params,
    'proxy request params',
  )

  // SECURITY: Validate URL with DNS resolution to prevent SSRF and DNS rebinding attacks
  await validateProxyUrlWithDNS(proxyRequest.url)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000)

  const response = await fetch(proxyRequest.url, {
    method: proxyRequest.method,
    headers: proxyRequest.headers,
    body: proxyRequest.body,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId))

  const responseBody = await readResponseBody(
    response,
    A2A_MAX_RESPONSE_BODY_SIZE,
  )

  return {
    jsonrpc: '2.0',
    id: a2aRequest.id,
    result: {
      parts: [
        {
          kind: 'text',
          text: `Proxy request completed: ${response.status} ${response.statusText}`,
        },
        {
          kind: 'data',
          data: {
            status: response.status,
            body: responseBody.slice(0, 10000), // Limit response in JSON output
          },
        },
      ],
    },
  }
}

async function handleGetContribution(
  ctx: VPNServiceContext,
  a2aRequest: A2ARequest,
  address: Address | null,
) {
  if (!address) {
    throw new Error('Authentication required for contribution status')
  }

  const contribution = getOrCreateContribution(ctx, address)
  const quotaRemaining = getQuotaRemaining(contribution)
  const contributionRatio = calculateContributionRatio(contribution)

  return {
    jsonrpc: '2.0',
    id: a2aRequest.id,
    result: {
      parts: [
        {
          kind: 'text',
          text: `You have used ${contribution.bytesUsed} bytes and contributed ${contribution.bytesContributed} bytes (${contributionRatio.toFixed(2)}x ratio)`,
        },
        {
          kind: 'data',
          data: {
            bytesUsed: contribution.bytesUsed.toString(),
            bytesContributed: contribution.bytesContributed.toString(),
            quotaRemaining: quotaRemaining.toString(),
            contributionRatio,
          },
        },
      ],
    },
  }
}

export interface AgentCard {
  protocolVersion: string
  name: string
  url: string
  skills: string[]
}

async function getAgentCard(
  ctx: VPNServiceContext,
): Promise<{ card: AgentCard }> {
  return {
    card: {
      protocolVersion: '1.0',
      name: 'Jeju VPN Agent',
      url: ctx.config.publicUrl,
      skills: [
        'vpn_connect',
        'vpn_disconnect',
        'get_nodes',
        'proxy_request',
        'get_contribution',
      ],
    },
  }
}
