/** VPN Server - REST, x402, A2A, and MCP protocols */

import { cors } from '@elysiajs/cors'
import { parseEnvAddress } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import { createA2ARouter } from './a2a'
import { config as vpnConfig } from './config'
import { createMCPRouter } from './mcp'
import { createRESTRouter } from './rest'
import {
  expectValid,
  type VPNServerConfig,
  VPNServerConfigSchema,
} from './schemas'
import type { VPNServiceContext } from './types'
import { checkRateLimit } from './utils/rate-limit'
import { createX402Middleware } from './x402'

export function createVPNServer(serverConfig: VPNServerConfig) {
  expectValid(VPNServerConfigSchema, serverConfig, 'VPN server config')

  const ctx: VPNServiceContext = {
    config: serverConfig,
    nodes: new Map(),
    sessions: new Map(),
    contributions: new Map(),
    contributionSettings: new Map(),
  }

  const app = new Elysia()
    .use(
      cors({
        origin: [
          serverConfig.publicUrl,
          'https://vpn.jejunetwork.org',
          'https://app.jejunetwork.org',
          ...(!vpnConfig.isProduction
            ? (() => {
                const host = getLocalhostHost()
                return [`http://${host}:1421`]
              })()
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
    .onBeforeHandle(({ request, set }) => {
      const forwardedFor = request.headers.get('x-forwarded-for')
      const realIp = request.headers.get('x-real-ip')
      const jejuAddress = request.headers.get('x-jeju-address')
      const identifier =
        jejuAddress ??
        forwardedFor?.split(',')[0]?.trim() ??
        realIp ??
        'unknown'

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
    .onError(({ error, set }) => {
      console.error('VPN Server error:', error)

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

      set.status = 500
      return { error: 'Internal server error' }
    })
    .get('/health', () => ({ status: 'ok', service: 'vpn' }))
    .get('/version', () => ({
      name: 'Jeju VPN',
      version: '1.0.0',
      protocols: ['wireguard', 'socks5', 'http-connect'],
      features: ['x402', 'a2a', 'mcp', 'fair-contribution'],
    }))
    .use(createRESTRouter(ctx))
    .use(createX402Middleware(ctx))
    .use(createA2ARouter(ctx))
    .use(createMCPRouter(ctx))
    .get('/.well-known/agent-card.json', () => ({
      protocolVersion: '1.0',
      name: 'Jeju VPN Agent',
      description: 'Decentralized VPN service with fair contribution model',
      url: serverConfig.publicUrl,
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

export type { VPNServerConfig } from './schemas'
export type { VPNServiceContext } from './types'

import { CORE_PORTS, getLocalhostHost } from '@jejunetwork/config'

const PORT = vpnConfig.port || CORE_PORTS.VPN_API.get()

const devServerConfig: VPNServerConfig = {
  publicUrl: vpnConfig.publicUrl || `http://${getLocalhostHost()}:${PORT}`,
  port: PORT,
  chainId: vpnConfig.chainId,
  rpcUrl: vpnConfig.rpcUrl,
  coordinatorUrl: vpnConfig.coordinatorUrl,
  contracts: {
    vpnRegistry: parseEnvAddress(vpnConfig.vpnRegistryAddress),
    vpnBilling: parseEnvAddress(vpnConfig.vpnBillingAddress),
    x402Facilitator: parseEnvAddress(vpnConfig.x402FacilitatorAddress),
  },
  paymentRecipient: parseEnvAddress(vpnConfig.paymentRecipientAddress),
  pricing: {
    pricePerGB: vpnConfig.pricePerGB,
    pricePerHour: vpnConfig.pricePerHour,
    pricePerRequest: vpnConfig.pricePerRequest,
    supportedTokens: [parseEnvAddress(vpnConfig.paymentTokenAddress)],
  },
}

const app = createVPNServer(devServerConfig)

const host = getLocalhostHost()
app.listen(PORT, () => {
  console.log(`VPN Server running on http://${host}:${PORT}`)
  console.log(`  - REST API: /api/v1`)
  console.log(`  - A2A Protocol: /a2a`)
  console.log(`  - MCP Protocol: /mcp`)
  console.log(`  - x402 Payments: /x402`)
  console.log(`  - Agent Card: /.well-known/agent-card.json`)
})
