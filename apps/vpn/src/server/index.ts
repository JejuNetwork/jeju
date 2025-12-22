/**
 * VPN Server with x402, A2A, MCP, and REST API
 *
 * Provides:
 * - REST API for VPN operations
 * - x402 micropayments for premium/paid tier
 * - A2A protocol for agent-to-agent VPN access
 * - MCP tools for AI agent integration
 */

import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import { createA2ARouter } from './a2a'
import { createMCPRouter } from './mcp'
import { createRESTRouter } from './rest'
import { expectValid, VPNServerConfigSchema } from './schemas'
import type { VPNServerConfig, VPNServiceContext } from './types'
import { checkRateLimit } from './utils/rate-limit'
import { createX402Middleware } from './x402'

export function createVPNServer(config: VPNServerConfig) {
  // Validate config on startup
  expectValid(VPNServerConfigSchema, config, 'VPN server config')

  // Service context available to all routes
  const ctx: VPNServiceContext = {
    config,
    nodes: new Map(),
    sessions: new Map(),
    contributions: new Map(),
  }

  const app = new Elysia()
    // Base middleware with restrictive CORS
    .use(
      cors({
        origin: [
          config.publicUrl,
          'https://vpn.jejunetwork.org',
          'https://app.jejunetwork.org',
          // Allow localhost in development
          ...(process.env.NODE_ENV === 'development'
            ? ['http://localhost:1421', 'http://127.0.0.1:1421']
            : []),
        ],
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'x-jeju-address',
          'x-jeju-timestamp',
          'x-jeju-signature',
          'x-payment',
        ],
        exposeHeaders: [
          'Content-Length',
          'Content-Type',
          'X-RateLimit-Remaining',
          'X-RateLimit-Reset',
        ],
        maxAge: 600,
        credentials: true,
      }),
    )
    // SECURITY: Apply rate limiting to all endpoints
    .onBeforeHandle(({ request, set }) => {
      // Get identifier from request
      const forwardedFor = request.headers.get('x-forwarded-for')
      const realIp = request.headers.get('x-real-ip')
      const jejuAddress = request.headers.get('x-jeju-address')
      const identifier =
        jejuAddress ?? forwardedFor?.split(',')[0]?.trim() ?? realIp ?? 'unknown'

      // Determine endpoint type for rate limiting
      const path = new URL(request.url).pathname
      let type = 'default'
      if (path.includes('/connect') || path.includes('/disconnect')) {
        type = 'session'
      } else if (path.includes('/proxy')) {
        type = 'proxy'
      } else if (path.includes('/auth') || path.includes('/login')) {
        type = 'auth'
      }

      const result = checkRateLimit(type, identifier)

      // Add rate limit headers
      set.headers['X-RateLimit-Remaining'] = result.remaining.toString()
      set.headers['X-RateLimit-Reset'] = result.resetAt.toString()

      if (!result.allowed) {
        set.status = 429
        return {
          error: 'Too many requests. Please try again later.',
          retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
        }
      }
      return undefined
    })
    // Global error handler - sanitize error messages
    .onError(({ error, set }) => {
      console.error('VPN Server error:', error)

      // SECURITY: Don't expose internal error details to clients
      // Only expose safe validation/auth errors
      const safeErrors = [
        'Authentication required',
        'Invalid authentication',
        'Invalid signature',
        'Session expired',
        'Session not found',
        'Node not found',
        'No available nodes',
        'Payment required',
        'Invalid payment',
        'Validation failed',
      ]

      const message = error instanceof Error ? error.message : ''
      const isSafeError =
        safeErrors.some((safe) => message.includes(safe)) ||
        message.startsWith('Validation failed')

      if (isSafeError) {
        set.status = 400
        return { error: message }
      }

      // Generic error for unexpected issues
      set.status = 500
      return { error: 'Internal server error' }
    })
    // Health check
    .get('/health', () => ({ status: 'ok', service: 'vpn' }))
    // Version info
    .get('/version', () => ({
      name: 'Jeju VPN',
      version: '1.0.0',
      protocols: ['wireguard', 'socks5', 'http-connect'],
      features: ['x402', 'a2a', 'mcp', 'fair-contribution'],
    }))
    // Mount REST API
    .use(createRESTRouter(ctx))
    // Mount x402 payment endpoints
    .use(createX402Middleware(ctx))
    // Mount A2A protocol
    .use(createA2ARouter(ctx))
    // Mount MCP protocol
    .use(createMCPRouter(ctx))
    // Agent card for A2A discovery
    .get('/.well-known/agent-card.json', () => ({
      protocolVersion: '1.0',
      name: 'Jeju VPN Agent',
      description: 'Decentralized VPN service with fair contribution model',
      url: config.publicUrl,
      provider: {
        organization: 'Jeju Network',
        url: 'https://jejunetwork.org',
      },
      version: '1.0.0',
      capabilities: {
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: false,
      },
      skills: [
        {
          id: 'vpn_connect',
          name: 'Connect to VPN',
          description: 'Establish a VPN connection through the Jeju network',
          inputs: {
            countryCode: {
              type: 'string',
              description: 'Target country (e.g., US, NL, JP)',
            },
            protocol: {
              type: 'string',
              description: 'VPN protocol (wireguard, socks5)',
              default: 'wireguard',
            },
          },
          outputs: {
            connectionId: 'string',
            endpoint: 'string',
            publicKey: 'string',
          },
          paymentRequired: false, // Free tier available
        },
        {
          id: 'vpn_disconnect',
          name: 'Disconnect VPN',
          description: 'End the current VPN session',
          inputs: {
            connectionId: {
              type: 'string',
              description: 'Connection ID to disconnect',
            },
          },
          outputs: {
            success: 'boolean',
            bytesTransferred: 'number',
          },
        },
        {
          id: 'get_nodes',
          name: 'List VPN Nodes',
          description: 'Get available VPN exit nodes',
          inputs: {
            countryCode: {
              type: 'string',
              description: 'Filter by country',
              optional: true,
            },
          },
          outputs: {
            nodes: 'array',
          },
        },
        {
          id: 'proxy_request',
          name: 'Proxy HTTP Request',
          description: 'Make an HTTP request through the VPN network',
          inputs: {
            url: { type: 'string', description: 'Target URL' },
            method: {
              type: 'string',
              description: 'HTTP method',
              default: 'GET',
            },
            headers: {
              type: 'object',
              description: 'Request headers',
              optional: true,
            },
            body: {
              type: 'string',
              description: 'Request body',
              optional: true,
            },
            countryCode: {
              type: 'string',
              description: 'Exit country',
              optional: true,
            },
          },
          outputs: {
            status: 'number',
            headers: 'object',
            body: 'string',
          },
          paymentRequired: true, // Requires x402 payment
        },
        {
          id: 'get_contribution',
          name: 'Get Contribution Status',
          description: 'Get your fair contribution quota status',
          inputs: {},
          outputs: {
            bytesUsed: 'number',
            bytesContributed: 'number',
            quotaRemaining: 'number',
          },
        },
      ],
    }))

  return app
}

export type { VPNServerConfig, VPNServiceContext } from './types'
