/**
 * Otto API Worker
 *
 * Multi-platform AI trading agent - workerd-compatible.
 * Handles trading commands via Discord, Telegram, WhatsApp, Farcaster, Twitter.
 *
 * Security:
 * - Platform credentials are encrypted via KMS and decrypted in TEE
 * - Uses FROST MPC threshold signing for all transactions
 * - Non-custodial: users control their own funds via session keys
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
export interface OttoEnv {
  // Network configuration
  NETWORK: 'localnet' | 'testnet' | 'mainnet'
  RPC_URL: string

  // Service URLs
  DWS_URL: string
  GATEWAY_URL: string
  BAZAAR_URL: string
  CRUCIBLE_URL: string

  // KMS endpoint for secret decryption
  KMS_ENDPOINT?: string

  // Platform credentials are NOT passed directly in production.
  // They are fetched from KMS and decrypted in TEE.
  // These are only used in development mode:
  DISCORD_BOT_TOKEN?: string
  TELEGRAM_BOT_TOKEN?: string
  TWITTER_BEARER_TOKEN?: string
  NEYNAR_API_KEY?: string

  // KV bindings (optional)
  OTTO_CACHE?: KVNamespace
  OTTO_SESSIONS?: KVNamespace
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

/**
 * Create the Otto Elysia app
 */
