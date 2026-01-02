/**
 * VPN API Worker
 *
 * Decentralized VPN service - workerd-compatible API worker.
 * Provides VPN connection management, node discovery, and fair contribution model.
 *
 * @see https://elysiajs.com/integrations/cloudflare-worker
 */

import { cors } from '@elysiajs/cors'
import {
  getCoreAppUrl,
  getCurrentNetwork,
  getLocalhostHost,
} from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { z } from 'zod'

/**
 * Worker Environment Types
 */
export interface VPNWorkerEnv {
  NETWORK: 'localnet' | 'testnet' | 'mainnet'
  RPC_URL: string
  DWS_URL: string
  VPN_REGISTRY_ADDRESS?: string
  VPN_BILLING_ADDRESS?: string
  X402_FACILITATOR_ADDRESS?: string
  PAYMENT_RECIPIENT_ADDRESS?: string
  PAYMENT_TOKEN_ADDRESS?: string
  VPN_CACHE?: KVNamespace
}

interface KVNamespace {
  get(key: string): Promise<string | null>
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>
  delete(key: string): Promise<void>
}

// Schemas
const ConnectRequestSchema = z.object({
  countryCode: z.string().optional(),
  protocol: z.enum(['wireguard', 'socks5']).default('wireguard'),
})

const DisconnectRequestSchema = z.object({
  sessionId: z.string(),
})

const ProxyRequestSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET'),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  countryCode: z.string().optional(),
})

// In-memory state (in production would use DWS storage/SQLit)
const nodes = new Map<
  string,
  {
    id: string
    countryCode: string
    endpoint: string
    publicKey: string
    load: number
    reputation: number
  }
>()

const sessions = new Map<
  string,
  {
    id: string
    userId: string
    nodeId: string
    protocol: string
    bytesTransferred: number
    createdAt: number
  }
>()

const contributions = new Map<
  string,
  {
    bytesUsed: number
    bytesContributed: number
    lastUpdated: number
  }
>()

/**
 * Create the VPN Elysia app
 */