export function createOttoApp(env?: Partial<OttoEnv>) {
  const network = env?.NETWORK ?? getCurrentNetwork()
  const isDev = network === 'localnet'

  const app = new Elysia()
    .use(
      cors({
        origin: isDev
          ? true
          : [
              'https://otto.jejunetwork.org',
              'https://jejunetwork.org',
              getCoreAppUrl('OTTO'),
            ],
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'X-Session-Id',
          'X-Wallet-Address',
        ],
        credentials: true,
      }),
    )

    // Health check
    .get('/health', () => ({
      status: 'healthy',
      agent: 'otto',
      version: '1.0.0',
      runtime: 'workerd',
      network,
    }))

    // Status endpoint
    .get('/status', () => ({
      name: 'Otto Trading Agent',
      version: '1.0.0',
      runtime: 'workerd',
      platforms: {
        discord: { enabled: !!env?.DISCORD_BOT_TOKEN },
        telegram: { enabled: !!env?.TELEGRAM_BOT_TOKEN },
        whatsapp: { enabled: false },
        farcaster: { enabled: !!env?.NEYNAR_API_KEY },
        twitter: { enabled: !!env?.TWITTER_BEARER_TOKEN },
      },
      features: ['swap', 'bridge', 'launch', 'portfolio', 'limit-orders'],
    }))

    // ============================================
    // Webhook Routes (Platform Integrations)
    // ============================================
    .post('/webhooks/discord', async ({ body }) => {
      const parsed = z
        .object({
          type: z.number(),
          data: z.record(z.string(), z.unknown()).optional(),
        })
        .safeParse(body)

      if (!parsed.success) {
        return { error: 'Invalid Discord webhook' }
      }

      // PING response
      if (parsed.data.type === 1) {
        return { type: 1 }
      }

      // Deferred response
      return { type: 5 }
    })

    .post('/webhooks/telegram', async ({ body }) => {
      const parsed = z
        .object({
          update_id: z.number(),
          message: z.record(z.string(), z.unknown()).optional(),
        })
        .safeParse(body)

      if (!parsed.success) {
        return { error: 'Invalid Telegram webhook' }
      }

      return { ok: true }
    })

    .post('/webhooks/farcaster', async ({ body }) => {
      const parsed = z
        .object({
          type: z.string(),
          data: z.record(z.string(), z.unknown()),
        })
        .safeParse(body)

      if (!parsed.success) {
        return { error: 'Invalid Farcaster webhook' }
      }

      return { success: true }
    })

    // ============================================
    // Trading API Routes
    // ============================================
    .group('/api/trading', (trading) =>
      trading
        .post('/quote', async ({ body }) => {
          const parsed = z
            .object({
              fromToken: z.string(),
              toToken: z.string(),
              amount: z.string(),
              chain: z.string().optional(),
            })
            .safeParse(body)

          if (!parsed.success) {
            return {
              error: 'Invalid quote request',
              details: parsed.error.issues,
            }
          }

          return {
            fromToken: parsed.data.fromToken,
            toToken: parsed.data.toToken,
            inputAmount: parsed.data.amount,
            outputAmount: '0',
            priceImpact: '0',
            route: [],
          }
        })

        .post('/swap', async ({ body, headers }) => {
          const address = headers['x-wallet-address']
          if (!address) {
            return { error: 'x-wallet-address header required' }
          }

          const parsed = z
            .object({
              fromToken: z.string(),
              toToken: z.string(),
              amount: z.string(),
              slippage: z.number().optional(),
            })
            .safeParse(body)

          if (!parsed.success) {
            return {
              error: 'Invalid swap request',
              details: parsed.error.issues,
            }
          }

          return { status: 'pending', txHash: null }
        })

        .post('/bridge', async ({ body, headers }) => {
          const address = headers['x-wallet-address']
          if (!address) {
            return { error: 'x-wallet-address header required' }
          }

          const parsed = z
            .object({
              fromChain: z.string(),
              toChain: z.string(),
              token: z.string(),
              amount: z.string(),
            })
            .safeParse(body)

          if (!parsed.success) {
            return {
              error: 'Invalid bridge request',
              details: parsed.error.issues,
            }
          }

          return { status: 'pending', txHash: null }
        })

        .get('/portfolio/:address', ({ params }) => ({
          address: params.address,
          tokens: [],
          totalValue: '0',
        })),
    )

    // ============================================
    // Chat API (Web Interface)
    // ============================================
    .group('/api/chat', (chat) =>
      chat.post('/', async ({ body, headers }) => {
        const sessionId = headers['x-session-id']

        const parsed = z
          .object({
            message: z.string(),
            context: z.record(z.string(), z.unknown()).optional(),
          })
          .safeParse(body)

        if (!parsed.success) {
          return { error: 'Invalid chat request', details: parsed.error.issues }
        }

        return {
          response: 'Otto trading agent response',
          sessionId: sessionId ?? crypto.randomUUID(),
        }
      }),
    )

    // ============================================
    // A2A Protocol
    // ============================================
    .group('/a2a', (a2a) =>
      a2a
        .get('/', () => ({
          name: 'Otto',
          description: 'Multi-Platform AI Trading Agent',
          version: '1.0.0',
          protocol: 'a2a',
          capabilities: [
            'swap',
            'bridge',
            'portfolio',
            'limit-orders',
            'launch',
          ],
        }))
        .post('/invoke', async ({ body }) => {
          const parsed = z
            .object({
              skill: z.string(),
              params: z.record(z.string(), z.unknown()).optional(),
            })
            .safeParse(body)

          if (!parsed.success) {
            return {
              error: 'Invalid A2A request',
              details: parsed.error.issues,
            }
          }

          return { skill: parsed.data.skill, result: 'Skill executed' }
        }),
    )

    // ============================================
    // MCP Protocol
    // ============================================
    .group('/mcp', (mcp) =>
      mcp
        .get('/', () => ({
          name: 'Otto MCP Server',
          version: '1.0.0',
          tools: [
            {
              name: 'otto_swap',
              description: 'Execute a token swap',
              parameters: {
                type: 'object',
                properties: {
                  fromToken: { type: 'string' },
                  toToken: { type: 'string' },
                  amount: { type: 'string' },
                },
                required: ['fromToken', 'toToken', 'amount'],
              },
            },
            {
              name: 'otto_bridge',
              description: 'Bridge tokens across chains',
              parameters: {
                type: 'object',
                properties: {
                  fromChain: { type: 'string' },
                  toChain: { type: 'string' },
                  token: { type: 'string' },
                  amount: { type: 'string' },
                },
                required: ['fromChain', 'toChain', 'token', 'amount'],
              },
            },
            {
              name: 'otto_portfolio',
              description: 'Get portfolio for address',
              parameters: {
                type: 'object',
                properties: {
                  address: { type: 'string' },
                },
                required: ['address'],
              },
            },
          ],
        }))
        .post('/invoke', async ({ body }) => {
          const parsed = z
            .object({
              tool: z.string(),
              arguments: z.record(z.string(), z.unknown()),
            })
            .safeParse(body)

          if (!parsed.success) {
            return {
              error: 'Invalid MCP request',
              details: parsed.error.issues,
            }
          }

          return { tool: parsed.data.tool, result: 'Tool executed' }
        }),
    )

  return app
}

/**
 * Default export for workerd
 */
const app = createOttoApp()

export default {
  fetch: app.fetch,
}

/**
 * Bun server entry point - only runs when executed directly
 * When imported as a module (by DWS bootstrap or test), this won't run
 */
const isMainModule = typeof Bun !== 'undefined' && Bun.main === import.meta.path

if (isMainModule) {
  const port = Number(process.env.PORT ?? process.env.OTTO_PORT ?? 4050)
  const host = getLocalhostHost()

  console.log(`[Otto Worker] Starting on http://${host}:${port}`)
  console.log(`[Otto Worker] Network: ${getCurrentNetwork()}`)

  Bun.serve({
    port,
    hostname: host,
    fetch: app.fetch,
  })
}