export function createVPNApp(env?: Partial<VPNWorkerEnv>) {
  const network = env?.NETWORK ?? getCurrentNetwork()
  const isDev = network === 'localnet'

  const app = new Elysia()
    .use(
      cors({
        origin: isDev
          ? true
          : [
              'https://vpn.jejunetwork.org',
              'https://app.jejunetwork.org',
              getCoreAppUrl('VPN'),
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

    // Health check
    .get('/health', () => ({
      status: 'ok',
      service: 'vpn-api',
      version: '1.0.0',
      network,
      runtime: 'workerd',
    }))

    // Version info
    .get('/version', () => ({
      name: 'Jeju VPN',
      version: '1.0.0',
      protocols: ['wireguard', 'socks5', 'http-connect'],
      features: ['x402', 'a2a', 'mcp', 'fair-contribution'],
    }))

    // ============================================
    // REST API Routes
    // ============================================
    .group('/api/v1', (api) =>
      api
        // List available nodes
        .get('/nodes', ({ query }) => {
          const countryCode = query.country as string | undefined
          const nodeList = Array.from(nodes.values())
            .filter((n) => !countryCode || n.countryCode === countryCode)
            .map((n) => ({
              id: n.id,
              countryCode: n.countryCode,
              endpoint: n.endpoint,
              load: n.load,
              reputation: n.reputation,
            }))

          return {
            nodes: nodeList,
            total: nodeList.length,
          }
        })

        // Connect to VPN
        .post('/connect', async ({ body, headers, set }) => {
          const parsed = ConnectRequestSchema.safeParse(body)
          if (!parsed.success) {
            set.status = 400
            return { error: 'Invalid request', details: parsed.error.issues }
          }

          const address = headers['x-jeju-address']
          if (!address) {
            set.status = 401
            return { error: 'Authentication required' }
          }

          // Find available node
          const availableNodes = Array.from(nodes.values())
            .filter(
              (n) =>
                !parsed.data.countryCode ||
                n.countryCode === parsed.data.countryCode,
            )
            .filter((n) => n.load < 0.9)
            .sort((a, b) => a.load - b.load)

          if (availableNodes.length === 0) {
            // Return mock connection for demo
            const sessionId = crypto.randomUUID()
            sessions.set(sessionId, {
              id: sessionId,
              userId: address,
              nodeId: 'mock-node',
              protocol: parsed.data.protocol,
              bytesTransferred: 0,
              createdAt: Date.now(),
            })

            return {
              sessionId,
              endpoint: 'vpn.jejunetwork.org:51820',
              publicKey: 'mock-public-key-base64',
              protocol: parsed.data.protocol,
              config:
                parsed.data.protocol === 'wireguard'
                  ? {
                      interface: {
                        address: '10.0.0.2/32',
                        dns: '1.1.1.1',
                      },
                      peer: {
                        publicKey: 'mock-public-key-base64',
                        endpoint: 'vpn.jejunetwork.org:51820',
                        allowedIPs: '0.0.0.0/0',
                      },
                    }
                  : {
                      host: 'vpn.jejunetwork.org',
                      port: 1080,
                      username: sessionId,
                    },
            }
          }

          const node = availableNodes[0]
          const sessionId = crypto.randomUUID()

          sessions.set(sessionId, {
            id: sessionId,
            userId: address,
            nodeId: node.id,
            protocol: parsed.data.protocol,
            bytesTransferred: 0,
            createdAt: Date.now(),
          })

          return {
            sessionId,
            endpoint: node.endpoint,
            publicKey: node.publicKey,
            protocol: parsed.data.protocol,
          }
        })

        // Disconnect from VPN
        .post('/disconnect', async ({ body, headers, set }) => {
          const parsed = DisconnectRequestSchema.safeParse(body)
          if (!parsed.success) {
            set.status = 400
            return { error: 'Invalid request', details: parsed.error.issues }
          }

          const address = headers['x-jeju-address']
          if (!address) {
            set.status = 401
            return { error: 'Authentication required' }
          }

          const session = sessions.get(parsed.data.sessionId)
          if (!session) {
            set.status = 404
            return { error: 'Session not found' }
          }

          if (session.userId !== address) {
            set.status = 403
            return { error: 'Not authorized' }
          }

          sessions.delete(parsed.data.sessionId)

          return {
            success: true,
            bytesTransferred: session.bytesTransferred,
            duration: Date.now() - session.createdAt,
          }
        })

        // Get contribution status
        .get('/contribution', ({ headers, set }) => {
          const address = headers['x-jeju-address']
          if (!address) {
            set.status = 401
            return { error: 'Authentication required' }
          }

          const contribution = contributions.get(address) ?? {
            bytesUsed: 0,
            bytesContributed: 0,
            lastUpdated: Date.now(),
          }

          // Fair contribution model: 1:1 ratio
          const quotaRemaining = Math.max(
            0,
            contribution.bytesContributed - contribution.bytesUsed,
          )

          return {
            bytesUsed: contribution.bytesUsed,
            bytesContributed: contribution.bytesContributed,
            quotaRemaining,
            ratio:
              contribution.bytesContributed > 0
                ? contribution.bytesUsed / contribution.bytesContributed
                : 0,
          }
        })

        // Proxy HTTP request through VPN
        .post('/proxy', async ({ body, headers, set }) => {
          const parsed = ProxyRequestSchema.safeParse(body)
          if (!parsed.success) {
            set.status = 400
            return { error: 'Invalid request', details: parsed.error.issues }
          }

          const address = headers['x-jeju-address']
          if (!address) {
            set.status = 401
            return { error: 'Authentication required' }
          }

          // Check x402 payment for paid requests
          const payment = headers['x-payment']
          if (!payment) {
            set.status = 402
            return {
              error: 'Payment required',
              x402: {
                accepts: ['USDC', 'ETH', 'JEJU'],
                pricePerRequest: '0.0001',
              },
            }
          }

          // Execute proxy request
          try {
            const response = await fetch(parsed.data.url, {
              method: parsed.data.method,
              headers: parsed.data.headers,
              body: parsed.data.body,
            })

            const responseBody = await response.text()

            // Track usage
            const contribution = contributions.get(address) ?? {
              bytesUsed: 0,
              bytesContributed: 0,
              lastUpdated: Date.now(),
            }
            contribution.bytesUsed += responseBody.length
            contribution.lastUpdated = Date.now()
            contributions.set(address, contribution)

            return {
              status: response.status,
              headers: Object.fromEntries(response.headers.entries()),
              body: responseBody,
              bytesUsed: responseBody.length,
            }
          } catch (err) {
            set.status = 502
            return {
              error: 'Proxy request failed',
              details: err instanceof Error ? err.message : 'Unknown error',
            }
          }
        }),
    )

    // ============================================
    // A2A Protocol
    // ============================================
    .group('/a2a', (a2a) =>
      a2a
        .get('/', () => ({
          name: 'VPN',
          description: 'Decentralized VPN Service',
          version: '1.0.0',
          protocol: 'a2a',
          capabilities: [
            'vpn_connect',
            'vpn_disconnect',
            'get_nodes',
            'proxy_request',
            'get_contribution',
          ],
        }))
        .post('/invoke', async ({ body, set }) => {
          const parsed = z
            .object({
              skill: z.string(),
              params: z.record(z.string(), z.unknown()).optional(),
            })
            .safeParse(body)

          if (!parsed.success) {
            set.status = 400
            return {
              error: 'Invalid A2A request',
              details: parsed.error.issues,
            }
          }

          const { skill, params } = parsed.data

          switch (skill) {
            case 'vpn_connect': {
              const sessionId = crypto.randomUUID()
              return {
                result: {
                  sessionId,
                  endpoint: 'vpn.jejunetwork.org:51820',
                  protocol: params?.protocol ?? 'wireguard',
                },
              }
            }
            case 'get_nodes': {
              return {
                result: {
                  nodes: Array.from(nodes.values()).map((n) => ({
                    id: n.id,
                    countryCode: n.countryCode,
                    load: n.load,
                  })),
                },
              }
            }
            default:
              return { skill, result: 'Skill executed' }
          }
        }),
    )

    // ============================================
    // MCP Protocol
    // ============================================
    .group('/mcp', (mcp) =>
      mcp
        .get('/', () => ({
          name: 'VPN MCP Server',
          version: '1.0.0',
          tools: [
            {
              name: 'vpn_connect',
              description: 'Connect to VPN',
              parameters: {
                type: 'object',
                properties: {
                  countryCode: {
                    type: 'string',
                    description: 'Target country',
                  },
                  protocol: {
                    type: 'string',
                    enum: ['wireguard', 'socks5'],
                    description: 'VPN protocol',
                  },
                },
              },
            },
            {
              name: 'vpn_disconnect',
              description: 'Disconnect VPN session',
              parameters: {
                type: 'object',
                properties: {
                  sessionId: { type: 'string', description: 'Session ID' },
                },
                required: ['sessionId'],
              },
            },
            {
              name: 'vpn_nodes',
              description: 'List available VPN nodes',
              parameters: {
                type: 'object',
                properties: {
                  countryCode: {
                    type: 'string',
                    description: 'Filter by country',
                  },
                },
              },
            },
            {
              name: 'vpn_proxy',
              description: 'Make HTTP request through VPN',
              parameters: {
                type: 'object',
                properties: {
                  url: { type: 'string', description: 'Target URL' },
                  method: { type: 'string', description: 'HTTP method' },
                },
                required: ['url'],
              },
            },
          ],
        }))
        .post('/invoke', async ({ body, set }) => {
          const parsed = z
            .object({
              tool: z.string(),
              arguments: z.record(z.string(), z.unknown()),
            })
            .safeParse(body)

          if (!parsed.success) {
            set.status = 400
            return {
              error: 'Invalid MCP request',
              details: parsed.error.issues,
            }
          }

          return { tool: parsed.data.tool, result: 'Tool executed' }
        }),
    )

    // ============================================
    // Agent Card
    // ============================================
    .get('/.well-known/agent-card.json', () => ({
      protocolVersion: '1.0',
      name: 'Jeju VPN Agent',
      description: 'Decentralized VPN service with fair contribution model',
      url: 'https://vpn.jejunetwork.org',
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
          paymentRequired: false,
        },
        {
          id: 'vpn_disconnect',
          name: 'Disconnect VPN',
          description: 'End the current VPN session',
        },
        {
          id: 'get_nodes',
          name: 'List VPN Nodes',
          description: 'Get available VPN exit nodes',
        },
        {
          id: 'proxy_request',
          name: 'Proxy HTTP Request',
          description: 'Make an HTTP request through the VPN network',
          paymentRequired: true,
        },
        {
          id: 'get_contribution',
          name: 'Get Contribution Status',
          description: 'Get your fair contribution quota status',
        },
      ],
    }))

  return app
}

/**
 * Default export for workerd
 */
const app = createVPNApp()

export default {
  fetch: app.fetch,
}

/**
 * Bun server entry point (for local development)
 */
if (typeof Bun !== 'undefined') {
  const port = process.env.PORT ?? process.env.VPN_API_PORT ?? 4021
  const host = getLocalhostHost()

  console.log(`[VPN Worker] Starting on http://${host}:${port}`)
  console.log(`[VPN Worker] Network: ${getCurrentNetwork()}`)

  Bun.serve({
    port: Number(port),
    hostname: host,
    fetch: app.fetch,
  })
}
